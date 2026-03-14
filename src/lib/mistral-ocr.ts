import { Mistral } from '@mistralai/mistralai';
import { getApiKey } from '@/lib/provider-helpers';
import { getOcrSettings } from '@/lib/db/compat/config';

let mistralClient: Mistral | null = null;

/**
 * Reset the Mistral client (call when API key changes)
 */
export function resetMistralOcrClient(): void {
  mistralClient = null;
}

/**
 * Get or create Mistral client for OCR
 * Priority: OCR settings → LLM provider config → env var
 */
async function getMistralClient(): Promise<Mistral> {
  if (!mistralClient) {
    // Priority: OCR settings → LLM provider → env var
    const ocrSettings = await getOcrSettings();
    const apiKey = ocrSettings.mistralApiKey || await getApiKey('mistral');

    if (!apiKey) {
      throw new Error('Mistral API key not configured. Set in Settings > Document Processing or LLM > Providers.');
    }
    mistralClient = new Mistral({ apiKey });
  }
  return mistralClient;
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
 * Supports:
 * - PDF documents (type: document_url)
 * - Images: PNG, JPG, WEBP, GIF (type: image_url)
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
    ...(isImage && { includeImageBase64: true }),
  });

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
