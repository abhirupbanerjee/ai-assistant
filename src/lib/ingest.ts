/**
 * Document Ingestion Module
 *
 * Supports category-based document ingestion with SQLite metadata storage.
 * Documents can be assigned to categories or marked as global.
 * Global documents are indexed into all category collections.
 *
 * Supports: PDF, DOCX, XLSX, PPTX, PNG, JPG, WEBP, GIF
 */

import { RecursiveTextSplitter } from './chunking/recursive-splitter';
import path from 'path';
import { createEmbeddings } from './openai';
import { SemanticChunker } from './chunking/semantic-chunker';
import {
  addDocuments,
  addDocumentsToCategories,
  addGlobalDocuments,
  deleteDocumentsByFilter,
  deleteDocumentsByFilterFromCategories,
  deleteDocumentsFromAllCollections,
} from './chroma';
import { readFileBuffer, getGlobalDocsDir, deleteFile, fileExists, writeFileBuffer } from './storage';
import { getRagSettings } from './db/config';
import {
  createDocument,
  getDocumentWithCategories,
  getAllDocumentsWithCategories,
  updateDocument,
  deleteDocument as dbDeleteDocument,
  setDocumentCategories,
  setDocumentGlobal,
  type DocumentWithCategories,
} from './db/documents';
import { getCategoryById } from './db/categories';
import { extractText, getMimeTypeFromFilename, type ExtractedPage } from './document-extractor';
import type { DocumentChunk, GlobalDocument } from '@/types';
import {
  isYouTubeUrl,
  extractYouTubeTranscript,
  formatTranscriptForIngestion,
  isYouTubeApiConfigured,
} from './youtube';
import {
  extractWebContent,
  formatWebContentForIngestion,
  generateFilenameFromUrl,
  isTavilyConfigured,
  crawlWebsite,
  mapWebsite,
  downloadPdfFromUrl,
  type CrawlOptions,
} from './tools/tavily';

// Create splitter with configurable settings
function createSplitter(chunkSize?: number, chunkOverlap?: number): RecursiveTextSplitter {
  if (chunkSize !== undefined && chunkOverlap !== undefined) {
    return new RecursiveTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ['\n\n', '\n', '. ', ' ', ''],
    });
  }

  const settings = getRagSettings();
  return new RecursiveTextSplitter({
    chunkSize: settings.chunkSize,
    chunkOverlap: settings.chunkOverlap,
    separators: ['\n\n', '\n', '. ', ' ', ''],
  });
}

// Re-export PageText type for backward compatibility
export type PageText = ExtractedPage;

/**
 * Extract text from a PDF document
 * @deprecated Use extractText from document-extractor.ts for new code
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<{ text: string; numPages: number; pages: PageText[] }> {
  return extractText(buffer, 'application/pdf', 'document.pdf');
}

/**
 * Extract text from any supported document type
 */
