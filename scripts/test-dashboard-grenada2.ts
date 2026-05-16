/**
 * Live data test 2: Grenada Digital Transformation — Full Initiative Register
 * Run with: npx tsx scripts/test-dashboard-grenada2.ts
 */
import * as path from 'path';
import * as fs from 'fs';

process.env.APP_ROOT = path.resolve(__dirname, '..');

import { generateHtml } from '../src/lib/docgen/html/generate';
import { DEFAULT_BRANDING } from '../src/lib/docgen/branding';
import { DEFAULT_DISCLAIMER_CONFIG } from '../src/lib/disclaimer';

// Budget by theme (computed from register × cost table):
// Simplify Life (19 initiatives):  $29.31M
// Boost Resiliency (11 initiatives): $19.77M
// Build our People (8 initiatives):  $2.74M

// Budget by status (computed):
// Planned: $37.03M | Ongoing: $8.65M | Design: $2.90M | Pilot: $1.86M | Implemented: $1.29M | Complete: $0.09M

// Start year distribution:
// 2023:1, 2024:2, 2025:2, 2026:15, 2027:14, 2028:4

const content = `
\`\`\`kpi
{"label":"Total Initiatives","value":"38","trend_direction":"neutral","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`kpi
{"label":"Total Budget (2026–30)","value":"$51.8M","trend_direction":"neutral","tooltip":"Sum across all 38 initiatives across all phases","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`kpi
{"label":"Active (Ongoing/Pilot/Design)","value":"10","delta":"26%","trend_direction":"positive","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`kpi
{"label":"Completed / Implemented","value":"3","delta":"8%","trend_direction":"positive","tooltip":"Complete: 1 (DPDP), Implemented: 2 (Digital Records, Port Modernisation)","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`filters
{"title":"Filters","slicers":[
  {"id":"theme","label":"Strategic Theme","type":"multiselect","options":["Simplify Life","Boost Resiliency","Build our People"],"tag_prefix":"theme"},
  {"id":"status","label":"Status","type":"multiselect","options":["Planned","Ongoing","Complete","Implemented","Pilot","Design"],"tag_prefix":"status"},
  {"id":"org","label":"Lead Organization","type":"multiselect","options":["DTA","Min. of Education","Min. of Finance","Min. of Legal Affairs","Min. of Health","Grenada Tourism Auth."],"tag_prefix":"org"}
]}
\`\`\`

\`\`\`chart
{"title":"Initiatives by Strategic Theme","data":[{"theme":"Simplify Life","count":19},{"theme":"Boost Resiliency","count":11},{"theme":"Build our People","count":8}],"x_field":"theme","y_fields":["count"],"recommended_chart":"bar","size":"half","tags":["theme:simplify life","theme:boost resiliency","theme:build our people"]}
\`\`\`

\`\`\`chart
{"title":"Budget by Strategic Theme ($M)","data":[{"theme":"Simplify Life","budget":29.31},{"theme":"Boost Resiliency","budget":19.77},{"theme":"Build our People","budget":2.74}],"x_field":"theme","y_fields":["budget"],"recommended_chart":"bar","size":"half","tags":["theme:simplify life","theme:boost resiliency","theme:build our people"]}
\`\`\`

\`\`\`chart
{"title":"Initiative Status","data":[{"status":"Planned","count":25},{"status":"Ongoing","count":7},{"status":"Design","count":1},{"status":"Pilot","count":2},{"status":"Implemented","count":2},{"status":"Complete","count":1}],"x_field":"status","y_fields":["count"],"recommended_chart":"pie","size":"half","tags":["status:planned","status:ongoing","status:design","status:pilot","status:implemented","status:complete"]}
\`\`\`

\`\`\`chart
{"title":"Budget by Status ($M)","data":[{"status":"Planned","budget":37.03},{"status":"Ongoing","budget":8.65},{"status":"Design","budget":2.90},{"status":"Pilot","budget":1.86},{"status":"Implemented","budget":1.29},{"status":"Complete","budget":0.09}],"x_field":"status","y_fields":["budget"],"recommended_chart":"bar","size":"half","tags":["status:planned","status:ongoing","status:design","status:pilot","status:implemented","status:complete"]}
\`\`\`

\`\`\`chart
{"title":"Initiatives by Lead Organization","data":[{"org":"DTA","count":14},{"org":"Min. of Education","count":5},{"org":"Min. of Finance","count":4},{"org":"Min. of Legal Affairs","count":3},{"org":"Min. of Health","count":3},{"org":"Grenada Tourism Auth.","count":2},{"org":"Other","count":7}],"x_field":"org","y_fields":["count"],"recommended_chart":"bar","size":"half","tags":["org:dta","org:min. of education","org:min. of finance","org:min. of legal affairs","org:min. of health","org:grenada tourism auth."]}
\`\`\`

\`\`\`chart
{"title":"Initiative Classification Attributes","data":[{"classification":"Procurement","count":35},{"classification":"Localisation","count":32},{"classification":"Standardisation","count":31},{"classification":"Reusability","count":26},{"classification":"Service Offering","count":20},{"classification":"Policy Req.","count":9},{"classification":"Quick Win","count":8}],"x_field":"classification","y_fields":["count"],"recommended_chart":"bar","size":"half","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`chart
{"title":"Start Year Distribution (Count of Initiatives)","data":[{"year":"2023","count":1},{"year":"2024","count":2},{"year":"2025","count":2},{"year":"2026","count":15},{"year":"2027","count":14},{"year":"2028","count":4}],"x_field":"year","y_fields":["count"],"recommended_chart":"bar","size":"half","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`chart
{"title":"Budget by Phase ($M) — 2026 Budget Peak in 2027","data":[{"phase":"2026","budget":12.39},{"phase":"2027","budget":22.78},{"phase":"2028–30","budget":16.65}],"x_field":"phase","y_fields":["budget"],"recommended_chart":"bar","size":"half","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`chart
{"title":"Top 10 Initiatives by Total Budget ($M)","data":[{"initiative":"Cloud & NW Upgrade","budget":7.09,"theme":"Boost Resiliency"},{"initiative":"PKI & Digital Signatures","budget":4.08,"theme":"Boost Resiliency"},{"initiative":"Digital Payments","budget":4.02,"theme":"Simplify Life"},{"initiative":"DTA Setup","budget":3.40,"theme":"Boost Resiliency"},{"initiative":"Digital Health","budget":3.31,"theme":"Simplify Life"},{"initiative":"Digital Transport","budget":3.18,"theme":"Simplify Life"},{"initiative":"Digital Identity","budget":2.90,"theme":"Simplify Life"},{"initiative":"Citizen Touchpoints","budget":2.83,"theme":"Simplify Life"},{"initiative":"Gov. Intelligence Unit","budget":2.11,"theme":"Boost Resiliency"},{"initiative":"Social Protection","budget":1.65,"theme":"Simplify Life"}],"x_field":"initiative","y_fields":["budget"],"recommended_chart":"bar","size":"hero","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`data
{"title":"Budget Summary","items":[{"label":"2026 Budget","value":"$12.4M","note":"17 initiatives starting"},{"label":"2027 Budget","value":"$22.8M","note":"Peak delivery year"},{"label":"2028–30 Budget","value":"$16.6M","note":"Consolidation phase"},{"label":"Avg. Initiative Cost","value":"$1.36M","note":"Across all 38 initiatives"},{"label":"Largest Initiative","value":"$7.09M","note":"Cloud, DC & NW Upgrade"},{"label":"DTA-Supported","value":"100%","note":"All 38 initiatives"}],"table":{"headers":["Theme","Initiatives","Budget"],"rows":[["Simplify Life","19","$29.3M"],["Boost Resiliency","11","$19.8M"],["Build our People","8","$2.7M"]]}}
\`\`\`
`;

async function main() {
  console.log('Generating Grenada Digital Transformation — Full Register Dashboard...');
  const result = await generateHtml({
    title: 'Grenada Digital Transformation — Initiative Register Dashboard',
    content,
    pageType: 'dashboard',
    branding: {
      ...DEFAULT_BRANDING,
      organizationName: 'Grenada DTA',
      primaryColor: '#1a5f2e',
    },
    disclaimerConfig: { ...DEFAULT_DISCLAIMER_CONFIG, enabled: false },
    metadata: { date: 'May 2026' },
  });

  const outPath = '/tmp/dashboard-grenada2.html';
  fs.writeFileSync(outPath, result.buffer);
  console.log(`\n✓ Dashboard written to: ${outPath}`);
  console.log(`  File size : ${(result.fileSize / 1024).toFixed(0)} KB`);
  console.log(`  Charts    : ${result.chartCount}`);
  console.log(`  Page type : ${result.pageType}`);
  console.log('\n  xdg-open /tmp/dashboard-grenada2.html');
}

main().catch((err) => { console.error(err); process.exit(1); });
