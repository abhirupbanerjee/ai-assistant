/**
 * Image Generation Provider Factory
 *
 * Orchestrates image generation across providers:
 * - Smart category-based routing (Gemini primary for text, Imagen 4 for photorealism)
 * - Google-aligned prompt enhancement with 5-part structure
 * - Cascading fallback: Primary → Secondary → ASCII placeholder
 * - Image processing and optimization
 * - Storage in thread_outputs table
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  getToolConfigAsync,
  getThreadContext,
  addThreadOutput,
  addWorkspaceOutput,
} from '@/lib/db/compat';
import { getRequestContext } from '@/lib/request-context';
import { generateWithGoogle } from './providers/gemini-imagen';
import { generateAsciiFallbackImage } from './ascii-fallback';
import { processImage, getFileExtension } from './image-processor';
import { getDisclaimerConfigIfEnabled } from '../disclaimer';
import type {
  ImageGenConfig,
  ImageGenToolArgs,
  ImageProvider,
  ImageStyle,
  Resolution,
  GeneratedImage,
  ImageGenResponse,
  ImageHint,
  ProcessingOptions,
  GeminiProviderConfig,
  ImagenProviderConfig,
} from '@/types/image-gen';

// ===== Configuration =====

export const IMAGE_GEN_DEFAULTS: ImageGenConfig = {
  activeProvider: 'gemini',
  providers: {
    gemini: {
      enabled: true,
      defaultModel: 'gemini-3.1-flash-image-preview',
      proModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9',
    },
    // Imagen 4 is deprecated (shutdown: August 17, 2026). Disabled by default.
    // All image generation now routes through Gemini native models.
    imagen: {
      enabled: false,
      fastModel: 'gemini-3.1-flash-image-preview',
      standardModel: 'gemini-3-pro-image-preview',
      ultraModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9',
    },
  },
  defaultStyle: 'infographic',
  defaultResolution: '1K',
  enhancePrompts: true,
  addSafetyPrefixes: true,
  imageProcessing: {
    maxDimension: 2048,
    format: 'webp',
    quality: 85,
    generateThumbnail: true,
    thumbnailSize: 400,
  },
};

export async function getImageGenConfig(): Promise<ImageGenConfig> {
  const config = await getToolConfigAsync('image_gen');

  if (config?.config) {
    const stored = config.config as Partial<ImageGenConfig>;
    return {
      ...IMAGE_GEN_DEFAULTS,
      ...stored,
      providers: {
        gemini: { ...IMAGE_GEN_DEFAULTS.providers.gemini, ...stored.providers?.gemini },
        imagen: { ...IMAGE_GEN_DEFAULTS.providers.imagen, ...stored.providers?.imagen },
      },
      imageProcessing: {
        ...IMAGE_GEN_DEFAULTS.imageProcessing,
        ...stored.imageProcessing,
      },
    };
  }

  return IMAGE_GEN_DEFAULTS;
}

export async function isImageGenEnabled(): Promise<boolean> {
  const config = await getToolConfigAsync('image_gen');
  return config?.isEnabled ?? false;
}

// ===== Smart Provider Selection =====

interface ProviderSelection {
  provider: 'gemini' | 'imagen';
  model: string;
}

/**
 * Categories where Gemini Nano Banana Pro is the PRIMARY choice.
 * These styles benefit from the Pro model's superior quality:
 * - Text-heavy styles (infographic, poster)
 * - Photorealism styles (photo, product-mockup) — previously handled by Imagen 4
 */
const GEMINI_PRO_CATEGORIES: ImageStyle[] = [
  'infographic',
  'poster',
  'photo',
  'product-mockup',
];

/**
 * Classify a prompt into the best image style when LLM selects "auto".
 * Uses keyword matching and prompt content analysis.
 */