export async function extractTextFromDocument(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<{ text: string; numPages: number; pages: PageText[] }> {
  const resolvedMimeType = mimeType || getMimeTypeFromFilename(filename);
  return extractText(buffer, resolvedMimeType, filename);
}

export async function chunkText(
  text: string,
  documentId: string,
  documentName: string,
  source: 'global' | 'user' = 'global',
  threadId?: string,
  userId?: string,
  pages?: PageText[]
): Promise<DocumentChunk[]> {
  const settings = getRagSettings();
  const useSemanticChunking = settings.chunkingStrategy === 'semantic';

  // Create appropriate chunker based on strategy
  const splitTextFn = useSemanticChunking
    ? async (pageText: string) => {
        const chunker = new SemanticChunker({
          maxChunkSize: settings.chunkSize,
          breakpointThreshold: settings.semanticBreakpointThreshold,
        });
        return chunker.splitText(pageText);
      }
    : async (pageText: string) => {
        const splitter = createSplitter();
        return splitter.splitText(pageText);
      };

  if (useSemanticChunking) {
    console.log(`[Ingest] Using semantic chunking (threshold: ${settings.semanticBreakpointThreshold})`);
  }

  // If we have page information, chunk each page separately to preserve page numbers
  if (pages && pages.length > 0) {
    const allChunks: DocumentChunk[] = [];
    let chunkIndex = 0;

    for (const page of pages) {
      if (!page.text.trim()) continue;

      const pageChunks = await splitTextFn(page.text);

      for (const chunkText of pageChunks) {
        allChunks.push({
          id: `${documentId}-chunk-${chunkIndex}`,
          text: chunkText,
          metadata: {
            documentId,
            documentName,
            pageNumber: page.pageNumber,
            chunkIndex,
            source,
            threadId,
            userId,
          },
        });
        chunkIndex++;
      }
    }

    return allChunks;
  }

  // Fallback: chunk without page info (all page 1)
  const chunks = await splitTextFn(text);

  return chunks.map((chunk, index) => ({
    id: `${documentId}-chunk-${index}`,
    text: chunk,
    metadata: {
      documentId,
      documentName,
      pageNumber: 1,
      chunkIndex: index,
      source,
      threadId,
      userId,
    },
  }));
}

/**
 * Convert SQLite document to API format for backward compatibility
 */
function toGlobalDocument(doc: DocumentWithCategories): GlobalDocument {
  return {
    id: String(doc.id),
    filename: doc.filename,
    filepath: doc.filepath,
    size: doc.file_size,
    chunkCount: doc.chunk_count,
    uploadedAt: new Date(doc.created_at),
    uploadedBy: doc.uploaded_by,
    status: doc.status,
    errorMessage: doc.error_message || undefined,
    isGlobal: doc.isGlobal,
    categories: doc.categories,
  };
}

/**
 * Ingest a document with category support
 *
 * @param buffer - File buffer
 * @param filename - Original filename
 * @param uploadedBy - User email who uploaded
 * @param options - Category, global, and MIME type options
 */
export async function ingestDocument(
  buffer: Buffer,
  filename: string,
  uploadedBy: string,
  options?: {
    categoryIds?: number[];
    isGlobal?: boolean;
    mimeType?: string;
  }
): Promise<GlobalDocument> {
  const globalDocsDir = getGlobalDocsDir();
  const categoryIds = options?.categoryIds || [];
  const isGlobal = options?.isGlobal || false;
  const mimeType = options?.mimeType || getMimeTypeFromFilename(filename);

  // Save file
  const filePath = path.join(globalDocsDir, filename);
  await writeFileBuffer(filePath, buffer);

  // Create document record in SQLite
  const doc = createDocument({
    filename,
    filepath: filename,
    fileSize: buffer.length,
    uploadedBy,
    isGlobal,
    categoryIds,
  });

  try {
    // Extract and chunk text
    const { text, pages } = await extractText(buffer, mimeType, filename);
    const docId = String(doc.id);
    const chunks = await chunkText(text, docId, filename, 'global', undefined, undefined, pages);

    if (chunks.length === 0) {
      throw new Error('No text content extracted from document');
    }

    // Get category slugs for ChromaDB collection names
    const categorySlugs: string[] = [];
    for (const catId of categoryIds) {
      const category = getCategoryById(catId);
      if (category) {
        categorySlugs.push(category.slug);
      }
    }

    // Create embeddings in batches
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const embeddings = await createEmbeddings(texts);
      const metadatas = batch.map(c => c.metadata);

      // Global documents go into global_documents collection
      if (isGlobal) {
        await addGlobalDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas
        );
      }

      // Documents with categories go into their category collections
      // (This applies to BOTH global and non-global documents with categories)
      if (categorySlugs.length > 0) {
        await addDocumentsToCategories(
          categorySlugs,
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas,
          false
        );
      } else if (!isGlobal) {
        // Legacy: add to default collection (for uncategorized, non-global documents)
        await addDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas
        );
      }
    }

    // Update document status
    updateDocument(doc.id, {
      chunkCount: chunks.length,
      status: 'ready',
    });

    // Fetch updated document
    const updatedDoc = getDocumentWithCategories(doc.id);
    return toGlobalDocument(updatedDoc!);
  } catch (error) {
    // Update document with error status
    updateDocument(doc.id, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Sanitize a filename for filesystem use
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .slice(0, 200); // Limit length
}

/**
 * Ingest text content directly (bypasses document extraction)
 *
 * @param content - Raw text content
 * @param name - Document name (will be saved as .txt file)
 * @param uploadedBy - User email who uploaded
 * @param options - Category and global options
 */
export async function ingestTextContent(
  content: string,
  name: string,
  uploadedBy: string,
  options?: {
    categoryIds?: number[];
    isGlobal?: boolean;
  }
): Promise<GlobalDocument> {
  const globalDocsDir = getGlobalDocsDir();
  const categoryIds = options?.categoryIds || [];
  const isGlobal = options?.isGlobal || false;

  // Create filename from name
  const sanitizedName = sanitizeFilename(name);
  const filename = sanitizedName.endsWith('.txt') ? sanitizedName : `${sanitizedName}.txt`;
  const buffer = Buffer.from(content, 'utf-8');

  // Save file
  const filePath = path.join(globalDocsDir, filename);
  await writeFileBuffer(filePath, buffer);

  // Create document record in SQLite
  const doc = createDocument({
    filename,
    filepath: filename,
    fileSize: buffer.length,
    uploadedBy,
    isGlobal,
    categoryIds,
  });

  try {
    // Chunk text directly (no extraction needed)
    const docId = String(doc.id);
    const chunks = await chunkText(content, docId, filename, 'global');

    if (chunks.length === 0) {
      throw new Error('No text content to process');
    }

    // Get category slugs for ChromaDB collection names
    const categorySlugs: string[] = [];
    for (const catId of categoryIds) {
      const category = getCategoryById(catId);
      if (category) {
        categorySlugs.push(category.slug);
      }
    }

    // Create embeddings in batches
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const embeddings = await createEmbeddings(texts);
      const metadatas = batch.map(c => c.metadata);

      // Global documents go into global_documents collection
      if (isGlobal) {
        await addGlobalDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas
        );
      }

      // Documents with categories go into their category collections
      // (This applies to BOTH global and non-global documents with categories)
      if (categorySlugs.length > 0) {
        await addDocumentsToCategories(
          categorySlugs,
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas,
          false
        );
      } else if (!isGlobal) {
        // Legacy: add to default collection (for uncategorized, non-global documents)
        await addDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas
        );
      }
    }

    // Update document status
    updateDocument(doc.id, {
      chunkCount: chunks.length,
      status: 'ready',
    });

    // Fetch updated document
    const updatedDoc = getDocumentWithCategories(doc.id);
    return toGlobalDocument(updatedDoc!);
  } catch (error) {
    // Update document with error status
    updateDocument(doc.id, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Delete a document and its embeddings
 */
export async function deleteDocument(docId: string): Promise<{ filename: string; chunksRemoved: number } | null> {
  const numericId = parseInt(docId, 10);
  const doc = getDocumentWithCategories(numericId);

  if (!doc) {
    return null;
  }

  // Get category slugs for deletion
  const categorySlugs = doc.categories.map(c => c.slug);

  // Delete from ChromaDB
  if (doc.isGlobal) {
    // Global doc: delete from all collections
    await deleteDocumentsFromAllCollections([docId]);
  } else if (categorySlugs.length > 0) {
    // Category doc: delete from specific collections
    await deleteDocumentsByFilterFromCategories(categorySlugs, { documentId: docId });
  } else {
    // Legacy: delete from default collection
    await deleteDocumentsByFilter({ documentId: docId });
  }

  // Delete PDF file
  const globalDocsDir = getGlobalDocsDir();
  const pdfPath = path.join(globalDocsDir, doc.filepath);
  await deleteFile(pdfPath);

  // Delete from SQLite
  dbDeleteDocument(numericId);

  return {
    filename: doc.filename,
    chunksRemoved: doc.chunk_count,
  };
}

/**
 * Reindex a document (re-extract and re-embed)
 */
export async function reindexDocument(docId: string): Promise<GlobalDocument | null> {
  const numericId = parseInt(docId, 10);
  const doc = getDocumentWithCategories(numericId);

  if (!doc) {
    return null;
  }

  const globalDocsDir = getGlobalDocsDir();
  const pdfPath = path.join(globalDocsDir, doc.filepath);

  if (!await fileExists(pdfPath)) {
    throw new Error('PDF file not found');
  }

  // Get category slugs
  const categorySlugs = doc.categories.map(c => c.slug);

  // Delete existing embeddings
  if (doc.isGlobal) {
    await deleteDocumentsFromAllCollections([docId]);
  } else if (categorySlugs.length > 0) {
    await deleteDocumentsByFilterFromCategories(categorySlugs, { documentId: docId });
  } else {
    await deleteDocumentsByFilter({ documentId: docId });
  }

  // Update status to processing
  updateDocument(numericId, { status: 'processing' });

  try {
    // Re-extract and chunk
    const buffer = await readFileBuffer(pdfPath);
    const mimeType = getMimeTypeFromFilename(doc.filename);
    const { text, pages } = await extractText(buffer, mimeType, doc.filename);
    const chunks = await chunkText(text, docId, doc.filename, 'global', undefined, undefined, pages);

    // Create embeddings in batches
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const embeddings = await createEmbeddings(texts);
      const metadatas = batch.map(c => c.metadata);

      if (doc.isGlobal) {
        await addGlobalDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas
        );
      } else if (categorySlugs.length > 0) {
        await addDocumentsToCategories(
          categorySlugs,
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas,
          false
        );
      } else {
        await addDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          metadatas
        );
      }
    }

    // Update document status
    updateDocument(numericId, {
      chunkCount: chunks.length,
      status: 'ready',
      errorMessage: null,
    });

    const updatedDoc = getDocumentWithCategories(numericId);
    return toGlobalDocument(updatedDoc!);
  } catch (error) {
    updateDocument(numericId, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * List all global documents
 */
export async function listGlobalDocuments(): Promise<GlobalDocument[]> {
  const docs = getAllDocumentsWithCategories();
  return docs.map(toGlobalDocument);
}

/**
 * Get a specific document
 */
export async function getGlobalDocument(docId: string): Promise<GlobalDocument | null> {
  const numericId = parseInt(docId, 10);
  const doc = getDocumentWithCategories(numericId);
  return doc ? toGlobalDocument(doc) : null;
}

// ============ Category Management Functions ============

/**
 * Update document categories
 * This will re-index the document to the new categories
 */
export async function updateDocumentCategories(
  docId: string,
  categoryIds: number[]
): Promise<void> {
  const numericId = parseInt(docId, 10);
  const doc = getDocumentWithCategories(numericId);

  if (!doc) {
    throw new Error('Document not found');
  }

  // Get old and new category slugs
  const oldSlugs = doc.categories.map(c => c.slug);
  const newSlugs: string[] = [];
  for (const catId of categoryIds) {
    const category = getCategoryById(catId);
    if (category) {
      newSlugs.push(category.slug);
    }
  }

  // If document has embeddings and categories changed, need to re-index
  if (doc.chunk_count > 0 && doc.status === 'ready') {
    // Delete from old categories
    if (oldSlugs.length > 0) {
      await deleteDocumentsByFilterFromCategories(oldSlugs, { documentId: docId });
    }

    // Re-add to new categories
    if (newSlugs.length > 0) {
      const globalDocsDir = getGlobalDocsDir();
      const filePath = path.join(globalDocsDir, doc.filepath);
      const buffer = await readFileBuffer(filePath);
      const mimeType = getMimeTypeFromFilename(doc.filename);
      const { text, pages } = await extractText(buffer, mimeType, doc.filename);
      const chunks = await chunkText(text, docId, doc.filename, 'global', undefined, undefined, pages);

      const batchSize = 100;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => c.text);
        const embeddings = await createEmbeddings(texts);

        await addDocumentsToCategories(
          newSlugs,
          batch.map(c => c.id),
          embeddings,
          texts,
          batch.map(c => c.metadata),
          false
        );
      }
    }
  }

  // Update SQLite
  setDocumentCategories(numericId, categoryIds);
}

