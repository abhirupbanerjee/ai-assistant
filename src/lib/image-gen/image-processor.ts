/**
 * Image Processing Utilities
 *
 * Uses sharp for high-performance image optimization.
 * Handles resizing, format conversion, and thumbnail generation.
 */

import sharp from 'sharp';
import type {
  ProcessedImage,
  ProcessingOptions,
  ImageMetadata,
  OutputFormat,
} from '@/types/image-gen';
import { type DisclaimerConfig, getDisclaimerText } from '../disclaimer';

// ===== Default Processing Options =====

const DEFAULT_OPTIONS: Required<ProcessingOptions> = {
  maxDimension: 2048,
  format: 'webp',
  quality: 85,
  generateThumbnail: true,
  thumbnailSize: 400,
};

// ===== Main Processing Function =====

/**
 * Process a generated image buffer:
 * - Resize if larger than maxDimension
 * - Convert to optimized format (WebP by default)
 * - Generate thumbnail for chat preview
 * - Optionally add AI disclaimer watermark
 *
 * @param buffer - Raw image buffer from provider
 * @param options - Processing options
 * @param disclaimerConfig - Optional disclaimer configuration for watermarking
 * @returns Processed image with main buffer, optional thumbnail, and metadata
 */
export async function processImage(
  buffer: Buffer,
  options: ProcessingOptions = {},
  disclaimerConfig?: DisclaimerConfig | null
): Promise<ProcessedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Get original metadata
  const originalMeta = await sharp(buffer).metadata();
  const originalWidth = originalMeta.width || 0;
  const originalHeight = originalMeta.height || 0;

  // Create sharp instance for processing
  let image = sharp(buffer);

  // Resize if larger than max dimension
  const needsResize =
    originalWidth > opts.maxDimension || originalHeight > opts.maxDimension;

  if (needsResize) {
    image = image.resize(opts.maxDimension, opts.maxDimension, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Convert to optimized format
  let mainBuffer = await convertToFormat(image, opts.format, opts.quality);

  // Add AI disclaimer watermark if enabled
  if (disclaimerConfig?.enabled && disclaimerConfig.imageWatermark.enabled) {
    mainBuffer = await addDisclaimerWatermark(mainBuffer, disclaimerConfig);
  }

  // Get final dimensions
  const finalMeta = await sharp(mainBuffer).metadata();
  const width = finalMeta.width || 0;
  const height = finalMeta.height || 0;

  // Generate thumbnail if requested
  let thumbnail: Buffer | undefined;
  let thumbnailSizeBytes: number | undefined;

  if (opts.generateThumbnail) {
    thumbnail = await sharp(buffer)
      .resize(opts.thumbnailSize, opts.thumbnailSize, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    thumbnailSizeBytes = thumbnail.length;
  }

  const metadata: ImageMetadata = {
    width,
    height,
    format: opts.format,
    originalWidth,
    originalHeight,
    sizeBytes: mainBuffer.length,
    thumbnailSizeBytes,
  };

  return {
    main: mainBuffer,
    thumbnail,
    metadata,
  };
}

// ===== Helper Functions =====

/**
 * Convert sharp instance to specified format
 */
async function convertToFormat(
  image: sharp.Sharp,
  format: OutputFormat,
  quality: number
): Promise<Buffer> {
  switch (format) {
    case 'webp':
      return image.webp({ quality }).toBuffer();
    case 'jpeg':
      return image.jpeg({ quality }).toBuffer();
    case 'png':
    default:
      return image.png({ compressionLevel: 6 }).toBuffer();
  }
}

/**
 * Get image dimensions from buffer
 *
 * @param buffer - Image buffer
 * @returns Width and height
 */
export async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

/**
 * Get full image metadata from buffer
 *
 * @param buffer - Image buffer
 * @returns Metadata including format, dimensions, etc.
 */
export async function getImageMetadata(buffer: Buffer): Promise<{
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
}> {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || 'unknown',
    size: meta.size || buffer.length,
    hasAlpha: meta.hasAlpha || false,
  };
}

/**
 * Get file extension for output format
 */
export function getFileExtension(format: OutputFormat): string {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'webp':
      return 'webp';
    case 'png':
    default:
      return 'png';
  }
}

/**
 * Get MIME type for output format
 */
export function getMimeType(format: OutputFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}

/**
 * Validate that a buffer contains a valid image
 *
 * @param buffer - Buffer to validate
 * @returns True if valid image, false otherwise
 */
export async function isValidImage(buffer: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buffer).metadata();
    return !!(meta.width && meta.height && meta.format);
  } catch {
    return false;
  }
}

/**
 * Calculate size reduction percentage
 */
export function calculateSizeReduction(
  originalSize: number,
  processedSize: number
): number {
  if (originalSize === 0) return 0;
  return Math.round(((originalSize - processedSize) / originalSize) * 100);
}

/**
 * Add AI disclaimer watermark to image
 *
 * @param buffer - Image buffer to watermark
 * @param config - Disclaimer configuration
 * @returns Buffer with watermark added
 */
export async function addDisclaimerWatermark(
  buffer: Buffer,
  config: DisclaimerConfig
): Promise<Buffer> {
  if (!config.imageWatermark.enabled) {
    return buffer;
  }

  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (width === 0 || height === 0) {
    return buffer;
  }

  // Get appropriate disclaimer text based on image size
  const text = getDisclaimerText(config, width, height);
  const isSmall = Math.min(width, height) < config.smallImageThreshold;

  // Adjust font size based on image size
  const fontSize = isSmall ? Math.max(8, Math.floor(Math.min(width, height) / 20)) : config.fontSize;

  // Calculate position based on config
  const padding = 10;
  const textX =
    config.imageWatermark.position.includes('Right')
      ? width - padding
      : padding;
  const textY =
    config.imageWatermark.position.includes('bottom') ||
    config.imageWatermark.position.includes('Bottom')
      ? height - padding
      : padding + fontSize;
  const textAnchor = config.imageWatermark.position.includes('Right') ? 'end' : 'start';

  // Create SVG text overlay
  const opacity = config.imageWatermark.opacity;
  const hexColor = config.color.replace('#', '');

  const svgText = `
    <svg width="${width}" height="${height}">
      <style>
        .disclaimer {
          fill: #${hexColor};
          font-size: ${fontSize}px;
          font-family: Arial, sans-serif;
          opacity: ${opacity};
        }
      </style>
      <text
        x="${textX}"
        y="${textY}"
        text-anchor="${textAnchor}"
        class="disclaimer"
      >${text}</text>
    </svg>
  `;

  return sharp(buffer)
    .composite([
      {
        input: Buffer.from(svgText),
        top: 0,
        left: 0,
      },
    ])
    .toBuffer();
}