export function classifyPromptToStyle(prompt: string, defaultStyle: ImageStyle): ImageStyle {
  const p = prompt.toLowerCase();

  // Infographic: data, statistics, comparison, timeline, facts
  if (/(infographic|data visualization|stats|statistics|compare|comparison|timeline|facts|metrics|kpi|dashboard)/.test(p)) {
    return 'infographic';
  }

  // Chart / data visualization: specific chart types, data points, axes
  // Note: chart_gen is the preferred tool for real data charts.
  // When image_gen is used, we fall back to infographic which commonly includes chart elements.
  if (/(chart|graph|bar chart|pie chart|line graph|scatter plot|histogram|data points)/.test(p)) {
    return 'infographic';
  }

  // Diagram / technical drawing: architectural, structural, scientific
  // Note: diagram_gen is the preferred tool for editable technical diagrams.
  // When image_gen is used, we fall back to illustration.
  if (/(diagram|schematic|architecture|system design|wiring|circuit|anatomy|cross-section|blueprint|entity relationship|er diagram|uml)/.test(p)) {
    return 'illustration';
  }

  // Process flow: steps, workflow, sequence, flowchart
  // Note: diagram_gen is the preferred tool for editable flowcharts.
  // When image_gen is used, we fall back to infographic which commonly shows step-by-step processes.
  if (/(process flow|workflow|step by step|sequence|flowchart|decision tree|user journey|pipeline|stages)/.test(p)) {
    return 'infographic';
  }

  // Poster: promotional, event, campaign, headline
  if (/(poster|flyer|event poster|promotional|campaign|billboard|announcement|invitation)/.test(p)) {
    return 'poster';
  }

  // Photo: photorealistic, portrait, landscape, editorial
  if (/(photo|photorealistic|photography|portrait|landscape|editorial|realistic image|picture of|snapshot)/.test(p)) {
    return 'photo';
  }

  // Product mockup: product, packaging, e-commerce, catalog
  if (/(product mockup|packaging|e-commerce|catalog|product shot|merchandise|3d render.*product)/.test(p)) {
    return 'product-mockup';
  }

  // Icon: icon, favicon, app icon, small logo, glyph
  if (/(icon|favicon|app icon|glyph|pictogram|symbol|small logo|ui icon)/.test(p)) {
    return 'icon';
  }

  // Social media: social, instagram, linkedin, twitter, post
  if (/(social media|instagram|linkedin|twitter|facebook|tiktok|post|story|reel|thumbnail|cover image)/.test(p)) {
    return 'social-media';
  }

  // Illustration: artistic, drawing, sketch, painting, concept art
  if (/(illustration|drawing|sketch|painting|concept art|watercolor|digital art|cartoon|comic|manga)/.test(p)) {
    return 'illustration';
  }

  // Default fallback
  return defaultStyle;
}

function selectPrimaryProvider(style: ImageStyle, config: ImageGenConfig): ProviderSelection | null {
  // Imagen 4 is deprecated (shutdown: August 17, 2026).
  // All image generation now routes exclusively through Gemini native models.
  if (config.providers.gemini.enabled) {
    return { provider: 'gemini', model: getGeminiModelForCategory(style, config.providers.gemini) };
  }
  return null;
}

/**
 * No fallback provider needed — Imagen 4 is deprecated and Gemini is the sole provider.
 * Kept as a stub that always returns null for backward compatibility with call sites.
 */
function selectFallbackProvider(
  _primary: ProviderSelection,
  _style: ImageStyle,
  _config: ImageGenConfig
): ProviderSelection | null {
  return null;
}

function getGeminiModelForCategory(
  style: ImageStyle,
  config: GeminiProviderConfig
): string {
  if (GEMINI_PRO_CATEGORIES.includes(style)) {
    return config.proModel;
  }
  return config.defaultModel;
}

/**
 * @deprecated Imagen 4 is sunset (August 17, 2026). This function is retained
 * for backward compatibility with DB-stored configs but is no longer called
 * by the routing logic. All styles now use getGeminiModelForCategory().
 */
function getImagenModelForCategory(
  style: ImageStyle,
  config: ImagenProviderConfig
): string {
  if (style === 'photo') return config.ultraModel;
  if (style === 'product-mockup') return config.standardModel;
  return config.fastModel;
}

// ===== Prompt Enhancement (Google Best Practices) =====

/**
 * Detect the infographic sub-mode based on prompt content.
 * Data charts, process flows, and general infographics need distinct rendering guidance
 * that a single generic prompt cannot adequately cover.
 */
function detectInfographicSubMode(prompt: string): 'data-chart' | 'process-flow' | 'general' {
  const p = prompt.toLowerCase();

  // Data chart patterns: specific chart types, axes, data points, legends
  if (/(chart|graph|bar chart|pie chart|line graph|scatter plot|histogram|data points|axis|legend|trend line|donut chart|kpi|metrics|dashboard)/.test(p)) {
    return 'data-chart';
  }

  // Process flow patterns: workflow, pipeline, steps, sequence, decision trees
  if (/(process flow|workflow|step by step|sequence|flowchart|decision tree|user journey|pipeline|stages|swimlane|decision node|branch|routing)/.test(p)) {
    return 'process-flow';
  }

  return 'general';
}