/**
 * Toggle document global status
 * Global documents are indexed into all category collections
 */
export async function toggleDocumentGlobal(
  docId: string,
  isGlobal: boolean
): Promise<void> {
  const numericId = parseInt(docId, 10);
  const doc = getDocumentWithCategories(numericId);

  if (!doc) {
    throw new Error('Document not found');
  }

  // If document has embeddings and status is changing, need to re-index
  if (doc.chunk_count > 0 && doc.status === 'ready' && doc.isGlobal !== isGlobal) {
    const globalDocsDir = getGlobalDocsDir();
    const filePath = path.join(globalDocsDir, doc.filepath);
    const buffer = await readFileBuffer(filePath);
    const mimeType = getMimeTypeFromFilename(doc.filename);
    const { text, pages } = await extractText(buffer, mimeType, doc.filename);
    const chunks = await chunkText(text, docId, doc.filename, 'global', undefined, undefined, pages);

    // Delete from current locations
    if (doc.isGlobal) {
      await deleteDocumentsFromAllCollections([docId]);
    } else {
      const oldSlugs = doc.categories.map(c => c.slug);
      if (oldSlugs.length > 0) {
        await deleteDocumentsByFilterFromCategories(oldSlugs, { documentId: docId });
      }
    }

    // Re-add to new locations
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const embeddings = await createEmbeddings(texts);

      if (isGlobal) {
        await addGlobalDocuments(
          batch.map(c => c.id),
          embeddings,
          texts,
          batch.map(c => c.metadata)
        );
      } else {
        const newSlugs = doc.categories.map(c => c.slug);
        if (newSlugs.length > 0) {
          await addDocumentsToCategories(
            newSlugs,
            batch.map(c => c.id),
            embeddings,
            texts,
            batch.map(c => c.metadata),
            false
          );
        }
      }
    }
  }

  // Update SQLite
  setDocumentGlobal(numericId, isGlobal);
}

