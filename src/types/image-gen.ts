/**
 * Image Generation Tool Types
 */

// ===== Provider Types =====

export type ImageProvider = 'gemini' | 'imagen' | 'ascii';

export type ImageStyle =
  | 'auto'
  | 'infographic'
  | 'poster'
  | 'illustration'
  | 'photo'
  | 'product-mockup'
  | 'icon'
  | 'social-media';

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export type Resolution = '512' | '1K' | '2K' | '4K';

export type OutputFormat = 'png' | 'webp' | 'jpeg';

// ===== Provider Configuration Types =====

export interface GeminiProviderConfig {
  enabled: boolean;
  defaultModel: 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
  proModel: 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
  aspectRatio: AspectRatio;
}

export interface ImagenProviderConfig {
  enabled: boolean;
  fastModel: 'imagen-4.0-fast-generate-001';
  standardModel: 'imagen-4.0-generate-001';
  ultraModel: 'imagen-4.0-ultra-generate-001';
  aspectRatio: AspectRatio;
}

// ===== Image Processing Configuration =====

export interface ImageProcessingConfig {
  /** Maximum dimension (width or height) for output images */
  maxDimension: number;
  /** Output format for processed images */
  format: OutputFormat;
  /** Quality setting for JPEG/WebP (0-100) */
  quality: number;
  /** Whether to generate thumbnails for chat preview */
  generateThumbnail: boolean;
  /** Thumbnail dimension */
  thumbnailSize: number;
}

// ===== Main Tool Configuration =====

export interface ImageGenConfig {
  /** Active provider: 'gemini', 'imagen', or 'none' to disable */
  activeProvider: ImageProvider | 'none';

  /** Provider-specific configurations */
  providers: {
    gemini: GeminiProviderConfig;
    imagen: ImagenProviderConfig;
  };

  /** Default image style when not specified */
  defaultStyle: ImageStyle;

  /** Default resolution when not specified */
  defaultResolution: Resolution;

  /** Whether to enhance prompts with style-specific instructions */
  enhancePrompts: boolean;

  /** Whether to add workplace-appropriate safety prefixes */
  addSafetyPrefixes: boolean;

  /** Image processing/optimization settings */
  imageProcessing: ImageProcessingConfig;
}

// ===== Tool Arguments (from LLM function call) =====

export interface ImageGenToolArgs {
  /** Detailed description of the image to generate */
  prompt: string;
  /** Visual style for the generated image */
  style?: ImageStyle;
  /** Aspect ratio for the image */
  aspectRatio?: AspectRatio;
  /** Output resolution (512 for previews, 1K standard, 2K high-fidelity, 4K print-quality) */
  resolution?: Resolution;
  /** Override default provider selection (internal use) */
  provider?: ImageProvider;
}

// ===== Processed Image Types =====

export interface ImageMetadata {
  /** Final width after processing */
  width: number;
  /** Final height after processing */
  height: number;
  /** Output format */
  format: OutputFormat;
  /** Original width before processing */
  originalWidth: number;
  /** Original height before processing */
  originalHeight: number;
  /** File size in bytes */
  sizeBytes: number;
  /** Thumbnail size in bytes (if generated) */
  thumbnailSizeBytes?: number;
}

export interface ProcessedImage {
  /** Main image buffer */
  main: Buffer;
  /** Thumbnail buffer (if generated) */
  thumbnail?: Buffer;
  /** Image metadata */
  metadata: ImageMetadata;
}

export interface ProcessingOptions {
  /** Maximum dimension (default: 2048) */
  maxDimension?: number;
  /** Output format (default: 'webp') */
  format?: OutputFormat;
  /** Quality setting (default: 85) */
  quality?: number;
  /** Generate thumbnail (default: true) */
  generateThumbnail?: boolean;
  /** Thumbnail size (default: 400) */
  thumbnailSize?: number;
}

// ===== Generated Image Result =====

export interface GeneratedImage {
  /** Unique image ID */
  id: string;
  /** Filename on disk */
  filename: string;
  /** Full filepath */
  filepath: string;
  /** Download URL */
  url: string;
  /** Thumbnail URL (if available) */
  thumbnailUrl?: string;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Provider used */
  provider: ImageProvider;
  /** Model used */
  model: string;
  /** Original prompt */
  prompt: string;
  /** Enhanced prompt (if any) */
  enhancedPrompt?: string;
  /** Provider's revised prompt (DALL-E 3 feature) */
  revisedPrompt?: string;
  /** Whether served from cache */
  cached: boolean;
  /** Generation timestamp */
  generatedAt: string;
}

// ===== Tool Response Types =====

export interface ImageHint {
  /** Image ID for tracking */
  id: string;
  /** Download URL */
  url: string;
  /** Full filepath on disk (for internal use, e.g., PPTX embedding) */
  filepath: string;
  /** Thumbnail URL for preview */
  thumbnailUrl?: string;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Alt text for accessibility */
  alt: string;
}

export interface ImageGenResponse {
  /** Whether generation succeeded */
  success: boolean;
  /** Status message for LLM context */
  message?: string;
  /** Image hint for frontend rendering (like visualizationHint) */
  imageHint?: ImageHint;
  /** Generation metadata */
  metadata?: {
    provider: ImageProvider;
    model: string;
    prompt: string;
    enhancedPrompt?: string;
    revisedPrompt?: string;
    processingTimeMs: number;
  };
  /** Error information */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

// ===== Gemini API Response Types =====

export interface GeminiInlineData {
  mimeType: string;
  data: string; // base64 encoded
}

export interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
}

export interface GeminiContent {
  parts: GeminiPart[];
}

export interface GeminiCandidate {
  content: GeminiContent;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

// ===== Imagen 4 API Response Types =====

export interface ImagenPrediction {
  bytesBase64Encoded?: string;
  mimeType?: string;
}

export interface ImagenResponse {
  predictions?: ImagenPrediction[];
}
