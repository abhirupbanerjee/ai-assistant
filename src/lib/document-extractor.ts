/**
 * Unified document extraction with tiered fallback strategy
 *
 * Processing Order:
 *   Tier 0:   Plain text (.txt, .md, .json) — direct UTF-8 read
 *   Tier 0.5: Office docs — local parsers (no API key needed):
 *             - DOCX → mammoth
 *             - XLSX → exceljs
 *             - PPTX → officeparser
 *   Tier 1+:  API-based providers (configurable order in admin settings):
 *             - Mistral OCR (PDF + images)
 *             - Azure Document Intelligence (all formats)
 *             - pdf-parse (PDF only, local fallback)
 */

import { extractTextWithMistral } from './mistral-ocr';
import { extractTextWithAzureDI } from './azure-document-intelligence';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { OfficeParser } from 'officeparser';
import { getOcrSettings } from './db/compat/config';
import type { OcrProvider } from './db/compat/config';
import { isProviderConfigured } from '@/lib/provider-helpers';

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
  provider: 'mistral' | 'azure-di' | 'pdf-parse' | 'mammoth' | 'exceljs' | 'officeparser';
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

export function isDocx(mimeType: string): boolean {
  return mimeType === SUPPORTED_MIME_TYPES.DOCX;
}

export function isXlsx(mimeType: string): boolean {
  return mimeType === SUPPORTED_MIME_TYPES.XLSX;
}

export function isPptx(mimeType: string): boolean {
  return mimeType === SUPPORTED_MIME_TYPES.PPTX;
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
 * Extract text from document using tiered extraction strategy
 *
 * Tier 0:   Plain text files — direct read (no processing)
 * Tier 0.5: Office docs — local parsers: mammoth (DOCX), exceljs (XLSX), officeparser (PPTX)
 * Tier 1+:  API-based providers (configurable order in admin settings):
 *           - Mistral OCR: PDF and images only
 *           - Azure DI: All formats (PDF, Office, images)
 *           - pdf-parse: PDF only (local fallback)
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

  // TIER 0.5: DOCX files (structured XML, no OCR needed)
  // mammoth extracts text locally without API keys
  // Falls through to provider loop (Azure DI) if mammoth fails
  if (isDocx(mimeType)) {
    try {
      console.log(`[Tier 0.5] Attempting mammoth extraction for ${filename}...`);
      const result = await extractWithMammoth(buffer);
      console.log(`[Tier 0.5] mammoth succeeded: ${result.text.length} chars`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[Tier 0.5] mammoth failed for ${filename}: ${msg}`);
      errors.push(`mammoth: ${msg}`);
      // Fall through to provider loop — Azure DI can handle DOCX as backup
    }
  }

  // TIER 0.5b: XLSX files (structured data, no OCR needed)
  if (isXlsx(mimeType)) {
    try {
      console.log(`[Tier 0.5] Attempting exceljs extraction for ${filename}...`);
      const result = await extractWithExcelJS(buffer);
      console.log(`[Tier 0.5] exceljs succeeded: ${result.text.length} chars`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[Tier 0.5] exceljs failed for ${filename}: ${msg}`);
      errors.push(`exceljs: ${msg}`);
    }
  }

  // TIER 0.5c: PPTX files (structured slides, no OCR needed)
  if (isPptx(mimeType)) {
    try {
      console.log(`[Tier 0.5] Attempting officeparser extraction for ${filename}...`);
      const result = await extractWithOfficeParser(buffer);
      console.log(`[Tier 0.5] officeparser succeeded: ${result.text.length} chars`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[Tier 0.5] officeparser failed for ${filename}: ${msg}`);
      errors.push(`officeparser: ${msg}`);
    }
  }

  // Load provider priority from admin settings
  const ocrSettings = await getOcrSettings();

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
      // Check OCR settings first, then LLM provider config
      const ocrSettings = await getOcrSettings();
      const hasMistral = ocrSettings.mistralApiKey || await isProviderConfigured('mistral');
      if (!isMistralSupported(mimeType) || !hasMistral) return null;
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
      // Check OCR settings first, then env vars
      const azureOcrSettings = await getOcrSettings();
      const hasAzureDI = (azureOcrSettings.azureDiEndpoint && azureOcrSettings.azureDiKey) ||
                         (process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY);
      if (!hasAzureDI) return null;
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

// ============================================
// mammoth DOCX Extraction
// ============================================

async function extractWithMammoth(buffer: Buffer): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  if (!text || text.trim().length === 0) {
    throw new Error('mammoth extracted empty text from DOCX');
  }

  return {
    text,
    numPages: 1,
    pages: [{ pageNumber: 1, text }],
    provider: 'mammoth',
  };
}

// ============================================
// ExcelJS XLSX Extraction
// ============================================

async function extractWithExcelJS(buffer: Buffer): Promise<ExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const pages: ExtractedPage[] = [];
  const allText: string[] = [];

  workbook.eachSheet((sheet, sheetId) => {
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const cells = row.values as (string | number | null | undefined)[];
      const rowText = cells
        .slice(1) // exceljs row.values is 1-indexed (index 0 is empty)
        .filter(v => v != null)
        .map(v => String(v).trim())
        .filter(v => v.length > 0)
        .join('\t');
      if (rowText) rows.push(rowText);
    });
    const sheetText = rows.join('\n');
    if (sheetText.trim()) {
      pages.push({ pageNumber: sheetId, text: `[Sheet: ${sheet.name}]\n${sheetText}` });
      allText.push(`[Sheet: ${sheet.name}]\n${sheetText}`);
    }
  });

  const text = allText.join('\n\n');
  if (!text.trim()) throw new Error('exceljs extracted empty text from XLSX');

  return { text, numPages: pages.length, pages, provider: 'exceljs' };
}

// ============================================
// officeparser PPTX Extraction
// ============================================

async function extractWithOfficeParser(buffer: Buffer): Promise<ExtractionResult> {
  const ast = await OfficeParser.parseOffice(buffer);
  const text = ast.toText();

  if (!text || text.trim().length === 0) {
    throw new Error('officeparser extracted empty text from PPTX');
  }

  return {
    text,
    numPages: 1,
    pages: [{ pageNumber: 1, text }],
    provider: 'officeparser',
  };
}