// ============ URL Ingestion Functions ============

/**
 * URL ingestion status for UI feedback
 */
export interface UrlIngestionStatus {
  webEnabled: boolean;
  youtubeEnabled: boolean;
  youtubeSupadataEnabled: boolean;
  crawlEnabled: boolean;
  message?: string;
}

/**
 * Result of URL ingestion
 */
export interface UrlIngestionResult {
  url: string;
  success: boolean;
  document?: GlobalDocument;
  error?: string;
  sourceType: 'youtube' | 'web';
}

/**
 * Check what URL ingestion methods are available
 */
export function getUrlIngestionStatus(): UrlIngestionStatus {
  const webEnabled = isTavilyConfigured();
  const crawlEnabled = isTavilyConfigured(); // Crawl uses same Tavily API key
  const youtubeSupadataEnabled = isYouTubeApiConfigured(); // Now checks Supadata config

  const messages: string[] = [];
  if (!webEnabled) {
    messages.push('Web URL extraction requires Tavily API key. Configure in Admin > Tools > Web Search.');
  }
  if (!youtubeSupadataEnabled) {
    messages.push('YouTube extraction requires Supadata API key. Configure in Admin > Tools > YouTube.');
  }

  return {
    webEnabled,
    youtubeEnabled: true, // Fallback always available (may fail due to IP blocking)
    youtubeSupadataEnabled,
    crawlEnabled,
    message: messages.length > 0 ? messages.join(' ') : undefined,
  };
}

