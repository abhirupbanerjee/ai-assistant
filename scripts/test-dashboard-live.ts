/**
 * Live data test: Grenada Digital Transformation Dashboard
 * Run with: npx tsx scripts/test-dashboard-live.ts
 */
import * as path from 'path';
import * as fs from 'fs';

process.env.APP_ROOT = path.resolve(__dirname, '..');

import { generateHtml } from '../src/lib/docgen/html/generate';
import { DEFAULT_BRANDING } from '../src/lib/docgen/branding';
import { DEFAULT_DISCLAIMER_CONFIG } from '../src/lib/disclaimer';

const content = `
\`\`\`kpi
{"label":"Total Initiatives","value":"38","delta":null,"trend_direction":"neutral","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`kpi
{"label":"Total Budget","value":"$51.8M","delta":null,"trend_direction":"neutral","tooltip":"2026–2030 combined across all initiatives","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`kpi
{"label":"Planned","value":"25","delta":"66%","trend_direction":"neutral","tags":["status:planned","status:all"]}
\`\`\`

\`\`\`kpi
{"label":"Completed / Implemented","value":"3","delta":"8%","trend_direction":"positive","tags":["status:complete","status:all"]}
\`\`\`

\`\`\`filters
{"title":"Filters","slicers":[{"id":"theme","label":"Strategic Theme","type":"multiselect","options":["Simplify Life","Boost Resiliency","Build our People"],"tag_prefix":"theme"},{"id":"status","label":"Status","type":"multiselect","options":["Planned","Ongoing","Complete","Implemented","Pilot","Design"],"tag_prefix":"status"}]}
\`\`\`

\`\`\`chart
{"title":"Initiatives by Strategic Theme","data":[{"theme":"Simplify Life","initiatives":19},{"theme":"Boost Resiliency","initiatives":11},{"theme":"Build our People","initiatives":8}],"x_field":"theme","y_fields":["initiatives"],"recommended_chart":"bar","size":"half","tags":["theme:simplify life","theme:boost resiliency","theme:build our people"]}
\`\`\`

\`\`\`chart
{"title":"Initiative Status Distribution","data":[{"status":"Planned","count":25},{"status":"Ongoing","count":7},{"status":"Implemented","count":2},{"status":"Pilot","count":2},{"status":"Design","count":1},{"status":"Complete","count":1}],"x_field":"status","y_fields":["count"],"recommended_chart":"pie","size":"half","tags":["status:planned","status:ongoing","status:implemented","status:pilot","status:design","status:complete"]}
\`\`\`

\`\`\`chart
{"title":"Budget by Phase ($M)","data":[{"phase":"2026","budget":12.39},{"phase":"2027","budget":22.78},{"phase":"2028–30","budget":16.65}],"x_field":"phase","y_fields":["budget"],"recommended_chart":"bar","size":"half","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`chart
{"title":"Initiatives by Lead Organization","data":[{"org":"DTA","count":14},{"org":"Min. of Education","count":5},{"org":"Min. of Finance","count":4},{"org":"Min. of Legal Affairs","count":3},{"org":"Min. of Health","count":2},{"org":"Grenada Tourism Auth.","count":2},{"org":"Other Ministries","count":8}],"x_field":"org","y_fields":["count"],"recommended_chart":"bar","size":"half","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`chart
{"title":"Initiative Classification Attributes","data":[{"classification":"Procurement","count":35},{"classification":"Localisation","count":32},{"classification":"Standardisation","count":31},{"classification":"Reusability","count":26},{"classification":"Policy Req.","count":9},{"classification":"Quick Win","count":8}],"x_field":"classification","y_fields":["count"],"recommended_chart":"bar","size":"half","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`chart
{"title":"Top 10 Initiatives by Total Budget ($M)","data":[{"initiative":"Cloud & NW Upgrade","budget":7.09},{"initiative":"PKI & Digital Signatures","budget":4.08},{"initiative":"Digital Payments","budget":4.02},{"initiative":"DTA Setup","budget":3.40},{"initiative":"Digital Health","budget":3.31},{"initiative":"Digital Transport","budget":3.18},{"initiative":"Digital Identity","budget":2.90},{"initiative":"Citizen Touchpoints","budget":2.83},{"initiative":"Gov. Intelligence Unit","budget":2.11},{"initiative":"Social Protection","budget":1.65}],"x_field":"initiative","y_fields":["budget"],"recommended_chart":"bar","size":"hero","tags":["status:all","theme:all"]}
\`\`\`

\`\`\`data
{"title":"Budget Summary","items":[{"label":"2026 Budget","value":"$12.4M","note":"Foundation year"},{"label":"2027 Budget","value":"$22.8M","note":"Peak delivery year"},{"label":"2028–30 Budget","value":"$16.6M","note":"Consolidation phase"},{"label":"Avg. Initiative Cost","value":"$1.36M","note":"Across 38 initiatives"}],"table":{"headers":["Phase","Budget","# Initiatives"],"rows":[["2026","$12.4M","17"],["2027","$22.8M","28"],["2028–30","$16.6M","12"]]}}
\`\`\`
`;

async function main() {
  console.log('Generating Grenada Digital Transformation Dashboard...');
  const result = await generateHtml({
    title: 'Grenada Digital Transformation — Initiative Dashboard',
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

  const outPath = '/tmp/dashboard-live.html';
  fs.writeFileSync(outPath, result.buffer);
  console.log(`\n✓ Dashboard written to: ${outPath}`);
  console.log(`  File size: ${(result.fileSize / 1024).toFixed(0)} KB`);
  console.log(`  Charts: ${result.chartCount}`);
  console.log(`  Page type: ${result.pageType}`);
  console.log('\n  xdg-open /tmp/dashboard-live.html');
}

main().catch((err) => { console.error(err); process.exit(1); });
