/**
 * Read vendor bundles from local public/vendor directory, falling back to node_modules.
 * This makes generated HTML self-contained — no CDN dependencies at view time.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Read a vendor bundle from the local public/vendor directory, falling back to node_modules.
 *
 * Tries multiple likely paths for robustness across package versions.
 */
export function readVendorBundle(packageName: string, vendorFileName: string, relativePaths: string[]): string | null {
  const appRoot = process.env.APP_ROOT ?? process.cwd();
  const candidatePaths = [
    path.join(appRoot, 'public', 'vendor', vendorFileName),
    ...relativePaths.map((relativePath) => path.join(appRoot, 'node_modules', packageName, relativePath)),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

/**
 * Build inline <script> blocks for Chart.js, chartjs-plugin-datalabels, and Mermaid
 * from local vendor bundles.
 * Falls back to HTML comments (not CDN) so missing bundles are visible, not silent.
 *
 * Note: When server-side rendering is active, these bundles are only needed as a
 * fallback for charts/diagrams that failed to render server-side.
 */
export function buildVendorScripts(): string {
  const chartJsBundle = readVendorBundle('chart.js', 'chart.umd.min.js', [
    'dist/chart.umd.min.js',
    'dist/chart.umd.js',
  ]);
  const datalabelsBundle = readVendorBundle('chartjs-plugin-datalabels', 'chartjs-plugin-datalabels.min.js', [
    'dist/chartjs-plugin-datalabels.min.js',
  ]);
  const mermaidBundle = readVendorBundle('mermaid', 'mermaid.min.js', [
    'dist/mermaid.min.js',
    'dist/mermaid.js',
  ]);

  const scripts: string[] = [];

  if (chartJsBundle) {
    scripts.push(`<script>\n${chartJsBundle}\n</script>`);
  } else {
    scripts.push('<!-- Chart.js bundle not found: charts will show a fallback message. Run: npm install -->');
  }

  if (datalabelsBundle) {
    scripts.push(`<script>\n${datalabelsBundle}\n</script>`);
  } else {
    scripts.push('<!-- chartjs-plugin-datalabels bundle not found: chart data labels will be unavailable. Run: npm install -->');
  }

  if (mermaidBundle) {
    scripts.push(`<script>\n${mermaidBundle}\n</script>`);
  } else {
    scripts.push('<!-- Mermaid bundle not found: diagrams will show a text fallback. Run: npm install -->');
  }

  return scripts.join('\n');
}