/**
 * Ingest a single YouTube video
 */
export async function ingestYouTubeUrl(
  url: string,
  uploadedBy: string,
  options?: {
    categoryIds?: number[];
    isGlobal?: boolean;
    customName?: string;
  }
): Promise<GlobalDocument> {
  const result = await extractYouTubeTranscript(url);

  if (!result.success) {
    throw new Error(result.error || 'Failed to extract YouTube transcript');
  }

  const content = formatTranscriptForIngestion(result);
  const defaultName = result.videoInfo?.title || `YouTube-${result.videoId}`;
  const documentName = options?.customName || defaultName;

  return ingestTextContent(content, documentName, uploadedBy, {
    categoryIds: options?.categoryIds,
    isGlobal: options?.isGlobal,
  });
}

/**
 * Ingest multiple web URLs in a batch (max 5 for optimal credit usage)
 */
export async function ingestWebUrls(
  urls: string[],
  uploadedBy: string,
  options?: {
    categoryIds?: number[];
    isGlobal?: boolean;
  }
): Promise<UrlIngestionResult[]> {
  if (!isTavilyConfigured()) {
    throw new Error('Web URL extraction requires Tavily API key. Configure in Settings > Web Search.');
  }

  if (urls.length > 5) {
    throw new Error('Maximum 5 URLs per batch');
  }

  // Extract content from all URLs
  const extractResults = await extractWebContent(urls);
  const ingestionResults: UrlIngestionResult[] = [];

  // Ingest each successful extraction
  for (const extractResult of extractResults) {
    if (extractResult.success && extractResult.content) {
      try {
        const content = formatWebContentForIngestion(extractResult.url, extractResult.content);
        const filename = generateFilenameFromUrl(extractResult.url);

        const doc = await ingestTextContent(content, filename.replace('.txt', ''), uploadedBy, {
          categoryIds: options?.categoryIds,
          isGlobal: options?.isGlobal,
        });

        ingestionResults.push({
          url: extractResult.url,
          success: true,
          document: doc,
          sourceType: 'web',
        });
      } catch (error) {
        ingestionResults.push({
          url: extractResult.url,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to ingest content',
          sourceType: 'web',
        });
      }
    } else {
      ingestionResults.push({
        url: extractResult.url,
        success: false,
        error: extractResult.error || 'Failed to extract content',
        sourceType: 'web',
      });
    }
  }

  return ingestionResults;
}