function enhancePrompt(args: ImageGenToolArgs, config: ImageGenConfig): string {
  if (!config.enhancePrompts) {
    return args.prompt;
  }

  const rawStyle = args.style || config.defaultStyle;
  const style = rawStyle === 'auto'
    ? classifyPromptToStyle(args.prompt, config.defaultStyle === 'auto' ? 'infographic' : config.defaultStyle)
    : rawStyle;
  let enhanced = args.prompt;

  switch (style) {
    case 'infographic': {
      const subMode = detectInfographicSubMode(args.prompt);

      if (subMode === 'data-chart') {
        enhanced = `[TASK] Create a professional data visualization infographic: ${enhanced}
[CHART] Include at least one primary chart type (bar, pie, line, or donut) appropriate for the data. Use clearly labeled axes with titles, visible value labels on data points, and a legend positioned outside the chart area. Use consistent color coding across categories — same category same color throughout.
[NUMBERS] Display key statistics as large bold numbers with percentage badges, up/down trend arrows, and progress bars where applicable. Include comparison indicators (YoY, QoQ, vs. target). Format large numbers with K/M suffixes for readability.
[LAYOUT] Multi-panel grid with 3-5 zones: hero KPI statistic (largest, top or top-left), supporting charts (2-3 panels in middle), detail callouts or source notes (smallest, bottom). Fill 85-90% of canvas — minimize dead space between panels.
[ICONS] Use consistent flat-design icons to represent each metric category. Icons should be small (24-32px visual weight) and subordinate to the data they accompany.
[TYPOGRAPHY] Bold sans-serif for all numbers and chart titles. Clean readable sans-serif for axis labels, legends, and notes. Use 3 distinct font sizes for hierarchy — hero stat largest, chart titles medium, axis labels smallest.
[COLORS] Professional palette with 4-6 colors: 1 primary bold color for hero KPI, 2-3 accent colors for chart categories (maintain consistent mapping), 1 neutral for chart backgrounds, white for text panels.`;
      } else if (subMode === 'process-flow') {
        enhanced = `[TASK] Create a professional process flow infographic: ${enhanced}
[FLOW] Show a clear directional sequence with arrows or connector lines between steps. Use distinct shapes consistently: rounded rectangles for process steps, diamonds for decision points, circles/ovals for start/end terminals. Number each step prominently.
[STRUCTURE] If showing a pipeline or multi-stage process, use horizontal lanes or vertical columns with clear separation lines. Each stage should have a title bar, representative icon, and brief description (1-2 lines).
[DECISIONS] For decision trees or branching logic, show yes/no or conditional paths clearly diverging from decision diamonds. Use different colors for different branches. Label each branch with the condition.
[LAYOUT] Left-to-right progression for sequential processes, top-to-bottom for hierarchical flows. Fill 85-90% of canvas. Include a title banner at the top with the process name and a one-line description.
[ICONS] Use a distinct flat-design icon for each process stage, lane, or decision type. Icons should be consistent in size (~32px visual weight) and style throughout.
[TYPOGRAPHY] Bold sans-serif for step titles and numbers, regular sans-serif for descriptions. Step numbers should be large and visually prominent (contained in circles or badges).
[COLORS] Use 4-6 colors: 1 primary for the main flow path, 2-3 accent colors for branches/swimlanes, 1 neutral background, 1 distinct color for decision nodes. Gray out optional or secondary paths slightly.`;
      } else {
        enhanced = `[TASK] Create a comprehensive, information-dense professional infographic: ${enhanced}
[LAYOUT] Multi-section panel grid layout. Fill the entire canvas — target 85-90% utilization with minimal dead space. Use modular card zones with clear visual separation (thin borders, subtle shadows, or color blocks). Include 4-8 distinct information zones arranged in a balanced grid.
[HIERARCHY] Three-tier visual structure:
- TIER 1: Hero statistic or headline (largest, most prominent, bold sans-serif)
- TIER 2: Supporting data panels with charts, comparisons, or explanatory content
- TIER 3: Detail callouts, source notes, or contextual footnotes (smallest)
[DATA DISPLAY] For any data points use: large bold numbers, percentage badges, up/down trend arrows, progress bars, or comparison indicators. Include at least one visual data element (bar chart, donut chart, timeline, or comparison table).
[ICONS] Use professional flat-design icons and pictograms to represent each concept or category. Each data panel should have a distinct icon. Icons should be consistent in style and size throughout the infographic.
[TYPOGRAPHY] Bold sans-serif for all titles and statistics. Clean, highly-readable sans-serif for body text. Use 3 distinct font sizes to establish hierarchy — large for hero stats, medium for section headers, small for details and notes.
[COLORS] Professional color scheme with 4-6 colors: 1 primary bold color for hero elements and key data, 2-3 supporting accent colors for category differentiation, 1 neutral background color, white or near-white for text panels. Use color consistently — same category = same color throughout the infographic.`;
      }
      break;
    }

    case 'poster':
      enhanced = `[TASK] Create a professional promotional poster: ${enhanced}
[CONTENT ZONES] Structure into 3-4 distinct vertical zones:
- ZONE 1 (top 30%): Hero headline in bold display sans-serif, supporting tagline below
- ZONE 2 (middle 40%): Key details (date, time, venue, speakers) with icons beside each
- ZONE 3 (bottom 20%): Call-to-action element (button-style text, QR code, or URL), sponsor/organizer logo area
- Optional ZONE 4 (bottom 10%): Footer with fine print, social handles, or disclaimers
[TYPOGRAPHY SYSTEM] Three-tier font sizing:
- TIER 1: Hero headline — largest, bold condensed sans-serif, readable from 3m distance
- TIER 2: Key details — medium weight, clear sans-serif, high contrast against background
- TIER 3: Fine print — smallest, regular weight, legible at close range only
[VISUAL ANCHOR] Include one dominant graphic element — illustration, abstract shape, or symbolic icon — positioned to draw the eye to the headline zone. Do not let it compete with the headline.
[COLOR] Professional palette with one dominant brand color as background/base, one high-contrast accent for CTA and key details, white or near-white for headline text. Add 1-2 supporting neutrals.
[BACKGROUND] Solid color, subtle gradient, or geometric pattern. Avoid photographic backgrounds that compete with text legibility.
[DISTANCE] Design for viewing from 1-3 meters distance. Print-ready quality with bleed margin awareness.`;
      break;

    case 'illustration':
      enhanced = `[TASK] Create a professional illustration: ${enhanced}
[SUBJECT] Clearly depicted central subject with appropriate detail. If the concept is abstract, use a recognizable visual metaphor or scene to convey the idea concretely.
[STYLE] Clean, modern vector illustration with flat or subtly shaded color blocks (no photo-textures). Consistent stroke weights throughout (2-3px implied). Rounded corners on interface elements, organic curves on characters/objects. Isometric or front-facing perspective as appropriate for the subject.
[COLOR PALETTE] 5-7 colors maximum: 1-2 dominant subject colors, 1-2 supporting accent colors, 1 background color (light neutral or transparent), 1-2 neutral/shading colors for depth.
[COMPOSITION] Subject-centered with balanced framing. Include subtle contextual elements (background shapes, environment hints) to ground the illustration without overwhelming the main subject. Suitable for use as a hero image in presentations and documents.
[QUALITY] Clean lines, consistent style, no artifacts or blurring. Professional presentation-grade output suitable for corporate use.`;
      break;

    case 'photo':
      enhanced = `[TASK] Create a photorealistic image: ${enhanced}
[COMPOSITION] Professional photography principles: rule of thirds or center-weighted composition as appropriate for the subject. Appropriate depth of field — shallow (f/2.8 equivalent) for portraits and isolated subjects, deep (f/8+ equivalent) for landscapes and environmental scenes. Subject clearly dominant in frame with intentional negative space.
[LIGHTING] Match lighting to subject mood:
- Corporate/professional: bright, even studio lighting, soft shadows
- Editorial: directional window light, moderate contrast
- Environmental: natural golden hour or overcast diffusion
- Product: three-point studio lighting with subtle rim light
[QUALITY] 35mm full-frame DSLR aesthetic equivalent. Clean, noise-free, tack-sharp on subject. Professional color grading with natural skin tones and accurate whites. Authentic micro-details (texture, fabric weave, surface imperfections) that signal photorealism.
[STYLE] Editorial/commercial photography crossover. No CGI or 3D-rendered appearance — the result should look like a real photograph taken with a physical camera. No artificial glow, HDR halo, or over-processed look.`;
      break;

    case 'product-mockup':
      enhanced = `[TASK] Create a professional product mockup photograph: ${enhanced}
[PRODUCT] Product as the undisputed hero — centered and occupying 60-70% of frame. Tack-sharp focus edge-to-edge on product surface. Accurate color representation with no color cast on the product itself.
[ANGLE] Front-facing hero angle (slightly elevated, approximately 15° above center) unless an alternative angle is specified. For packaging, show 2 visible faces where possible.
[BACKGROUND] Pure white infinity sweep (#FFFFFF) with seamless floor-to-wall transition for e-commerce style. Or contextual lifestyle scene if specified in the prompt. Zero distractions in frame.
[LIGHTING] Professional product studio setup:
- Key light: soft diffused from above-front, revealing product contours
- Fill light: subtle from opposite side to reduce harsh shadows
- Rim/edge light: optional, for glass/metal products to define edges
- Result: gentle contact shadow beneath product, no harsh drop shadows
[MATERIAL HANDLING] Lighting adapts to material:
- Matte surfaces: soft even illumination, no hotspots
- Glossy/glass: controlled specular highlights, no blown reflections
- Metallic: gradient reflections to communicate material, not mirror-like
[STYLE] E-commerce marketplace ready. Clean, commercial, brand-safe. No props, hands, or contextual elements unless explicitly requested in the prompt.`;
      break;

    case 'icon':
      enhanced = `[TASK] Create a simple, recognizable icon: ${enhanced}
[STYLE] Minimal flat design icon: filled silhouette style (not outlined) unless an outline better communicates the concept. Clean geometric construction with consistent 2px stroke width for any internal lines. Slightly rounded corners (2-3px radius) — not fully circular, not razor-sharp. Single primary color on transparent background.
[CONSTRUCTION] Design on a 24x24px base grid with 2px internal padding. All elements should align to the pixel grid. Simplicity priority: if a detail is invisible at 16px, remove it entirely.
[RECOGNIZABILITY] Distinctive silhouette that communicates the concept without relying on fine detail. Test mental model: should be recognizable in 200ms at 24px display size.
[FORMAT] Square 1:1 canvas. Subject optically centered (not mathematically — adjust for visual weight of shapes). 15-20% padding on all sides. No text whatsoever.
[FAMILY] If part of an icon set, maintain consistent: stroke width, corner radius, fill density, and optical size across all icons in the set.`;
      break;

    case 'social-media':
      enhanced = `[TASK] Create a professional social media graphic: ${enhanced}
[PLATFORM AWARE] Optimize layout for the intended platform:
- Feed post (1:1 or 4:5): bold headline top-third, visual center, CTA bottom
- Story (9:16): vertical flow with CTA at thumb-reach zone (bottom 25%)
- LinkedIn/Professional: clean, data-forward, minimal decorative elements
- Banner/Header: left-weighted content with right-side negative space for profile picture overlay
[SAFE ZONES] Leave 10% margin on all edges. For Stories, leave top 15% clear (overlapped by platform UI). For feed posts, keep critical content away from bottom 8% (overlapped by engagement bar on some platforms).
[CONTENT STRUCTURE]
- Headline: large, bold, maximum 6-8 words
- Supporting text: 1-2 lines maximum, medium weight
- Visual: icon, illustration, or data visualization supporting the message
- Brand element: small logo or handle in consistent position
[ENGAGEMENT HOOK] Include one visual attention-grabber: a bold statistic, striking contrast, unexpected color accent, or compelling (but workplace-appropriate) visual element.
[STYLE] Vibrant digital-native design. Slightly bolder colors than print designs — compensate for screen brightness variation across devices. Optimized for mobile-first viewing at approximately 400px wide.`;
      break;
  }

  if (config.addSafetyPrefixes) {
    enhanced = `Professional, workplace-appropriate image. ${enhanced}`;
  }

  return enhanced;
}

