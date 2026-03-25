/**
 * Admin - URL Ingestion API
 * POST /api/admin/documents/url - Ingest content from web URLs or YouTube
 * GET /api/admin/documents/url - Check URL ingestion availability
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { ingestUrls, ingestYouTubeUrl, getUrlIngestionStatus, ingestCrawledSite } from '@/lib/ingest';
import { isYouTubeUrl } from '@/lib/youtube';
import { isTavilyConfigured, mapWebsite } from '@/lib/tools/tavily';
import type { ApiError } from '@/types';

const MAX_URLS = 5;
const MAX_NAME_LENGTH = 255;
const PDF_WARNING_THRESHOLD = 25;

interface WebEntry {
  url: string;
  mode: 'page' | 'crawl';
  crawlOptions?: {
    limit?: number;
    selectPaths?: string[];
    excludePaths?: string[];
  };
}

interface UrlIngestionRequest {
  urls?: string[];
  youtubeUrl?: string;
  name?: string;
  categoryIds?: number[];
  isGlobal?: boolean;
  // Crawl-specific fields (legacy)
  crawlUrl?: string;
  crawlOptions?: {
    limit?: number;
    maxDepth?: number;
    selectPaths?: string[];
    excludePaths?: string[];
  };
  includePdfs?: boolean;
  // Unified entries format (new)
  entries?: WebEntry[];
  dryRun?: boolean;  // preview mode: map only, no ingestion
}

interface UrlIngestionResponse {
  results: Array<{
    url: string;
    success: boolean;
    documentId?: string;
    filename?: string;
    sourceType: 'youtube' | 'web' | 'crawl' | 'pdf';
    error?: string;
  }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
  // Crawl-specific response fields
  crawlInfo?: {
    baseUrl: string;
    totalPagesFound: number;
    pagesIngested: number;
    estimatedCredits: number;
    // PDF info
    pdfCount?: number;
    pdfsIngested?: number;
    pdfsFailed?: number;
  };
  // Preview/dry-run response
  preview?: {
    entries: Array<{
      url: string;
      mode: 'page' | 'crawl';
      estimatedPages: number;
      pdfCount: number;
      estimatedCredits: number;
      siteBlocked: boolean;  // map returned 0 — site likely blocks automated discovery
    }>;
    totals: {
      estimatedPages: number;
      pdfCount: number;
      estimatedCredits: number;
    };
    pdfWarning: boolean;
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json() as UrlIngestionRequest;
    const { urls, youtubeUrl, name, categoryIds, isGlobal, crawlUrl, crawlOptions, includePdfs, entries, dryRun } = body;

    // Validate name if provided
    if (name && name.length > MAX_NAME_LENGTH) {
      return NextResponse.json<ApiError>(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or less`, code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Handle single YouTube URL with custom name
    if (youtubeUrl) {
      if (!isYouTubeUrl(youtubeUrl)) {
        return NextResponse.json<ApiError>(
          { error: 'Invalid YouTube URL', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      try {
        const doc = await ingestYouTubeUrl(youtubeUrl, user.email, {
          categoryIds: categoryIds || [],
          isGlobal: isGlobal || false,
          customName: name,
        });

        return NextResponse.json<UrlIngestionResponse>({
          results: [{
            url: youtubeUrl,
            success: true,
            documentId: doc.id,
            filename: doc.filename,
            sourceType: 'youtube',
          }],
          summary: { total: 1, successful: 1, failed: 0 },
        }, { status: 202 });
      } catch (error) {
        return NextResponse.json<UrlIngestionResponse>({
          results: [{
            url: youtubeUrl,
            success: false,
            sourceType: 'youtube',
            error: error instanceof Error ? error.message : 'Failed to extract transcript',
          }],
          summary: { total: 1, successful: 0, failed: 1 },
        }, { status: 207 }); // Multi-status for partial success
      }
    }

    // Handle unified entries (new websites mode)
    if (entries && Array.isArray(entries) && entries.length > 0) {
      if (!isTavilyConfigured()) {
        return NextResponse.json<ApiError>(
          { error: 'Web ingestion requires Tavily API key. Configure in Settings > Web Search.', code: 'NOT_CONFIGURED' },
          { status: 400 }
        );
      }

      // --- DRY RUN: Map-only preview, no ingestion ---
      if (dryRun) {
        const previewEntries: NonNullable<UrlIngestionResponse['preview']>['entries'] = [];
        let totalPages = 0;
        let totalPdfs = 0;
        let totalCredits = 0;

        for (const entry of entries) {
          try {
            new URL(entry.url);
          } catch {
            previewEntries.push({ url: entry.url, mode: entry.mode, estimatedPages: 0, pdfCount: 0, estimatedCredits: 0, siteBlocked: false });
            continue;
          }

          if (entry.mode === 'crawl') {
            const mapResult = await mapWebsite(entry.url, {
              limit: (entry.crawlOptions?.limit ?? 50) * 2,
              selectPaths: entry.crawlOptions?.selectPaths,
              excludePaths: entry.crawlOptions?.excludePaths,
            });
            const pageLimit = entry.crawlOptions?.limit ?? 50;
            const pages = Math.min(mapResult.webUrls.length, pageLimit);
            const pdfs = mapResult.pdfUrls.length;
            const credits = mapResult.creditsUsed ?? Math.ceil(Math.max(mapResult.totalUrls, 1) / 10);
            const siteBlocked = mapResult.success && mapResult.totalUrls === 0;
            previewEntries.push({ url: entry.url, mode: 'crawl', estimatedPages: pages, pdfCount: pdfs, estimatedCredits: credits, siteBlocked });
            totalPages += pages;
            totalPdfs += pdfs;
            totalCredits += credits;
          } else {
            previewEntries.push({ url: entry.url, mode: 'page', estimatedPages: 1, pdfCount: 0, estimatedCredits: 0, siteBlocked: false });
            totalPages += 1;
          }
        }

        return NextResponse.json<UrlIngestionResponse>({
          results: [],
          summary: { total: 0, successful: 0, failed: 0 },
          preview: {
            entries: previewEntries,
            totals: { estimatedPages: totalPages, pdfCount: totalPdfs, estimatedCredits: totalCredits },
            pdfWarning: totalPdfs > PDF_WARNING_THRESHOLD,
          },
        }, { status: 200 });
      }

      // --- FULL INGESTION: process each entry ---
      const allResults: UrlIngestionResponse['results'] = [];
      let totalSuccessful = 0;
      let totalFailed = 0;
      let totalFound = 0;

      // Collect page-mode URLs for batched extraction
      const pageUrls: string[] = [];

      for (const entry of entries) {
        if (entry.mode === 'crawl') {
          try {
            new URL(entry.url);
          } catch {
            allResults.push({ url: entry.url, success: false, sourceType: 'web', error: 'Invalid URL format' });
            totalFailed++;
            continue;
          }

          const crawlResult = await ingestCrawledSite(entry.url, user.email, {
            categoryIds: categoryIds || [],
            isGlobal: isGlobal || false,
            crawlOptions: entry.crawlOptions ? {
              limit: entry.crawlOptions.limit,
              selectPaths: entry.crawlOptions.selectPaths,
              excludePaths: entry.crawlOptions.excludePaths,
            } : undefined,
            includePdfs: includePdfs || false,
          });

          for (const doc of crawlResult.documents) {
            allResults.push({
              url: doc.url,
              success: doc.success,
              documentId: doc.documentId,
              filename: doc.filename,
              sourceType: doc.url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'crawl',
              error: doc.error,
            });
            if (doc.success) totalSuccessful++; else totalFailed++;
          }
          totalFound += crawlResult.totalPagesFound;
        } else {
          pageUrls.push(entry.url);
        }
      }

      // Process page-mode URLs in batches of 5
      if (pageUrls.length > 0) {
        const pageResults = await ingestUrls(pageUrls, user.email, {
          categoryIds: categoryIds || [],
          isGlobal: isGlobal || false,
        });
        for (const r of pageResults) {
          allResults.push({
            url: r.url,
            success: r.success,
            documentId: r.document?.id,
            filename: r.document?.filename,
            sourceType: r.sourceType,
            error: r.error,
          });
          if (r.success) totalSuccessful++; else totalFailed++;
          totalFound++;
        }
      }

      const status = totalFailed === 0 ? 202 : totalSuccessful === 0 ? 400 : 207;
      return NextResponse.json<UrlIngestionResponse>({
        results: allResults,
        summary: { total: totalFound, successful: totalSuccessful, failed: totalFailed },
      }, { status });
    }

    // Handle website crawl
    if (crawlUrl) {
      // Validate URL format
      try {
        new URL(crawlUrl);
      } catch {
        return NextResponse.json<ApiError>(
          { error: 'Invalid crawl URL format', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      // Check if Tavily is configured
      if (!isTavilyConfigured()) {
        return NextResponse.json<ApiError>(
          { error: 'Website crawling requires Tavily API key. Configure in Settings > Web Search.', code: 'NOT_CONFIGURED' },
          { status: 400 }
        );
      }

      // Validate crawl options
      if (crawlOptions?.limit !== undefined) {
        if (crawlOptions.limit < 1 || crawlOptions.limit > 500) {
          return NextResponse.json<ApiError>(
            { error: 'Crawl limit must be between 1 and 500', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }
      }

      try {
        const crawlResult = await ingestCrawledSite(crawlUrl, user.email, {
          categoryIds: categoryIds || [],
          isGlobal: isGlobal || false,
          crawlOptions: crawlOptions ? {
            limit: crawlOptions.limit,
            maxDepth: crawlOptions.maxDepth,
            selectPaths: crawlOptions.selectPaths,
            excludePaths: crawlOptions.excludePaths,
          } : undefined,
          includePdfs: includePdfs || false,
        });

        const response: UrlIngestionResponse = {
          results: crawlResult.documents.map(doc => ({
            url: doc.url,
            success: doc.success,
            documentId: doc.documentId,
            filename: doc.filename,
            // Determine source type: PDF URLs end with .pdf
            sourceType: doc.url.toLowerCase().endsWith('.pdf') ? 'pdf' as const : 'crawl' as const,
            error: doc.error,
          })),
          summary: {
            total: crawlResult.totalPagesFound,
            successful: crawlResult.successfulPages,
            failed: crawlResult.failedPages,
          },
          crawlInfo: {
            baseUrl: crawlResult.baseUrl,
            totalPagesFound: crawlResult.totalPagesFound,
            pagesIngested: crawlResult.successfulPages,
            estimatedCredits: crawlResult.estimatedCredits,
            pdfCount: crawlResult.pdfCount,
            pdfsIngested: crawlResult.pdfsIngested,
            pdfsFailed: crawlResult.pdfsFailed,
          },
        };

        // Use appropriate status code
        const status = crawlResult.failedPages === 0 ? 202 :
                       crawlResult.successfulPages === 0 ? 400 : 207;

        return NextResponse.json(response, { status });
      } catch (error) {
        console.error('Website crawl error:', error);
        return NextResponse.json<ApiError>(
          {
            error: 'Failed to crawl website',
            code: 'SERVICE_ERROR',
            details: error instanceof Error ? error.message : undefined,
          },
          { status: 500 }
        );
      }
    }

    // Handle batch URLs (web and/or YouTube)
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json<ApiError>(
        { error: 'At least one URL is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (urls.length > MAX_URLS) {
      return NextResponse.json<ApiError>(
        { error: `Maximum ${MAX_URLS} URLs per batch`, code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate URL formats
    const invalidUrls: string[] = [];
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        if (!isYouTubeUrl(url)) {
          invalidUrls.push(url);
        }
      }
    }

    if (invalidUrls.length > 0) {
      return NextResponse.json<ApiError>(
        { error: `Invalid URL format: ${invalidUrls.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check if web URLs are present but Tavily not configured
    const hasWebUrls = urls.some(url => !isYouTubeUrl(url));
    if (hasWebUrls && !isTavilyConfigured()) {
      return NextResponse.json<ApiError>(
        { error: 'Web URL extraction requires Tavily API key. Configure in Settings > Web Search.', code: 'NOT_CONFIGURED' },
        { status: 400 }
      );
    }

    // Ingest all URLs
    const results = await ingestUrls(urls, user.email, {
      categoryIds: categoryIds || [],
      isGlobal: isGlobal || false,
    });

    const response: UrlIngestionResponse = {
      results: results.map(r => ({
        url: r.url,
        success: r.success,
        documentId: r.document?.id,
        filename: r.document?.filename,
        sourceType: r.sourceType,
        error: r.error,
      })),
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      },
    };

    // Use 207 Multi-Status if there are mixed results
    const status = response.summary.failed === 0 ? 202 :
                   response.summary.successful === 0 ? 400 : 207;

    return NextResponse.json(response, { status });
  } catch (error) {
    console.error('URL ingestion error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to ingest URLs',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Check URL ingestion availability
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const status = getUrlIngestionStatus();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json<ApiError>(
      { error: 'Failed to check status', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
