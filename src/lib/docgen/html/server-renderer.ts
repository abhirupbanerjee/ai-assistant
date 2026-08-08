/**
 * Server-side renderer for charts and mermaid diagrams using Playwright.
 *
 * Renders Chart.js charts to PNG data-URLs and Mermaid diagrams to inline SVG
 * so the generated HTML is fully self-contained with zero client-side JS dependencies.
 *
 * Falls back to client-side rendering if Playwright is unavailable.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ChartBlockConfig } from './types';
import { escapeHtml } from './markdown/escape';
import { mermaidInitConfigJson } from '@/lib/diagram-gen/mermaid-config';

// ============ Types ============

export interface RenderedChart {
  /** base64 data-URL PNG of the rendered chart */
  pngDataUrl: string;
  /** Chart title for alt text */
  title: string;
}

export interface RenderedDiagram {
  /** Inline SVG string */
  svg: string;
  /** Original mermaid source (for <details> disclosure) */
  source: string;
}

export interface ServerRenderResult {
  charts: Map<number, RenderedChart>;
  diagrams: Map<number, RenderedDiagram>;
  /** If true, Playwright was unavailable — caller should fall back to client-side */
  fallbackToClient: boolean;
}

// ============ Playwright singleton ============

let _browser: import('playwright').Browser | null = null;
let _browserLaunching: Promise<import('playwright').Browser> | null = null;
let _playwrightAvailable: boolean | null = null;

async function getBrowser(): Promise<import('playwright').Browser | null> {
  if (_browser && _browser.isConnected()) return _browser;
  if (_playwrightAvailable === false) return null;

  try {
    const { chromium } = await import('playwright');
    if (!_browserLaunching) {
      _browserLaunching = chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      });
    }
    _browser = await _browserLaunching;
    _browserLaunching = null;
    _playwrightAvailable = true;

    // Clean up on unexpected disconnect — register only once to avoid listener leak
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(_browser as any).listenerCount('disconnected')) {
      _browser.on('disconnected', () => { _browser = null; });
    }

    return _browser;
  } catch (err) {
    _playwrightAvailable = false;
    _browserLaunching = null;
    console.warn('[ServerRenderer] Playwright not available, falling back to client-side rendering:', (err as Error).message);
    return null;
  }
}

/**
 * Gracefully close the browser instance (call on process shutdown).
 */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// ============ Vendor bundle readers ============

function readLocalFile(...segments: string[]): string | null {
  const appRoot = process.env.APP_ROOT ?? process.cwd();
  const filePath = path.join(appRoot, ...segments);
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch { /* ignore */ }
  return null;
}

function getChartJsBundle(): string {
  return readLocalFile('public', 'vendor', 'chart.umd.min.js')
    ?? readLocalFile('node_modules', 'chart.js', 'dist', 'chart.umd.min.js')
    ?? readLocalFile('node_modules', 'chart.js', 'dist', 'chart.umd.js')
    ?? '';
}

function getChartJsDatalabelsBundle(): string {
  return readLocalFile('public', 'vendor', 'chartjs-plugin-datalabels.min.js')
    ?? readLocalFile('node_modules', 'chartjs-plugin-datalabels', 'dist', 'chartjs-plugin-datalabels.min.js')
    ?? '';
}

function getMermaidBundle(): string {
  return readLocalFile('public', 'vendor', 'mermaid.min.js')
    ?? readLocalFile('node_modules', 'mermaid', 'dist', 'mermaid.min.js')
    ?? '';
}

// ============ Standalone Mermaid → SVG (Phase 3 internal endpoint) ============

/**
 * Render a single Mermaid diagram to an SVG string using the self-hosted
 * Playwright + bundled mermaid.min.js pipeline. Air-gap safe — NO external
 * egress (mermaid.ink/pako dropped per user constraint).
 *
 * Used by the /api/diagram/render endpoint as a client-side render fallback.
 * Reuses the same getBrowser()/getMermaidBundle() as serverRenderAll so the
 * browser instance and vendor bundle are shared.
 *
 * @returns SVG string on success, or null if Playwright is unavailable or
 *          the diagram fails to render.
 */
