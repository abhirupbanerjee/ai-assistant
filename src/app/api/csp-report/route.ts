/**
 * CSP Violation Report Endpoint
 *
 * This endpoint collects Content-Security-Policy violation reports from browsers.
 * Enable by setting CSP_REPORT_URI=/api/csp-report in your environment.
 *
 * Violations are logged for monitoring and analysis. In production, consider:
 * - Forwarding to a dedicated CSP monitoring service (report-uri.com, Sentry, etc.)
 * - Aggregating violations in a database for trend analysis
 * - Setting up alerts for critical violations (e.g., script-src violations)
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only
 */

import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  try {
    const report = await req.json();

    // Log the violation with structured data
    logger.warn('[CSP Violation Report]', {
      timestamp: new Date().toISOString(),
      violatedDirective: report['violated-directive'],
      effectiveDirective: report['effective-directive'],
      originalPolicy: report['original-policy'],
      blockedURI: report['blocked-uri'],
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
      columnNumber: report['column-number'],
      statusCode: report['status-code'],
      documentURI: report['document-uri'],
      disposition: report.disposition, // 'enforce' or 'report'
    });

    // Return 204 No Content (standard for CSP report endpoints)
    return new Response(null, { status: 204 });
  } catch (error) {
    // Log parsing errors but still return 204 to avoid browser warnings
    logger.error('[CSP Report Parsing Error]', {
      error: error instanceof Error ? error.message : String(error),
      contentType: req.headers.get('content-type'),
    });

    return new Response(null, { status: 204 });
  }
}

// Disable authentication for this endpoint (CSP reports must be sent without credentials)
export const runtime = 'nodejs';
