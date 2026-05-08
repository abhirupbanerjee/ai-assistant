# HTML Rendering — Technical Reference

> Last updated: May 2026 · Covers all 9 `html_gen` page types + `file_to_html`

---

## Overview

The HTML generation pipeline converts LLM-authored content into self-contained, interactive HTML pages. It is used by two tools:

| Tool | Entry point | Input |
|------|-------------|-------|
| `html_gen` | `generateHtml()` in `generate.ts` | Markdown + JSON fenced blocks |
| `file_to_html` | `generateHtmlFromSource()` in `source-html/generate-from-source.ts` | DOCX/PDF → HTML (mammoth) |

---

## Page Types

### Tier A — Structured JSON block types (6)

These types require the LLM to emit a typed JSON fenced block. The renderer uses the structured config directly for maximum reliability and repeatability.

| Type | Fenced block | Template function | Notes |
|------|-------------|-------------------|-------|
| `book` | ` ```book ` | `buildBookFromConfig` / `buildBookTemplate` | Cover page, sidebar TOC, chapter navigation, language selector |
| `report` | ` ```report ` | `buildReportFromConfig` / `buildReportTemplate` | Cover page, classification badge, executive summary, typed sections |
| `roadmap` | ` ```roadmap ` | `buildRoadmapFromConfig` / `buildRoadmapTemplate` | **Sun Ray Diagram** — concentric arc bands from bottom-left origin |
| `playbook` | ` ```playbook ` | `buildPlaybookFromConfig` / `buildPlaybookTemplate` | Card grid layout, part/topic hierarchy |
| `gantt` | ` ```gantt ` | `buildGanttTemplate` | Timeline bars + milestone diamonds, hover tooltips |
| `project_plan` | ` ```gantt ` | `buildProjectPlanTemplate` | Gantt + KPI strip + roll-up summary table |

Each Tier A type has two rendering paths:
- **JSON-driven** (preferred): LLM emits the typed fenced block → structured renderer
- **Markdown fallback**: No fenced block found → legacy markdown heading parser

### Tier B — Multi-block dashboard (1)

| Type | Fenced blocks | Template function | Notes |
|------|--------------|-------------------|-------|
| `dashboard` | ` ```chart `, ` ```kpi `, ` ```filters `, ` ```data ` | `buildDashboardTemplateV2` | Power BI-style layout, hover tooltips on KPI tiles and chart panels |

### Tier C — Simple document layout (1)

| Type | Layout | TOC | Search | Notes |
|------|--------|-----|--------|-------|
| `website` | Hero + sections | — | — | Default fallback type |

> **Removed types**: `documentation` and `webpage` have been removed. `website` is the default fallback.

---

## JSON Fenced Block Contracts

### ` ```book `

```json
{
  "frontMatter": {
    "author": "Jane Smith",
    "subtitle": "A Practical Guide",
    "publisher": "Acme Press",
    "edition": "2nd Edition",
    "abstract": "This book covers..."
  },
  "chapters": [
    {
      "title": "Introduction",
      "sections": [
        {
          "heading": "Background",
          "content": "## Background\n\nThis section covers..."
        }
      ]
    }
  ]
}
```

**Fields**:
- `frontMatter` — optional cover page metadata
- `chapters[]` — required; each chapter has a `title` and optional `sections[]`
- `sections[].content` — Markdown string rendered to HTML

---

### ` ```report `

```json
{
  "metadata": {
    "preparedFor": "Ministry of Finance",
    "preparedBy": "Consulting Group Ltd.",
    "date": "May 2026",
    "classification": "CONFIDENTIAL",
    "version": "v1.2"
  },
  "executiveSummary": "This report presents findings from...",
  "sections": [
    {
      "heading": "Key Findings",
      "type": "findings",
      "content": "## Key Findings\n\n1. Finding one..."
    },
    {
      "heading": "Recommendations",
      "type": "recommendations",
      "content": "## Recommendations\n\nWe recommend..."
    }
  ],
  "appendices": [
    {
      "title": "Methodology Details",
      "content": "## Appendix A\n\nData was collected..."
    }
  ]
}
```

**Section `type` values** (controls left-border accent color):
- `findings` → blue `#1a5c8a`
- `analysis` → purple `#5b2d8e`
- `recommendations` → green `#1a7a3a`
- `methodology` → gray `#555`
- `background` → amber `#8b6914`
- `content` → neutral (default)

---

### ` ```roadmap ` — Sun Ray Diagram

The roadmap renders as a **Sun Ray Diagram**: a quarter-circle SVG with concentric arc bands (inner = current state, outer = future state) divided by diagonal ray lines from the bottom-left origin.

