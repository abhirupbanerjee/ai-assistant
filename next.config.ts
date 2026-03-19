import type { NextConfig } from 'next';

// Configurable via environment variable (requires rebuild to take effect)
// Default: 500mb, Max recommended: 2gb
// Set MAX_UPLOAD_SIZE in .env to override (e.g., MAX_UPLOAD_SIZE=1gb)
const maxUploadSize = (process.env.MAX_UPLOAD_SIZE || '500mb') as `${number}${'kb' | 'mb' | 'gb'}`;

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        // Prevent Cloudflare (or any CDN) from caching API responses
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  serverExternalPackages: [
    'pdf-parse',
    'chromadb',
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
