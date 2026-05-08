/**
 * Smoke test for server-side HTML rendering (charts + mermaid diagrams).
 *
 * Run with:
 *   npx tsx scripts/test-html-rendering.ts
 *
 * Writes output to /tmp/html-render-smoke-test.html for manual inspection.
 */
import * as fs from 'fs';
import * as path from 'path';

// Set APP_ROOT so vendor bundle readers find node_modules
process.env.APP_ROOT = path.resolve(__dirname, '..');

// Dynamically import after env is set
async function main() {
  const { serverRenderAll, closeBrowser } = await import('../src/lib/docgen/html/server-renderer');

  const chartConfigs: Array<{ index: number; config: import('../src/lib/docgen/html/types').ChartBlockConfig }> = [
    {
      index: 0,
      config: {
        title: 'Revenue by Quarter',
        x_field: 'quarter',
        y_fields: ['revenue'],
        recommended_chart: 'bar',
        series_mode: 'auto',
        data: [
          { quarter: 'Q1', revenue: 120000 },
          { quarter: 'Q2', revenue: 185000 },
          { quarter: 'Q3', revenue: 210000 },
          { quarter: 'Q4', revenue: 175000 },
        ],
      },
    },
    {
      index: 1,
      config: {
        title: 'Market Share',
        x_field: 'segment',
        y_fields: ['share'],
        recommended_chart: 'pie',
        series_mode: 'auto',
        data: [
          { segment: 'Enterprise', share: 45 },
          { segment: 'SMB', share: 30 },
          { segment: 'Consumer', share: 25 },
        ],
      },
    },
  ];

  const diagramCodes: Array<{ index: number; code: string }> = [
    {
      index: 2,
      code: `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E`,
    },
    {
      index: 3,
      code: `sequenceDiagram
    participant User
    participant API
    participant DB
    User->>API: POST /report
    API->>DB: Query data
    DB-->>API: Results
    API-->>User: HTML report`,
    },
    {
      index: 4,
      code: `mindmap
  root((Policy Bot))
    Reports
      HTML
      PDF
    Chat
      RAG
      Memory
    Admin
      Users
      Settings`,
    },
  ];

  console.log('🚀 Starting server-side render smoke test...\n');

  const start = Date.now();
  let result;
  try {
    result = await serverRenderAll(chartConfigs, diagramCodes);
  } catch (err) {
    console.error('❌ serverRenderAll threw:', err);
    process.exit(1);
  } finally {
    await closeBrowser();
  }

  const elapsed = Date.now() - start;
  console.log(`⏱  Render completed in ${elapsed}ms\n`);

  if (result.fallbackToClient) {
    console.warn('⚠️  Playwright unavailable — fell back to client-side rendering');
  }

  // ---- Report results ----
  let allPassed = true;

  console.log('📊 Charts:');
  for (const { index, config } of chartConfigs) {
    const rendered = result.charts.get(index);
    if (rendered) {
      const sizeKb = Math.round(rendered.pngDataUrl.length / 1024);
      console.log(`  ✅ Chart ${index} (${config.title}): PNG ${sizeKb} KB`);
    } else {
      console.log(`  ❌ Chart ${index} (${config.title}): NOT RENDERED`);
      allPassed = false;
    }
  }

  console.log('\n🔷 Diagrams:');
  for (const { index, code } of diagramCodes) {
    const rendered = result.diagrams.get(index);
    const diagramType = code.trim().split('\n')[0].split(/\s/)[0];
    if (rendered) {
      const hasSvg = rendered.svg.includes('<svg');
      const svgSizeKb = Math.round(rendered.svg.length / 1024);
      if (hasSvg) {
        console.log(`  ✅ Diagram ${index} (${diagramType}): SVG ${svgSizeKb} KB`);
      } else {
        console.log(`  ⚠️  Diagram ${index} (${diagramType}): rendered but no <svg> tag found`);
        allPassed = false;
      }
    } else {
      console.log(`  ❌ Diagram ${index} (${diagramType}): NOT RENDERED`);
      allPassed = false;
    }
  }

  // ---- Write HTML output for visual inspection ----
  const outputPath = '/tmp/html-render-smoke-test.html';
  const sections: string[] = [];

  for (const { index, config } of chartConfigs) {
    const rendered = result.charts.get(index);
    if (rendered) {
      sections.push(`
        <section style="margin:24px 0;">
          <h3>${config.title}</h3>
          <img src="${rendered.pngDataUrl}" alt="${config.title}" style="max-width:800px;border:1px solid #e5e7eb;border-radius:8px;">
        </section>`);
    }
  }

  for (const { index, code } of diagramCodes) {
    const rendered = result.diagrams.get(index);
    const diagramType = code.trim().split('\n')[0].split(/\s/)[0];
    if (rendered) {
      sections.push(`
        <section style="margin:24px 0;">
          <h3>Diagram: ${diagramType}</h3>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;overflow-x:auto;">
            ${rendered.svg}
          </div>
          <details style="margin-top:8px;">
            <summary style="cursor:pointer;font-size:0.8rem;color:#6b7280;">Source</summary>
            <pre style="background:#f9fafb;padding:8px;border-radius:6px;font-size:11px;">${code.replace(/</g, '&lt;')}</pre>
          </details>
        </section>`);
    } else {
      sections.push(`
        <section style="margin:24px 0;">
          <h3>Diagram: ${diagramType}</h3>
          <p style="color:#dc2626;">❌ Not rendered</p>
          <pre style="background:#fef2f2;padding:8px;border-radius:6px;font-size:11px;">${code.replace(/</g, '&lt;')}</pre>
        </section>`);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HTML Render Smoke Test</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #1f2937; }
    h1 { font-size: 1.5rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
    h3 { font-size: 1rem; color: #374151; margin: 0 0 8px; }
    section { background: #fff; border-radius: 10px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  </style>
</head>
<body>
  <h1>🧪 HTML Render Smoke Test — ${new Date().toLocaleString()}</h1>
  <p>Render time: <strong>${elapsed}ms</strong> | Fallback: <strong>${result.fallbackToClient}</strong></p>
  ${sections.join('\n')}
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
  console.log(`\n📄 Visual output written to: ${outputPath}`);

  if (allPassed) {
    console.log('\n✅ All smoke tests passed!\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some renders failed — check output above.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
