/**
 * Generate PNG versions of Lucide icons for PWA use
 *
 * Run with: node scripts/generate-icon-pngs.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Icon definitions matching BRANDING_ICONS in src/lib/db/config.ts
const ICONS = [
  { key: 'government', lucideIcon: 'landmark' },
  { key: 'operations', lucideIcon: 'settings' },
  { key: 'finance', lucideIcon: 'dollar-sign' },
  { key: 'kpi', lucideIcon: 'bar-chart-3' },
  { key: 'logs', lucideIcon: 'file-text' },
  { key: 'data', lucideIcon: 'database' },
  { key: 'monitoring', lucideIcon: 'activity' },
  { key: 'architecture', lucideIcon: 'layers' },
  { key: 'internet', lucideIcon: 'globe' },
  { key: 'systems', lucideIcon: 'server' },
  { key: 'policy', lucideIcon: 'scroll-text' },
  // Neural-network "AI Assistant" icon. Rendered with a wordmark
  // ("abai" on the 512, "ai" on the 192) so it doubles as a branded
  // favicon / PWA icon. See createLabeledSvg below.
  { key: 'ai-neural', lucideIcon: 'brain-circuit', label: { 192: 'ai', 512: 'abai' } },
];

// Icon color (blue matching the app theme)
const ICON_COLOR = '#2563eb';
const BACKGROUND_COLOR = '#ffffff';

// Output sizes
const SIZES = [192, 512];

// Lucide icon SVG template (24x24 viewBox)
// We'll fetch actual SVG paths from lucide-static or define them manually
const LUCIDE_SVGS = {
  'landmark': '<path d="M3 21h18M6 21V9m6 12V9m6 12V9M4 9h16L12 3 4 9Z"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'dollar-sign': '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  'bar-chart-3': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16h8"/><path d="M7 11h12"/><path d="M7 6h3"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  'activity': '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  'layers': '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.18-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12.16"/><path d="m22 17.18-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17.16"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'server': '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  'scroll-text': '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  // Lucide "brain-circuit" — a neural-network/graph glyph. Used for the
  // AI Assistant branded icon. Path taken from lucide-static.
  'brain-circuit': '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.372 4 4 0 0 0 .556 6.891A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.372 4 4 0 0 1-.556 6.891A4 4 0 1 1 12 18Z"/><path d="M15 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M12 9v6"/><path d="M12 4v1"/><path d="M12 19v1"/>',
};

function createSvg(iconKey, size) {
  const svgPath = LUCIDE_SVGS[iconKey];
  if (!svgPath) {
    console.error(`No SVG path found for icon: ${iconKey}`);
    return null;
  }

  // Calculate padding (20% of size for nice margins)
  const padding = Math.floor(size * 0.2);
  const iconSize = size - (padding * 2);

  // Scale factor from 24x24 viewBox to target icon size
  const scale = iconSize / 24;
  const offset = padding;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BACKGROUND_COLOR}" rx="${Math.floor(size * 0.15)}"/>
  <g transform="translate(${offset}, ${offset}) scale(${scale})" fill="none" stroke="${ICON_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${svgPath}
  </g>
</svg>`;
}

/**
 * Create a labeled SVG: a Lucide glyph in the upper portion and a wordmark
 * ("abai" / "ai") centered below it. Used for the neural-network AI
 * Assistant icon so it reads as a branded favicon / PWA icon at small sizes.
 *
 * The glyph occupies the top ~58% of the canvas; the wordmark sits in the
 * bottom ~28% with generous safe-zone padding for maskable/monochrome use.
 */
function createLabeledSvg(iconKey, size, label) {
  const svgPath = LUCIDE_SVGS[iconKey];
  if (!svgPath) {
    console.error(`No SVG path found for icon: ${iconKey}`);
    return null;
  }
  if (!label) {
    console.error(`No label provided for labeled icon: ${iconKey}`);
    return null;
  }

  const radius = Math.floor(size * 0.15);
  // Glyph area: top 58% of canvas, centered horizontally, with 18% side padding.
  const glyphBoxTop = Math.floor(size * 0.14);
  const glyphBoxHeight = Math.floor(size * 0.58);
  const glyphScale = glyphBoxHeight / 24; // 24x24 Lucide viewBox
  const glyphOffsetX = (size - 24 * glyphScale) / 2;
  const glyphOffsetY = glyphBoxTop;

  // Wordmark: bottom area, scaled so "abai" fits comfortably on the 512
  // and "ai" on the 192.
  const fontSize = Math.floor(size * (label.length > 2 ? 0.20 : 0.30));
  const textY = Math.floor(size * 0.86);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BACKGROUND_COLOR}" rx="${radius}"/>
  <g transform="translate(${glyphOffsetX}, ${glyphOffsetY}) scale(${glyphScale})" fill="none" stroke="${ICON_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${svgPath}
  </g>
  <text x="50%" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${fontSize}" font-weight="700" fill="${ICON_COLOR}" letter-spacing="0.5">${label}</text>
</svg>`;
}

async function generateIcon(iconDef, size) {
  // Icons with a `label` (e.g. the neural-network AI icon) use the labeled
  // layout (glyph + wordmark); others use the plain centered glyph.
  const labelForSize = iconDef.label && (iconDef.label[size] || iconDef.label);
  const svg = labelForSize
    ? createLabeledSvg(iconDef.lucideIcon, size, labelForSize)
    : createSvg(iconDef.lucideIcon, size);
  if (!svg) return;

  const outputPath = path.join(__dirname, '..', 'public', 'icons', 'bot', `${iconDef.key}-${size}.png`);

  try {
    await sharp(Buffer.from(svg))
      .png()
      .toFile(outputPath);
    console.log(`Generated: ${iconDef.key}-${size}.png${labelForSize ? ` (label: ${labelForSize})` : ''}`);
  } catch (error) {
    console.error(`Failed to generate ${iconDef.key}-${size}.png:`, error.message);
  }
}

async function main() {
  console.log('Generating PNG icons from Lucide SVGs...\n');

  for (const icon of ICONS) {
    for (const size of SIZES) {
      await generateIcon(icon, size);
    }
  }

  console.log('\nDone! Generated icons in public/icons/bot/');
}

main().catch(console.error);
