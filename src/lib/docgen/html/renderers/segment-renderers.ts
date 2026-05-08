/**
 * Generic segment renderers (charts and diagrams).
 * Uses a RenderContext to avoid module-level mutable state.
 *
 * When server-rendered results are available, charts are emitted as <img> tags
 * (PNG data-URLs) and diagrams as inline SVG — no client-side JS needed.
 * Falls back to client-side rendering when server results are absent.
 */
import type { ChartSegment, DiagramSegment } from '../types';
import type { RenderedChart, RenderedDiagram } from '../server-renderer';
import { escapeHtml } from '../markdown/escape';
import { buildChartJsConfig } from '../charts/chartjs-config';

export interface RenderContext {
  nextChartId(): string;
  nextDiagramId(): string;
}

export function createRenderContext(): RenderContext {
  let chartCounter = 0;
  let diagramCounter = 0;
  return {
    nextChartId() {
      chartCounter++;
      return `chart-${chartCounter}`;
    },
    nextDiagramId() {
      diagramCounter++;
      return `diagram-${diagramCounter}`;
    },
  };
}

export function renderChartSegment(
  seg: ChartSegment,
  ctx: RenderContext,
  rendered?: RenderedChart,
): string {
  const id = ctx.nextChartId();
  const notesHtml = seg.config.notes
    ? `<details class="chart-notes"><summary>Notes</summary><p>${escapeHtml(seg.config.notes)}</p></details>`
    : '';

  // Server-rendered: emit static <img> with data-URL
  if (rendered) {
    return `
<div class="chart-card">
  ${seg.config.title ? `<h4 class="chart-title">${escapeHtml(seg.config.title)}</h4>` : ''}
  <div class="chart-container" data-chart-wrapper="true">
    <img src="${rendered.pngDataUrl}" alt="${escapeHtml(rendered.title)}" style="width:100%;height:auto;display:block;" data-chart-image="true">
  </div>
  ${notesHtml}
</div>`;
  }

  // Fallback: client-side Chart.js rendering
  const chartConfig = buildChartJsConfig(seg.config, id);
  const encodedConfig = Buffer.from(chartConfig, 'utf-8').toString('base64');
  return `
<div class="chart-card">
  ${seg.config.title ? `<h4 class="chart-title">${escapeHtml(seg.config.title)}</h4>` : ''}
  <div class="chart-container" data-chart-wrapper="true">
    <canvas id="${id}" data-chart-config="${encodedConfig}"></canvas>
  </div>
  ${notesHtml}
</div>`;
}

export function renderDiagramSegment(
  seg: DiagramSegment,
  ctx: RenderContext,
  rendered?: RenderedDiagram,
  fallbackToClient?: boolean,
): string {
  ctx.nextDiagramId();

  // Server-rendered: emit inline SVG with source disclosure
  if (rendered) {
    return `
<div class="diagram-card">
  <div class="diagram-svg-container" style="overflow-x:auto;">
    ${rendered.svg}
  </div>
  <details class="diagram-source" style="margin-top:8px;">
    <summary style="cursor:pointer;font-size:0.8rem;color:#6b7280;">Diagram source</summary>
    <pre style="background:#f9fafb;padding:8px;border-radius:6px;font-size:11px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(rendered.source)}</pre>
  </details>
</div>`;
  }

  // Fallback: client-side mermaid rendering
  const encodedSource = Buffer.from(seg.code, 'utf-8').toString('base64');
  return `
<div class="diagram-card">
  <div class="mermaid" data-mermaid-source="${encodedSource}">
    <pre style="color:#6b7280;font-size:12px;">Loading diagram...</pre>
  </div>
</div>`;
}