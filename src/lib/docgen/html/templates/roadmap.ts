/**
 * Roadmap template — Sun Ray Diagram renderer.
 *
 * Renders a sunburst/sun ray diagram: concentric arc bands radiating from a
 * bottom-left origin, divided by diagonal ray lines into segments.
 * Each band = a maturity/progress layer (inner = current, outer = future).
 * Each ray = a strategic pillar or theme.
 *
 * JSON block schema (```roadmap):
 * {
 *   "topic": "Digital Transformation",
 *   "title": "Sun Ray Diagram",
 *   "subtitle": "Optional subtitle",
 *   "currentState": "Manual processes, siloed data",
 *   "futureState": "Fully automated, AI-driven insights",
 *   "overallProgress": 45,
 *   "bands": [
 *     { "label": "Foundation", "color": "#0d3b66" },
 *     { "label": "Integration", "color": "#1a5c8a" },
 *     { "label": "Automation", "color": "#2980b9" },
 *     { "label": "Intelligence", "color": "#5dade2" },
 *     { "label": "Innovation", "color": "#aed6f1" }
 *   ],
 *   "rays": [
 *     { "caption": "People & Culture", "description": "...", "status": "completed" },
 *     { "caption": "Technology", "description": "...", "status": "in-progress" },
 *     { "caption": "Process", "description": "...", "status": "planned" },
 *     { "caption": "Data & Analytics", "description": "...", "status": "planned" }
 *   ]
 * }
 *
 * Mobile fallback: vertical progress stepper.
 */
import type { BrandingConfig } from '../../branding';
import type { RoadmapBlockConfig } from '../types';
import { escapeHtml } from '../markdown/escape';
import { buildVendorScripts } from '../vendor-bundles';

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return null;
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

