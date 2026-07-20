import { getWebSearchConfig } from '../db/compat/tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import { validateUrlIsPublic } from '../ssrf-guard';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';
import { numInRange } from '../tools';

// ============ URL Extract Types ============

export interface ExtractResult {
  url: string;
  success: boolean;
  content?: string;
  error?: string;
}

// ============ URL Crawl Types ============

export interface CrawlOptions {
  limit?: number;           // Total pages to process (default 50, max varies by plan)
  maxDepth?: number;        // 1-5, how deep to crawl from base URL
  maxBreadth?: number;      // 1-500, links per page level
  selectPaths?: string[];   // Regex patterns to include specific URL paths
  excludePaths?: string[];  // Regex patterns to exclude URL paths
  extractDepth?: 'basic' | 'advanced';
  format?: 'markdown' | 'text';
}

export interface CrawlPageResult {
  url: string;
  content?: string;
  error?: string;
}

export interface CrawlResult {
  baseUrl: string;
  success: boolean;
  pages: CrawlPageResult[];
  totalPages: number;
  creditsUsed?: number;
  error?: string;
}

// ============ URL Extract Functions ============

/**
 * Check if Tavily is configured (has API key)
 */
export async function isTavilyConfigured(): Promise<boolean> {
  const { config: settings } = await getWebSearchConfig();
  return !!(settings.apiKey || process.env.TAVILY_API_KEY);
}

export interface ExtractOptions {
  extractDepth?: 'basic' | 'advanced';
  format?: 'markdown' | 'text';
  query?: string;  // rerank chunks by relevance to this query
  chunksPerSource?: number;  // 1-5, only when query is provided
}

/**
 * Extract content from web URLs using Tavily Extract API
 * Supports batch extraction (up to 5 URLs per request for 1 credit)
 *
 * @param urls - Array of URLs to extract (max 5)
 * @param options - Optional extraction parameters
 * @returns Array of extraction results
 */
