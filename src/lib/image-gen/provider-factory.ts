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
    imagen: {
      enabled: true,
      fastModel: 'imagen-4.0-fast-generate-001',
      standardModel: 'imagen-4.0-generate-001',
      ultraModel: 'imagen-4.0-ultra-generate-001',
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
 * Categories where Imagen 4 is the PRIMARY choice (photorealism specialist)
 */
const IMAGEN_PRIMARY_CATEGORIES: ImageStyle[] = ['photo', 'product-mockup'];

/**
 * Categories where Gemini Nano Banana Pro is the PRIMARY choice (text-heavy)
 */
const GEMINI_PRO_CATEGORIES: ImageStyle[] = ['infographic', 'poster'];

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
  if (IMAGEN_PRIMARY_CATEGORIES.includes(style)) {
    if (config.providers.imagen.enabled) {
      return { provider: 'imagen', model: getImagenModelForCategory(style, config.providers.imagen) };
    }
    if (config.providers.gemini.enabled) {
      return { provider: 'gemini', model: getGeminiModelForCategory(style, config.providers.gemini) };
    }
  } else {
    if (config.providers.gemini.enabled) {
      return { provider: 'gemini', model: getGeminiModelForCategory(style, config.providers.gemini) };
    }
    if (config.providers.imagen.enabled) {
      return { provider: 'imagen', model: getImagenModelForCategory(style, config.providers.imagen) };
    }
  }
  return null;
}

function selectFallbackProvider(
  primary: ProviderSelection,
  style: ImageStyle,
  config: ImageGenConfig
): ProviderSelection | null {
  if (primary.provider === 'imagen') {
    if (config.providers.gemini.enabled) {
      return { provider: 'gemini', model: getGeminiModelForCategory(style, config.providers.gemini) };
    }
  } else {
    if (config.providers.imagen.enabled) {
      return { provider: 'imagen', model: getImagenModelForCategory(style, config.providers.imagen) };
    }
  }
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

function getImagenModelForCategory(
  style: ImageStyle,
  config: ImagenProviderConfig
): string {
  if (style === 'photo') return config.ultraModel;
  if (style === 'product-mockup') return config.standardModel;
  return config.fastModel;
}

// ===== Prompt Enhancement (Google Best Practices) =====

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
    case 'infographic':
      enhanced = `[TASK] Create a professional infographic: ${enhanced}
[DESIGN] Modern card-based layout, high contrast for readability, balanced whitespace
[TEXT] Enclose all headlines and labels in quotes. Specify typography: bold sans-serif for titles, clean readable font for body text.
[COLORS] Professional color scheme suitable for business presentations
[FORMAT] ${getAspectRatioPrompt(args.aspectRatio || config.providers.gemini.aspectRatio)}, clean data visualization`;
      break;

    case 'poster':
      enhanced = `[TASK] Create a promotional poster: ${enhanced}
[TYPOGRAPHY] Headline text in quotes with specified font style (e.g., "bold sans-serif"). Subtitle below.
[LAYOUT] Balanced composition with clear visual hierarchy
[STYLE] Professional print-ready design, vibrant but workplace-appropriate
[FORMAT] ${getAspectRatioPrompt(args.aspectRatio || config.providers.gemini.aspectRatio)}, high contrast for readability`;
      break;

    case 'illustration':
      enhanced = `[TASK] Create a professional illustration: ${enhanced}
[SUBJECT] Clearly depicted central subject with appropriate detail
[STYLE] Clean, modern illustration style suitable for presentations and documents
[COMPOSITION] Balanced framing, appropriate negative space
[MOOD] Professional, engaging, workplace-appropriate`;
      break;

    case 'photo':
      enhanced = `[TASK] Create a photorealistic image: ${enhanced}
[CAMERA] Professional photography composition, appropriate lens and depth of field
[LIGHTING] Natural or studio lighting with proper shadows and highlights
[QUALITY] High-resolution, professional color grading, authentic textures
[STYLE] Editorial photography quality, no artificial or rendered appearance`;
      break;

    case 'product-mockup':
      enhanced = `[TASK] Create a product mockup photograph: ${enhanced}
[PRODUCT] Product centered, sharp focus, accurate color representation
[BACKGROUND] Clean, non-distracting background (white, transparent, or contextual)
[LIGHTING] Professional product lighting with subtle reflections
[STYLE] E-commerce ready, brand-safe, commercial photography quality`;
      break;

    case 'icon':
      enhanced = `[TASK] Create a simple, recognizable icon: ${enhanced}
[STYLE] Minimal flat design, clean lines, single-color or limited palette
[RECOGNIZABILITY] Distinctive silhouette readable at small sizes (16x16 to 64x64)
[FORMAT] Centered composition, adequate padding, no text unless essential`;
      break;

    case 'social-media':
      enhanced = `[TASK] Create a social media graphic: ${enhanced}
[FORMAT] Optimized for specified platform with appropriate aspect ratio
[COPY] Any text enclosed in quotes with specified typography style
[BRAND] Consistent color scheme and professional appearance
[STYLE] Eye-catching but workplace-appropriate, optimized for digital display`;
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
  if (selection.provider === 'gemini') {
    return generateWithGoogle(args, selection.model, config.providers.gemini);
  }
  return generateWithGoogle(args, selection.model, config.providers.imagen);
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