function interpolateColor(hex1: string, hex2: string, t: number): string {
  const c1 = hexToRgb(hex1) || { r: 26, g: 58, b: 92 };
  const c2 = hexToRgb(hex2) || { r: 173, g: 214, b: 241 };
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── SVG arc path builder ─────────────────────────────────────────────────────

/**
 * Build an SVG arc path for a band segment.
 * Origin is at bottom-left of the SVG viewport.
 * Arc sweeps from startAngle to endAngle (in degrees, 0=right, CCW).
 */
function buildArcPath(
  cx: number, cy: number,
  innerR: number, outerR: number,
  startAngleDeg: number, endAngleDeg: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const sa = toRad(startAngleDeg);
  const ea = toRad(endAngleDeg);

  const x1 = cx + outerR * Math.cos(sa);
  const y1 = cy - outerR * Math.sin(sa);
  const x2 = cx + outerR * Math.cos(ea);
  const y2 = cy - outerR * Math.sin(ea);
  const x3 = cx + innerR * Math.cos(ea);
  const y3 = cy - innerR * Math.sin(ea);
  const x4 = cx + innerR * Math.cos(sa);
  const y4 = cy - innerR * Math.sin(sa);

  const largeArc = endAngleDeg - startAngleDeg > 180 ? 1 : 0;

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildRoadmapFromConfig(
  pageTitle: string,
  cfg: RoadmapBlockConfig,
  branding: BrandingConfig,
  _css: string,
  _js: string,
  disclaimerHtml: string,
  date: string,
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const primary = branding.primaryColor || '#1a3a5c';
  const vendorScripts = buildVendorScripts();

  // Resolve bands and rays
  // If phases provided but no bands/rays, auto-generate from phases
  let bands = cfg.bands || [];
  let rays = cfg.rays || [];

  if (bands.length === 0 && cfg.phases && cfg.phases.length > 0) {
    // Auto-generate bands from phases (treat each phase as a band)
    bands = cfg.phases.map(p => ({ label: p.title, color: undefined }));
  }
  if (rays.length === 0 && cfg.phases && cfg.phases.length > 0) {
    // Auto-generate rays from phase milestones or use phases as rays
    rays = cfg.phases.map(p => ({
      caption: p.title,
      description: p.description || (p.milestones ? p.milestones.join(', ') : ''),
      status: p.status,
    }));
  }

  // Ensure minimum viable data
  if (bands.length === 0) {
    bands = [
      { label: 'Foundation' },
      { label: 'Development' },
      { label: 'Integration' },
      { label: 'Optimization' },
      { label: 'Innovation' },
    ];
  }
  if (rays.length === 0) {
    rays = [
      { caption: 'Strategy', description: '' },
      { caption: 'Technology', description: '' },
      { caption: 'People', description: '' },
      { caption: 'Process', description: '' },
    ];
  }

  const numBands = bands.length;
  const numRays = rays.length;
  const topic = cfg.topic || pageTitle;
  const overallProgress = cfg.overallProgress ?? null;

  // Generate band colors (dark → light gradient from primary)
  const primaryDark = primary;
  const primaryLight = '#aed6f1';
  const bandColors = bands.map((b, i) => {
    if (b.color) return b.color;
    return interpolateColor(primaryDark, primaryLight, i / Math.max(numBands - 1, 1));
  });

  // SVG dimensions — quarter circle from bottom-left
  const SVG_W = 700;
  const SVG_H = 600;
  const CX = 0;       // origin at left edge
  const CY = SVG_H;   // origin at bottom edge
  const MIN_R = 80;   // inner radius (topic circle)
  const MAX_R = Math.min(SVG_W, SVG_H) - 20; // outer radius

  // Band radii
  const bandStep = (MAX_R - MIN_R) / numBands;
  const bandRadii = bands.map((_, i) => ({
    inner: MIN_R + i * bandStep,
    outer: MIN_R + (i + 1) * bandStep,
  }));

  // Ray angles — sweep from 0° (right) to 90° (up) = quarter circle
  const ARC_START = 0;   // degrees from positive x-axis
  const ARC_END = 90;    // degrees
  const rayStep = (ARC_END - ARC_START) / numRays;
  const rayAngles = rays.map((_, i) => ({
    start: ARC_START + i * rayStep,
    end: ARC_START + (i + 1) * rayStep,
    mid: ARC_START + (i + 0.5) * rayStep,
  }));

  // Build SVG arc segments
  const arcSegments: string[] = [];
  bands.forEach((band, bi) => {
    const { inner, outer } = bandRadii[bi];
    const color = bandColors[bi];
    rays.forEach((ray, ri) => {
      const { start, end } = rayAngles[ri];
      const path = buildArcPath(CX, CY, inner, outer, start, end);
      const segId = `seg-b${bi}-r${ri}`;
      const rayStatus = ray.status || 'planned';
      arcSegments.push(
        `<path id="${segId}" d="${path}" fill="${color}" stroke="#fff" stroke-width="2"
          class="arc-seg" data-band="${bi}" data-ray="${ri}" data-status="${rayStatus}"
          opacity="${bi === 0 ? 1 : 0.85 + bi * 0.02}"
          style="cursor:pointer; transition: opacity 0.2s, filter 0.2s;"
          onmouseenter="arcHover(this, ${bi}, ${ri})"
          onmouseleave="arcLeave(this)"
          onclick="arcClick(${bi}, ${ri})"
        />`
      );
    });
  });

  // Ray divider lines
  const rayLines: string[] = [];
  // Outer boundary lines for each ray
  rayAngles.forEach(({ start }) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const x = CX + MAX_R * Math.cos(toRad(start));
    const y = CY - MAX_R * Math.sin(toRad(start));
    rayLines.push(
      `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"
        stroke="#fff" stroke-width="2.5" opacity="0.9"/>`
    );
  });
  // Final boundary
  const lastAngle = rayAngles[numRays - 1].end;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lx = CX + MAX_R * Math.cos(toRad(lastAngle));
  const ly = CY - MAX_R * Math.sin(toRad(lastAngle));
  rayLines.push(
    `<line x1="${CX}" y1="${CY}" x2="${lx.toFixed(2)}" y2="${ly.toFixed(2)}"
      stroke="#fff" stroke-width="2.5" opacity="0.9"/>`
  );

  // Band boundary arcs (white separators)
  const bandArcs: string[] = [];
  bandRadii.forEach(({ outer }) => {
    const arcPath = buildArcPath(CX, CY, outer - 0.5, outer + 0.5, ARC_START, ARC_END);
    bandArcs.push(`<path d="${arcPath}" fill="#fff" opacity="0.6"/>`);
  });

  // Topic circle at origin
  const topicCircle = `
    <circle cx="${CX}" cy="${CY}" r="${MIN_R - 4}" fill="${primary}" stroke="#fff" stroke-width="3"/>
    <text x="${CX + 8}" y="${CY - 20}" fill="#fff" font-size="13" font-weight="700"
      font-family="Segoe UI, Arial, sans-serif" text-anchor="start">${escapeHtml(topic.length > 18 ? topic.slice(0, 16) + '…' : topic)}</text>`;

  // Caption labels at outer edge of each ray
  const captions: string[] = [];
  rayAngles.forEach(({ mid }, ri) => {
    const ray = rays[ri];
    const labelR = MAX_R + 18;
    const rad = toRad(mid);
    const lx2 = CX + labelR * Math.cos(rad);
    const ly2 = CY - labelR * Math.sin(rad);
    const anchor = mid > 45 ? 'start' : mid < 45 ? 'end' : 'middle';
    const statusColor = ray.status === 'completed' ? '#1a7a3a' : ray.status === 'in-progress' ? '#1a5c8a' : '#888';
    captions.push(`
      <text x="${lx2.toFixed(2)}" y="${ly2.toFixed(2)}"
        fill="${statusColor}" font-size="12" font-weight="700"
        font-family="Segoe UI, Arial, sans-serif"
        text-anchor="${anchor}"
        class="ray-caption" data-ray="${ri}"
        style="cursor:pointer"
        onclick="rayClick(${ri})"
      >${escapeHtml(ray.caption)}</text>`);
  });

  // Band labels (on the arc, at mid-angle)
  const bandLabels: string[] = [];
  const midAngle = (ARC_START + ARC_END) / 2;
  bandRadii.forEach(({ inner, outer }, bi) => {
    const midR = (inner + outer) / 2;
    const rad = toRad(midAngle);
    const bx = CX + midR * Math.cos(rad);
    const by = CY - midR * Math.sin(rad);
    const textColor = bi < numBands / 2 ? '#fff' : '#1a1a1a';
    bandLabels.push(`
      <text x="${bx.toFixed(2)}" y="${by.toFixed(2)}"
        fill="${textColor}" font-size="10" font-weight="600"
        font-family="Segoe UI, Arial, sans-serif"
        text-anchor="middle" dominant-baseline="middle"
        transform="rotate(${-(midAngle)}, ${bx.toFixed(2)}, ${by.toFixed(2)})"
        opacity="0.85"
      >${escapeHtml(bands[bi].label)}</text>`);
  });

  // Progress ring (overall progress arc on outermost band)
  let progressArc = '';
  if (overallProgress !== null) {
    const progressAngle = (overallProgress / 100) * ARC_END;
    const pPath = buildArcPath(CX, CY, MAX_R - bandStep * 0.3, MAX_R + 6, ARC_START, progressAngle);
    progressArc = `<path d="${pPath}" fill="rgba(255,255,255,0.35)" stroke="#fff" stroke-width="1"/>`;
  }

  // Current/Future state labels
  const currentStateLabel = cfg.currentState
    ? `<div class="state-label state-current"><span class="state-dot"></span><div><strong>Current State</strong><p>${escapeHtml(cfg.currentState)}</p></div></div>`
    : '';
  const futureStateLabel = cfg.futureState
    ? `<div class="state-label state-future"><span class="state-dot"></span><div><strong>Future State</strong><p>${escapeHtml(cfg.futureState)}</p></div></div>`
    : '';

  // Ray detail cards (shown on click/hover)
  const rayCards = rays.map((ray, ri) => {
    const statusLabel = ray.status === 'completed' ? '✓ Completed' : ray.status === 'in-progress' ? '⟳ In Progress' : '○ Planned';
    const statusClass = ray.status || 'planned';
    return `
      <div class="ray-card" id="ray-card-${ri}" style="display:none">
        <div class="ray-card-header">
          <span class="ray-card-title">${escapeHtml(ray.caption)}</span>
          <span class="ray-card-status status-${statusClass}">${statusLabel}</span>
          <button class="ray-card-close" onclick="closeRayCard(${ri})">✕</button>
        </div>
        ${ray.description ? `<p class="ray-card-desc">${escapeHtml(ray.description)}</p>` : ''}
      </div>`;
  }).join('');

  // Mobile stepper
  const mobileStepper = rays.map((ray, ri) => {
    const statusClass = ray.status || 'planned';
    const statusLabel = ray.status === 'completed' ? '✓' : ray.status === 'in-progress' ? '⟳' : '○';
    return `
      <div class="stepper-item status-${statusClass}">
        <div class="stepper-dot">${statusLabel}</div>
        <div class="stepper-content">
          <strong>${escapeHtml(ray.caption)}</strong>
          ${ray.description ? `<p>${escapeHtml(ray.description)}</p>` : ''}
        </div>
      </div>`;
  }).join('');

  // Legend
  const legendItems = bands.map((band, bi) => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${bandColors[bi]}"></span>
      <span class="legend-label">${escapeHtml(band.label)}</span>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    :root {
      --primary: ${primary};
      --font: ${branding.fontFamily || 'Segoe UI, Arial, sans-serif'};
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font);
      background: #f0f4f8;
      color: #1a1a1a;
      min-height: 100vh;
      display: flex; flex-direction: column;
    }

    /* ── Header ── */
    .rm-header {
      background: var(--primary); color: #fff;
      padding: 16px 28px;
      display: flex; align-items: center; gap: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
    }
    .header-logo { height: 32px; width: auto; }
    .header-titles { flex: 1; }
    .header-title { font-size: 1.1rem; font-weight: 700; }
    .header-subtitle { font-size: 0.8rem; opacity: 0.75; margin-top: 2px; }
    .header-progress {
      display: flex; align-items: center; gap: 10px;
      font-size: 0.85rem;
    }
    .progress-ring-wrap { position: relative; width: 44px; height: 44px; }
    .progress-ring-wrap svg { transform: rotate(-90deg); }
    .progress-pct {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; font-weight: 700; color: #fff;
    }

    /* ── Main layout ── */
    .rm-main {
      flex: 1;
      display: flex; flex-direction: column;
      align-items: center;
      padding: 32px 24px 48px;
      gap: 24px;
    }

    /* ── State labels ── */
    .state-labels {
      display: flex; justify-content: space-between; align-items: flex-start;
      width: 100%; max-width: 760px;
      gap: 16px;
    }
    .state-label {
      display: flex; align-items: flex-start; gap: 10px;
      max-width: 280px;
      background: #fff; border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 1px 6px rgba(0,0,0,.08);
      font-size: 0.82rem; line-height: 1.5;
    }
    .state-label strong { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .state-label p { color: #555; }
    .state-dot {
      width: 10px; height: 10px; border-radius: 50%;
      flex-shrink: 0; margin-top: 4px;
    }
    .state-current .state-dot { background: var(--primary); }
    .state-future .state-dot { background: #aed6f1; border: 2px solid var(--primary); }
    .state-future { margin-left: auto; text-align: right; }
    .state-future .state-dot { order: 2; }
    .state-future > div { order: 1; }

    /* ── SVG container ── */
    .sunray-wrap {
      position: relative;
      width: 100%; max-width: 760px;
    }
    .sunray-svg {
      width: 100%; height: auto;
      overflow: visible;
    }
    .arc-seg:hover {
      opacity: 1 !important;
      filter: brightness(1.15) drop-shadow(0 0 6px rgba(0,0,0,.3));
    }

    /* ── Tooltip ── */
    .arc-tooltip {
      position: fixed;
      background: rgba(20,20,40,0.92);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.8rem; line-height: 1.5;
      pointer-events: none;
      z-index: 200;
      max-width: 220px;
      display: none;
      box-shadow: 0 4px 16px rgba(0,0,0,.3);
    }
    .arc-tooltip strong { display: block; margin-bottom: 4px; font-size: 0.85rem; }
    .arc-tooltip .tt-band { font-size: 0.72rem; opacity: 0.75; }

    /* ── Ray cards ── */
    .ray-cards {
      width: 100%; max-width: 760px;
      display: flex; flex-wrap: wrap; gap: 12px;
    }
    .ray-card {
      background: #fff; border-radius: 8px;
      border: 1px solid #e0e0e0;
      padding: 14px 18px;
      flex: 1; min-width: 200px;
      box-shadow: 0 2px 8px rgba(0,0,0,.06);
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .ray-card-header {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px;
    }
    .ray-card-title { font-weight: 700; font-size: 0.9rem; flex: 1; }
    .ray-card-status {
      font-size: 0.68rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      padding: 2px 8px; border-radius: 10px;
    }
    .ray-card-close {
      background: none; border: none; cursor: pointer;
      font-size: 0.85rem; color: #999; padding: 0 2px;
    }
    .ray-card-desc { font-size: 0.82rem; color: #555; line-height: 1.5; }
    .status-completed { background: #e8f5e9; color: #1a7a3a; }
    .status-in-progress { background: #e3f2fd; color: #1a5c8a; }
    .status-planned { background: #f5f5f5; color: #666; }

    /* ── Legend ── */
    .rm-legend {
      display: flex; flex-wrap: wrap; gap: 10px 20px;
      justify-content: center;
      width: 100%; max-width: 760px;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: #555; }
    .legend-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }

    /* ── Mobile stepper ── */
    .mobile-stepper { display: none; width: 100%; max-width: 560px; }
    .stepper-item {
      display: flex; gap: 14px; align-items: flex-start;
      padding: 14px 0;
      border-bottom: 1px solid #e8e8e8;
    }
    .stepper-dot {
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.9rem; font-weight: 700; flex-shrink: 0;
    }
    .stepper-item.status-completed .stepper-dot { background: #1a7a3a; color: #fff; }
    .stepper-item.status-in-progress .stepper-dot { background: #1a5c8a; color: #fff; }
    .stepper-item.status-planned .stepper-dot { background: #e0e0e0; color: #888; }
    .stepper-content strong { font-size: 0.9rem; display: block; margin-bottom: 4px; }
    .stepper-content p { font-size: 0.82rem; color: #666; line-height: 1.5; }

    /* ── Disclaimer ── */
    .disclaimer {
      margin: 16px auto 0; max-width: 760px; width: 100%;
      padding: 14px 18px;
      background: #fff8e1; border: 1px solid #ffe082;
      border-radius: 6px; font-size: 0.78rem; color: #5a4a00;
    }

    /* ── Footer ── */
    .rm-footer {
      background: var(--primary); color: rgba(255,255,255,0.7);
      text-align: center; padding: 12px;
      font-size: 0.75rem;
    }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .sunray-wrap { display: none; }
      .state-labels { display: none; }
      .mobile-stepper { display: block; }
      .rm-legend { display: none; }
    }
  </style>
</head>
<body>
  <header class="rm-header">
    ${logoHtml}
    <div class="header-titles">
      <div class="header-title">${escapeHtml(pageTitle)}</div>
      ${cfg.subtitle ? `<div class="header-subtitle">${escapeHtml(cfg.subtitle)}</div>` : ''}
    </div>
    ${overallProgress !== null ? `
    <div class="header-progress">
      <div class="progress-ring-wrap">
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="4"/>
          <circle cx="22" cy="22" r="18" fill="none" stroke="#fff" stroke-width="4"
            stroke-dasharray="${(overallProgress / 100 * 113).toFixed(1)} 113"
            stroke-linecap="round"/>
        </svg>
        <div class="progress-pct">${overallProgress}%</div>
      </div>
      <span>Overall</span>
    </div>` : ''}
  </header>

  <main class="rm-main">
    ${(currentStateLabel || futureStateLabel) ? `
    <div class="state-labels">
      ${currentStateLabel}
      ${futureStateLabel}
    </div>` : ''}

    <div class="sunray-wrap">
      <svg class="sunray-svg" viewBox="-20 -20 ${SVG_W + 200} ${SVG_H + 20}" xmlns="http://www.w3.org/2000/svg">
        <!-- Arc segments -->
        ${arcSegments.join('\n        ')}
        <!-- Band separators -->
        ${bandArcs.join('\n        ')}
        <!-- Ray divider lines -->
        ${rayLines.join('\n        ')}
        <!-- Progress overlay -->
        ${progressArc}
        <!-- Topic circle -->
        ${topicCircle}
        <!-- Band labels -->
        ${bandLabels.join('\n        ')}
        <!-- Ray captions -->
        ${captions.join('\n        ')}
      </svg>
    </div>

    <!-- Ray detail cards -->
    <div class="ray-cards" id="rayCards">
      ${rayCards}
    </div>

    <!-- Legend -->
    <div class="rm-legend">
      ${legendItems}
    </div>

    <!-- Mobile stepper fallback -->
    <div class="mobile-stepper">
      ${mobileStepper}
    </div>

    ${disclaimerHtml ? `<div class="disclaimer">${disclaimerHtml}</div>` : ''}
  </main>

  <footer class="rm-footer">
    ${escapeHtml(pageTitle)} · ${escapeHtml(date)}${orgName ? ` · ${escapeHtml(orgName)}` : ''}
  </footer>

  <!-- Tooltip element -->
  <div class="arc-tooltip" id="arcTooltip"></div>

  ${vendorScripts}
  <script>
    const BANDS = ${JSON.stringify(bands.map((b, i) => ({ label: b.label, color: bandColors[i] })))};
    const RAYS = ${JSON.stringify(rays)};

    const tooltip = document.getElementById('arcTooltip');

    function arcHover(el, bi, ri) {
      const band = BANDS[bi];
      const ray = RAYS[ri];
      const statusLabel = ray.status === 'completed' ? '✓ Completed' : ray.status === 'in-progress' ? '⟳ In Progress' : '○ Planned';
      tooltip.innerHTML = '<strong>' + (ray.caption || '') + '</strong>' +
        '<div class="tt-band">Layer: ' + (band.label || '') + '</div>' +
        (ray.description ? '<div style="margin-top:4px;font-size:0.75rem;opacity:0.85">' + ray.description + '</div>' : '') +
        '<div style="margin-top:6px;font-size:0.7rem;opacity:0.7">' + statusLabel + '</div>';
      tooltip.style.display = 'block';
      el.style.filter = 'brightness(1.2) drop-shadow(0 0 8px rgba(0,0,0,.4))';
    }

    function arcLeave(el) {
      tooltip.style.display = 'none';
      el.style.filter = '';
    }

    document.addEventListener('mousemove', (e) => {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
      }
    });

    function arcClick(bi, ri) {
      const card = document.getElementById('ray-card-' + ri);
      if (card) {
        const isVisible = card.style.display !== 'none';
        card.style.display = isVisible ? 'none' : 'block';
      }
    }

    function rayClick(ri) {
      arcClick(0, ri);
    }

    function closeRayCard(ri) {
      const card = document.getElementById('ray-card-' + ri);
      if (card) card.style.display = 'none';
    }
  </script>
</body>
</html>`;
}

// ─── Legacy markdown fallback ─────────────────────────────────────────────────

export function buildRoadmapTemplate(
  pageTitle: string,
  contentHtml: string,
  branding: BrandingConfig,
  _css: string,
  _js: string,
  disclaimerHtml: string,
  date: string,
): string {
  const orgName = branding.organizationName || '';
  const logoHtml = branding.enabled && branding.logoUrl
    ? `<img src="${branding.logoUrl}" class="header-logo" alt="${escapeHtml(orgName)} logo">`
    : '';
  const primary = branding.primaryColor || '#1a3a5c';
  const vendorScripts = buildVendorScripts();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    :root { --primary: ${primary}; --font: ${branding.fontFamily || 'Segoe UI, Arial, sans-serif'}; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: #f0f4f8; color: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; }
    .rm-header { background: var(--primary); color: #fff; padding: 16px 28px; display: flex; align-items: center; gap: 14px; }
    .header-logo { height: 32px; }
    .header-title { font-size: 1.1rem; font-weight: 700; }
    .rm-main { flex: 1; max-width: 900px; margin: 0 auto; padding: 40px 24px 60px; width: 100%; }
    .rm-content { background: #fff; border-radius: 10px; padding: 32px 36px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
    .rm-content h2 { font-size: 1.2rem; color: var(--primary); margin: 1.5em 0 0.5em; padding-bottom: 8px; border-bottom: 2px solid var(--primary); }
    .rm-content h3 { font-size: 1rem; color: #333; margin: 1.2em 0 0.4em; }
    .rm-content p { font-size: 0.93rem; line-height: 1.7; margin-bottom: 0.8em; color: #444; }
    .rm-content ul { padding-left: 1.5em; margin-bottom: 0.8em; }
    .rm-content li { margin-bottom: 0.3em; font-size: 0.9rem; }
    .disclaimer { margin-top: 24px; padding: 14px 18px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 6px; font-size: 0.78rem; color: #5a4a00; }
    .rm-footer { background: var(--primary); color: rgba(255,255,255,0.7); text-align: center; padding: 12px; font-size: 0.75rem; }
  </style>
</head>
<body>
  <header class="rm-header">
    ${logoHtml}
    <span class="header-title">${escapeHtml(pageTitle)}</span>
  </header>
  <main class="rm-main">
    <div class="rm-content">${contentHtml}</div>
    ${disclaimerHtml ? `<div class="disclaimer">${disclaimerHtml}</div>` : ''}
  </main>
  <footer class="rm-footer">${escapeHtml(pageTitle)} · ${escapeHtml(date)}</footer>
  ${vendorScripts}
</body>
</html>`;
}
