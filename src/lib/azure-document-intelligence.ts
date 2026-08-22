/**
 * Azure Document Intelligence client for text extraction
 *
 * Supports: PDF, DOCX, XLSX, PPTX, Images (PNG, JPG, WEBP, GIF)
 */

import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { getOcrSettings } from '@/lib/db/compat/config';
import { resolveProviderCredentialForRequest } from '@/lib/provider-credential';

// ============================================
// Types
// ============================================

export interface AzureDIPage {
  pageNumber: number;
  text: string;
}

export interface AzureDIResult {
  text: string;
  numPages: number;
  pages: AzureDIPage[];
}

// ============================================
// Client Singleton
// ============================================

/**
 * Reset the Azure DI client (call when credentials change).
 * DocumentAnalysisClient is constructed per call; nothing module-scoped to reset.
 * Retained for API compatibility with admin settings routes.
 */
export function resetAzureDIClient(): void {}

/**
 * Get or create Azure DI client
 *
 * Org-aware resolution (AI & API Setup Redesign): a BYOK organization uses
 * only its own `azure-di` credential and fails closed when it is missing —
 * never silently falling back to the platform key. PLATFORM_MANAGED / legacy
 * orgs preserve the pre-Phase-D priority (OCR settings → env vars).
 */
async function getAzureDIClient(): Promise<DocumentAnalysisClient> {
  const cred = await resolveProviderCredentialForRequest('azure-di');

  let endpoint = cred.apiBase;
  let key = cred.apiKey;
  if (cred.credentialId === 'platform' || cred.credentialId === 'legacy') {
    // Legacy/platform parity only. BYOK orgs keep their own credential.
    const ocrSettings = await getOcrSettings();
    endpoint = ocrSettings.azureDiEndpoint || process.env.AZURE_DI_ENDPOINT || null;
    key = ocrSettings.azureDiKey || process.env.AZURE_DI_KEY || null;
  }

  if (!endpoint || !key) {
    throw new Error('Azure Document Intelligence not configured. Set credentials in Settings > Document Processing or use AZURE_DI_ENDPOINT and AZURE_DI_KEY environment variables.');
  }

  if (!endpoint.startsWith('https://')) {
    throw new Error(`Invalid Azure DI endpoint URL: "${endpoint}". Must be an HTTPS URL (e.g., https://your-resource.cognitiveservices.azure.com)`);
  }

  return new DocumentAnalysisClient(
    endpoint,
    new AzureKeyCredential(key)
  );
}

// ============================================
// Extraction Function
// ============================================

/**
 * Extract text using Azure Document Intelligence
 *
 * Uses the prebuilt-read model which is optimized for:
 * - Printed and handwritten text extraction
 * - Multiple languages
 * - Tables and structure preservation
 *
 * Supports: PDF, DOCX, XLSX, PPTX, PNG, JPG, WEBP, GIF, BMP, TIFF
 *
 * Note: The SDK automatically detects content type from the buffer.
 * The mimeType parameter is kept for documentation/logging purposes.
 */
export async function extractTextWithAzureDI(
  buffer: Buffer,
  mimeType: string
): Promise<AzureDIResult> {
  const client = await getAzureDIClient();

  console.log(`Azure DI processing document (${mimeType}, ${buffer.length} bytes)`);

  // Use prebuilt-read model for text extraction
  // This model is best for general text extraction from documents
  // The SDK automatically detects content type from the buffer
  const poller = await client.beginAnalyzeDocument(
    'prebuilt-read',
    buffer
  );

  const result = await poller.pollUntilDone();

  // The result.content field contains the full text for all document types
  // This is the primary source for text extraction (works for DOCX, XLSX, PPTX, PDF, images)
  const fullText = result.content || '';

  // For page-level information, extract from pages if available
  // Note: For Office documents, pages may not have line-level data
  const numPages = result.pages?.length || 1;

  const pages: AzureDIPage[] = result.pages?.map((page, index) => {
    // Try to get page-specific text from lines, fall back to empty
    const pageText = page.lines
      ?.map(line => line.content)
      .join('\n') || '';

    return {
      pageNumber: index + 1,
      text: pageText,
    };
  }) || [{ pageNumber: 1, text: fullText }];

  // If we have content but pages don't have text (common for Office docs),
  // put all content in the first page for consistency
  if (fullText && pages.every(p => !p.text)) {
    pages[0] = { pageNumber: 1, text: fullText };
  }

  console.log(`Azure DI extracted ${fullText.length} chars from ${numPages} page(s)`);

  return {
    text: fullText,
    numPages,
    pages,
  };
}