function getAspectRatioPrompt(ratio: string): string {
  switch (ratio) {
    case '16:9':
      return 'Wide landscape format (16:9), suitable for presentations and displays';
    case '9:16':
      return 'Tall portrait format (9:16), suitable for mobile screens and stories';
    case '4:3':
      return 'Standard landscape format (4:3), suitable for documents and prints';
    case '3:4':
      return 'Portrait format (3:4), suitable for posters and documents';
    case '1:1':
      return 'Square format (1:1), suitable for social media and icons';
    default:
      return 'Standard format';
  }
}

// ===== Storage =====

function getOutputDirectory(): string {
  const outputDir =
    process.env.DOC_OUTPUT_DIR || path.join(process.cwd(), 'data', 'outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function saveImage(
  buffer: Buffer,
  thumbnailBuffer: Buffer | undefined,
  args: ImageGenToolArgs,
  provider: ImageProvider,
  model: string,
  config: ImageGenConfig,
  metadata: {
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
    enhancedPrompt?: string;
    revisedPrompt?: string;
    generationTimeMs: number;
  }
): Promise<GeneratedImage> {
  const imageId = uuidv4();
  const outputDir = getOutputDirectory();

  const extension = getFileExtension(config.imageProcessing.format);
  const filename = `${imageId}.${extension}`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, buffer);

  let thumbnailFilename: string | undefined;
  if (thumbnailBuffer) {
    thumbnailFilename = `${imageId}_thumb.webp`;
    const thumbnailPath = path.join(outputDir, thumbnailFilename);
    fs.writeFileSync(thumbnailPath, thumbnailBuffer);
  }

  const requestContext = getRequestContext();
  const threadId = requestContext.threadId;

  if (!threadId) {
    throw new Error('No thread context available for image generation');
  }

  const threadContext = await getThreadContext(threadId);

  if (!threadContext.exists) {
    console.error('[ImageGen] Thread not found in database:', { threadId, requestContext });
    throw new Error(`Thread ${threadId} not found - cannot save generated image`);
  }

  const generationConfig = JSON.stringify({
    provider,
    model,
    prompt: args.prompt,
    enhancedPrompt: metadata.enhancedPrompt,
    revisedPrompt: metadata.revisedPrompt,
    style: args.style,
    aspectRatio: args.aspectRatio,
    resolution: args.resolution,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    generationTimeMs: metadata.generationTimeMs,
    thumbnailFilename,
  });

  let docId: number;
  let downloadUrlPrefix: string;

  try {
    if (threadContext.isWorkspace) {
      const result = await addWorkspaceOutput(
        threadContext.workspaceId!,
        threadContext.sessionId!,
        threadContext.actualThreadId || null,
        filename,
        filepath,
        'image',
        metadata.sizeBytes,
        generationConfig,
        null
      );
      docId = result.id;
      downloadUrlPrefix = '/api/workspace-documents';
    } else {
      const result = await addThreadOutput(
        threadId,
        null,
        filename,
        filepath,
        'image',
        metadata.sizeBytes,
        generationConfig,
        null
      );
      docId = result.id;
      downloadUrlPrefix = '/api/documents';
    }
  } catch (dbError) {
    console.error('[ImageGen] Database error saving image:', {
      error: dbError instanceof Error ? dbError.message : dbError,
      threadId,
      filename,
      filepath,
      isWorkspaceContext: threadContext.isWorkspace,
    });
    throw dbError;
  }

  return {
    id: imageId,
    filename,
    filepath,
    url: `${downloadUrlPrefix}/${docId}/download`,
    thumbnailUrl: thumbnailFilename
      ? `${downloadUrlPrefix}/${docId}/download?thumbnail=true`
      : undefined,
    width: metadata.width,
    height: metadata.height,
    provider,
    model,
    prompt: args.prompt,
    enhancedPrompt: metadata.enhancedPrompt,
    revisedPrompt: metadata.revisedPrompt,
    cached: false,
    generatedAt: new Date().toISOString(),
  };
}

