/**
 * Build script for the embed widget bundle
 *
 * Creates a self-contained JavaScript bundle that can be loaded on external websites.
 * Usage: npx tsx scripts/build-embed.ts
 */

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';

const outDir = path.join(process.cwd(), 'public', 'embed');

async function buildEmbed() {
  console.log('[Embed Build] Starting build...');

  // Ensure output directory exists
  await fs.mkdir(outDir, { recursive: true });

  // Build the bundle
  const result = await build({
    entryPoints: ['src/embed/index.tsx'],
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ['es2020', 'chrome80', 'firefox78', 'safari13'],
    format: 'iife',
    globalName: 'AIAssistantEmbed',
    outfile: path.join(outDir, 'workspace.js'),
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
    },
    // Inject CSS into the bundle
    inject: [],
    // External packages (React is bundled for isolation)
    external: [],
    metafile: true,
  });

  // Log bundle size
  const stats = await fs.stat(path.join(outDir, 'workspace.js'));
  const sizeKb = (stats.size / 1024).toFixed(2);
  console.log(`[Embed Build] Bundle size: ${sizeKb} KB`);

  // Calculate gzipped size estimate
  const outputs = result.metafile?.outputs || {};
  for (const [file, info] of Object.entries(outputs)) {
    console.log(`[Embed Build] Output: ${file} (${(info.bytes / 1024).toFixed(2)} KB)`);
  }

  console.log('[Embed Build] Build complete!');
  console.log(`[Embed Build] Output: ${path.join(outDir, 'workspace.js')}`);
}

buildEmbed().catch((err) => {
  console.error('[Embed Build] Error:', err);
  process.exit(1);
});
