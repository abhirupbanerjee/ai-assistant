/**
 * Super User - URL Ingestion API
 * POST /api/superuser/documents/url - Ingest content from web URLs or YouTube to assigned category
 * GET /api/superuser/documents/url - Check URL ingestion availability
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getCategoryById } from '@/lib/db/compat';
import { ingestUrls, ingestYouTubeUrl, getUrlIngestionStatus, ingestCrawledSite } from '@/lib/ingest';
import { isYouTubeUrl } from '@/lib/youtube';
import { isTavilyConfigured } from '@/lib/tools/tavily';

const MAX_URLS = 5;
const MAX_NAME_LENGTH = 255;

interface UrlIngestionRequest {
  urls?: string[];
  youtubeUrl?: string;
  name?: string;
  categoryId?: number;
  // Crawl-specific fields
  crawlUrl?: string;
  crawlOptions?: {
    limit?: number;
    maxDepth?: number;
    selectPaths?: string[];
    excludePaths?: string[];
  };
  includePdfs?: boolean;  // Include PDF files discovered during crawl
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
  category?: {
    categoryId: number;
    categoryName: string;
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
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get super user's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData || superUserData.assignedCategories.length === 0) {
      return NextResponse.json(
        { error: 'No categories assigned to you' },
        { status: 403 }
      );
    }

    const body = await request.json() as UrlIngestionRequest;
    const { urls, youtubeUrl, name, categoryId, crawlUrl, crawlOptions, includePdfs } = body;

    // Validate category ID (required for super users)
    if (!categoryId || typeof categoryId !== 'number') {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    // Verify super user has access to this category
    const hasAccess = superUserData.assignedCategories.some(c => c.categoryId === categoryId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to upload to this category' },
        { status: 403 }
      );
    }

    // Verify category exists
    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Validate name if provided
    if (name && name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or less` },
        { status: 400 }
      );
    }

    // Handle single YouTube URL with custom name
    if (youtubeUrl) {
      if (!isYouTubeUrl(youtubeUrl)) {
        return NextResponse.json(
          { error: 'Invalid YouTube URL' },
          { status: 400 }
        );
      }

      try {
        const doc = await ingestYouTubeUrl(youtubeUrl, user.email, {
          categoryIds: [categoryId],
          isGlobal: false, // Super users cannot create global documents
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
          category: { categoryId: category.id, categoryName: category.name },
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
          category: { categoryId: category.id, categoryName: category.name },
        }, { status: 207 });
      }
    }

    // Handle website crawl
    if (crawlUrl) {
      // Validate URL format
      try {
        new URL(crawlUrl);
      } catch {
        return NextResponse.json(
          { error: 'Invalid crawl URL format' },
          { status: 400 }
        );
      }

      // Check if Tavily is configured
      if (!isTavilyConfigured()) {
        return NextResponse.json(
          { error: 'Website crawling is not available. Contact administrator.' },
          { status: 400 }
        );
      }

      // Validate crawl options
      if (crawlOptions?.limit !== undefined) {
        if (crawlOptions.limit < 1 || crawlOptions.limit > 500) {
          return NextResponse.json(
            { error: 'Crawl limit must be between 1 and 500' },
            { status: 400 }
          );
        }
      }

      try {
        const crawlResult = await ingestCrawledSite(crawlUrl, user.email, {
          categoryIds: [categoryId], // Super users upload to single category
          isGlobal: false, // Super users cannot create global documents
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
          category: { categoryId: category.id, categoryName: category.name },
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
        return NextResponse.json(
          {
            error: 'Failed to crawl website',
            details: error instanceof Error ? error.message : undefined,
          },
          { status: 500 }
        );
      }
    }

    // Handle batch URLs (web and/or YouTube)
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: 'At least one URL is required' },
        { status: 400 }
      );
    }

    if (urls.length > MAX_URLS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_URLS} URLs per batch` },
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
      return NextResponse.json(
        { error: `Invalid URL format: ${invalidUrls.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if web URLs are present but Tavily not configured
    const hasWebUrls = urls.some(url => !isYouTubeUrl(url));
    if (hasWebUrls && !isTavilyConfigured()) {
      return NextResponse.json(
        { error: 'Web URL extraction is not available. Contact administrator.' },
        { status: 400 }
      );
    }

    // Ingest all URLs (super users cannot create global documents)
    const results = await ingestUrls(urls, user.email, {
      categoryIds: [categoryId],
      isGlobal: false,
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
      category: { categoryId: category.id, categoryName: category.name },
    };

    // Use 207 Multi-Status if there are mixed results
    const status = response.summary.failed === 0 ? 202 :
                   response.summary.successful === 0 ? 400 : 207;

    return NextResponse.json(response, { status });
  } catch (error) {
    console.error('URL ingestion error:', error);
    return NextResponse.json(
      {
        error: 'Failed to ingest URLs',
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = getUrlIngestionStatus();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