// ===== Raw Buffer Generation =====

export interface ImageBufferResult {
  success: boolean;
  buffer: Buffer;
  thumbnail?: Buffer;
  provider: ImageProvider;
  model: string;
  enhancedPrompt: string;
  revisedPrompt?: string;
  metadata: {
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
  };
  error?: { code: string; message: string };
}

async function callGoogleProvider(
  args: ImageGenToolArgs,
  selection: ProviderSelection,
  config: ImageGenConfig
): Promise<{ buffer: Buffer; enhancedPrompt?: string }> {
  // All image generation now routes through Gemini native models.
  // The generateWithGoogle() function transparently redirects any
  // legacy Imagen model names to their Gemini equivalents.
  const aspectConfig = selection.provider === 'gemini'
    ? config.providers.gemini
    : config.providers.imagen;
  return generateWithGoogle(args, selection.model, aspectConfig);
}

async function buildAsciiFallbackResult(
  enhancedPrompt: string,
  style?: ImageStyle
): Promise<ImageBufferResult> {
  const { buffer, width, height } = await generateAsciiFallbackImage(enhancedPrompt, style);

  return {
    success: true,
    buffer,
    provider: 'ascii',
    model: 'ascii-fallback',
    enhancedPrompt,
    metadata: {
      width,
      height,
      format: 'png',
      sizeBytes: buffer.length,
    },
  };
}

