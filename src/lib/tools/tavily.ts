import { getWebSearchConfig } from '../db/compat/tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

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

/**
 * Extract content from web URLs using Tavily Extract API
 * Supports batch extraction (up to 5 URLs per request for 1 credit)
 *
 * @param urls - Array of URLs to extract (max 5)
 * @returns Array of extraction results
 */
export async function extractWebContent(urls: string[]): Promise<ExtractResult[]> {
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
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        urls: validUrls,
        extract_depth: 'advanced',
        format: 'markdown',
        include_usage: true,
      }),
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

    console.log('Downloading PDF:', url);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PolicyBot/1.0)',
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
      description: 'Basic = quick (3-5 results), Advanced = comprehensive (10+ results)',
      enum: ['basic', 'advanced'],
      default: 'basic',
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

  // Validate defaultSearchDepth
  if (config.defaultSearchDepth && !['basic', 'advanced'].includes(config.defaultSearchDepth as string)) {
    errors.push('defaultSearchDepth must be one of: basic, advanced');
  }

  // Validate maxResults
  if (config.maxResults !== undefined) {
    const maxResults = config.maxResults as number;
    if (typeof maxResults !== 'number' || maxResults < 1 || maxResults > 20) {
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
    const cacheTTL = config.cacheTTLSeconds as number;
    if (typeof cacheTTL !== 'number' || cacheTTL < 60 || cacheTTL > 2592000) {
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
            enum: ['basic', 'advanced'],
            description: 'Search depth: "basic" for quick searches (3-5 results), "advanced" for thorough research (10+ results). Defaults to admin setting.',
          },
          include_answer: {
            type: 'string',
            enum: ['none', 'basic', 'advanced'],
            description: 'Include AI-generated answer: "none" = disabled, "basic" = quick summary, "advanced" = comprehensive analysis. Defaults to admin setting.',
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
    includeAnswer: 'basic',  // 'false' | 'basic' | 'advanced'
  },

  configSchema: webSearchConfigSchema,

  execute: async (
    args: {
      query: string;
      max_results?: number;
      search_depth?: 'basic' | 'advanced';
      include_answer?: 'none' | 'basic' | 'advanced';
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

    // Resolve parameters: LLM override > admin default
    const maxResults = Math.min(
      args.max_results ?? settings.maxResults ?? 10,
      20  // Hard cap
    );
    const searchDepth = args.search_depth ?? settings.defaultSearchDepth ?? 'basic';

    // Handle include_answer: 'none' maps to false for API, 'basic'/'advanced' pass through
    let includeAnswer: false | 'basic' | 'advanced' = false;
    if (args.include_answer !== undefined) {
      // LLM sends 'none' string, convert to boolean false for Tavily API
      includeAnswer = args.include_answer === 'none' ? false : args.include_answer;
    } else if (settings.includeAnswer !== undefined) {
      // Settings uses 'none' | 'basic' | 'advanced', convert 'none' to false for API
      includeAnswer = settings.includeAnswer === 'none' ? false : (settings.includeAnswer as 'basic' | 'advanced');
    }

    // Resolve domain filters (skill override > global config)
    const includeDomains = (settings.includeDomains as string[]) || [];
    const excludeDomains = (settings.excludeDomains as string[]) || [];

    // Check Redis cache first (include params + domains in cache key for varied searches)
    const domainKey = includeDomains.length > 0 || excludeDomains.length > 0
      ? `:inc=${includeDomains.join(',')}:exc=${excludeDomains.join(',')}`
      : '';
    const cacheKey = hashQuery(`${args.query}:${maxResults}:${searchDepth}:${includeAnswer}${domainKey}`);
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
      includeDomains: includeDomains.length > 0 ? includeDomains : undefined,
      excludeDomains: excludeDomains.length > 0 ? excludeDomains : undefined,
    });

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: args.query,
          max_results: maxResults,
          search_depth: searchDepth,
          topic: settings.defaultTopic,
          include_answer: includeAnswer,
          include_raw_content: false,
          include_domains: includeDomains.length > 0 ? includeDomains : undefined,
          exclude_domains: excludeDomains.length > 0 ? excludeDomains : undefined,
        }),
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
