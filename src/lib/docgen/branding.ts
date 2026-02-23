/**
 * Branding Utilities for Document Generation
 *
 * Handles logo processing, colors, and branding config resolution
 * for PDF and Word document generation.
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

// ============ Types ============

export interface BrandingConfig {
  enabled: boolean;
  logoUrl: string;
  organizationName: string;
  primaryColor: string;
  fontFamily: string;
  header: { enabled: boolean; content: string };
  footer: { enabled: boolean; content: string; includePageNumber: boolean };
}

export interface ProcessedLogo {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

// ============ Default Config ============

export const DEFAULT_BRANDING: BrandingConfig = {
  enabled: false,
  logoUrl: '',
  organizationName: '',
  primaryColor: '#003366',
  fontFamily: 'Calibri',
  header: { enabled: true, content: '' },
  footer: { enabled: true, content: '', includePageNumber: true },
};

// ============ Color Utilities ============

/**
 * Parse hex color to RGB values
 */
export function hexToRgb(hex: string): ColorRGB {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');

  // Parse hex values
  const bigint = parseInt(cleanHex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return { r, g, b };
}

/**
 * Convert RGB to hex string
 */
export function rgbToHex(rgb: ColorRGB): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Lighten a color by a percentage
 */
export function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  const factor = percent / 100;

  return rgbToHex({
    r: Math.min(255, Math.round(rgb.r + (255 - rgb.r) * factor)),
    g: Math.min(255, Math.round(rgb.g + (255 - rgb.g) * factor)),
    b: Math.min(255, Math.round(rgb.b + (255 - rgb.b) * factor)),
  });
}

/**
 * Darken a color by a percentage
 */
export function darkenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  const factor = 1 - percent / 100;

  return rgbToHex({
    r: Math.round(rgb.r * factor),
    g: Math.round(rgb.g * factor),
    b: Math.round(rgb.b * factor),
  });
}

/**
 * Check if a color is light (for determining text contrast)
 */
export function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  // Using relative luminance formula
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5;
}

/**
 * Get contrasting text color (black or white)
 */
export function getContrastColor(backgroundColor: string): string {
  return isLightColor(backgroundColor) ? '#000000' : '#ffffff';
}

// ============ Logo Processing ============

/**
 * Process a logo image for document embedding
 * - Resizes to max dimensions while maintaining aspect ratio
 * - Converts to PNG or JPEG format
 * - Returns buffer with metadata
 */
export async function processLogo(
  logoSource: string | Buffer,
  maxWidth: number = 200,
  maxHeight: number = 80
): Promise<ProcessedLogo | null> {
  try {
    let inputBuffer: Buffer;

    if (Buffer.isBuffer(logoSource)) {
      inputBuffer = logoSource;
    } else if (logoSource.startsWith('data:image')) {
      // Handle data URL
      const base64Data = logoSource.split(',')[1];
      inputBuffer = Buffer.from(base64Data, 'base64');
    } else if (logoSource.startsWith('http://') || logoSource.startsWith('https://')) {
      // Fetch remote image
      const response = await fetch(logoSource);
      if (!response.ok) {
        console.error(`Failed to fetch logo: ${response.status}`);
        return null;
      }
      inputBuffer = Buffer.from(await response.arrayBuffer());
    } else if (fs.existsSync(logoSource)) {
      // Read from file path
      inputBuffer = fs.readFileSync(logoSource);
    } else {
      console.error('Invalid logo source:', logoSource.substring(0, 50));
      return null;
    }

    // Process with sharp
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      console.error('Could not get image dimensions');
      return null;
    }

    // Calculate resize dimensions maintaining aspect ratio
    let targetWidth = metadata.width;
    let targetHeight = metadata.height;

    if (targetWidth > maxWidth) {
      const ratio = maxWidth / targetWidth;
      targetWidth = maxWidth;
      targetHeight = Math.round(targetHeight * ratio);
    }

    if (targetHeight > maxHeight) {
      const ratio = maxHeight / targetHeight;
      targetHeight = maxHeight;
      targetWidth = Math.round(targetWidth * ratio);
    }

    // Resize and convert to PNG (best for logos with transparency)
    const processedBuffer = await image
      .resize(targetWidth, targetHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    return {
      buffer: processedBuffer,
      width: targetWidth,
      height: targetHeight,
      format: 'png',
    };
  } catch (error) {
    console.error('Failed to process logo:', error);
    return null;
  }
}

// ============ Font Utilities ============

/**
 * Map font family names to standard fonts
 */