export async function renderMermaidToSvg(code: string): Promise<string | null> {
  const mermaidBundle = getMermaidBundle();
  if (!mermaidBundle) return null;

  const browser = await getBrowser();
  if (!browser) return null;

  let page: import('playwright').Page | null = null;
  try {
    page = await browser.newPage();
    const html = `<!DOCTYPE html><html><head>
<script>${mermaidBundle}</script>
<style>body{margin:0;padding:20px;font-family:system-ui,sans-serif;} .mermaid{display:flex;justify-content:center;}</style>
</head><body>
<div class="mermaid" id="mermaid-target"></div>
<script>
(function(){
  mermaid.initialize(${mermaidInitConfigJson()});
  window.__mermaidCheck = function() {
    var el = document.getElementById('mermaid-target');
    return el && el.querySelector('svg') !== null;
  };
})();
</script>
</body></html>`;

    await page.setContent(html, { waitUntil: 'load' });

    // Inject raw mermaid source via textContent (safe — no HTML parsing).
    await page.evaluate((src) => {
      const el = document.getElementById('mermaid-target');
      if (el) el.textContent = src;
    }, code);

    // Trigger mermaid.run() to process the populated div.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mmd = (globalThis as any).mermaid;
      if (mmd?.run) {
        await mmd.run({ nodes: [document.getElementById('mermaid-target')!] });
      } else if (mmd?.init) {
        await mmd.init(undefined, '#mermaid-target');
      }
    });

    // Wait for mermaid to render (up to 15s).
    try {
      await page.waitForFunction('window.__mermaidCheck()', { timeout: 15000 });
    } catch {
      // Mermaid may have rendered despite the check failing; try to get SVG.
    }

    // Extract the SVG.
    let svgHtml = await page.evaluate(() => {
      const el = document.getElementById('mermaid-target');
      const svg = el?.querySelector('svg');
      return svg ? svg.outerHTML : null;
    });

    // Fallback to mermaid.render() API directly. Capture the mermaid error
    // detail (mermaid throws plain objects {str, message}, not Error) so the
    // server log shows the real syntax error instead of "page.evaluate: Object".
    if (!svgHtml) {
      svgHtml = await page.evaluate(async (src) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mmd = (globalThis as any).mermaid;
          if (!mmd) return null;
          const id = 'mermaid-svg-' + Date.now();
          const { svg } = await mmd.render(id, src);
          return svg;
        } catch (e) {
          // Return the mermaid error string so the catch below can log it.
          // mermaid v11 throws { str, message } objects; fall back to String().
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const eAny = e as any;
          return '__MERMAID_ERROR__:' + (eAny?.str || eAny?.message || String(e)).substring(0, 300);
        }
      }, code);
      // If the fallback returned our error sentinel, surface it and treat as failure.
      if (typeof svgHtml === 'string' && svgHtml.startsWith('__MERMAID_ERROR__:')) {
        console.warn('[ServerRenderer] mermaid.render() failed:', svgHtml.slice('__MERMAID_ERROR__:'.length));
        svgHtml = null;
      }
    }

    return svgHtml;
  } catch (err) {
    // Playwright wraps page.evaluate rejections; the real browser-side error
    // text is embedded in err.message (after "page.evaluate:" / "Error:").
    // Serialize the full error to avoid the opaque "page.evaluate: Object".
    const e = err as Error & { cause?: unknown };
    const detail = e?.message || String(e);
    const cause = e?.cause ? `\n  cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)}` : '';
    console.warn(`[ServerRenderer] renderMermaidToSvg failed: ${detail}${cause}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ============ Chart config builder (with datalabels) ============

function buildChartConfigWithLabels(config: ChartBlockConfig): Record<string, unknown> {
  const chartType = resolveChartType(config);
  const isPie = chartType === 'pie' || chartType === 'doughnut';

  const baseConfig = JSON.parse(buildChartJsConfigOriginal(config, chartType));

  // Add datalabels plugin config
  if (isPie) {
    baseConfig.plugins = baseConfig.plugins || {};
    baseConfig.plugins.datalabels = {
      color: '#fff',
      font: { weight: 'bold', size: 11 },
      formatter: function(value: number, ctx: { chart: { data: { labels: string[]; datasets: Array<{ data: number[] }> }; getDatasetMeta: (i: number) => { data: Array<{ outerRadius: number; innerRadius: number }> }; width: number }; dataIndex: number; datasetIndex: number }) {
        const label = ctx.chart.data.labels[ctx.dataIndex];
        const total = ctx.chart.data.datasets[ctx.datasetIndex].data.reduce((a: number, b: number) => a + b, 0);
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
        return `${label}\n${value} (${pct}%)`;
      },
      textAlign: 'center',
      display: function(ctx: { chart: { getDatasetMeta: (i: number) => { data: Array<{ outerRadius: number; innerRadius: number }> }; width: number }; datasetIndex: number; dataIndex: number }) {
        // Hide labels for very small slices
        const dataset = ctx.chart.getDatasetMeta(ctx.datasetIndex);
        if (!dataset.data[ctx.dataIndex]) return false;
        const { outerRadius, innerRadius = 0 } = dataset.data[ctx.dataIndex];
        const available = (outerRadius - innerRadius) / 2;
        return available > 20;
      },
    };
  } else {
    // Bar / line / area
    baseConfig.plugins = baseConfig.plugins || {};
    baseConfig.plugins.datalabels = {
      anchor: 'end',
      align: 'top',
      font: { size: 10, weight: '600' },
      formatter: function(value: number) {
        if (value === 0) return '';
        if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
        if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
        return String(value);
      },
      color: '#374151',
    };
  }

  // Format y-axis ticks with thousands separators
  if (!isPie && baseConfig.options?.scales?.y) {
    baseConfig.options.scales.y.ticks = baseConfig.options.scales.y.ticks || {};
    baseConfig.options.scales.y.ticks.callback = function(value: number) {
      return new Intl.NumberFormat('en').format(value);
    };
  }

  // Rich tooltips
  if (baseConfig.plugins) {
    baseConfig.plugins.tooltip = {
      callbacks: {
        label: function(ctx: { dataset: { label?: string }; parsed: { y?: number; x?: number }; label?: string }) {
          const label = ctx.dataset?.label || '';
          const value = ctx.parsed?.y ?? ctx.parsed?.x ?? 0;
          return `${label}: ${new Intl.NumberFormat('en').format(value)}`;
        },
      },
    };
  }

  return baseConfig;
}

function resolveChartType(config: ChartBlockConfig): string {
  const rec = config.recommended_chart;
  if (!rec || rec === 'auto') return autoSelectChartType(config);
  if (rec === 'area') return 'line';
  return rec;
}

function autoSelectChartType(config: ChartBlockConfig): string {
  if (!config.data || config.data.length === 0) return 'bar';
  const xVal = config.data[0][config.x_field];
  const isDate = /date|time|year|month|day|week/i.test(config.x_field) ||
    (typeof xVal === 'string' && !isNaN(Date.parse(xVal as string)));
  if (isDate) return 'line';
  const unique = new Set(config.data.map(d => d[config.x_field])).size;
  if (unique >= 2 && unique <= 8 && config.data.length <= 20 && config.y_fields.length === 1) return 'pie';
  return 'bar';
}

/**
 * Build Chart.js config (mirrors chartjs-config.ts but inline for server rendering).
 */
function buildChartJsConfigOriginal(config: ChartBlockConfig, chartType: string): string {
  const CHART_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a',
    '#0891b2', '#4f46e5', '#c026d3', '#dc2626', '#ca8a04',
    '#0d9488', '#9333ea',
  ];
  const colors = CHART_COLORS;

  if (chartType === 'pie' || chartType === 'doughnut') {
    const labels = config.data.map(d => String(d[config.x_field] ?? ''));
    const values = config.data.map(d => Number(d[config.y_fields[0]] ?? 0));
    return JSON.stringify({
      type: chartType,
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.slice(0, values.length),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: !!config.title, text: config.title || '' },
        },
      },
    });
  }

  const labels = config.data.map(d => String(d[config.x_field] ?? ''));
  const isArea = config.recommended_chart === 'area';
  const isStacked = config.series_mode === 'stacked' ||
    (config.series_mode === 'auto' && config.y_fields.length > 1);

  const datasets = config.y_fields.map((field, i) => {
    const color = colors[i % colors.length];
    const base: Record<string, unknown> = {
      label: field,
      data: config.data.map(d => Number(d[field] ?? 0)),
      backgroundColor: chartType === 'bar' ? color : color + '40',
      borderColor: color,
      borderWidth: 2,
    };
    if (isArea) base.fill = true;
    if (chartType === 'line') base.tension = 0.3;
    return base;
  });

  return JSON.stringify({
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: config.y_fields.length > 1 },
        title: { display: !!config.title, text: config.title || '' },
      },
      scales: {
        x: { stacked: isStacked },
        y: { stacked: isStacked, beginAtZero: true },
      },
    },
  });
}

// ============ Main render function ============

/**
 * Render all charts and diagrams server-side using Playwright.
 *
 * @param chartConfigs - Array of chart configs with their indices
 * @param diagramCodes - Array of mermaid code strings with their indices
 * @returns Rendered results, or fallback flag if Playwright is unavailable
 */
export async function serverRenderAll(
  chartConfigs: Array<{ index: number; config: ChartBlockConfig }>,
  diagramCodes: Array<{ index: number; code: string }>,
): Promise<ServerRenderResult> {
  const result: ServerRenderResult = {
    charts: new Map(),
    diagrams: new Map(),
    fallbackToClient: false,
  };

  // If nothing to render, return early
  if (chartConfigs.length === 0 && diagramCodes.length === 0) return result;

  const browser = await getBrowser();
  if (!browser) {
    result.fallbackToClient = true;
    return result;
  }

  const chartJsBundle = getChartJsBundle();
  const datalabelsBundle = getChartJsDatalabelsBundle();
  const mermaidBundle = getMermaidBundle();

  let page: import('playwright').Page | null = null;

  try {
    page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 800 });

    // ---- Render Charts ----
    if (chartConfigs.length > 0 && chartJsBundle) {
      for (const { index, config } of chartConfigs) {
        try {
          const chartConfig = buildChartConfigWithLabels(config);
          const chartConfigJson = JSON.stringify(chartConfig);

          // Set page content with Chart.js + datalabels + canvas
          const html = `<!DOCTYPE html><html><head>
<script>${chartJsBundle}</script>
${datalabelsBundle ? `<script>${datalabelsBundle}</script>` : ''}
<style>body{margin:0;padding:20px;font-family:system-ui,sans-serif;}</style>
</head><body>
<div id="chart-wrap" style="width:800px;height:450px;">
  <canvas id="chart-canvas"></canvas>
</div>
<script>
(function(){
  if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);
  var config = ${chartConfigJson};
  config.options = config.options || {};
  config.options.animation = { duration: 0 };
  config.options.responsive = true;
  config.options.maintainAspectRatio = false;
  var canvas = document.getElementById('chart-canvas');
  var chart = new Chart(canvas.getContext('2d'), config);
  window.__chartReady = true;
})();
</script>
</body></html>`;

          await page.setContent(html, { waitUntil: 'load' });
          await page.waitForFunction('window.__chartReady === true', { timeout: 10000 });

          // Small delay to ensure canvas is fully painted
          await page.waitForTimeout(200);

          const canvas = page.locator('#chart-canvas');

          // playwright screenshot returns Buffer, convert to data URL
          const screenshotBuffer = await canvas.screenshot({ type: 'png' });
          const base64 = screenshotBuffer.toString('base64');
          const dataUrl = `data:image/png;base64,${base64}`;

          result.charts.set(index, {
            pngDataUrl: dataUrl,
            title: config.title || 'Chart',
          });
        } catch (err) {
          console.warn(`[ServerRenderer] Chart ${index} render failed:`, (err as Error).message);
          // Leave this chart for client-side fallback
        }
      }
    }

    // ---- Render Mermaid Diagrams ----
    if (diagramCodes.length > 0 && mermaidBundle) {
      for (const { index, code } of diagramCodes) {
        try {
          // NOTE: mermaid reads textContent of the .mermaid div, so we must NOT
          // use escapeHtml() here — HTML entities like &lt; would be passed
          // literally to the mermaid parser and cause syntax errors.
          // Instead we set the div's textContent via page.evaluate() after load.
          const html = `<!DOCTYPE html><html><head>
<script>${mermaidBundle}</script>
<style>body{margin:0;padding:20px;font-family:system-ui,sans-serif;} .mermaid{display:flex;justify-content:center;}</style>
</head><body>
<div class="mermaid" id="mermaid-target"></div>
<script>
(function(){
  mermaid.initialize(${mermaidInitConfigJson()});
  window.__mermaidCheck = function() {
    var el = document.getElementById('mermaid-target');
    return el && el.querySelector('svg') !== null;
  };
})();
</script>
</body></html>`;

          await page.setContent(html, { waitUntil: 'load' });

          // Inject the raw mermaid source via textContent (safe: no HTML parsing)
          // then trigger mermaid.run() so it processes the div
          await page.evaluate((src) => {
            const el = document.getElementById('mermaid-target');
            if (el) el.textContent = src;
          }, code);

          // Trigger mermaid to render the now-populated div
          await page.evaluate(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mmd = (globalThis as any).mermaid;
            if (mmd?.run) {
              await mmd.run({ nodes: [document.getElementById('mermaid-target')!] });
            } else if (mmd?.init) {
              await mmd.init(undefined, '#mermaid-target');
            }
          });

          // Wait for mermaid to render (up to 15s)
          try {
            await page.waitForFunction('window.__mermaidCheck()', { timeout: 15000 });
          } catch {
            // Mermaid might have rendered but our check failed; try to get SVG anyway
          }

          // Extract the SVG
          const svgHtml = await page.evaluate(() => {
            const el = document.getElementById('mermaid-target');
            const svg = el?.querySelector('svg');
            return svg ? svg.outerHTML : null;
          });

          if (svgHtml) {
            result.diagrams.set(index, {
              svg: svgHtml,
              source: code,
            });
          } else {
            // Try mermaid.render() API directly
            const svgFromRender = await page.evaluate(async (src) => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mmd = (globalThis as any).mermaid;
                if (!mmd) return null;
                const id = 'mermaid-svg-' + Date.now();
                const { svg } = await mmd.render(id, src);
                return svg;
              } catch { return null; }
            }, code);

            if (svgFromRender) {
              result.diagrams.set(index, {
                svg: svgFromRender,
                source: code,
              });
            } else {
              console.warn(`[ServerRenderer] Diagram ${index} render produced no SVG`);
            }
          }
        } catch (err) {
          console.warn(`[ServerRenderer] Diagram ${index} render failed:`, (err as Error).message);
          // Leave this diagram for client-side fallback
        }
      }
    }
  } catch (err) {
    console.warn('[ServerRenderer] Page-level error:', (err as Error).message);
    // If we got any results, keep them; otherwise fall back entirely
    if (result.charts.size === 0 && result.diagrams.size === 0) {
      result.fallbackToClient = true;
    }
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return result;
}

