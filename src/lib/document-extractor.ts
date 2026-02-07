/**
 * Unified document extraction with tiered fallback strategy
 *
 * Processing Order: Mistral OCR -> Azure Document Intelligence -> pdf-parse -> Error
 */

import { extractTextWithMistral } from './mistral-ocr';
import { extractTextWithAzureDI } from './azure-document-intelligence';
import pdf from 'pdf-parse';
import { getOcrSettings } from './db/config';
import type { OcrProvider } from './db/config';

// ============================================
// Types
// ============================================

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  text: string;
  numPages: number;
  pages: ExtractedPage[];
  provider: 'mistral' | 'azure-di' | 'pdf-parse';
}

// ============================================
// MIME Type Constants
// ============================================

export const SUPPORTED_MIME_TYPES = {
  // Documents
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  TXT: 'text/plain',
  MD: 'text/markdown',
  JSON: 'application/json',
  // Images
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp',
  GIF: 'image/gif',
} as const;

export const ALL_SUPPORTED_MIME_TYPES = Object.values(SUPPORTED_MIME_TYPES);

export const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
  '.md',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
] as const;

export const ALLOWED_EXTENSIONS_STRING = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif';

// ============================================
// MIME Type Helpers
// ============================================

export function isPDF(mimeType: string): boolean {
  return mimeType === SUPPORTED_MIME_TYPES.PDF;
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isOfficeDocument(mimeType: string): boolean {
  return [
    SUPPORTED_MIME_TYPES.DOCX,
    SUPPORTED_MIME_TYPES.XLSX,
    SUPPORTED_MIME_TYPES.PPTX,
  ].includes(mimeType as typeof SUPPORTED_MIME_TYPES.DOCX);
}

export function isMistralSupported(mimeType: string): boolean {
  // Mistral OCR supports PDF and images
  return isPDF(mimeType) || isImage(mimeType);
}

export function isPlainText(mimeType: string): boolean {
  return mimeType === SUPPORTED_MIME_TYPES.TXT || mimeType === SUPPORTED_MIME_TYPES.MD || mimeType === SUPPORTED_MIME_TYPES.JSON;
}

export function isPlainTextFile(mimeType: string, filename: string): boolean {
  // Check MIME type first
  if (mimeType === SUPPORTED_MIME_TYPES.TXT || mimeType === SUPPORTED_MIME_TYPES.MD || mimeType === SUPPORTED_MIME_TYPES.JSON) return true;
  // Also check file extension for octet-stream (common for .txt, .md, and .json files)
  if (mimeType === 'application/octet-stream') {
    const ext = filename.toLowerCase().split('.').pop();
    return ext === 'txt' || ext === 'md' || ext === 'json';
  }
  return false;
}

export function isSupportedMimeType(mimeType: string): boolean {
  return ALL_SUPPORTED_MIME_TYPES.includes(mimeType as typeof SUPPORTED_MIME_TYPES.PDF);
}

export function isSupportedExtension(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext) return false;
  return SUPPORTED_EXTENSIONS.includes(`.${ext}` as typeof SUPPORTED_EXTENSIONS[number]);
}

export function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeMap: Record<string, string> = {
    'pdf': SUPPORTED_MIME_TYPES.PDF,
    'docx': SUPPORTED_MIME_TYPES.DOCX,
    'xlsx': SUPPORTED_MIME_TYPES.XLSX,
    'pptx': SUPPORTED_MIME_TYPES.PPTX,
    'txt': SUPPORTED_MIME_TYPES.TXT,
    'md': SUPPORTED_MIME_TYPES.MD,
    'json': SUPPORTED_MIME_TYPES.JSON,
    'png': SUPPORTED_MIME_TYPES.PNG,
    'jpg': SUPPORTED_MIME_TYPES.JPEG,
    'jpeg': SUPPORTED_MIME_TYPES.JPEG,
    'webp': SUPPORTED_MIME_TYPES.WEBP,
    'gif': SUPPORTED_MIME_TYPES.GIF,
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
}

// ============================================
// Main Extraction Function
// ============================================