```json
{
  "title": "Digital Transformation Roadmap",
  "subtitle": "2026–2028",
  "topic": "Digital Gov",
  "currentState": "Manual processes, siloed data",
  "futureState": "Integrated, data-driven government",
  "overallProgress": 35,
  "bands": [
    { "label": "Foundation" },
    { "label": "Integration" },
    { "label": "Optimization" },
    { "label": "Innovation" }
  ],
  "rays": [
    {
      "caption": "People & Culture",
      "description": "Change management and capacity building",
      "status": "in-progress"
    },
    {
      "caption": "Technology",
      "description": "Core infrastructure and platforms",
      "status": "completed"
    },
    {
      "caption": "Data & Analytics",
      "description": "Data governance and insights",
      "status": "planned"
    },
    {
      "caption": "Service Delivery",
      "description": "Citizen-facing digital services",
      "status": "planned"
    }
  ]
}
```

**Fields**:
- `bands[]` — concentric rings from inner (current) to outer (future); colors auto-generated from branding primary if not specified
- `rays[]` — radial pillars/themes; each ray divides the arc into a sector
- `topic` — label shown at the origin circle
- `currentState` / `futureState` — descriptive labels shown at arc start/end
- `overallProgress` — 0–100 percentage shown in header progress ring
- `phases[]` — legacy linear format; auto-converted to bands/rays if `bands`/`rays` not provided

**Status values**: `"completed"` | `"in-progress"` | `"planned"`

**Hover interaction**: Hovering an arc segment shows a tooltip with the ray description, band layer, and status.

---

### ` ```gantt ` / ` ```project_plan `

```json
{
  "title": "Optional chart title",
  "subtitle": "May 2026 → Feb 2027",
  "start_date": "2026-05-01",
  "end_date": "2027-02-28",
  "axis": "weeks",
  "flag_colors": ["#007A5E", "#CE1126", "#FCD116"],
  "categories": [
    { "id": "onboarding", "label": "Onboarding", "color": "#007A5E" },
    { "id": "training",   "label": "Training",   "color": "#1f4e79" }
  ],
  "tasks": [
    {
      "group": "Phase 1",
      "name": "Orientation",
      "sub": "Week 1: team formation",
      "category": "onboarding",
      "start": "W1",
      "end": "W2",
      "type": "bar",
      "hatched": false,
      "detail": "Tooltip text shown on hover"
    },
    {
      "group": "Phase 1",
      "name": "Kickoff milestone",
      "category": "onboarding",
      "start": "W3",
      "type": "diamond"
    }
  ]
}
```

**Position tokens** (`start` / `end`):
- `"W1"` … `"W52"` — 1-based week index
- `"M1"` … `"M24"` — 1-based month index (converted to weeks × 4.333)
- `"2026-05-04"` — ISO date (requires `start_date` to compute column offset)

**Axis modes** (`axis`):
- `"weeks"` — each column = 1 week (default)
- `"months"` — each column = 1 month
- `"dates"` — each column = 1 day (for short sprints)

**Hover tooltips**: Set `detail` on any task to show a tooltip on bar/diamond hover.

---

### ` ```playbook `

```json
{
  "title": "Digital Transformation Playbook",
  "subtitle": "A guide for Change Champions",
  "parts": [
    {
      "title": "Getting Started",
      "intro": "This section covers onboarding and orientation.",
      "topics": [
        {
          "title": "Your Role as a Change Champion",
          "subtitle": "What you need to know in week 1",
          "body": "## Responsibilities\n\nYou are responsible for..."
        }
      ]
    }
  ]
}
```

---

### ` ```kpi ` (dashboard)

```json
{
  "label": "Active Users",
  "value": "12,450",
  "delta": "+8.3% vs last month",
  "trend_direction": "positive",
  "trend": [9200, 9800, 10400, 11100, 11800, 12450],
  "tooltip": "Monthly active users who logged in at least once. Excludes service accounts.",
  "tags": ["region:all", "category:engagement"]
}
```

**Hover tooltip**: Set `tooltip` to show a dark bubble on KPI tile hover. An ℹ icon appears in the top-right corner of the tile when a tooltip is present.

---

### ` ```chart ` (dashboard)

```json
{
  "title": "Revenue by Region",
  "data": [
    { "region": "North", "revenue": 4200000 },
    { "region": "South", "revenue": 3100000 }
  ],
  "x_field": "region",
  "y_fields": ["revenue"],
  "recommended_chart": "bar",
  "size": "half",
  "notes": "North region leads due to Q1 contract renewals. South expected to close gap in Q3.",
  "tags": ["category:revenue"]
}
```

**Insight overlay**: Set `notes` to show a dark overlay with a 💡 icon on chart panel hover. The overlay fades in smoothly on mouse-over.

**Size values**: `"hero"` (12 cols) | `"half"` (6 cols) | `"third"` (4 cols) | `"quarter"` (3 cols)

---

## Rendering Pipeline

```
LLM content (markdown + JSON blocks)
        │
        ▼
  parseContent()          ← content-parser.ts
  → ContentSegment[]      ← types: markdown, chart, mermaid, kpi,
                             filters, data, gantt, roadmap, playbook,
                             book, report
        │
        ▼
  detectPageType()        ← parsing/page-type.ts (skipped if pageType explicit)
        │
        ▼
  serverRenderAll()       ← server-renderer.ts (Playwright/Chromium)
  → charts: PNG data-URLs
  → diagrams: inline SVG
        │
        ▼
  buildXxxTemplate()      ← templates/*.ts
        │
        ▼
  Buffer (UTF-8 HTML)
```

