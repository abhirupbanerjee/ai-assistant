import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'pdf-parse',
    'chromadb',
    '@xenova/transformers',
    'onnxruntime-node',
    'pdfkit',
  ],
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