export async function extractWebContent(urls: string[], options?: ExtractOptions): Promise<ExtractResult[]> {
  // Validate input
  if (!urls || urls.length === 0) {
    return [];
  }

  if (urls.length > 5) {
    throw new Error('Maximum 5 URLs per batch');
  }

  // Validate URLs
  const validUrls: string[] = [];
  const results: ExtractResult[] = [];

  for (const url of urls) {
    try {
      new URL(url);
      validUrls.push(url);
    } catch {
      results.push({
        url,
        success: false,
        error: 'Invalid URL format',
      });
    }
  }

  if (validUrls.length === 0) {
    return results;
  }

  // Get API key
  const { config: settings } = await getWebSearchConfig();
  const apiKey = settings.apiKey || process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return urls.map(url => ({
      url,
      success: false,
      error: 'Tavily API key not configured. Set in Settings > Web Search.',
    }));
  }

  try {
    const extractDepth = options?.extractDepth ?? (settings.extractDepth as 'basic' | 'advanced') ?? 'advanced';
    const format = options?.format ?? (settings.extractFormat as 'markdown' | 'text') ?? 'markdown';

    const body: Record<string, unknown> = {
      urls: validUrls,
      extract_depth: extractDepth,
      format,
      include_usage: true,
    };
    if (options?.query) {
      body.query = options.query;
      if (options?.chunksPerSource) {
        body.chunks_per_source = options.chunksPerSource;
      }
    }

    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Tavily API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();

    // Process successful results
    if (data.results) {
      for (const result of data.results) {
        results.push({
          url: result.url,
          success: true,
          content: result.raw_content,
        });
      }
    }

    // Process failed results
    if (data.failed_results) {
      for (const failed of data.failed_results) {
        results.push({
          url: failed.url,
          success: false,
          error: failed.error || 'Failed to extract content',
        });
      }
    }

    // Check for any URLs that weren't in either results or failed_results
    for (const url of validUrls) {
      const found = results.some(r => r.url === url);
      if (!found) {
        results.push({
          url,
          success: false,
          error: 'No response from extraction service',
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Tavily Extract error:', error);

    // Return error for all valid URLs
    for (const url of validUrls) {
      const found = results.some(r => r.url === url);
      if (!found) {
        results.push({
          url,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      }
    }

    return results;
  }
}

// ============ URL Crawl Functions ============

/**
 * Crawl a website using Tavily Crawl API
 * Automatically discovers and extracts content from multiple pages starting from a base URL
 *
 * @param url - Base URL to start crawling from
 * @param options - Crawl configuration options
 * @returns CrawlResult with pages array containing content from each crawled page
 */
export async function crawlWebsite(url: string, options?: CrawlOptions): Promise<CrawlResult> {
  // Validate URL
  try {
    new URL(url);
  } catch {
    return {
      baseUrl: url,
      success: false,
      pages: [],
      totalPages: 0,
      error: 'Invalid URL format',
    };
  }

  // Get API key
  const { config: settings } = await getWebSearchConfig();
  const apiKey = settings.apiKey || process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      baseUrl: url,
      success: false,
      pages: [],
      totalPages: 0,
      error: 'Tavily API key not configured. Set in Settings > Web Search.',
    };
  }

  // Build request payload
  const payload: Record<string, unknown> = {
    url: url,
    limit: options?.limit ?? 50,
    max_depth: options?.maxDepth ?? 2,
    max_breadth: options?.maxBreadth ?? 20,
    extract_depth: options?.extractDepth ?? 'advanced',
    format: options?.format ?? 'markdown',
    allow_external: false,   // only crawl pages within the target domain
    include_usage: true,     // get actual credit usage in response
  };

  // Add optional path filters if provided
  if (options?.selectPaths && options.selectPaths.length > 0) {
    payload.select_paths = options.selectPaths;
  }
  if (options?.excludePaths && options.excludePaths.length > 0) {
    payload.exclude_paths = options.excludePaths;
  }

  try {
    console.log('Tavily Crawl: Starting crawl of', url, 'with options:', {
      limit: payload.limit,
      maxDepth: payload.max_depth,
      maxBreadth: payload.max_breadth,
      selectPaths: options?.selectPaths,
      excludePaths: options?.excludePaths,
    });

    const response = await fetch('https://api.tavily.com/crawl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.detail || `HTTP ${response.status}`;
      console.error('Tavily Crawl API error:', response.status, errorData);
      return {
        baseUrl: url,
        success: false,
        pages: [],
        totalPages: 0,
        error: `Tavily Crawl API error: ${errorMessage}`,
      };
    }

    const data = await response.json();

    // Debug: log raw response when results are empty
    if (!data.results || data.results.length === 0) {
      console.log('Tavily Crawl: Empty results for', url, '- response keys:', Object.keys(data));
    }

    // Process results from Tavily Crawl API
    // Response format: { base_url, results: [{ url, raw_content }], response_time }
    const pages: CrawlPageResult[] = [];

    if (data.results && Array.isArray(data.results)) {
      for (const result of data.results) {
        if (result.raw_content) {
          pages.push({
            url: result.url,
            content: result.raw_content,
          });
        } else {
          pages.push({
            url: result.url,
            error: 'No content extracted',
          });
        }
      }
    }

    const actualCredits = data.usage?.credits;
    console.log('Tavily Crawl: Completed crawl of', url, '- found', pages.length, 'pages', actualCredits != null ? `(${actualCredits} credits)` : '');

    return {
      baseUrl: data.base_url || url,
      success: true,
      pages,
      totalPages: pages.length,
      creditsUsed: actualCredits,
    };
  } catch (error) {
    console.error('Tavily Crawl error:', error);
    return {
      baseUrl: url,
      success: false,
      pages: [],
      totalPages: 0,
      error: error instanceof Error ? error.message : 'Unknown error occurred during crawl',
    };
  }
}

// ============ URL Map Functions ============

export interface MapOptions {
  limit?: number;           // Total URLs to discover (default 50)
  maxDepth?: number;        // 1-5, how deep to explore
  maxBreadth?: number;      // 1-500, links per page level
  selectPaths?: string[];   // Regex patterns to include
  excludePaths?: string[];  // Regex patterns to exclude
}

export interface MapResult {
  baseUrl: string;
  success: boolean;
  urls: string[];           // All discovered URLs
  pdfUrls: string[];        // URLs ending in .pdf
  webUrls: string[];        // Non-PDF URLs (web pages)
  totalUrls: number;
  creditsUsed?: number;
  error?: string;
}

/** Tavily enforces a 400-character max query length. */
const TAVILY_MAX_QUERY_LENGTH = 400;

/**
 * Map a website using Tavily Map API
 * Discovers all URLs on a website without extracting content
 * Useful for getting a site overview and finding PDF links
 *
 * @param url - Base URL to start mapping from
 * @param options - Map configuration options
 * @returns MapResult with arrays of discovered URLs
 */
export async function mapWebsite(url: string, options?: MapOptions): Promise<MapResult> {
  // Validate URL
  try {
    new URL(url);
  } catch {
    return {
      baseUrl: url,
      success: false,
      urls: [],
      pdfUrls: [],
      webUrls: [],
      totalUrls: 0,
      error: 'Invalid URL format',
    };
  }

  // Get API key
  const { config: settings } = await getWebSearchConfig();
  const apiKey = settings.apiKey || process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      baseUrl: url,
      success: false,
      urls: [],
      pdfUrls: [],
      webUrls: [],
      totalUrls: 0,
      error: 'Tavily API key not configured. Set in Settings > Web Search.',
    };
  }

  // Build request payload
  const payload: Record<string, unknown> = {
    url: url,
    limit: options?.limit ?? 100,
    max_depth: options?.maxDepth ?? 3,
    max_breadth: options?.maxBreadth ?? 50,
    allow_external: false,   // only map pages within the target domain
    include_usage: true,     // get actual credit usage in response
  };

  // Add optional path filters if provided
  if (options?.selectPaths && options.selectPaths.length > 0) {
    payload.select_paths = options.selectPaths;
  }
  if (options?.excludePaths && options.excludePaths.length > 0) {
    payload.exclude_paths = options.excludePaths;
  }

  try {
    console.log('Tavily Map: Starting map of', url);

    const response = await fetch('https://api.tavily.com/map', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.detail || `HTTP ${response.status}`;
      console.error('Tavily Map API error:', response.status, errorData);
      return {
        baseUrl: url,
        success: false,
        urls: [],
        pdfUrls: [],
        webUrls: [],
        totalUrls: 0,
        error: `Tavily Map API error: ${errorMessage}`,
      };
    }

    const data = await response.json();

    // Response format: { base_url, results: string[] }
    const urls: string[] = data.results || [];

    // Separate PDF URLs from web page URLs
    const pdfUrls: string[] = [];
    const webUrls: string[] = [];

    for (const discoveredUrl of urls) {
      const lowerUrl = discoveredUrl.toLowerCase();
      if (lowerUrl.endsWith('.pdf') || lowerUrl.includes('.pdf?') || lowerUrl.includes('.pdf#')) {
        pdfUrls.push(discoveredUrl);
      } else {
        webUrls.push(discoveredUrl);
      }
    }

    const actualCredits = data.usage?.credits;
    console.log('Tavily Map: Completed map of', url, '- found', urls.length, 'URLs (', pdfUrls.length, 'PDFs)', actualCredits != null ? `(${actualCredits} credits)` : '');

    return {
      baseUrl: data.base_url || url,
      success: true,
      urls,
      pdfUrls,
      webUrls,
      totalUrls: urls.length,
      creditsUsed: actualCredits,
    };
  } catch (error) {
    console.error('Tavily Map error:', error);
    return {
      baseUrl: url,
      success: false,
      urls: [],
      pdfUrls: [],
      webUrls: [],
      totalUrls: 0,
      error: error instanceof Error ? error.message : 'Unknown error occurred during map',
    };
  }
}

// ============ PDF Download Functions ============

export interface PdfDownloadResult {
  url: string;
  success: boolean;
  buffer?: Buffer;
  filename?: string;
  size?: number;
  error?: string;
}

/**
 * Download a PDF file from a URL
 * Returns the PDF as a Buffer for processing
 *
 * @param url - URL of the PDF to download
 * @returns PdfDownloadResult with buffer if successful
 */
export async function downloadPdfFromUrl(url: string): Promise<PdfDownloadResult> {
  try {
    // Validate URL
    const urlObj = new URL(url);

    // SSRF guard: block private/internal IP ranges
    await validateUrlIsPublic(url).catch((err) => {
      throw new Error(`SSRF guard rejected URL: ${err.message}`);
    });

    console.log('Downloading PDF:', url);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIAssistant/1.0)',
        'Accept': 'application/pdf,*/*',
      },
    });

    if (!response.ok) {
      return {
        url,
        success: false,
        error: `HTTP ${response.status}: Failed to download PDF`,
      };
    }

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/pdf') && !url.toLowerCase().endsWith('.pdf')) {
      return {
        url,
        success: false,
        error: `Not a PDF file (content-type: ${contentType})`,
      };
    }

    // Get the PDF as ArrayBuffer and convert to Buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate filename from URL
    let filename = urlObj.pathname.split('/').pop() || 'document.pdf';
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }
    // Clean filename
    filename = filename.replace(/[^a-zA-Z0-9.-_]/g, '-').slice(0, 200);

    console.log('Downloaded PDF:', filename, '- size:', buffer.length, 'bytes');

    return {
      url,
      success: true,
      buffer,
      filename,
      size: buffer.length,
    };
  } catch (error) {
    console.error('PDF download error:', url, error);
    return {
      url,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error downloading PDF',
    };
  }
}