export async function generateImageBuffer(args: ImageGenToolArgs): Promise<ImageBufferResult> {
  const config = await getImageGenConfig();

  if (config.activeProvider === 'none') {
    return {
      success: false,
      buffer: Buffer.alloc(0),
      provider: 'ascii',
      model: '',
      enhancedPrompt: '',
      metadata: { width: 0, height: 0, format: '', sizeBytes: 0 },
      error: {
        code: 'DISABLED',
        message: 'Image generation is disabled by administrator',
      },
    };
  }

  const rawStyle = args.style || config.defaultStyle;
  const resolvedStyle = rawStyle === 'auto'
    ? classifyPromptToStyle(args.prompt, config.defaultStyle === 'auto' ? 'infographic' : config.defaultStyle)
    : rawStyle;

  console.log(`[ImageGen] Style: ${rawStyle}${rawStyle !== resolvedStyle ? ` → resolved to ${resolvedStyle}` : ''}`);

  const enhancedPrompt = enhancePrompt(args, config);
  const enhancedArgs = { ...args, prompt: enhancedPrompt };

  const primary = selectPrimaryProvider(resolvedStyle, config);

  if (!primary) {
    console.log('[ImageGen] No providers enabled, falling back to ASCII');
    return buildAsciiFallbackResult(enhancedPrompt, resolvedStyle);
  }

  console.log(`[ImageGen] Primary provider: ${primary.provider}, model: ${primary.model}`);

  // Try primary provider
  let rawBuffer: Buffer;
  let revisedPrompt: string | undefined;
  let usedProvider: ImageProvider = primary.provider;
  let usedModel: string = primary.model;

  try {
    const result = await callGoogleProvider(enhancedArgs, primary, config);
    rawBuffer = result.buffer;
    revisedPrompt = result.enhancedPrompt;
  } catch (primaryError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : 'Unknown error';
    console.error(`[ImageGen] Primary provider ${primary.provider} failed: ${primaryMessage}`);

    // Try fallback provider
    const fallback = selectFallbackProvider(primary, resolvedStyle, config);

    if (fallback) {
      console.log(`[ImageGen] Fallback provider: ${fallback.provider}, model: ${fallback.model}`);
      try {
        const result = await callGoogleProvider(enhancedArgs, fallback, config);
        rawBuffer = result.buffer;
        revisedPrompt = result.enhancedPrompt;
        usedProvider = fallback.provider;
        usedModel = fallback.model;
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
        console.error(`[ImageGen] Fallback provider ${fallback.provider} failed: ${fallbackMessage}`);
        console.log('[ImageGen] All providers failed, falling back to ASCII');
        return buildAsciiFallbackResult(enhancedPrompt, resolvedStyle);
      }
    } else {
      console.log('[ImageGen] No fallback provider available, falling back to ASCII');
      return buildAsciiFallbackResult(enhancedPrompt, resolvedStyle);
    }
  }

  console.log(`[ImageGen] Raw image received (${rawBuffer.length} bytes)`);

  const processingOptions: ProcessingOptions = {
    maxDimension: config.imageProcessing.maxDimension,
    format: config.imageProcessing.format,
    quality: config.imageProcessing.quality,
    generateThumbnail: config.imageProcessing.generateThumbnail,
    thumbnailSize: config.imageProcessing.thumbnailSize,
  };

  const disclaimerConfig = await getDisclaimerConfigIfEnabled();
  const processed = await processImage(rawBuffer, processingOptions, disclaimerConfig);

  console.log(
    `[ImageGen] Processed: ${processed.metadata.originalWidth}x${processed.metadata.originalHeight} → ${processed.metadata.width}x${processed.metadata.height}, ${processed.metadata.sizeBytes} bytes`
  );

  return {
    success: true,
    buffer: processed.main,
    thumbnail: processed.thumbnail,
    provider: usedProvider,
    model: usedModel,
    enhancedPrompt,
    revisedPrompt,
    metadata: {
      width: processed.metadata.width,
      height: processed.metadata.height,
      format: processed.metadata.format,
      sizeBytes: processed.metadata.sizeBytes,
    },
  };
}


