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
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ];

    const defaultFrameAncestors = "'self'";
    const embedFrameAncestors = allowedEmbedOrigins.length > 0
      ? `'self' ${allowedEmbedOrigins.join(' ')}`
      : defaultFrameAncestors;

    const buildCsp = (frameAncestors: string) => ({
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://cloudflareinsights.com",
        `frame-ancestors ${frameAncestors}`,
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
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/pdfkit/js/data/**/*'],
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