/**
 * Format extracted web content for document ingestion
 */
export function formatWebContentForIngestion(url: string, content: string): string {
  const urlObj = new URL(url);

  const lines: string[] = [];
  lines.push('Source: Web Page');
  lines.push(`URL: ${url}`);
  lines.push(`Domain: ${urlObj.hostname}`);
  lines.push(`Extracted: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(content);

  return lines.join('\n');
}

/**
 * Generate a filename from a URL
 */
export function generateFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname
      .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
      .replace(/\//g, '-') // Replace slashes with hyphens
      .replace(/[^a-zA-Z0-9-_]/g, '') // Remove invalid characters
      .slice(0, 50); // Limit length

    const hostname = urlObj.hostname.replace(/^www\./, '');
    const timestamp = Date.now();

    return `web-${timestamp}-${hostname}${pathname ? `-${pathname}` : ''}.txt`;
  } catch {
    return `web-${Date.now()}.txt`;
  }
}

/**
 * Web Search configuration schema for admin UI
 */
const webSearchConfigSchema = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      title: 'API Key',
      description: 'Tavily API key (get from https://tavily.com)',
      format: 'password',
    },
    // ── Endpoint enable toggles ──
    extractEnabled: {
      type: 'boolean',
      title: 'Enable Extract',
      description: 'Allow the LLM to extract content from specific URLs',
      default: true,
    },
    crawlEnabled: {
      type: 'boolean',
      title: 'Enable Crawl',
      description: 'Allow the LLM to crawl and explore websites',
      default: true,
    },
    mapEnabled: {
      type: 'boolean',
      title: 'Enable Map',
      description: 'Allow the LLM to discover URLs on websites',
      default: true,
    },
    // ── Search defaults ──
    defaultTopic: {
      type: 'string',
      title: 'Default Topic',
      description: 'Search topic category',
      enum: ['general', 'news', 'finance'],
      default: 'general',
    },
    defaultSearchDepth: {
      type: 'string',
      title: 'Search Depth',
      description: 'Ultra-fast = lowest latency, Fast = low latency with chunks, Basic = balanced, Advanced = highest relevance (2 credits)',
      enum: ['basic', 'advanced', 'fast', 'ultra-fast'],
      default: 'advanced',
    },
    maxResults: {
      type: 'number',
      title: 'Max Results',
      description: 'Maximum results per query (1-20)',
      minimum: 1,
      maximum: 20,
      default: 10,
    },
    includeDomains: {
      type: 'array',
      title: 'Include Domains',
      description: 'Only search these domains (comma-separated)',
      items: { type: 'string' },
      default: [],
    },
    excludeDomains: {
      type: 'array',
      title: 'Exclude Domains',
      description: 'Never search these domains (comma-separated)',
      items: { type: 'string' },
      default: [],
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache search results',
      minimum: 60,
      maximum: 2592000,
      default: 3600,
    },
    includeAnswer: {
      type: 'string',
      title: 'Include AI Answer',
      description: 'Include AI-generated summary: none (disabled), basic (quick), or advanced (comprehensive)',
      enum: ['none', 'basic', 'advanced'],
      default: 'basic',
    },
    includeRawContent: {
      type: 'string',
      title: 'Include Raw Content',
      description: 'Include full page content: none (disabled), markdown, or text',
      enum: ['none', 'markdown', 'text'],
      default: 'none',
    },
    includeImages: {
      type: 'boolean',
      title: 'Include Images',
      description: 'Include images in search results',
      default: false,
    },
    includeImageDescriptions: {
      type: 'boolean',
      title: 'Include Image Descriptions',
      description: 'Include descriptions for images (only when includeImages is true)',
      default: false,
    },
    includeFavicon: {
      type: 'boolean',
      title: 'Include Favicon',
      description: 'Include favicon URL for each result',
      default: false,
    },
    exactMatch: {
      type: 'boolean',
      title: 'Exact Match',
      description: 'Only return results containing exact quoted phrases in the query',
      default: false,
    },
    autoParameters: {
      type: 'boolean',
      title: 'Auto Parameters',
      description: 'Let Tavily auto-configure search parameters (may increase cost/latency)',
      default: false,
    },
    timeRange: {
      type: 'string',
      title: 'Time Range Filter',
      description: 'Restrict results to recency: none, day, week, month, or year',
      enum: ['none', 'day', 'week', 'month', 'year'],
      default: 'none',
    },
    country: {
      type: 'string',
      title: 'Country Boost',
      description: 'Full country name to boost results from (e.g., United States, Japan, Germany)',
      default: '',
    },
    // ── Extract defaults ──
    extractDepth: {
      type: 'string',
      title: 'Extract Depth',
      description: 'Basic = faster (1 credit/5 URLs), Advanced = includes tables and embedded content (2 credits/5 URLs)',
      enum: ['basic', 'advanced'],
      default: 'advanced',
    },
    extractFormat: {
      type: 'string',
      title: 'Extract Format',
      description: 'Output format for extracted content',
      enum: ['markdown', 'text'],
      default: 'markdown',
    },
    // ── Crawl defaults ──
    crawlLimit: {
      type: 'number',
      title: 'Crawl Page Limit',
      description: 'Total pages to process per crawl (1+)',
      minimum: 1,
      default: 50,
    },
    crawlMaxDepth: {
      type: 'number',
      title: 'Crawl Max Depth',
      description: 'How deep to crawl from base URL (1-5)',
      minimum: 1,
      maximum: 5,
      default: 2,
    },
    crawlMaxBreadth: {
      type: 'number',
      title: 'Crawl Max Breadth',
      description: 'Max links to follow per page level (1-500)',
      minimum: 1,
      maximum: 500,
      default: 20,
    },
    crawlExtractDepth: {
      type: 'string',
      title: 'Crawl Extract Depth',
      description: 'Content extraction depth for crawled pages',
      enum: ['basic', 'advanced'],
      default: 'advanced',
    },
    crawlFormat: {
      type: 'string',
      title: 'Crawl Format',
      description: 'Output format for crawled content',
      enum: ['markdown', 'text'],
      default: 'markdown',
    },
    crawlAllowExternal: {
      type: 'boolean',
      title: 'Crawl External Links',
      description: 'Whether to include external domain links in crawl results',
      default: false,
    },
    // ── Map defaults ──
    mapLimit: {
      type: 'number',
      title: 'Map URL Limit',
      description: 'Total URLs to discover per map (1+)',
      minimum: 1,
      default: 100,
    },
    mapMaxDepth: {
      type: 'number',
      title: 'Map Max Depth',
      description: 'How deep to explore from base URL (1-5)',
      minimum: 1,
      maximum: 5,
      default: 3,
    },
    mapMaxBreadth: {
      type: 'number',
      title: 'Map Max Breadth',
      description: 'Max links to follow per page level (1-500)',
      minimum: 1,
      maximum: 500,
      default: 50,
    },
    mapAllowExternal: {
      type: 'boolean',
      title: 'Map External Links',
      description: 'Whether to include external domain links in map results',
      default: false,
    },
  },
  required: ['defaultTopic', 'defaultSearchDepth', 'maxResults', 'cacheTTLSeconds'],
};

/**
 * Validate web search configuration
 */
function validateWebSearchConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate defaultTopic
  if (config.defaultTopic && !['general', 'news', 'finance'].includes(config.defaultTopic as string)) {
    errors.push('defaultTopic must be one of: general, news, finance');
  }

  // Validate defaultSearchDepth (now includes fast and ultra-fast)
  if (config.defaultSearchDepth && !['basic', 'advanced', 'fast', 'ultra-fast'].includes(config.defaultSearchDepth as string)) {
    errors.push('defaultSearchDepth must be one of: basic, advanced, fast, ultra-fast');
  }

  // Validate maxResults
  if (config.maxResults !== undefined) {
    if (!numInRange(config.maxResults, 1, 20)) {
      errors.push('maxResults must be a number between 1 and 20');
    }
  }

  // Validate includeAnswer
  if (config.includeAnswer !== undefined) {
    const validValues = ['none', 'basic', 'advanced'];
    if (!validValues.includes(config.includeAnswer as string)) {
      errors.push('includeAnswer must be one of: none, basic, advanced');
    }
  }

  // Validate cacheTTLSeconds
  if (config.cacheTTLSeconds !== undefined) {
    if (!numInRange(config.cacheTTLSeconds, 60, 2592000)) {
      errors.push('cacheTTLSeconds must be a number between 60 and 2592000');
    }
  }

  // Validate arrays
  if (config.includeDomains && !Array.isArray(config.includeDomains)) {
    errors.push('includeDomains must be an array');
  }
  if (config.excludeDomains && !Array.isArray(config.excludeDomains)) {
    errors.push('excludeDomains must be an array');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Tavily web search tool implementation
 * Provides web search capabilities with Redis caching
 */
export const tavilyWebSearch: ToolDefinition = {
  name: 'web_search',
  displayName: 'Web Search',
  description: 'Search the web for current information, news, or data not available in the organizational knowledge base.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information, news, or data not available in the organizational knowledge base. Use when internal documents do not contain the answer or when user asks about recent events or current data.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to find relevant web information',
          },
          max_results: {
            type: 'number',
            description: 'Number of results (1-20). Use higher values for comprehensive research, lower for quick facts. Defaults to admin setting if not specified.',
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced', 'fast', 'ultra-fast'],
            description: 'Search depth: "ultra-fast" = lowest latency (1 credit), "fast" = low latency with chunks (1 credit), "basic" = balanced (1 credit), "advanced" = highest relevance (2 credits). Defaults to admin setting.',
          },
          include_answer: {
            type: 'string',
            enum: ['none', 'basic', 'advanced'],
            description: 'Include AI-generated answer: "none" = disabled, "basic" = quick summary, "advanced" = comprehensive analysis. Defaults to admin setting.',
          },
          topic: {
            type: 'string',
            enum: ['general', 'news', 'finance'],
            description: 'Search category: "general" for broad searches, "news" for current events, "finance" for financial data. Defaults to admin setting.',
          },
          time_range: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description: 'Filter results by recency. Defaults to admin setting.',
          },
          start_date: {
            type: 'string',
            description: 'Return results published after this date (YYYY-MM-DD format).',
          },
          end_date: {
            type: 'string',
            description: 'Return results published before this date (YYYY-MM-DD format).',
          },
          include_raw_content: {
            type: 'string',
            enum: ['none', 'markdown', 'text'],
            description: 'Include full page content: "none" = disabled, "markdown" = formatted, "text" = plain text. Defaults to admin setting.',
          },
          include_images: {
            type: 'boolean',
            description: 'Include image results in the response. Defaults to admin setting.',
          },
          include_image_descriptions: {
            type: 'boolean',
            description: 'Include descriptions for images (only when include_images is true).',
          },
          include_favicon: {
            type: 'boolean',
            description: 'Include favicon URL for each result. Defaults to admin setting.',
          },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only include results from these domains (e.g., ["example.com", "gov.uk"]). Overrides admin defaults.',
          },
          exclude_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exclude results from these domains. Overrides admin defaults.',
          },
          country: {
            type: 'string',
            description: 'Boost results from a specific country (full name, e.g., "United States", "Japan"). Defaults to admin setting.',
          },
          auto_parameters: {
            type: 'boolean',
            description: 'Let Tavily auto-configure search parameters based on query intent. May increase cost/latency.',
          },
          exact_match: {
            type: 'boolean',
            description: 'Only return results containing exact quoted phrases from the query.',
          },
          chunks_per_source: {
            type: 'number',
            description: 'Number of content chunks per source (1-3). Only effective with search_depth="advanced".',
          },
        },
        required: ['query'],
      },
    },
  },

  validateConfig: validateWebSearchConfig,

  defaultConfig: {
    apiKey: '',
    defaultTopic: 'general',
    defaultSearchDepth: 'advanced',
    maxResults: 10,
    includeDomains: [],
    excludeDomains: [],
    cacheTTLSeconds: 3600,
    includeAnswer: 'basic',
    includeRawContent: 'none',
    includeImages: false,
    includeImageDescriptions: false,
    includeFavicon: false,
    exactMatch: false,
    autoParameters: false,
    timeRange: 'none',
    country: '',
    extractEnabled: true,
    crawlEnabled: true,
    mapEnabled: true,
    extractDepth: 'advanced',
    extractFormat: 'markdown',
    crawlLimit: 50,
    crawlMaxDepth: 2,
    crawlMaxBreadth: 20,
    crawlExtractDepth: 'advanced',
    crawlFormat: 'markdown',
    crawlAllowExternal: false,
    mapLimit: 100,
    mapMaxDepth: 3,
    mapMaxBreadth: 50,
    mapAllowExternal: false,
  },

  configSchema: webSearchConfigSchema,

  execute: async (
    args: {
      query: string;
      max_results?: number;
      search_depth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
      include_answer?: 'none' | 'basic' | 'advanced';
      topic?: 'general' | 'news' | 'finance';
      time_range?: 'day' | 'week' | 'month' | 'year';
      start_date?: string;
      end_date?: string;
      include_raw_content?: 'none' | 'markdown' | 'text';
      include_images?: boolean;
      include_image_descriptions?: boolean;
      include_favicon?: boolean;
      include_domains?: string[];
      exclude_domains?: string[];
      country?: string;
      auto_parameters?: boolean;
      exact_match?: boolean;
      chunks_per_source?: number;
    },
    options?: ToolExecutionOptions
  ) => {
    // Get config from unified tool_configs table (with fallback to settings table)
    const { enabled, config: globalSettings } = await getWebSearchConfig();

    // Merge skill-level config override with global settings (override wins)
    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride };

    // Check settings first, fall back to environment variable
    const apiKey = settings.apiKey || process.env.TAVILY_API_KEY;

    // Check if web search is enabled
    if (!enabled) {
      return JSON.stringify({
        error: 'Web search is currently disabled',
        errorCode: 'TOOL_DISABLED',
        results: [],
      });
    }

    if (!apiKey) {
      return JSON.stringify({
        error: 'Web search not configured - please set API key in admin settings',
        errorCode: 'NOT_CONFIGURED',
        results: [],
      });
    }

    // Resolve parameters: LLM args > admin default > hardcoded fallback
    const maxResults = Math.min(
      args.max_results ?? settings.maxResults ?? 10,
      20  // Tavily API hard cap
    );
    const searchDepth = args.search_depth ?? settings.defaultSearchDepth ?? 'basic';

    // Handle include_answer: 'none' maps to false for API, 'basic'/'advanced' pass through
    let includeAnswer: false | 'basic' | 'advanced' = false;
    if (args.include_answer !== undefined) {
      includeAnswer = args.include_answer === 'none' ? false : args.include_answer;
    } else if (settings.includeAnswer !== undefined) {
      includeAnswer = settings.includeAnswer === 'none' ? false : (settings.includeAnswer as 'basic' | 'advanced');
    }

    // Resolve topic: LLM arg > admin setting > 'general'
    const topic = args.topic ?? (settings.defaultTopic as string) ?? 'general';

    // Resolve domain filters: LLM args override admin settings
    const includeDomains = args.include_domains ?? (settings.includeDomains as string[]) ?? [];
    const excludeDomains = args.exclude_domains ?? (settings.excludeDomains as string[]) ?? [];

    // Resolve other parameters: LLM arg > admin setting
    const includeRawContent = args.include_raw_content ?? (settings.includeRawContent as string) ?? 'none';
    const autoParameters = args.auto_parameters ?? (settings.autoParameters as boolean) ?? false;
    const timeRange = args.time_range ?? (settings.timeRange as string) ?? 'none';
    const country = args.country ?? (settings.country as string) ?? '';
    const includeImages = args.include_images ?? (settings.includeImages as boolean) ?? false;
    const includeImageDescriptions = args.include_image_descriptions ?? (settings.includeImageDescriptions as boolean) ?? false;
    const includeFavicon = args.include_favicon ?? (settings.includeFavicon as boolean) ?? false;
    const exactMatch = args.exact_match ?? (settings.exactMatch as boolean) ?? false;
    const chunksPerSource = args.chunks_per_source;

    // Check Redis cache first
    const domainKey = includeDomains.length > 0 || excludeDomains.length > 0
      ? `:inc=${includeDomains.join(',')}:exc=${excludeDomains.join(',')}`
      : '';
    const cacheKey = hashQuery(`${args.query}:${maxResults}:${searchDepth}:${includeAnswer}${domainKey}:${includeRawContent}:${timeRange}:${country}:${includeImages}:${exactMatch}`);
    const cached = await getCachedQuery(`tavily:${cacheKey}`);

    if (cached) {
      console.log('Web search cache hit:', args.query);
      return cached;
    }

    // Cache miss - call Tavily API
    console.log('Web search cache miss - calling Tavily:', args.query, {
      maxResults,
      searchDepth,
      includeAnswer,
      topic,
      includeRawContent,
      autoParameters,
      timeRange,
      country,
      includeImages,
      includeFavicon,
      exactMatch,
      includeDomains: includeDomains.length > 0 ? includeDomains : undefined,
      excludeDomains: excludeDomains.length > 0 ? excludeDomains : undefined,
    });

    // Tavily rejects queries longer than 400 characters
    let query = args.query;
    if (query.length > TAVILY_MAX_QUERY_LENGTH) {
      console.warn(`[Tavily] Query truncated from ${query.length} to ${TAVILY_MAX_QUERY_LENGTH} chars. Original: ${query.slice(0, 80)}...`);
      query = query.slice(0, TAVILY_MAX_QUERY_LENGTH);
    }

    // Build Tavily request payload
    const payload: Record<string, unknown> = {
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      topic,
      include_answer: includeAnswer,
      include_domains: includeDomains.length > 0 ? includeDomains : undefined,
      exclude_domains: excludeDomains.length > 0 ? excludeDomains : undefined,
    };

    // Add optional parameters if not default
    if (includeRawContent !== 'none') payload.include_raw_content = includeRawContent;
    if (autoParameters) payload.auto_parameters = true;
    if (timeRange !== 'none') payload.time_range = timeRange;
    if (country) payload.country = country;
    if (includeImages) payload.include_images = true;
    if (includeImageDescriptions) payload.include_image_descriptions = true;
    if (includeFavicon) payload.include_favicon = true;
    if (exactMatch) payload.exact_match = true;
    if (args.start_date) payload.start_date = args.start_date;
    if (args.end_date) payload.end_date = args.end_date;
    if (chunksPerSource && searchDepth === 'advanced') payload.chunks_per_source = chunksPerSource;

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status}`);
      }

      const data = await response.json();
      const resultString = JSON.stringify(data, null, 2);

      // Cache the result
      await cacheQuery(`tavily:${cacheKey}`, resultString, settings.cacheTTLSeconds);

      return resultString;
    } catch (error) {
      console.error('Tavily API error:', error);
      return JSON.stringify({
        error: 'Web search temporarily unavailable',
        errorCode: 'API_ERROR',
        results: [],
      });
    }
  },
};

