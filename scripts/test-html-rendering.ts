/**
 * Smoke test for server-side HTML rendering (charts + mermaid diagrams)
 * and Gantt/project_plan HTML generation.
 *
 * Run with:
 *   npx tsx scripts/test-html-rendering.ts
 *
 * Writes output to /tmp/html-render-smoke-test.html for manual inspection.
 * Gantt output: /tmp/html-gantt-test.html
 * Project plan output: /tmp/html-project-plan-test.html
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
  } else {
    console.log('\n❌ Some renders failed — check output above.\n');
  }

  // ---- Gantt / project_plan HTML generation tests ----
  console.log('\n📅 Gantt / Project Plan generation tests...\n');

  const { generateHtml } = await import('../src/lib/docgen/html/generate');

  const ganttContent = `
\`\`\`gantt
{
  "title": "Digital Grenada Deployment Roadmap",
  "subtitle": "Transformation Agents: Change Champions and Digital Ambassadors · May 2026 to February 2027",
  "start_date": "2026-05-01",
  "end_date": "2027-02-28",
  "axis": "weeks",
  "flag_colors": ["#CE1126", "#FCD116", "#009E60"],
  "categories": [
    { "id": "onboarding",  "label": "Onboarding",         "color": "#1f4e79" },
    { "id": "training",    "label": "Foundation Training", "color": "#2C5F7A" },
    { "id": "champions",   "label": "Change Champions",    "color": "#1f4e79" },
    { "id": "ambassadors", "label": "Digital Ambassadors", "color": "#CE1126" },
    { "id": "milestones",  "label": "Milestones",          "color": "#8B6914" }
  ],
  "tasks": [
    { "group": "Onboarding & Formation", "name": "Orientation",           "sub": "Week 1: team formation, introductions", "category": "onboarding",  "start": "2026-05-04", "end": "2026-05-08" },
    { "group": "Onboarding & Formation", "name": "Onboarding session",    "sub": "Week 3: full-day programme",            "category": "onboarding",  "start": "2026-05-18", "end": "2026-05-22" },
    { "group": "Onboarding & Formation", "name": "Deploy into live projects","sub": "Week 4: field deployment begins",     "category": "onboarding",  "start": "2026-05-25", "end": "2026-05-29" },
    { "group": "Foundation Training (June)", "name": "Account management intro",  "sub": "Holding MDA/community relationships", "category": "training", "start": "2026-06-01", "end": "2026-06-12" },
    { "group": "Foundation Training (June)", "name": "BA fundamentals",           "sub": "Self-paced with check-ins",           "category": "training", "start": "2026-06-01", "end": "2026-06-26" },
    { "group": "Foundation Training (June)", "name": "Data capture mechanics",    "sub": "Listening, documenting, journaling",  "category": "training", "start": "2026-06-08", "end": "2026-06-19" },
    { "group": "Foundation Training (June)", "name": "EA orientation",            "sub": "What you need to know",               "category": "training", "start": "2026-06-08", "end": "2026-06-19" },
    { "group": "Foundation Training (June)", "name": "Process reengineering basics","sub": "",                                  "category": "training", "start": "2026-06-08", "end": "2026-06-19" },
    { "group": "Foundation Training (June)", "name": "DTA culture orientation",   "sub": "",                                    "category": "training", "start": "2026-06-15", "end": "2026-06-19" },
    { "group": "Change Champions", "name": "EA baselining: first round",  "sub": "Visit MDAs, document use cases",       "category": "champions", "start": "2026-05-25", "end": "2026-08-14" },
    { "group": "Change Champions", "name": "First cycle reports submitted","sub": "Use cases, blockers, KPIs",            "category": "champions", "start": "2026-07-27", "end": "2026-08-07" },
    { "group": "Change Champions", "name": "EA baselining: second cycle", "sub": "Address blockers, deepen",             "category": "champions", "start": "2026-08-17", "end": "2026-11-06" },
    { "group": "Change Champions", "name": "G-Tax and Civil Registry engagement","sub": "Expand to additional services",  "category": "champions", "start": "2026-09-07", "end": "2026-12-18" },
    { "group": "Change Champions", "name": "Phase 1 findings compiled",   "sub": "Present to DTA leadership",           "category": "milestones","start": "2026-11-09", "end": "2026-11-20" },
    { "group": "Digital Ambassadors", "name": "Community awareness: first round","sub": "Outreach, events, social media","category": "ambassadors","start": "2026-05-04", "end": "2026-08-14" },
    { "group": "Digital Ambassadors", "name": "Feedback collection",      "sub": "Surveys, focus groups",               "category": "ambassadors","start": "2026-07-06", "end": "2026-08-14" },
    { "group": "Digital Ambassadors", "name": "Community awareness: second round","sub": "Deeper engagement",           "category": "ambassadors","start": "2026-08-17", "end": "2026-12-18" },
    { "group": "Digital Ambassadors", "name": "Phase 2 community report", "sub": "Compile and present findings",        "category": "milestones","start": "2026-12-07", "end": "2026-12-18" },
    { "group": "Programme Milestones", "name": "Mid-programme review",    "sub": "DTA leadership + agents",             "category": "milestones","start": "2026-09-14", "type": "diamond", "detail": "Mid-programme review with DTA leadership and all transformation agents" },
    { "group": "Programme Milestones", "name": "Final programme review",  "sub": "Outcomes, lessons learned",           "category": "milestones","start": "2027-01-25", "type": "diamond", "detail": "Final review: outcomes, lessons learned, recommendations for next cohort" },
    { "group": "Programme Milestones", "name": "Graduation & recognition","sub": "Ceremony and awards",                 "category": "milestones","start": "2027-02-08", "type": "diamond" }
  ]
}
\`\`\`
`;

  const branding = {
    enabled: false,
    logoUrl: '',
    organizationName: 'Digital Grenada',
    primaryColor: '#1f4e79',
    fontFamily: 'Segoe UI, Arial, sans-serif',
    header: { enabled: false, content: '' },
    footer: { enabled: false, content: '', includePageNumber: false },
    playbook: { tagline: '', heroSubtitle: '', heroDate: '', footerEntity: '', footerAgency: '', footerDate: '' },
  };

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Test gantt
  let ganttPassed = true;
  try {
    const ganttResult = await generateHtml({
      title: 'Digital Grenada Deployment Roadmap',
      content: ganttContent,
      branding,
      metadata: { author: 'Digital Grenada', date: today },
      pageType: 'gantt',
    });
    const ganttPath = '/tmp/html-gantt-test.html';
    fs.writeFileSync(ganttPath, ganttResult.buffer);
    const sizeKb = Math.round(ganttResult.buffer.length / 1024);
    console.log(`  ✅ gantt page generated: ${sizeKb} KB → ${ganttPath}`);
    console.log(`     pageType=${ganttResult.pageType}, charts=${ganttResult.chartCount}, diagrams=${ganttResult.diagramCount}`);
  } catch (err) {
    console.error('  ❌ gantt generation failed:', err);
    ganttPassed = false;
    allPassed = false;
  }

  // Test project_plan
  let projectPlanPassed = true;
  try {
    const ppResult = await generateHtml({
      title: 'Digital Grenada Deployment Roadmap',
      content: ganttContent,
      branding,
      metadata: { author: 'Digital Grenada', date: today },
      pageType: 'project_plan',
    });
    const ppPath = '/tmp/html-project-plan-test.html';
    fs.writeFileSync(ppPath, ppResult.buffer);
    const sizeKb = Math.round(ppResult.buffer.length / 1024);
    console.log(`  ✅ project_plan page generated: ${sizeKb} KB → ${ppPath}`);
    console.log(`     pageType=${ppResult.pageType}, charts=${ppResult.chartCount}, diagrams=${ppResult.diagramCount}`);
  } catch (err) {
    console.error('  ❌ project_plan generation failed:', err);
    projectPlanPassed = false;
    allPassed = false;
  }

  if (ganttPassed && projectPlanPassed) {
    console.log('\n✅ Gantt tests passed!\n');
  }

  if (allPassed) {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed — check output above.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
