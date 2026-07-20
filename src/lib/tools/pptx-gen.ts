/**
 * PPTX Generation Tool
 *
 * Generates PowerPoint presentations (.pptx) with professional themes and layouts.
 * Supports optional AI image generation for image slides via image_gen integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition, ValidationResult } from '../tools';
import { numInRange } from '../tools';
import type {
  PptxGenToolArgs,
  PptxGenConfig,
  PptxGenResponse,
  SlideDefinition,
  SlideType,
} from '@/types/pptx-gen';
import { getRequestContext } from '../request-context';
import { getToolConfig } from '../db/compat/tool-config';
import { generatePptx } from '../pptxgen/pptx-builder';
import { getOutputDirectory, generateDocumentFilename } from '../docgen/branding';
import { addThreadOutput, addWorkspaceOutput, getThreadContext } from '../db/compat/threads';
import { checkPayloadSize, checkMemoryForPptx } from '../memory-utils';
import { isImageGenEnabled } from '../image-gen/provider-factory';

// ============ Constants ============

/** Absolute maximum slides an admin can configure */
const ABSOLUTE_MAX_SLIDES = 50;

/** Absolute maximum image slides an admin can configure */
const ABSOLUTE_MAX_IMAGE_SLIDES = 50;

/** Maximum payload size in MB */
const MAX_PAYLOAD_MB = 5;

// ============ Default Configuration ============

export const PPTX_GEN_DEFAULTS: PptxGenConfig = {
  defaultTheme: 'light',
  maxSlides: 12,
  maxImageSlides: 3,
  enableImageGeneration: true,
  maxCharsPerSlide: 500,
  maxDescriptionLength: 300,
  branding: {
    enabled: false,
    logoUrl: '',
    organizationName: '',
  },
};

// ============ Config Schema ============

const pptxGenConfigSchema = {
  type: 'object',
  properties: {
    defaultTheme: {
      type: 'string',
      title: 'Default Theme',
      enum: ['light', 'dark'],
      default: 'light',
    },
    maxSlides: {
      type: 'number',
      title: 'Max Slides',
      description: 'Maximum slides per presentation',
      minimum: 5,
      maximum: 50,
      default: 12,
    },
    maxImageSlides: {
      type: 'number',
      title: 'Max Image Slides',
      description: 'Maximum AI-generated image slides per presentation',
      minimum: 0,
      maximum: 50,
      default: 3,
    },
    enableImageGeneration: {
      type: 'boolean',
      title: 'Enable AI Image Slides',
      description: 'Allow AI-generated full-bleed image slides (requires image_gen tool)',
      default: true,
    },
    maxCharsPerSlide: {
      type: 'number',
      title: 'Max Characters Per Slide',
      description: 'Maximum characters allowed per slide content before overflow warning',
      minimum: 100,
      maximum: 2000,
      default: 500,
    },
    maxDescriptionLength: {
      type: 'number',
      title: 'Max Description Length',
      description: 'Maximum characters for slide description paragraphs',
      minimum: 50,
      maximum: 1000,
      default: 300,
    },
    branding: {
      type: 'object',
      title: 'Branding',
      properties: {
        enabled: { type: 'boolean', default: false },
        logoUrl: { type: 'string', default: '' },
        organizationName: { type: 'string', default: '' },
      },
    },
  },
};

// ============ Validation ============

function validatePptxGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.maxSlides !== undefined) {
    if (!numInRange(config.maxSlides, 5, ABSOLUTE_MAX_SLIDES)) {
      errors.push(`maxSlides must be between 5 and ${ABSOLUTE_MAX_SLIDES}`);
    }
  }

  if (config.maxImageSlides !== undefined) {
    if (!numInRange(config.maxImageSlides, 0, ABSOLUTE_MAX_IMAGE_SLIDES)) {
      errors.push(`maxImageSlides must be between 0 and ${ABSOLUTE_MAX_IMAGE_SLIDES}`);
    }
  }

  if (config.maxCharsPerSlide !== undefined) {
    if (!numInRange(config.maxCharsPerSlide, 100, 2000)) {
      errors.push('maxCharsPerSlide must be between 100 and 2000');
    }
  }

  if (config.maxDescriptionLength !== undefined) {
    if (!numInRange(config.maxDescriptionLength, 50, 1000)) {
      errors.push('maxDescriptionLength must be between 50 and 1000');
    }
  }

  const validThemes = ['light', 'dark'];
  if (config.defaultTheme && !validThemes.includes(config.defaultTheme as string)) {
    errors.push(`defaultTheme must be one of: ${validThemes.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

// ============ Helper Functions ============

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============ Slide-Type Priority Tiers ============

/**
 * Plain text fallback types — Tier 3. These are only acceptable when no
 * Tier 1 visual type or Tier 2 image slide fits the content.
 */
const TEXT_FALLBACK_TYPES = new Set<SlideType>(['content', 'closing', 'title']);

/**
 * Keyword → emoji icon map for Tier 3 fallback slides. When the LLM does not
 * provide an explicit `icon`, this heuristic assigns one so the fallback is
 * never a bare text wall.
 */
const ICON_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/finance|revenue|cost|budget|money|profit/i, '💰'],
  [/growth|increase|trend|up|rise/i, '📈'],
  [/decline|decrease|drop|down|fall|loss/i, '📉'],
  [/risk|security|threat|vulnerab|compliance/i, '🛡️'],
  [/team|people|staff|workforce|talent/i, '👥'],
  [/goal|target|objective|aim|kpi/i, '🎯'],
  [/idea|innovation|concept|creative|invent/i, '💡'],
  [/process|workflow|step|procedure|pipeline/i, '⚙️'],
  [/data|analytic|metric|insight|report/i, '📊'],
  [/customer|client|user|consumer|audience/i, '🤝'],
  [/time|schedule|deadline|timeline|duration/i, '⏰'],
  [/roadmap|plan|strategy|future|vision/i, '🗺️'],
  [/checklist|todo|task|action|deliverable/i, '✅'],
  [/warning|alert|caution|issue|problem/i, '⚠️'],
  [/location|region|global|geography|map/i, '🌍'],
  [/technology|software|system|infrastructure|cloud/i, '💻'],
  [/question|faq|ask|inquiry/i, '❓'],
  [/summary|conclusion|wrap|recap|overview/i, '📝'],
];

/**
 * Returns a context-appropriate emoji icon for a Tier 3 fallback slide when
 * the LLM did not specify one. Falls back to a generic pushpin.
 */
function autoIcon(title: string, content: string): string {
  const text = `${title} ${content}`;
  for (const [re, icon] of ICON_HINTS) {
    if (re.test(text)) return icon;
  }
  return '📌';
}

// ============ Tool Definition ============

export const pptxGenTool: ToolDefinition = {
  name: 'pptx_gen',
  displayName: 'Presentation Generator',
  description:
    'Generate PowerPoint presentations (.pptx) with professional themes, layouts, and AI-generated images',
  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'pptx_gen',
      description: `Generate a PowerPoint presentation (.pptx) with professional styling.

Slide and image limits are configured by the administrator. If the request exceeds limits, you will receive an error with the current configured limits.

Available themes: "light" (white background, best for screens/print) or "dark" (black background, best for projectors). Use accentColor for brand colors.

SLIDE-TYPE SELECTION PRIORITY — always prefer visual/structured slides over plain text.
Plain "content" text slides are a LAST-RESORT fallback, never the default choice.

Tier 1 — Structured visual slides (PREFER THESE for any data, comparisons, steps, frameworks):
- chart: Data visualization (bar, line, pie, doughnut, area). Provide chartData with categories, series, chartType. Supports layout for split mode.
- table: Structured data with headers and rows. Provide tableData. Supports striped rows and layout for split mode.
- timeline: Roadmap or milestone events. Provide timelineData with events array (date, title, description). Supports horizontal or vertical orientation.
- metric-cards: KPI dashboard cards with trend indicators. Provide metricCardsData with cards array (label, value, trend, trendValue). Auto-colored trend arrows.
- swot: Strategic SWOT analysis in a 2x2 grid. Provide swotData with strengths, weaknesses, opportunities, threats arrays.
- funnel: Sales pipeline or conversion funnel. Provide funnelData with stages array (label, value, color). Optional showPercentages.
- before-after: Transformation comparison with side-by-side panels. Provide beforeAfterData with left/right panels (label, content, color).
- process: Workflow or step-by-step guide. Provide processData with steps array (number, title, description). Horizontal or vertical orientation.
- kanban: Sprint board or project status. Provide kanbanData with columns array (header, color, cards). Trello-style layout.
- pyramid: Hierarchy or framework diagram. Provide pyramidData with levels array (label, color, description). Top-down or bottom-up.
- radial-progress: Goal tracking with donut rings. Provide radialProgressData with items array (label, value 0-100, color).
- icon-grid: Feature highlights or capabilities grid (4-6 discrete points). Provide iconGridData with items array (icon emoji, title, desc). 2x2 or 3x2 layout.
- comparison-matrix: Vendor/option evaluation table. Provide comparisonMatrixData with headers and rows. Optional winner highlighting.
- stats: Large numbers with labels and optional per-stat captions. Supports layout for split mode.
- comparison: Two boxes for pros/cons or before/after with description
- two-column: Side-by-side text columns with description
- quote: Testimonial or key statement. Provide quoteData with quote text, attribution, and optional role.
- agenda: Meeting outline or table of contents. Provide agendaData with items array (number, title, description). Numbered or plain.
- team: Leadership profiles or contact cards. Provide teamData with members array (name, role, bio). Card grid layout.
- geo: Regional or location data. Provide geoData with markers array (label, lat, lng, size). Simplified map visualization.

Tier 2 — AI-generated image slide (use when no Tier 1 type fits but a generated visual strengthens the slide):
- image: Visual slide with AI-generated imagery. Use imagePrompt. Supports description overlay and split layout.

Tier 3 — Last-resort text fallback (use ONLY when no Tier 1 or Tier 2 type fits; narrative/transition slides with no visualisable data):
- content: Title + description + bullet points + optional "icon" emoji. Supports layout: "split-left", "split-right", "split-top"

Special:
- title: Opening slide with title and optional description/subtitle (first slide only)
- closing: Thank you or contact slide with description (final slide only)

SELECTION RULES (enforce strictly):
- Numeric data → use stats, metric-cards, or chart — NEVER content.
- Comparisons (pros/cons, A vs B) → use comparison, comparison-matrix, or before-after — NEVER content.
- Steps, workflow, phases → use process or timeline — NEVER content.
- 4-6 discrete feature points → use icon-grid — NEVER content.
- Hierarchy, levels, framework → use pyramid — NEVER content.
- Do NOT produce consecutive "content" slides. If two slides in a row would both be content, restructure one into a Tier 1 visual type.
- When you DO use a "content" slide, include an "icon" emoji (e.g. 💡, 📊, 🎯, ⚙️, 🛡️) so it is not a bare text wall.

All slide types support an optional "description" field — a 1-2 sentence explanatory paragraph below the title.
All slide types support optional "speakerNotes" for presenter notes.

For image slides, provide an imagePrompt describing the visual.`,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Presentation title',
          },
          slides: {
            type: 'array',
            description: 'Array of slide definitions',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['title', 'content', 'two-column', 'comparison', 'stats', 'image', 'closing', 'chart', 'table', 'timeline', 'metric-cards', 'swot', 'funnel', 'before-after', 'process', 'kanban', 'pyramid', 'radial-progress', 'icon-grid', 'comparison-matrix', 'quote', 'agenda', 'team', 'geo'],
                  description: 'Slide layout type. Prefer Tier 1 visual types (chart, table, timeline, metric-cards, swot, funnel, before-after, process, kanban, pyramid, radial-progress, icon-grid, comparison-matrix, stats, comparison, two-column, quote, agenda, team, geo). Use "image" (Tier 2) only when no visual type fits. Use "content" (Tier 3) only as a last-resort narrative fallback.',
                },
                title: {
                  type: 'string',
                  description: 'Slide title',
                },
                description: {
                  type: 'string',
                  description: 'Optional explanatory paragraph (1-2 sentences) describing the slide content, key insight, or context',
                },
                layout: {
                  type: 'string',
                  enum: ['full', 'split-left', 'split-right', 'split-top'],
                  description: 'Layout mode for visual slides: "full" (default, visual only), "split-left" (visual left, text right), "split-right" (text left, visual right), "split-top" (text top, visual bottom)',
                  default: 'full',
                },
                content: {
                  type: 'string',
                  description: 'Main content for content/closing slides (use newlines for bullet points). Only use for Tier 3 fallback slides — prefer a visual slide type instead.',
                },
                icon: {
                  type: 'string',
                  description: 'Optional emoji icon shown next to the title for content/closing fallback slides (e.g. "💡", "📊", "🎯", "⚙️", "🛡️"). Required when using the "content" fallback type to avoid a bare text wall.',
                },
                leftContent: {
                  type: 'string',
                  description: 'Left column content (for two-column/comparison)',
                },
                rightContent: {
                  type: 'string',
                  description: 'Right column content (for two-column/comparison)',
                },
                stats: {
                  type: 'array',
                  description: 'Stats for stats slide',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string', description: 'Large number or value' },
                      label: { type: 'string', description: 'Description label' },
                      caption: { type: 'string', description: 'Optional small caption below label (e.g., "+12% vs last month")' },
                    },
                    required: ['value', 'label'],
                  },
                },
                imagePrompt: {
                  type: 'string',
                  description: 'For image slides: detailed prompt for AI image generation',
                },
                imageStyle: {
                  type: 'string',
                  enum: ['auto', 'infographic', 'poster', 'illustration', 'photo', 'product-mockup', 'icon', 'social-media'],
                  description: 'Style hint for image generation: auto (model decides), infographic, poster, illustration, photo, product-mockup, icon, social-media. Default: infographic for presentation slides.',
                },
                imageResolution: {
                  type: 'string',
                  enum: ['512', '1K', '2K', '4K'],
                  description: 'Image resolution: 512 (preview/thumbnail), 1K (standard quality), 2K (high-fidelity display), 4K (print-ready). Default: 1K.',
                },
                chartData: {
                  type: 'object',
                  description: 'Chart data (required for chart slides)',
                  properties: {
                    chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut', 'area'], description: 'Chart type' },
                    categories: { type: 'array', items: { type: 'string' }, description: 'X-axis category labels' },
                    series: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: 'Series name (legend)' },
                          values: { type: 'array', items: { type: 'number' }, description: 'Data values' },
                        },
                        required: ['name', 'values'],
                      },
                      description: 'Data series',
                    },
                    showLegend: { type: 'boolean', description: 'Show legend (default: true for multi-series)' },
                    showValues: { type: 'boolean', description: 'Show data labels on chart' },
                    yAxisLabel: { type: 'string', description: 'Optional Y-axis label' },
                  },
                  required: ['chartType', 'categories', 'series'],
                },
                tableData: {
                  type: 'object',
                  description: 'Table data (required for table slides)',
                  properties: {
                    headers: { type: 'array', items: { type: 'string' }, description: 'Column headers' },
                    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Data rows' },
                    columnWidths: { type: 'array', items: { type: 'number' }, description: 'Optional relative column width weights (e.g. [1,2,1]). Normalized to fit the table width. Omit for equal columns.' },
                    headerColor: { type: 'string', description: 'Header row background color hex' },
                    striped: { type: 'boolean', description: 'Alternate row shading (default: true)' },
                  },
                  required: ['headers', 'rows'],
                },
                timelineData: {
                  type: 'object',
                  description: 'Timeline data (required for timeline slides)',
                  properties: {
                    events: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', description: 'Date or timeframe label' },
                          title: { type: 'string', description: 'Event title' },
                          description: { type: 'string', description: 'Optional event detail' },
                        },
                        required: ['date', 'title'],
                      },
                      description: 'Timeline events in chronological order',
                    },
                    orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Layout orientation (default: horizontal)' },
                  },
                  required: ['events'],
                },
                metricCardsData: {
                  type: 'object',
                  description: 'Metric cards data (required for metric-cards slides)',
                  properties: {
                    cards: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          label: { type: 'string', description: 'Metric name' },
                          value: { type: 'string', description: 'Display value (e.g., "99.97%", "$12.4M")' },
                          trend: { type: 'string', enum: ['up', 'down', 'flat'], description: 'Trend direction' },
                          trendValue: { type: 'string', description: 'Trend delta (e.g., "+0.02%")' },
                          color: { type: 'string', description: 'Card accent color hex (default: auto from trend)' },
                        },
                        required: ['label', 'value'],
                      },
                      description: 'Metric cards',
                    },
                    columns: { type: 'number', description: 'Number of cards per row (default: auto)' },
                  },
                  required: ['cards'],
                },
                swotData: {
                  type: 'object',
                  description: 'SWOT analysis data (required for swot slides)',
                  properties: {
                    strengths: { type: 'array', items: { type: 'string' }, description: 'Internal positive factors' },
                    weaknesses: { type: 'array', items: { type: 'string' }, description: 'Internal negative factors' },
                    opportunities: { type: 'array', items: { type: 'string' }, description: 'External positive factors' },
                    threats: { type: 'array', items: { type: 'string' }, description: 'External negative factors' },
                  },
                  required: ['strengths', 'weaknesses', 'opportunities', 'threats'],
                },
                funnelData: {
                  type: 'object',
                  description: 'Funnel data (required for funnel slides)',
                  properties: {
                    stages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          label: { type: 'string', description: 'Stage name' },
                          value: { type: 'number', description: 'Count or value at this stage' },
                          color: { type: 'string', description: 'Stage color hex' },
                        },
                        required: ['label', 'value'],
                      },
                      description: 'Funnel stages from top to bottom',
                    },
                    showPercentages: { type: 'boolean', description: 'Show conversion percentages between stages' },
                    valuePrefix: { type: 'string', description: 'Prefix for value display (e.g., "$")' },
                    valueSuffix: { type: 'string', description: 'Suffix for value display (e.g., "%")' },
                  },
                  required: ['stages'],
                },
                beforeAfterData: {
                  type: 'object',
                  description: 'Before/after data (required for before-after slides)',
                  properties: {
                    left: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', description: 'Panel label (e.g., "Before")' },
                        content: { type: 'string', description: 'Bullet points (newline separated)' },
                        color: { type: 'string', description: 'Panel accent color hex (default: red)' },
                      },
                      required: ['label', 'content'],
                    },
                    right: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', description: 'Panel label (e.g., "After")' },
                        content: { type: 'string', description: 'Bullet points (newline separated)' },
                        color: { type: 'string', description: 'Panel accent color hex (default: green)' },
                      },
                      required: ['label', 'content'],
                    },
                  },
                  required: ['left', 'right'],
                },
                processData: {
                  type: 'object',
                  description: 'Process data (required for process slides)',
                  properties: {
                    steps: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          number: { type: 'number', description: 'Step number (1-based)' },
                          title: { type: 'string', description: 'Step title' },
                          description: { type: 'string', description: 'Step detail' },
                        },
                        required: ['number', 'title'],
                      },
                      description: 'Process steps in order',
                    },
                    orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Layout orientation (default: horizontal)' },
                    showNumbers: { type: 'boolean', description: 'Show step numbers (default: true)' },
                    showArrows: { type: 'boolean', description: 'Show connector arrows (default: true)' },
                  },
                  required: ['steps'],
                },
                kanbanData: {
                  type: 'object', description: 'Kanban board data (required for kanban slides)',
                  properties: {
                    columns: { type: 'array', items: { type: 'object', properties: { header: { type: 'string' }, color: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } } }, required: ['header', 'cards'] } },
                  }, required: ['columns'],
                },
                pyramidData: {
                  type: 'object', description: 'Pyramid data (required for pyramid slides)',
                  properties: {
                    levels: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, color: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } },
                    orientation: { type: 'string', enum: ['top-down', 'bottom-up'] },
                  }, required: ['levels'],
                },
                radialProgressData: {
                  type: 'object', description: 'Radial progress data (required for radial-progress slides)',
                  properties: {
                    items: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, color: { type: 'string' } }, required: ['label', 'value'] } },
                  }, required: ['items'],
                },
                iconGridData: {
                  type: 'object', description: 'Icon grid data (required for icon-grid slides)',
                  properties: {
                    items: { type: 'array', items: { type: 'object', properties: { icon: { type: 'string' }, title: { type: 'string' }, desc: { type: 'string' } }, required: ['icon', 'title', 'desc'] } },
                    layout: { type: 'string', enum: ['2x2', '3x2', '4x2'] },
                  }, required: ['items'],
                },
                comparisonMatrixData: {
                  type: 'object', description: 'Comparison matrix data (required for comparison-matrix slides)',
                  properties: {
                    headers: { type: 'array', items: { type: 'string' } },
                    rows: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          criteria: { type: 'string', description: 'Row label / criterion name (first column)' },
                          winner: { type: 'string', description: 'Name of the column header that wins this row (enables highlighting when showWinner is true). Must match one of the headers exactly.' },
                        },
                        required: ['criteria'],
                        // Allow dynamic option columns (each header name maps to a string value)
                      },
                      description: 'Data rows. Each row must include "criteria" plus a string value for each option column header.',
                    },
                    showWinner: { type: 'boolean' },
                  }, required: ['headers', 'rows'],
                },
                quoteData: {
                  type: 'object', description: 'Quote data (required for quote slides)',
                  properties: { quote: { type: 'string' }, attribution: { type: 'string' }, role: { type: 'string' } },
                  required: ['quote'],
                },
                agendaData: {
                  type: 'object', description: 'Agenda data (required for agenda slides)',
                  properties: {
                    items: { type: 'array', items: { type: 'object', properties: { number: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } },
                    numbered: { type: 'boolean' },
                  }, required: ['items'],
                },
                teamData: {
                  type: 'object', description: 'Team data (required for team slides)',
                  properties: {
                    members: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, bio: { type: 'string' } }, required: ['name', 'role'] } },
                    columns: { type: 'number' },
                  }, required: ['members'],
                },
                geoData: {
                  type: 'object', description: 'Geo data (required for geo slides)',
                  properties: {
                    region: { type: 'string', enum: ['world', 'us', 'europe', 'asia'] },
                    markers: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, size: { type: 'string', enum: ['small', 'medium', 'large'] } }, required: ['label', 'lat', 'lng'] } },
                  }, required: ['markers'],
                },
                speakerNotes: {
                  type: 'string',
                  description: 'Speaker notes (optional)',
                },
              },
              required: ['type', 'title'],
            },
          },
          theme: {
            type: 'string',
            enum: ['light', 'dark'],
            description: 'Visual theme: "light" (white background) or "dark" (black background). Default: light.',
          },
          accentColor: {
            type: 'string',
            description: 'Hex accent color for highlights, chart fills, and stat numbers (e.g., "#3B82F6"). Default: blue.',
          },
        },
        required: ['title', 'slides'],
      },
    },
  },

  validateConfig: validatePptxGenConfig,
  defaultConfig: PPTX_GEN_DEFAULTS as unknown as Record<string, unknown>,
  configSchema: pptxGenConfigSchema,

  execute: async (args: PptxGenToolArgs): Promise<string> => {
    try {
      // Get context from AsyncLocalStorage
      const context = getRequestContext();
      const { threadId } = context;

      // Validate we have required context
      if (!threadId) {
        console.warn('[PptxGen] No thread context available');
        return JSON.stringify({
          success: false,
          error: 'Presentation generation requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        } as PptxGenResponse);
      }

      // Step 0: Payload size check (first!)
      const payloadCheck = checkPayloadSize(args, MAX_PAYLOAD_MB);
      if (!payloadCheck.pass) {
        return JSON.stringify({
          success: false,
          error: payloadCheck.reason,
          errorCode: 'PAYLOAD_TOO_LARGE',
        } as PptxGenResponse);
      }

      // Step 1: Get tool configuration (needed for limit checks)
      const toolConfig = await getToolConfig('pptx_gen');
      const config = (toolConfig?.config as Partial<PptxGenConfig>) || {};
      const organizationName = config.branding?.organizationName || '';

      // Check if tool is enabled
      if (toolConfig && !toolConfig.isEnabled) {
        return JSON.stringify({
          success: false,
          error: 'Presentation generation is currently disabled',
          errorCode: 'TOOL_DISABLED',
        } as PptxGenResponse);
      }

      // Use admin-configured limits, falling back to defaults
      const maxSlides = config.maxSlides ?? PPTX_GEN_DEFAULTS.maxSlides;
      const maxImageSlides = config.maxImageSlides ?? PPTX_GEN_DEFAULTS.maxImageSlides;

      // Step 2: Validate inputs
      if (!args.slides || args.slides.length === 0) {
        return JSON.stringify({
          success: false,
          error: 'At least one slide is required',
          errorCode: 'INVALID_INPUT',
        } as PptxGenResponse);
      }

      // Validate slide limit
      if (args.slides.length > maxSlides) {
        return JSON.stringify({
          success: false,
          error: `Slide limit exceeded: ${args.slides.length} slides, maximum is ${maxSlides}`,
          errorCode: 'LIMIT_EXCEEDED',
          suggestion: `Reduce the number of slides to ${maxSlides} or fewer`,
        } as PptxGenResponse);
      }

      // Validate image slide limit
      const imageSlides = args.slides.filter((s) => s.type === 'image');
      if (imageSlides.length > maxImageSlides) {
        return JSON.stringify({
          success: false,
          error: `Image slide limit exceeded: ${imageSlides.length} image slides, maximum is ${maxImageSlides}`,
          errorCode: 'LIMIT_EXCEEDED',
          suggestion: `Reduce image slides to ${maxImageSlides} or fewer, or use content slides instead`,
        } as PptxGenResponse);
      }

      // Step 3: Check memory
      const memCheck = checkMemoryForPptx(args.slides);
      if (!memCheck.canProceed) {
        console.warn('[PptxGen] Memory check failed:', memCheck.reason);
        return JSON.stringify({
          success: false,
          error: memCheck.reason,
          errorCode: 'MEMORY_LIMIT',
        } as PptxGenResponse);
      }

      // Step 3: Check image_gen availability and prepare slides (tier cascade)
      const imageGenAvailable = await isImageGenEnabled();
      let slidesToProcess = args.slides;
      let imagesFallbackToText = 0;
      let contentSlidesAutoIconed = 0;

      if (!imageGenAvailable && imageSlides.length > 0) {
        console.log(
          `[PptxGen] image_gen disabled, converting ${imageSlides.length} image slides to content slides (Tier 3 fallback)`
        );
        // Convert image slides (Tier 2) to content slides (Tier 3) with an icon
        // so the fallback is not a bare text wall.
        slidesToProcess = slidesToProcess.map((slide) => {
          if (slide.type === 'image') {
            imagesFallbackToText++;
            const fallbackContent = slide.imagePrompt || slide.content || 'Visual content placeholder';
            return {
              ...slide,
              type: 'content' as const,
              content: fallbackContent,
              icon: slide.icon || autoIcon(slide.title, fallbackContent),
            };
          }
          return slide;
        });
      }

      // Tier 3 enhancement: ensure plain "content" fallback slides carry an
      // icon so they are not bare text walls. If the LLM omitted an icon we
      // auto-assign one via the keyword→emoji heuristic.
      slidesToProcess = slidesToProcess.map((slide) => {
        if (TEXT_FALLBACK_TYPES.has(slide.type) && !slide.icon) {
          const inferred = autoIcon(slide.title, slide.content || slide.description || '');
          if (slide.type === 'content') contentSlidesAutoIconed++;
          return { ...slide, icon: inferred };
        }
        return slide;
      });

      if (contentSlidesAutoIconed > 0) {
        console.log(
          `[PptxGen] auto-assigned icons to ${contentSlidesAutoIconed} content fallback slide(s) missing icons`
        );
      }

      // Audit log: warn when the LLM chose a Tier 3 fallback for content that
      // looks visualisable (contains numbers, "vs", or is verbose). We do not
      // auto-convert (the LLM's choice is respected) but surface it for review.
      const visualishPattern = /\d+%|\bvs\b|\bcompared?\b|\$[\d,]+|\d{2,}\s/gi;
      for (const slide of slidesToProcess) {
        if (
          TEXT_FALLBACK_TYPES.has(slide.type) &&
          visualishPattern.test(`${slide.title} ${slide.content || ''}`)
        ) {
          console.warn(
            `[PptxGen] content slide "${slide.title}" looks data-heavy — consider a Tier 1 visual type instead`
          );
        }
      }

      // Step 4: Generate presentation
      console.log(
        `[PptxGen] Generating presentation: "${args.title}" with ${slidesToProcess.length} slide(s)`
      );

      const result = await generatePptx({
        title: args.title,
        slides: slidesToProcess as SlideDefinition[],
        theme: args.theme,
        accentColor: args.accentColor,
        organizationName,
      });

      // Step 5: Save file
      const outputDir = getOutputDirectory();
      const filename = generateDocumentFilename(args.title, 'pptx', threadId);
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, result.buffer);

      // Step 6: Determine context and save to database
      const threadContext = await getThreadContext(threadId);

      if (!threadContext.exists) {
        console.error('[PptxGen] Thread not found in database:', threadId);
        return JSON.stringify({
          success: true,
          document: {
            filename,
            fileSize: result.fileSize,
            slideCount: result.slideCount,
            downloadUrl: '',
          },
        } as PptxGenResponse);
      }

      let docId: number;
      let downloadUrlPrefix: string;

      if (threadContext.isWorkspace) {
        // Workspace context
        const wsResult = await addWorkspaceOutput(
          threadContext.workspaceId!,
          threadContext.sessionId!,
          threadContext.actualThreadId ?? null,
          filename,
          filepath,
          'pptx',
          result.fileSize
        );
        docId = wsResult.id;
        downloadUrlPrefix = '/api/workspace-documents';
      } else {
        // Main chat context
        const outputResult = await addThreadOutput(
          threadId,
          null, // messageId not available yet
          filename,
          filepath,
          'pptx',
          result.fileSize
        );
        docId = outputResult.id;
        downloadUrlPrefix = '/api/documents';
      }

      console.log(`[PptxGen] Presentation generated: ${filename} (${formatFileSize(result.fileSize)})`);

      // Build response
      const response: PptxGenResponse = {
        success: true,
        document: {
          filename,
          fileSize: result.fileSize,
          slideCount: result.slideCount,
          downloadUrl: `${downloadUrlPrefix}/${docId}/download`,
        },
      };

      // Add image generation stats if applicable
      if (result.imageSlides > 0 || result.failedImages > 0) {
        response.imageGeneration = {
          attempted: result.imageSlides + result.failedImages,
          successful: result.imageSlides,
          failed: result.failedImages,
        };
      }

      // Add fallback info if image_gen was disabled
      if (imagesFallbackToText > 0) {
        response.imageGenDisabled = true;
        response.imagesFallbackToText = imagesFallbackToText;
      }

      return JSON.stringify(response);
    } catch (error) {
      console.error('[PptxGen] Generation error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during presentation generation',
        errorCode: 'GENERATION_ERROR',
      } as PptxGenResponse);
    }
  },
};
