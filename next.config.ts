import type { NextConfig } from 'next';

// Configurable via environment variable (requires rebuild to take effect)
// Default: 500mb, Max recommended: 2gb
// Set MAX_UPLOAD_SIZE in .env to override (e.g., MAX_UPLOAD_SIZE=1gb)
const maxUploadSize = (process.env.MAX_UPLOAD_SIZE || '500mb') as `${number}${'kb' | 'mb' | 'gb'}`;

// Comma-separated list of origins allowed to embed /e/* routes in iframes
// e.g. ALLOWED_EMBED_ORIGINS=https://gea.abhirup.app,https://other.example.com
const allowedEmbedOrigins = process.env.ALLOWED_EMBED_ORIGINS
  ? process.env.ALLOWED_EMBED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    const commonSecurityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ];

    const defaultFrameAncestors = "'self'";
    const embedFrameAncestors = allowedEmbedOrigins.length > 0
      ? `'self' ${allowedEmbedOrigins.join(' ')}`
      : defaultFrameAncestors;

    /**
     * CSP hardening notes:
     * - 'unsafe-eval' is required by Next.js dev mode and some dependencies (tiktoken, chart.js)
     * - report-uri /api/csp-report enables monitoring of CSP violations in production
     * - 'unsafe-inline' was removed from script-src to prevent XSS via inline script injection.
     *   If RSC bootstrapping breaks (Next.js App Router limitation), re-add with a specific hash.
     */
    const buildCsp = (frameAncestors: string) => ({
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        // NOTE: 'unsafe-eval' needed for Next.js dev + some library deps (tiktoken, chart.js)
        // NOTE: 'unsafe-inline' removed for security (XSS hardening). If RSC breaks, use a
        //       specific script hash instead of blanket 'unsafe-inline'.
        "script-src 'self' 'unsafe-eval' https://static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://cloudflareinsights.com",
        `frame-ancestors ${frameAncestors}`,
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        // Optional: enable CSP violation reporting (set CSP_REPORT_URI environment variable)
        // Example: CSP_REPORT_URI=/api/csp-report or https://your-endpoint.report-uri.com/r/d/csp/enforce
        ...(process.env.CSP_REPORT_URI ? [`report-uri ${process.env.CSP_REPORT_URI}`] : []),
        ...(process.env.CSP_REPORT_URI ? [`report-to ${process.env.CSP_REPORT_URI}`] : []),
      ].join('; '),
    });

    return [
      {
        // Prevent CDNs from caching the service worker file
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // Prevent Cloudflare (or any CDN) from caching API responses
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // Embed routes: allow framing from ALLOWED_EMBED_ORIGINS
        // X-Frame-Options is omitted because it cannot express specific external domains
        source: '/e/:path*',
        headers: [
          ...commonSecurityHeaders,
          buildCsp(embedFrameAncestors),
        ],
      },
      {
        // Exclude /e/ embed routes (handled above with relaxed frame-ancestors)
        source: '/((?!e/).*)',
        headers: [
          ...commonSecurityHeaders,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          buildCsp(defaultFrameAncestors),
        ],
      },
    ];
  },
  serverExternalPackages: [
    'pdf-parse',
    '@xenova/transformers',
    'onnxruntime-node',
    'pdfkit',
    'playwright',
    'tiktoken',
  ],
  // Body size limit for large file uploads (backup restore, document uploads)
  experimental: {
    serverActions: {
      bodySizeLimit: maxUploadSize,
    },
    // For API routes with middleware/proxy (Next.js 16+)
    proxyClientMaxBodySize: maxUploadSize,
  },
  // Include PDFKit font files in standalone output (required for PDF generation)
  // Include vendor bundles for self-contained HTML generation (Chart.js, Mermaid, datalabels plugin)
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/pdfkit/js/data/**/*',
      './node_modules/chart.js/dist/chart.umd.min.js',
      './node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js',
      './node_modules/mermaid/dist/mermaid.min.js',
    ],
  },
  // Exclude data directory from build (contains Redis files with restricted permissions)
  outputFileTracingExcludes: {
    '/**': ['./data/**'],
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;