// ============ Web Extract Tool ============

/**
 * Web Extract tool — extracts full content from specific URLs
 * Wraps the existing extractWebContent() function
 */
export const tavilyWebExtract: ToolDefinition = {
  name: 'web_extract',
  displayName: 'Web Extract',
  description: 'Extract and read the full content from specific web pages.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'web_extract',
      description: 'Extract the full content of one or more web pages. Use when you need to read a specific article, page, or document at a known URL. Supports up to 5 URLs per call. Best for: reading known articles, fetching specific documents, extracting content from URLs found in search results.',
      parameters: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of URLs to extract content from (max 5)',
          },
          extract_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'basic = faster (1 credit per 5 URLs), advanced = more data including tables and embedded content (2 credits per 5 URLs). Defaults to admin setting.',
          },
          query: {
            type: 'string',
            description: 'Optional: rerank extracted content chunks by relevance to this query for more focused results.',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'text'],
            description: 'Output format for extracted content. markdown preferred for readability. Defaults to admin setting.',
          },
        },
        required: ['urls'],
      },
    },
  },

  defaultConfig: {},

  validateConfig: () => ({ valid: true, errors: [] }),

  configSchema: { type: 'object', properties: {} },

  execute: async (args: {
    urls: string[];
    extract_depth?: 'basic' | 'advanced';
    query?: string;
    format?: 'markdown' | 'text';
  }) => {
    // Reuses existing extractWebContent() function, passing LLM args through
    const results = await extractWebContent(args.urls, {
      extractDepth: args.extract_depth,
      format: args.format,
      query: args.query,
    });
    return JSON.stringify(results);
  },
};