### JSON-first routing

When the LLM emits a typed fenced block, `generate.ts` prefers the JSON-driven renderer:

```
book page type
  ├── has BookSegment?     → buildBookFromConfig()      ← structured chapters
  └── no segment?          → buildBookTemplate()        ← markdown fallback

report page type
  ├── has ReportSegment?   → buildReportFromConfig()    ← structured sections
  └── no segment?          → buildReportTemplate()      ← markdown fallback

roadmap page type
  ├── has RoadmapSegment?  → buildRoadmapFromConfig()   ← Sun Ray Diagram
  └── no segment?          → buildRoadmapTemplate()     ← markdown fallback

playbook page type
  ├── has PlaybookSegment? → buildPlaybookFromConfig()  ← structured parts/topics
  └── no segment?          → buildPlaybookTemplate()    ← markdown heading parser
```

### Page type detection priority

`detectPageType()` uses this priority order:

1. Explicit `pageType` option (skips detection entirely)
2. Structured block counts: `book` > `report` > `roadmap` > `playbook` > `gantt` > `chart`/`kpi`/`filters`/`data` → `dashboard`
3. Title keyword matching: `/roadmap|transformation|journey|maturity/` → `roadmap`
4. Default fallback: `website`

---

## Shared Utilities

### `branding/color-resolver.ts`

Centralises the color fallback chain used by gantt, project-plan, and dashboard:

```
category.color → branding.primaryColor (index 0 only) → DEFAULT_PALETTE[i]
```

Exports: `resolveCategoryColor`, `paletteColor`, `resolvePalette`, `DEFAULT_PALETTE`

### `time/time-axis.ts`

Gantt time-axis utilities, independently testable:

- `parsePosition(token, startDate, axis)` — token → 0-based column index
- `computeTotalColumns(tasks, startDate, axis)` — max column needed
- `buildMonthSpans(startDate, totalCols, axis)` — header row spans

---

## `file_to_html` Page Types

The `file_to_html` tool supports these layout types for DOCX/PDF source documents:

| `page_type` | Routing |
|-------------|---------|
| `documentation` | Source HTML → TOC sidebar layout (legacy; use `website` for new docs) |
| `playbook` | Source HTML → `parsePlaybookParts()` → card grid |
| `roadmap` | Source HTML → `buildRoadmapTemplate()` |
| `gantt` | Source HTML → plain text → `generateHtml()` (requires ` ```gantt ` block in doc) |
| `project_plan` | Source HTML → plain text → `generateHtml()` (requires ` ```gantt ` block in doc) |
| `dashboard` | Source HTML → plain text → `generateHtml()` (requires ` ```chart `/` ```kpi ` blocks) |

---

## Branding

All templates respect `BrandingConfig`:

```typescript
interface BrandingConfig {
  enabled: boolean;
  logoUrl?: string;
  organizationName?: string;
  primaryColor?: string;   // hex, e.g. "#007A5E"
  fontFamily?: string;
}
```

- `primaryColor` is used for accent colors, timeline dots, category bars (index 0), button backgrounds, and Sun Ray Diagram band gradients.
- The playbook template also auto-detects Caribbean country names and applies national flag colors when `primaryColor` is not set.

---

## Dashboard Hover Interactions

### KPI Tile Tooltip

Add a `tooltip` field to any ` ```kpi ` block to enable hover tooltips:

```json
{ "label": "Budget Utilization", "value": "73%", "tooltip": "YTD spend vs approved budget. Excludes contingency reserve." }
```

- An ℹ icon appears in the top-right corner of the tile
- Hovering shows a dark bubble above the tile with the tooltip text
- Pure CSS — no JavaScript required

### Chart Panel Insight Overlay

Add a `notes` field to any ` ```chart ` block to enable insight overlays:

```json
{ "title": "Sales Trend", "notes": "Q2 spike driven by promotional campaign. Normalisation expected in Q3." }
```

- Hovering the chart panel fades in a dark overlay with a 💡 icon and the insight text
- CSS transition (`opacity 0.2s ease`) — no JavaScript required
- The overlay does not obscure the chart title

---

## Adding a New Page Type

1. Add the type to `HtmlPageType` in `types.ts`
2. Add a JSON block config interface + segment type in `types.ts`
3. Add parsing in `content-parser.ts` (new `else if (lang === 'mytype')` branch)
4. Create `templates/my-type.ts` with `buildMyTypeTemplate()`
5. Add routing in `generate.ts`
6. Add to `HtmlGenPageType` enum in `tools/html-gen.ts`
7. Add to `mapPageType()` in `tools/html-gen.ts`
8. Add a smoke test fixture in `scripts/test-html-rendering.ts`
