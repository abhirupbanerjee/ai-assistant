import type { NextConfig } from 'next';

// Configurable via environment variable (requires rebuild to take effect)
// Default: 500mb, Max recommended: 2gb
// Set MAX_UPLOAD_SIZE in .env to override (e.g., MAX_UPLOAD_SIZE=1gb)
const maxUploadSize = process.env.MAX_UPLOAD_SIZE || '500mb';

const nextConfig: NextConfig = {
  output: 'standalone',
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
