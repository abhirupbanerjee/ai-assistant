/**
 * Generate PWA assets for the mobile UI refresh (Phase 2.1):
 *   - Monochrome icons (192 + 512) for Android 13+ Material You themed icons.
 *   - Branded screenshot placeholders (1080x1920) for the install prompt.
 *
 * Monochrome icons are produced by luminance-thresholding the existing
 * color icon into a single-color (white) silhouette with transparency —
 * the format Android expects for `purpose: "monochrome"`.
 *
 * Screenshots are simple branded placeholders (gradient + bot name). They
 * satisfy the manifest schema and make the install prompt informative;
 * replace them with real app screenshots when convenient.
 *
 * Run with: node scripts/generate-pwa-assets.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const SRC_192 = path.join(ICONS_DIR, 'icon-192x192.png');
const SRC_512 = path.join(ICONS_DIR, 'icon-512x512.png');

// Read branding bot name (best-effort; fall back to default).
const FALLBACK_NAME = 'AI Assistant';

// Monochrome (Material You) icon label. Rendered as white text on a
// transparent background. Override via PWA_MONO_LABEL if branding changes.
const MONO_LABEL = process.env.PWA_MONO_LABEL || 'abai';

// Render the monochrome icon as a clean text-based silhouette ("abai")
// rather than deriving it from the color icon — the color icon contained
// different glyphs, which leaked through as "PB" in the silhouette.
// Material You monochrome icons must be a single-color (white) shape on a
// transparent background; Android tints it to match the wallpaper palette.
async function generateMonochrome(label, size) {
  const outPath = path.join(ICONS_DIR, `icon-monochrome-${size}x${size}.png`);
  // Font size scales with the icon; center the text in the canvas. Keep
  // generous padding so the safe zone for maskable/monochrome is respected.
  const fontSize = Math.floor(size * 0.42);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text>
</svg>`;
  // The SVG text is already white-on-transparent; render straight to PNG.
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`Generated: icon-monochrome-${size}x${size}.png (label: ${label})`);
}

// Regenerate the default color app icons (icon-192x192.png / icon-512x512.png)
// as a branded "AI" text icon: blue rounded-square background with white
// bold "AI" centered. These are the manifest fallbacks used when no
// DB-configured bot icon is set. Override the label via PWA_COLOR_LABEL.
async function generateColorIcon(label, size) {
  const outPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
  const fontSize = Math.floor(size * 0.46);
  const radius = Math.floor(size * 0.15);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#2563eb"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`Generated: icon-${size}x${size}.png (color label: ${label})`);
}

async function generateScreenshot({ width, height, label, filename, dark }) {
  const outPath = path.join(ICONS_DIR, filename);
  // Build an SVG screenshot placeholder with a gradient + centered label.
  const top = dark ? '#1c1c1c' : '#2563eb';
  const bottom = dark ? '#0a0a0a' : '#1e40af';
  const textColor = '#ffffff';
  const subColor = dark ? '#9ca3af' : '#dbeafe';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${Math.floor(width / 12)}" font-weight="700" fill="${textColor}">${label}</text>
  <text x="50%" y="54%" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${Math.floor(width / 24)}" fill="${subColor}">${dark ? 'Dark' : 'Light'} mode</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`Generated: ${filename}`);
}

async function main() {
  const botName = process.env.PWA_BOT_NAME || FALLBACK_NAME;
  console.log(`Using bot name: ${botName}\n`);

  // Source color icons are no longer needed for monochrome generation
  // (we render the label directly), but keep the check as a sanity guard
  // for the deployment's icon directory.
  if (!fs.existsSync(ICONS_DIR)) {
    console.error('public/icons directory missing.');
    process.exit(1);
  }

  await generateMonochrome(MONO_LABEL, 192);
  await generateMonochrome(MONO_LABEL, 512);

  // Default color app icons (AI). Backups of the previous icons were saved
  // as icon-*x*.png.bak before this overwrite.
  const COLOR_LABEL = process.env.PWA_COLOR_LABEL || 'AI';
  await generateColorIcon(COLOR_LABEL, 192);
  await generateColorIcon(COLOR_LABEL, 512);

  // Phone-sized screenshots (1080x1920) — light + dark variants.
  await generateScreenshot({
    width: 1080,
    height: 1920,
    label: botName,
    filename: 'screenshot-phone-light-1080x1920.png',
    dark: false,
  });
  await generateScreenshot({
    width: 1080,
    height: 1920,
    label: botName,
    filename: 'screenshot-phone-dark-1080x1920.png',
    dark: true,
  });

  console.log('\nDone! Assets in public/icons/');
  console.log('NOTE: Replace the screenshot placeholders with real app captures when convenient.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
