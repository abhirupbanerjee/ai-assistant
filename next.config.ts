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
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), clipboard-read=(), payment=(), usb=(), serial=()' },
    ];

    const defaultFrameAncestors = "'self'";
    const embedFrameAncestors = allowedEmbedOrigins.length > 0
      ? `'self' ${allowedEmbedOrigins.join(' ')}`
      : defaultFrameAncestors;

    /**
     * CSP hardening notes:
     * - 'unsafe-eval' is required by Next.js dev mode and some dependencies (tiktoken, chart.js);
     *   it also covers WASM compilation for pdf.js (wasm-unsafe-eval is implied).
     * - 'unsafe-inline' is required by Next.js App Router for RSC bootstrap scripts and
     *   __NEXT_DATA__ hydration blocks. Removing it broke the entire application (see 2026-05-23).
     * - The private PDF preview (PdfViewer) loads its pdf.js Web Worker from the same
     *   origin (/pdfjs/pdf.worker.min.mjs, served from public/pdfjs). worker-src is not
     *   set, so it falls back to script-src, where 'self' already allows it — no
     *   additional CSP directives are required for artifact previews.
     * - report-uri /api/csp-report enables monitoring of CSP violations in production
     * - Roadmap: Introduce hash-based CSP + Content-Security-Policy-Report-Only header to
     *   collect violation data, then migrate to a nonce-based strict CSP without 'unsafe-inline'.
     */
    const buildCsp = (frameAncestors: string) => ({
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        // RE-ADDED: 'unsafe-inline' restored on 2026-05-23 — removing it broke Next.js App Router
        // RSC bootstrap scripts and __NEXT_DATA__ hydration blocks require inline scripts.
        // A hash-based/nonce CSP should be introduced in a future sprint after collecting
        // violation data via a Content-Security-Policy-Report-Only header (see Option E plan).
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://static.cloudflareinsights.com",
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
    // officeparser dynamically imports the ESM-only `file-type` package at runtime.
    // Without externalization Next.js fails to resolve it inside the bundled chunk
    // ("Cannot find package 'file-type' imported from .next/server/chunks/...").
    'officeparser',
    'file-type',
    // diagram-gen generator.ts dynamically imports mermaid server-side for
    // mermaid.parse() pre-validation in the repair loop. Mermaid is ESM and
    // pulls in cytoscape/dagre/elkjs — without externalization the standalone
    // Docker build fails to resolve these from the bundled server chunk.
    'mermaid',
    // docx-preview renders .docx files in the browser (DocumentViewer). It
    // depends on jszip (CJS/ESM hybrid) — externalize to keep the standalone
    // Docker build from failing to resolve it.
    'docx-preview',
    'jszip',
    // Validation workers resolve these in a real Node context, outside the bundle.
    'adm-zip',
    'saxes',
    // pdfjs-dist/legacy/build/pdf.mjs is loaded by the validation worker in
    // Node and needs this native package for DOMMatrix/ImageData/Path2D.
    '@napi-rs/canvas',
  ],
  // Body size limit for large file uploads (backup restore, document uploads).
  //
  // NOTE: `serverActions.bodySizeLimit` was removed on upgrade to Next.js 16.3.6.
  // It only governs Server Action payloads, and this codebase contains no
  // `'use server'` modules — every upload path is a Route Handler reading
  // `request.formData()` (e.g. /api/admin/backup/restore, /api/superuser/documents,
  // /api/threads/[threadId]/upload). The option was therefore dead config that
  // implied an upload limit it never enforced.
  //
  // `proxyClientMaxBodySize` is the only option that actually governs Route
  // Handler request bodies. It is still `experimental`, so it carries no semver
  // guarantee across minor releases — if large uploads start failing with 413
  // after a Next.js upgrade, verify this flag has not been renamed or promoted
  // out of `experimental` before looking anywhere else.
  experimental: {
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
      // officeparser loads these via `new Function('s', 'return import(s)')(...)` to
      // defeat bundler analysis, which also defeats Next's outputFileTracing. Force
      // them into the standalone image so PPTX/legacy-Office extraction works at runtime.
      './node_modules/file-type/**/*',
      './node_modules/pdfjs-dist/**/*',
      // The worker imports pdfjs-dist dynamically; its optional native canvas
      // dependency cannot be discovered reliably by standalone tracing.
      './node_modules/@napi-rs/canvas/**/*',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**/*',
      './node_modules/adm-zip/**/*',
      './node_modules/saxes/**/*',
      './node_modules/xmlchars/**/*',
      './node_modules/tesseract.js/**/*',
      // file-type's runtime deps (transitive — also missed by tracing).
      './node_modules/strtok3/**/*',
      './node_modules/token-types/**/*',
      './node_modules/uint8array-extras/**/*',
      // site-gen: theme CSS (compiled from DTCG tokens) and HTML templates
      // are read via readFileSync at runtime — not traced by static import analysis.
      './src/lib/site-gen/themes/dist/**/*.css',
      './src/lib/site-gen/templates/**/*.html',
      './src/lib/site-gen/templates/components/*.js',
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
