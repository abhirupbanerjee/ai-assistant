/**
 * Image Generation Tool Types
 */

// ===== Provider Types =====

export type ImageProvider = 'openai' | 'gemini';

export type ImageStyle =
  | 'infographic'
  | 'diagram'
  | 'illustration'
  | 'photo'
  | 'icon'
  | 'chart'
  | 'process-flow';

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export type OutputFormat = 'png' | 'webp' | 'jpeg';

// ===== Provider Configuration Types =====

export interface OpenAIProviderConfig {
  enabled: boolean;
  model: 'dall-e-3' | 'dall-e-2';
  size: '1024x1024' | '1024x1792' | '1792x1024';
  quality: 'standard' | 'hd';
  style: 'vivid' | 'natural';
}

export interface GeminiProviderConfig {
  enabled: boolean;
  model: 'gemini-3-pro-image-preview' | 'imagen-3.0-generate-002';
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
  /** Active provider: 'openai', 'gemini', or 'none' to disable */
  activeProvider: ImageProvider | 'none';

  /** Provider-specific configurations */
  providers: {
    openai: OpenAIProviderConfig;
    gemini: GeminiProviderConfig;
  };

  /** Default image style when not specified */
  defaultStyle: ImageStyle;

  /** Preferred provider for infographics (Gemini recommended for text rendering) */
  infographicProvider: ImageProvider;

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
  /** Override default provider selection */
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

// ===== OpenAI API Response Types =====

export interface DalleImageData {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

export interface DalleResponse {
  data: DalleImageData[];
}