/**
 * Ingest URLs (auto-detects YouTube vs web URLs)
 * Separates YouTube URLs for individual processing and batches web URLs
 */
export async function ingestUrls(
  urls: string[],
  uploadedBy: string,
  options?: {
    categoryIds?: number[];
    isGlobal?: boolean;
  }
): Promise<UrlIngestionResult[]> {
  const results: UrlIngestionResult[] = [];
  const webUrls: string[] = [];

  // Process YouTube URLs individually
  for (const url of urls) {
    if (isYouTubeUrl(url)) {
      try {
        const doc = await ingestYouTubeUrl(url, uploadedBy, {
          categoryIds: options?.categoryIds,
          isGlobal: options?.isGlobal,
        });
        results.push({
          url,
          success: true,
          document: doc,
          sourceType: 'youtube',
        });
      } catch (error) {
        results.push({
          url,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to ingest YouTube video',
          sourceType: 'youtube',
        });
      }
    } else {
      webUrls.push(url);
    }
  }

  // Process web URLs in batch (max 5 at a time)
  if (webUrls.length > 0) {
    for (let i = 0; i < webUrls.length; i += 5) {
      const batch = webUrls.slice(i, i + 5);
      const batchResults = await ingestWebUrls(batch, uploadedBy, {
        categoryIds: options?.categoryIds,
        isGlobal: options?.isGlobal,
      });
      results.push(...batchResults);
    }
  }

  return results;
}

// ============ Website Crawl Ingestion Functions ============

/**
 * Options for crawling and ingesting a website
 */
export interface CrawlIngestionOptions {
  categoryIds?: number[];
  isGlobal?: boolean;
  crawlOptions?: CrawlOptions;
  includePdfs?: boolean;  // Download and ingest PDFs discovered via Map API
}

/**
 * Result of a page ingestion during crawl
 */
export interface CrawlPageIngestionResult {
  url: string;
  success: boolean;
  documentId?: string;
  filename?: string;
  error?: string;
}

/**
 * Result of website crawl ingestion
 */
export interface CrawlIngestionResult {
  baseUrl: string;
  success: boolean;
  totalPagesFound: number;
  successfulPages: number;
  failedPages: number;
  documents: CrawlPageIngestionResult[];
  error?: string;
  estimatedCredits: number;
  // PDF-related fields
  pdfCount?: number;         // Number of PDFs discovered
  pdfsIngested?: number;     // Number of PDFs successfully ingested
  pdfsFailed?: number;       // Number of PDFs that failed to ingest
}

/**
 * Crawl a website and ingest all discovered pages as documents
 * Each crawled page becomes a separate document
 * Optionally discovers and downloads PDFs via Map API
 *
 * @param url - Base URL to start crawling from
 * @param uploadedBy - User email who initiated the crawl
 * @param options - Crawl and ingestion options
 */