// ============ Web Crawl Tool ============

/**
 * Web Crawl tool — discovers and extracts content from multiple pages starting from a base URL
 * Wraps the existing crawlWebsite() function
 */
export const tavilyWebCrawl: ToolDefinition = {
  name: 'web_crawl',
  displayName: 'Web Crawl',
  description: 'Crawl a website to discover and extract content from multiple pages.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'web_crawl',
      description: 'Crawl a website starting from a URL. Automatically discovers and extracts content from multiple pages. Use for: exploring documentation sites, researching company websites, gathering content from blogs or knowledge bases, discovering all relevant pages on a domain.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Base URL to start crawling (e.g., https://docs.example.com)',
          },
          instructions: {
            type: 'string',
            description: 'Natural language instructions for what content to find (e.g., "Find all pages about API authentication")',
          },
          max_depth: {
            type: 'number',
            description: 'How deep to crawl from base URL (1-5). Higher = more pages but slower. Defaults to admin setting.',
            minimum: 1,
            maximum: 5,
          },
          max_breadth: {
            type: 'number',
            description: 'Max links to follow per page level (1-500). Defaults to admin setting.',
            minimum: 1,
            maximum: 500,
          },
          limit: {
            type: 'number',
            description: 'Total number of pages to process before stopping. Defaults to admin setting.',
          },
          select_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Regex patterns to include only specific URL paths (e.g., ["/docs/.*", "/api/.*"])',
          },
          select_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Regex patterns to restrict crawling to specific domains (e.g., ["^docs\\\\.example\\\\.com$"])',
          },
          extract_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'basic = faster extraction, advanced = includes tables and embedded content. Defaults to admin setting.',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'text'],
            description: 'Output format for extracted content. Defaults to admin setting.',
          },
        },
        required: ['url'],
      },
    },
  },

  defaultConfig: {},

  validateConfig: () => ({ valid: true, errors: [] }),

  configSchema: { type: 'object', properties: {} },

  execute: async (args: {
    url: string;
    instructions?: string;
    max_depth?: number;
    max_breadth?: number;
    limit?: number;
    select_paths?: string[];
    select_domains?: string[];
    extract_depth?: 'basic' | 'advanced';
    format?: 'markdown' | 'text';
  }) => {
    const { config: settings } = await getWebSearchConfig();
    const result = await crawlWebsite(args.url, {
      limit: args.limit ?? (settings.crawlLimit as number),
      maxDepth: args.max_depth ?? (settings.crawlMaxDepth as number),
      maxBreadth: args.max_breadth ?? (settings.crawlMaxBreadth as number),
      selectPaths: args.select_paths,
      extractDepth: args.extract_depth ?? (settings.crawlExtractDepth as 'basic' | 'advanced'),
      format: args.format ?? (settings.crawlFormat as 'markdown' | 'text'),
    });
    return JSON.stringify(result);
  },
};

