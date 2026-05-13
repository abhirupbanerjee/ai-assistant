/**
 * Quick local test: generates a dashboard HTML and writes it to /tmp/dashboard-test.html
 * Run with: npx tsx scripts/test-dashboard.ts
 */
import * as path from 'path';
import * as fs from 'fs';

// Set APP_ROOT so vendor-bundles.ts resolves node_modules correctly
process.env.APP_ROOT = path.resolve(__dirname, '..');

import { generateHtml } from '../src/lib/docgen/html/generate';

const content = `
\`\`\`kpi
{"label":"Total Revenue","value":"$4.2M","delta":"+18.3%","trend_direction":"positive","trend":[30,35,32,40,45,50,48,55,60,65],"tags":["region:all"],"tooltip":"Combined revenue across all regions, Q1–Q2"}
\`\`\`

\`\`\`kpi
{"label":"Units Sold","value":"12,840","delta":"+9.1%","trend_direction":"positive","trend":[100,110,105,120,130,125,140,150,145,160],"tags":["region:all"]}
\`\`\`

\`\`\`kpi
{"label":"Avg Deal Size","value":"$327","delta":"-2.4%","trend_direction":"negative","trend":[340,335,330,328,327,325,326,328,327,327],"tags":["region:all"]}
\`\`\`

\`\`\`kpi
{"label":"Win Rate","value":"68%","delta":"+3pp","trend_direction":"positive","trend":[60,62,64,63,65,66,67,68,68,68],"tags":["region:all"]}
\`\`\`

\`\`\`filters
{"title":"Filters","slicers":[{"id":"region","label":"Region","type":"multiselect","options":["North","South","East","West"],"tag_prefix":"region"},{"id":"category","label":"Category","type":"multiselect","options":["Software","Hardware","Services"],"tag_prefix":"category"}]}
\`\`\`

\`\`\`chart
{"title":"Revenue by Region","data":[{"region":"North","revenue":1200000},{"region":"South","revenue":980000},{"region":"East","revenue":1050000},{"region":"West","revenue":970000}],"x_field":"region","y_fields":["revenue"],"recommended_chart":"bar","size":"half","tags":["region:north","region:south","region:east","region:west"],"notes":"North leads by revenue; West and South are close behind."}
\`\`\`

\`\`\`chart
{"title":"Units Sold by Region","data":[{"region":"North","units":3800},{"region":"South","units":3100},{"region":"East","units":3200},{"region":"West","units":2740}],"x_field":"region","y_fields":["units"],"recommended_chart":"bar","size":"half","tags":["region:north","region:south","region:east","region:west"],"notes":"Units track closely with revenue except in East where avg deal size is higher."}
\`\`\`

\`\`\`chart
{"title":"Revenue by Category","data":[{"category":"Software","revenue":2100000},{"category":"Hardware","revenue":1300000},{"category":"Services","revenue":800000}],"x_field":"category","y_fields":["revenue"],"recommended_chart":"pie","size":"half","tags":["category:software","category:hardware","category:services"],"notes":"Software drives 50% of total revenue."}
\`\`\`

\`\`\`chart
{"title":"Monthly Revenue Trend","data":[{"month":"Jan","revenue":580000},{"month":"Feb","revenue":610000},{"month":"Mar","revenue":590000},{"month":"Apr","revenue":650000},{"month":"May","revenue":710000},{"month":"Jun","revenue":720000}],"x_field":"month","y_fields":["revenue"],"recommended_chart":"line","size":"half","tags":["region:all"],"notes":"Steady growth trend with a slight dip in March."}
\`\`\`

\`\`\`chart
{"title":"Revenue vs Units — North & South","data":[{"region":"North","revenue":1200000,"units":3800},{"region":"South","revenue":980000,"units":3100},{"region":"East","revenue":1050000,"units":3200},{"region":"West","revenue":970000,"units":2740}],"x_field":"region","y_fields":["revenue","units"],"recommended_chart":"bar","series_mode":"grouped","size":"hero","tags":["region:north","region:south","region:east","region:west"],"notes":"Grouped view reveals West has a higher revenue-per-unit ratio than South."}
\`\`\`

\`\`\`data
{"title":"Key Stats","items":[{"label":"Top Region","value":"North","note":"$1.2M revenue"},{"label":"Top Category","value":"Software","note":"50% share"},{"label":"YTD Growth","value":"+18.3%","note":"vs prior year"},{"label":"Active Accounts","value":"284","note":"as of today"}],"table":{"headers":["Region","Revenue","Units"],"rows":[["North","$1.2M","3,800"],["East","$1.05M","3,200"],["South","$980K","3,100"],["West","$970K","2,740"]]}}
\`\`\`
`;

async function main() {
  console.log('Generating dashboard HTML...');
  const result = await generateHtml({
    title: 'Sales Performance Dashboard',
    content,
    pageType: 'dashboard',
    branding: {
      orgName: 'Acme Corp',
      primaryColor: '#2563eb',
    },
    disclaimerConfig: { enabled: false },
    metadata: { date: 'June 2025' },
  });

  const outPath = '/tmp/dashboard-test.html';
  fs.writeFileSync(outPath, result.buffer);
  console.log(`\n✓ Dashboard written to: ${outPath}`);
  console.log(`  File size: ${(result.fileSize / 1024).toFixed(0)} KB`);
  console.log(`  Charts: ${result.chartCount}, Diagrams: ${result.diagramCount}`);
  console.log(`  Page type: ${result.pageType}`);
  console.log('\nOpen with:');
  console.log(`  xdg-open ${outPath}`);
  console.log(`  # or: google-chrome ${outPath}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
