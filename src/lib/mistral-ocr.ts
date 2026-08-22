import { Mistral } from '@mistralai/mistralai';
import { getOcrSettings } from '@/lib/db/compat/config';
import { resolveProviderCredentialForRequest } from '@/lib/provider-credential';

/**
 * Reset the Mistral client (call when API key changes).
 * Mistral SDK clients are constructed per call; nothing module-scoped to reset.
 * Retained for API compatibility with admin settings routes.
 */
export function resetMistralOcrClient(): void {}

/**
 * Get or create Mistral client for OCR
 *
 * Org-aware resolution (AI & API Setup Redesign): a BYOK organization uses
 * only its own `mistral` credential and fails closed when it is missing —
 * never silently falling back to the platform key. PLATFORM_MANAGED / legacy
 * orgs preserve the pre-Phase-D priority (OCR settings → LLM provider key).
 */
async function getMistralClient(): Promise<Mistral> {
  const cred = await resolveProviderCredentialForRequest('mistral');

  let apiKey = cred.apiKey;
  if (cred.credentialId === 'platform' || cred.credentialId === 'legacy') {
    // Legacy/platform parity only. BYOK orgs keep their own credential.
    const ocrSettings = await getOcrSettings();
    apiKey = ocrSettings.mistralApiKey || cred.apiKey;
  }

  if (!apiKey) {
    throw new Error('Mistral API key not configured. Set in Settings > Document Processing or LLM > Providers.');
  }
  return new Mistral({ apiKey });
}

export interface MistralPageText {
  pageNumber: number;
  text: string;
}

/**
 * Check if the MIME type is an image type supported by Mistral OCR
 */
function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Extract text using Mistral OCR
 *
 * Supports OCR 4 with:
 * - PDF, DOC, PPT, ODF documents (type: document_url)
 * - Images: PNG, JPG, WEBP, GIF (type: image_url)
 * - Block extraction, table formatting, header/footer extraction
 */
export async function extractTextWithMistral(
  buffer: Buffer,
  mimeType: string = 'application/pdf'
): Promise<{ text: string; numPages: number; pages: MistralPageText[] }> {
  const client = await getMistralClient();

  // Convert buffer to base64 data URL
  const base64Data = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  // Determine document type based on MIME type
  // Images use image_url, PDFs use document_url
  const isImage = isImageMimeType(mimeType);

  // Call Mistral OCR API with appropriate document type
  const response = await client.ocr.process({
    model: 'mistral-ocr-latest',
    document: isImage
      ? {
          type: 'image_url',
          imageUrl: dataUrl,
        }
      : {
          type: 'document_url',
          documentUrl: dataUrl,
        },
    includeImageBase64: isImage || undefined,
    tableFormat: 'html',
    extractHeader: true,
    extractFooter: true,
    includeBlocks: true,
  } as any);

  // Extract text from each page
  const pages: MistralPageText[] = response.pages.map((page, index) => ({
    pageNumber: index + 1,
    text: page.markdown || '', // Mistral returns markdown format
  }));

  // Combine all pages
  const fullText = pages.map(p => p.text).join('\n\n');

  return {
    text: fullText,
    numPages: pages.length,
    pages,
  };
}