export function mapFontFamily(fontFamily: string): string {
  const fontMap: Record<string, string> = {
    calibri: 'Helvetica',
    arial: 'Helvetica',
    'times new roman': 'Times-Roman',
    times: 'Times-Roman',
    courier: 'Courier',
    'courier new': 'Courier',
    georgia: 'Times-Roman',
    verdana: 'Helvetica',
    tahoma: 'Helvetica',
    trebuchet: 'Helvetica',
    segoe: 'Helvetica',
    'segoe ui': 'Helvetica',
  };

  const normalized = fontFamily.toLowerCase().trim();
  return fontMap[normalized] || 'Helvetica';
}

/**
 * Get font family for DOCX (uses actual font name)
 */
export function getDocxFontFamily(fontFamily: string): string {
  // DOCX can use actual font names as they'll be resolved by Word
  const defaultFonts: Record<string, string> = {
    calibri: 'Calibri',
    arial: 'Arial',
    'times new roman': 'Times New Roman',
    times: 'Times New Roman',
    courier: 'Courier New',
    'courier new': 'Courier New',
    georgia: 'Georgia',
    verdana: 'Verdana',
    tahoma: 'Tahoma',
    'trebuchet ms': 'Trebuchet MS',
    trebuchet: 'Trebuchet MS',
    'segoe ui': 'Segoe UI',
    segoe: 'Segoe UI',
  };

  const normalized = fontFamily.toLowerCase().trim();
  return defaultFonts[normalized] || fontFamily;
}

// ============ Text Processing ============

/**
 * Format date for document footer/header
 */
export function formatDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Process header/footer content with variable substitution
 */
export function processTemplateContent(
  content: string,
  variables: Record<string, string> = {}
): string {
  const defaultVariables: Record<string, string> = {
    date: formatDate(),
    year: new Date().getFullYear().toString(),
    ...variables,
  };

  let processed = content;
  for (const [key, value] of Object.entries(defaultVariables)) {
    processed = processed.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value);
  }

  return processed;
}

// ============ Config Resolution ============

/**
 * Merge branding configs (category override takes precedence)
 */
export function mergeBrandingConfigs(
  globalConfig: Partial<BrandingConfig> | null,
  categoryConfig: Partial<BrandingConfig> | null
): BrandingConfig {
  const base = { ...DEFAULT_BRANDING };

  // Apply global config
  if (globalConfig) {
    Object.assign(base, globalConfig);
    if (globalConfig.header) {
      base.header = { ...DEFAULT_BRANDING.header, ...globalConfig.header };
    }
    if (globalConfig.footer) {
      base.footer = { ...DEFAULT_BRANDING.footer, ...globalConfig.footer };
    }
  }

  // Apply category override (takes precedence)
  if (categoryConfig) {
    Object.assign(base, categoryConfig);
    if (categoryConfig.header) {
      base.header = { ...base.header, ...categoryConfig.header };
    }
    if (categoryConfig.footer) {
      base.footer = { ...base.footer, ...categoryConfig.footer };
    }
  }

  return base;
}

/**
 * Validate branding configuration
 */
export function validateBrandingConfig(config: Partial<BrandingConfig>): string[] {
  const errors: string[] = [];

  if (config.primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(config.primaryColor)) {
    errors.push('primaryColor must be a valid hex color (e.g., #003366)');
  }

  if (config.logoUrl && config.logoUrl.length > 2000) {
    errors.push('logoUrl is too long (max 2000 characters)');
  }

  if (config.organizationName && config.organizationName.length > 200) {
    errors.push('organizationName is too long (max 200 characters)');
  }

  if (config.header?.content && config.header.content.length > 500) {
    errors.push('header content is too long (max 500 characters)');
  }

  if (config.footer?.content && config.footer.content.length > 500) {
    errors.push('footer content is too long (max 500 characters)');
  }

  return errors;
}

// ============ Storage Utilities ============

/**
 * Get the output directory for generated documents
 */
export function getOutputDirectory(): string {
  const outputDir = process.env.DOC_OUTPUT_DIR || path.join(process.cwd(), 'data', 'outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

/**
 * Generate a unique filename for a document
 */
export function generateDocumentFilename(
  baseName: string,
  format: 'pdf' | 'docx' | 'md' | 'xlsx' | 'pptx',
  threadId?: string
): string {
  const timestamp = Date.now();
  const sanitized = baseName
    .replace(/[^a-z0-9]/gi, '_')
    .substring(0, 50)
    .toLowerCase();
  const prefix = threadId ? `${threadId.substring(0, 8)}_` : '';
  return `${prefix}${sanitized}_${timestamp}.${format}`;
}