/**
 * Extract text from document using configurable provider priority
 *
 * Provider order and enabled state are configured via admin settings.
 * Default order: Mistral OCR -> Azure DI -> pdf-parse
 *
 * - Mistral OCR: PDF and images only
 * - Azure DI: All formats (PDF, Office, images)
 * - pdf-parse: PDF only (final fallback)
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<ExtractionResult> {
  const errors: string[] = [];

  // TIER 0: Plain text files (no OCR needed)
  // Check both MIME type and file extension for .txt files
  if (isPlainTextFile(mimeType, filename)) {
    console.log(`[Tier 0] Reading plain text file ${filename}...`);
    const text = buffer.toString('utf-8');
    return {
      text,
      numPages: 1,
      pages: [{ pageNumber: 1, text }],
      provider: 'pdf-parse', // Use 'pdf-parse' as provider for consistency
    };
  }

  // Load provider priority from admin settings
  const ocrSettings = getOcrSettings();

  for (let i = 0; i < ocrSettings.providers.length; i++) {
    const { provider, enabled } = ocrSettings.providers[i];
    const tierLabel = i === 0 ? 'Primary' : i === 1 ? 'Secondary' : 'Fallback';

    if (!enabled) {
      continue;
    }

    const result = await attemptProvider(provider, tierLabel, buffer, mimeType, filename, errors);
    if (result) return result;
  }

  // All providers exhausted
  const errorDetails = errors.length > 0
    ? ` Attempted: ${errors.join('; ')}`
    : ' No extraction service configured for this file type.';

  throw new Error(
    `Unable to extract text from "${filename}" (${mimeType}).${errorDetails}`
  );
}

/**
 * Attempt extraction with a specific provider
 * Returns result on success, null on failure or skip
 */
async function attemptProvider(
  provider: OcrProvider,
  tierLabel: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  errors: string[]
): Promise<ExtractionResult | null> {
  switch (provider) {
    case 'mistral': {
      if (!isMistralSupported(mimeType) || !process.env.MISTRAL_API_KEY) return null;
      try {
        console.log(`[${tierLabel}] Attempting Mistral OCR for ${filename}...`);
        const result = await extractTextWithMistral(buffer, mimeType);
        console.log(`[${tierLabel}] Mistral OCR succeeded: ${result.numPages} pages`);
        return { ...result, provider: 'mistral' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[${tierLabel}] Mistral OCR failed: ${msg}`);
        errors.push(`Mistral: ${msg}`);
        return null;
      }
    }
    case 'azure-di': {
      if (!process.env.AZURE_DI_ENDPOINT || !process.env.AZURE_DI_KEY) return null;
      try {
        console.log(`[${tierLabel}] Attempting Azure DI for ${filename}...`);
        const result = await extractTextWithAzureDI(buffer, mimeType);
        console.log(`[${tierLabel}] Azure DI succeeded: ${result.numPages} pages`);
        return { ...result, provider: 'azure-di' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[${tierLabel}] Azure DI failed: ${msg}`);
        errors.push(`Azure DI: ${msg}`);
        return null;
      }
    }
    case 'pdf-parse': {
      if (!isPDF(mimeType)) return null;
      try {
        console.log(`[${tierLabel}] Attempting pdf-parse for ${filename}...`);
        const result = await extractWithPdfParse(buffer);
        console.log(`[${tierLabel}] pdf-parse succeeded: ${result.numPages} pages`);
        return { ...result, provider: 'pdf-parse' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[${tierLabel}] pdf-parse failed: ${msg}`);
        errors.push(`pdf-parse: ${msg}`);
        return null;
      }
    }
    default:
      return null;
  }
}

// ============================================
// pdf-parse Extraction
// ============================================

interface PdfParseResult {
  text: string;
  numPages: number;
  pages: ExtractedPage[];
}

async function extractWithPdfParse(buffer: Buffer): Promise<PdfParseResult> {
  const pages: ExtractedPage[] = [];

  const data = await pdf(buffer, {
    pagerender: function(pageData: { pageIndex: number; getTextContent: () => Promise<{ items: { str: string }[] }> }) {
      return pageData.getTextContent().then(function(textContent) {
        const pageText = textContent.items
          .map((item) => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        pages.push({
          pageNumber: pageData.pageIndex + 1,
          text: pageText,
        });

        return pageText;
      });
    }
  });

  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  return {
    text: data.text,
    numPages: data.numpages,
    pages,
  };
}