// ============ Web Map Tool ============

/**
 * Web Map tool — discovers all URLs on a website without extracting content
 * Wraps the existing mapWebsite() function
 */
export const tavilyWebMap: ToolDefinition = {
  name: 'web_map',
  displayName: 'Web Map',
  description: 'Discover all URLs on a website without extracting their content.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'web_map',
      description: 'Map a website to discover all URLs without extracting content. Returns a list of all discovered URLs, separated into web pages and PDF documents. Use for: getting a site overview before crawling, finding PDF documents on a site, understanding site structure, discovering all pages under a specific path.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Base URL to start mapping (e.g., https://example.com)',
          },
          instructions: {
            type: 'string',
            description: 'Natural language instructions for what URLs to find (e.g., "Find all documentation pages")',
          },
          max_depth: {
            type: 'number',
            description: 'How deep to explore from base URL (1-5). Defaults to admin setting.',
            minimum: 1,
            maximum: 5,
          },
          limit: {
            type: 'number',
            description: 'Total number of URLs to discover before stopping. Defaults to admin setting.',
          },
          select_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Regex patterns to include only specific URL paths (e.g., ["/docs/.*"])',
          },
        },
        required: ['url'],
      },
    },
  },

  defaultConfig: {},

  validateConfig: () => ({ valid: true, errors: [] }),

  configSchema: { type: 'object', properties: {} },

  execute: async (args: {
    url: string;
    instructions?: string;
    max_depth?: number;
    limit?: number;
    select_paths?: string[];
  }) => {
    const { config: settings } = await getWebSearchConfig();
    const result = await mapWebsite(args.url, {
      limit: args.limit ?? (settings.mapLimit as number),
      maxDepth: args.max_depth ?? (settings.mapMaxDepth as number),
      selectPaths: args.select_paths,
    });
    return JSON.stringify(result);
  },
};