export async function ingestCrawledSite(
  url: string,
  uploadedBy: string,
  options?: CrawlIngestionOptions
): Promise<CrawlIngestionResult> {
  if (!isTavilyConfigured()) {
    return {
      baseUrl: url,
      success: false,
      totalPagesFound: 0,
      successfulPages: 0,
      failedPages: 0,
      documents: [],
      error: 'Website crawling requires Tavily API key. Configure in Settings > Web Search.',
      estimatedCredits: 0,
    };
  }

  const documents: CrawlPageIngestionResult[] = [];
  let successfulPages = 0;
  let failedPages = 0;
  let pdfCount = 0;
  let pdfsIngested = 0;
  let pdfsFailed = 0;
  let estimatedCredits = 0;

  // If includePdfs is enabled, first use Map API to discover URLs and PDFs
  if (options?.includePdfs) {
    console.log('[Ingest] Using Map API to discover PDFs:', url);
    const mapResult = await mapWebsite(url, {
      limit: (options.crawlOptions?.limit ?? 50) * 2, // Map more URLs to find PDFs
      maxDepth: options.crawlOptions?.maxDepth,
      selectPaths: options.crawlOptions?.selectPaths,
      excludePaths: options.crawlOptions?.excludePaths,
    });

    if (mapResult.success && mapResult.pdfUrls.length > 0) {
      pdfCount = mapResult.pdfUrls.length;
      console.log('[Ingest] Found', pdfCount, 'PDFs to download');

      // Download and ingest each PDF
      for (const pdfUrl of mapResult.pdfUrls) {
        try {
          const downloadResult = await downloadPdfFromUrl(pdfUrl);

          if (downloadResult.success && downloadResult.buffer) {
            // Ingest the PDF through the normal document pipeline
            const doc = await ingestDocument(
              downloadResult.buffer,
              downloadResult.filename || 'document.pdf',
              uploadedBy,
              {
                categoryIds: options.categoryIds,
                isGlobal: options.isGlobal,
                mimeType: 'application/pdf',
              }
            );

            documents.push({
              url: pdfUrl,
              success: true,
              documentId: doc.id,
              filename: doc.filename,
            });
            pdfsIngested++;
            successfulPages++;
          } else {
            documents.push({
              url: pdfUrl,
              success: false,
              error: downloadResult.error || 'Failed to download PDF',
            });
            pdfsFailed++;
            failedPages++;
          }
        } catch (error) {
          documents.push({
            url: pdfUrl,
            success: false,
            error: error instanceof Error ? error.message : 'Failed to ingest PDF',
          });
          pdfsFailed++;
          failedPages++;
        }
      }

      // Map API credits: ~1 credit per 10 URLs discovered
      estimatedCredits += Math.ceil(mapResult.totalUrls / 10);
    }
  }

  // Crawl the website for web pages
  console.log('[Ingest] Starting website crawl:', url, options?.crawlOptions);
  const crawlResult = await crawlWebsite(url, options?.crawlOptions);

  if (!crawlResult.success) {
    // If we got some PDFs but crawl failed, return partial success
    if (pdfsIngested > 0) {
      return {
        baseUrl: url,
        success: true,
        totalPagesFound: pdfCount,
        successfulPages,
        failedPages,
        documents,
        error: crawlResult.error || 'Web page crawl failed, but PDFs were ingested',
        estimatedCredits,
        pdfCount,
        pdfsIngested,
        pdfsFailed,
      };
    }

    return {
      baseUrl: url,
      success: false,
      totalPagesFound: 0,
      successfulPages: 0,
      failedPages: 0,
      documents: [],
      error: crawlResult.error || 'Failed to crawl website',
      estimatedCredits: 0,
    };
  }

  // Ingest each crawled page as a separate document
  for (const page of crawlResult.pages) {
    if (page.content) {
      try {
        const content = formatWebContentForIngestion(page.url, page.content);
        const filename = generateFilenameFromUrl(page.url);
        const docName = filename.replace('.txt', '');

        const doc = await ingestTextContent(content, docName, uploadedBy, {
          categoryIds: options?.categoryIds,
          isGlobal: options?.isGlobal,
        });

        documents.push({
          url: page.url,
          success: true,
          documentId: doc.id,
          filename: doc.filename,
        });
        successfulPages++;
      } catch (error) {
        documents.push({
          url: page.url,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to ingest page',
        });
        failedPages++;
      }
    } else {
      documents.push({
        url: page.url,
        success: false,
        error: page.error || 'No content extracted from page',
      });
      failedPages++;
    }
  }

  // Calculate estimated credits (1 credit per 10 pages for crawl)
  estimatedCredits += Math.ceil(crawlResult.totalPages / 10);

  const totalPagesFound = crawlResult.totalPages + pdfCount;

  console.log('[Ingest] Website crawl complete:', {
    baseUrl: url,
    totalPages: totalPagesFound,
    webPages: crawlResult.totalPages,
    pdfs: pdfCount,
    successful: successfulPages,
    failed: failedPages,
    credits: estimatedCredits,
  });

  return {
    baseUrl: crawlResult.baseUrl,
    success: successfulPages > 0,
    totalPagesFound,
    successfulPages,
    failedPages,
    documents,
    estimatedCredits,
    pdfCount: pdfCount > 0 ? pdfCount : undefined,
    pdfsIngested: pdfsIngested > 0 ? pdfsIngested : undefined,
    pdfsFailed: pdfsFailed > 0 ? pdfsFailed : undefined,
  };
}