// ===== Main Generation Function (with DB save) =====

export async function generateImage(args: ImageGenToolArgs): Promise<ImageGenResponse> {
  const startTime = Date.now();
  const config = await getImageGenConfig();

  if (config.activeProvider === 'none') {
    return {
      success: false,
      error: {
        code: 'DISABLED',
        message: 'Image generation is disabled by administrator',
      },
    };
  }

  const rawResult = await generateImageBuffer(args);

  if (!rawResult.success || rawResult.error) {
    return {
      success: false,
      error: rawResult.error || { code: 'GENERATION_ERROR', message: 'Unknown error' },
    };
  }

  try {
    const savedImage = await saveImage(
      rawResult.buffer,
      rawResult.thumbnail,
      args,
      rawResult.provider,
      rawResult.model,
      config,
      {
        width: rawResult.metadata.width,
        height: rawResult.metadata.height,
        format: rawResult.metadata.format,
        sizeBytes: rawResult.metadata.sizeBytes,
        enhancedPrompt: rawResult.enhancedPrompt,
        revisedPrompt: rawResult.revisedPrompt,
        generationTimeMs: Date.now() - startTime,
      }
    );

    const imageHint: ImageHint = {
      id: savedImage.id,
      url: savedImage.url,
      filepath: savedImage.filepath,
      thumbnailUrl: savedImage.thumbnailUrl,
      width: savedImage.width,
      height: savedImage.height,
      alt: `Generated ${args.style || 'image'}: ${args.prompt.substring(0, 100)}`,
    };

    const isAscii = rawResult.provider === 'ascii';

    return {
      success: true,
      message: isAscii
        ? 'Image generation providers were unavailable. An ASCII placeholder has been generated instead.'
        : 'Image generated successfully. Do NOT call image_gen again unless the user explicitly requests another image.',
      imageHint,
      metadata: {
        provider: rawResult.provider,
        model: rawResult.model,
        prompt: args.prompt,
        enhancedPrompt: rawResult.enhancedPrompt,
        revisedPrompt: rawResult.revisedPrompt,
        processingTimeMs: Date.now() - startTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('[ImageGen] Save failed:', errorMessage);

    let errorCode = 'GENERATION_ERROR';
    if (errorMessage.includes('API key')) {
      errorCode = 'INVALID_API_KEY';
    } else if (errorMessage.includes('rate limit')) {
      errorCode = 'RATE_LIMIT';
    } else if (errorMessage.includes('rejected') || errorMessage.includes('declined')) {
      errorCode = 'CONTENT_REJECTED';
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
      },
    };
  }
}

// ===== Test Function =====

import { testGeminiConnection, testImagenConnection } from './providers/gemini-imagen';

export interface ImageGenTestResult {
  success: boolean;
  message: string;
  latency?: number;
  providers?: {
    gemini?: { success: boolean; message: string; latency?: number };
    imagen?: { success: boolean; message: string; latency?: number };
  };
}

export async function testImageGen(): Promise<ImageGenTestResult> {
  const config = await getImageGenConfig();
  const providers: ImageGenTestResult['providers'] = {};

  const startTime = Date.now();

  if (config.providers.gemini.enabled) {
    providers.gemini = await testGeminiConnection();
  }

  if (config.providers.imagen.enabled) {
    providers.imagen = await testImagenConnection();
  }

  const latency = Date.now() - startTime;

  const anySuccess = Object.values(providers).some((p) => p?.success);
  const allTested = Object.keys(providers).length;

  if (allTested === 0) {
    return {
      success: false,
      message: 'No image providers are enabled',
      latency,
      providers,
    };
  }

  return {
    success: anySuccess,
    message: anySuccess
      ? `Image generation available (${latency}ms)`
      : 'No image providers could connect',
    latency,
    providers,
  };
}
