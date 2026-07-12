/**
 * Website Analysis Tool — Unified Website Audit
 *
 * Merges 6 sub-analyses into a single tool:
 * 1. PageSpeed Insights — performance, accessibility, SEO, best practices
 * 2. Security Scan — Direct HTTP header inspection (CSP, HSTS, X-Frame-Options, etc.)
 * 3. SSL/TLS Scan — SSL Labs API v4 + direct TLS fallback
 * 4. DNS Security Scan — SPF, DMARC, DKIM, DNSSEC via Google DNS-over-HTTPS
 * 5. Cookie Security Audit — HttpOnly, Secure, SameSite flags
 * 6. Redirect Chain Audit — HTTP→HTTPS upgrade, loops, mixed content
 *
 * Each sub-analysis runs independently and is controlled by boolean flags.
 * Results are returned under sub-keys (pagespeed, security, ssl, dns, cookies, redirects).
 */

import * as tls from 'tls';
import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import { fetchWithSsrfGuard, validateUrlIsPublic } from '../ssrf-guard';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ========================================================================
// 1. PAGESPEED INSIGHTS — Types & Implementation
// ========================================================================

export interface CoreWebVitals {
  lcp: number;
  fid: number;
  cls: number;
  fcp: number;
  ttfb: number;
}

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface AuditItem {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue?: string;
}

export interface WcagViolation {
  auditId: string;
  title: string;
  description: string;
  wcagCriterion: string | null;
  wcagLevel: 'A' | 'AA' | 'AAA' | null;
  wcagPrinciple: string | null;
  score: number | null;
  displayValue?: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
}

export interface AccessibilityAudit {
  accessibilityScore: number;
  wcagLevel: 'A' | 'AA' | 'Partial AA' | 'Failing';
  totalViolations: number;
  byLevel: { A: number; AA: number; AAA: number; unmapped: number };
  violations: WcagViolation[];
  recommendations: string[];
}

export interface PageSpeedResult {
  url: string;
  fetchTime: string;
  strategy: 'mobile' | 'desktop';
  scores: LighthouseScores;
  coreWebVitals: CoreWebVitals;
  opportunities: AuditItem[];
  diagnostics: AuditItem[];
  accessibilityAudit?: AccessibilityAudit;
}

const PAGESPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const WCAG_MAP: Record<string, { criterion: string; level: 'A' | 'AA' | 'AAA'; principle: string }> = {
  'image-alt':              { criterion: '1.1.1', level: 'A',  principle: 'Images must have alternative text' },
  'input-image-alt':        { criterion: '1.1.1', level: 'A',  principle: 'Image buttons must have alternative text' },
  'object-alt':             { criterion: '1.1.1', level: 'A',  principle: 'Object elements must have alternative text' },
  'video-caption':          { criterion: '1.2.2', level: 'A',  principle: 'Videos must have captions' },
  'audio-caption':          { criterion: '1.2.4', level: 'AA', principle: 'Live audio must have captions' },
  'color-contrast':         { criterion: '1.4.3', level: 'AA', principle: 'Text must have sufficient colour contrast' },
  'color-contrast-enhanced':{ criterion: '1.4.6', level: 'AAA',principle: 'Text must have enhanced colour contrast' },
  'meta-viewport':          { criterion: '1.4.4', level: 'AA', principle: 'Page must not disable user scaling' },
  'document-title':         { criterion: '2.4.2', level: 'A',  principle: 'Page must have a descriptive title' },
  'html-has-lang':          { criterion: '3.1.1', level: 'A',  principle: 'Page must have a language attribute' },
  'html-lang-valid':        { criterion: '3.1.1', level: 'A',  principle: 'Page language attribute must be valid' },
  'valid-lang':             { criterion: '3.1.2', level: 'AA', principle: 'Language of parts must be valid' },
  'label':                  { criterion: '1.3.1', level: 'A',  principle: 'Form inputs must have associated labels' },
  'button-name':            { criterion: '4.1.2', level: 'A',  principle: 'Buttons must have accessible names' },
  'link-name':              { criterion: '2.4.4', level: 'A',  principle: 'Links must have descriptive text' },
  'frame-title':            { criterion: '2.4.1', level: 'A',  principle: 'Frames must have titles' },
  'duplicate-id-active':    { criterion: '4.1.1', level: 'A',  principle: 'Active elements must not share IDs' },
  'duplicate-id-aria':      { criterion: '4.1.1', level: 'A',  principle: 'ARIA IDs must be unique' },
  'aria-allowed-attr':      { criterion: '4.1.2', level: 'A',  principle: 'ARIA attributes must be valid for role' },
  'aria-required-attr':     { criterion: '4.1.2', level: 'A',  principle: 'Required ARIA attributes must be present' },
  'aria-roles':             { criterion: '4.1.2', level: 'A',  principle: 'ARIA roles must be valid' },
  'aria-valid-attr':        { criterion: '4.1.2', level: 'A',  principle: 'ARIA attributes must be valid' },
  'aria-valid-attr-value':  { criterion: '4.1.2', level: 'A',  principle: 'ARIA attribute values must be valid' },
  'aria-hidden-focus':      { criterion: '4.1.2', level: 'A',  principle: 'aria-hidden must not contain focusable elements' },
  'tabindex':               { criterion: '2.4.3', level: 'A',  principle: 'tabindex values greater than 0 disrupt focus order' },
  'logical-tab-order':      { criterion: '2.4.3', level: 'A',  principle: 'Focus order must be logical' },
  'focusable-controls':     { criterion: '2.1.1', level: 'A',  principle: 'All interactive controls must be keyboard accessible' },
  'interactive-element-affordance': { criterion: '2.1.1', level: 'A', principle: 'Interactive elements must be operable' },
  'managed-focus':          { criterion: '2.4.3', level: 'A',  principle: 'Focus must be managed after dynamic content changes' },
  'use-landmarks':          { criterion: '1.3.6', level: 'AAA',principle: 'Page should use ARIA landmark regions' },
  'bypass':                 { criterion: '2.4.1', level: 'A',  principle: 'Mechanism must exist to bypass repeated blocks' },
  'heading-order':          { criterion: '1.3.1', level: 'A',  principle: 'Heading levels must be sequential' },
  'list':                   { criterion: '1.3.1', level: 'A',  principle: 'Lists must be marked up correctly' },
  'listitem':               { criterion: '1.3.1', level: 'A',  principle: 'List items must be inside list elements' },
  'definition-list':        { criterion: '1.3.1', level: 'A',  principle: 'Definition lists must be correctly structured' },
  'dlitem':                 { criterion: '1.3.1', level: 'A',  principle: 'Definition list items must be properly nested' },
  'td-headers-attr':        { criterion: '1.3.1', level: 'A',  principle: 'Table cells must reference valid headers' },
  'th-has-data-cells':      { criterion: '1.3.1', level: 'A',  principle: 'Table headers must have associated data cells' },
};

function classifyViolations(
  audits: Record<string, { id: string; title: string; description: string; score: number | null; displayValue?: string }>
): WcagViolation[] {
  const violations: WcagViolation[] = [];
  for (const [id, audit] of Object.entries(audits)) {
    if (audit.score === null || audit.score >= 1) continue;
    const wcag = WCAG_MAP[id] || null;
    const impact: WcagViolation['impact'] =
      audit.score === 0 ? 'critical'
      : audit.score < 0.5 ? 'serious'
      : audit.score < 0.9 ? 'moderate'
      : 'minor';
    violations.push({
      auditId: id,
      title: audit.title,
      description: audit.description,
      wcagCriterion: wcag?.criterion || null,
      wcagLevel: wcag?.level || null,
      wcagPrinciple: wcag?.principle || null,
      score: audit.score,
      displayValue: audit.displayValue,
      impact,
    });
  }
  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return violations.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);
}

function assessWcagLevel(score: number, byLevel: { A: number; AA: number }): AccessibilityAudit['wcagLevel'] {
  if (byLevel.A > 0) return 'Failing';
  if (score >= 90 && byLevel.AA === 0) return 'AA';
  if (score >= 75) return 'Partial AA';
  return 'Failing';
}

function buildAccessibilityAudit(
  accessibilityScore: number,
  audits: Record<string, { id: string; title: string; description: string; score: number | null; displayValue?: string }>
): AccessibilityAudit {
  const violations = classifyViolations(audits);
  const byLevel = { A: 0, AA: 0, AAA: 0, unmapped: 0 };
  for (const v of violations) {
    if (v.wcagLevel === 'A') byLevel.A++;
    else if (v.wcagLevel === 'AA') byLevel.AA++;
    else if (v.wcagLevel === 'AAA') byLevel.AAA++;
    else byLevel.unmapped++;
  }
  const wcagLevel = assessWcagLevel(accessibilityScore, byLevel);
  const recommendations: string[] = [];
  const critical = violations.filter(v => v.impact === 'critical');
  const serious = violations.filter(v => v.impact === 'serious');
  if (critical.length > 0) {
    recommendations.push(`${critical.length} critical violation(s): ${critical.map(v => v.title).join(', ')}`);
  }
  if (serious.length > 0) {
    recommendations.push(`${serious.length} serious violation(s): ${serious.map(v => v.title).join(', ')}`);
  }
  if (byLevel.A > 0) {
    recommendations.push(`${byLevel.A} WCAG Level A failure(s) — these are the minimum conformance requirements and must be fixed.`);
  }
  if (byLevel.AA > 0) {
    recommendations.push(`${byLevel.AA} WCAG Level AA failure(s) — required for most accessibility standards and regulations.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('No accessibility violations detected. Score meets WCAG AA conformance.');
  }
  return { accessibilityScore, wcagLevel, totalViolations: violations.length, byLevel, violations, recommendations };
}

async function analyzePageSpeed(
  url: string,
  options: {
    apiKey?: string;
    strategy: 'mobile' | 'desktop';
    includeOpportunities: boolean;
    includeDiagnostics: boolean;
    accessibilityAudit?: boolean;
  }
): Promise<PageSpeedResult> {
  const params = new URLSearchParams({ url, strategy: options.strategy });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach(cat => params.append('category', cat));
  if (options.apiKey) params.append('key', options.apiKey);

  const response = await fetch(`${PAGESPEED_API_URL}?${params.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as Record<string, { message?: string }>).error?.message || `PageSpeed API error: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const lighthouse = data.lighthouseResult as Record<string, unknown> | undefined;
  const categories = (lighthouse?.categories || {}) as Record<string, { score?: number; auditRefs?: { id: string }[] }>;
  const audits = (lighthouse?.audits || {}) as Record<string, {
    id: string; title: string; description: string; score: number | null;
    displayValue?: string; numericValue?: number; details?: { type?: string };
  }>;

  const scores: LighthouseScores = {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    seo: Math.round((categories.seo?.score || 0) * 100),
  };

  const coreWebVitals: CoreWebVitals = {
    lcp: Math.round(audits['largest-contentful-paint']?.numericValue || 0),
    fid: Math.round(audits['max-potential-fid']?.numericValue || 0),
    cls: Number((audits['cumulative-layout-shift']?.numericValue || 0).toFixed(3)),
    fcp: Math.round(audits['first-contentful-paint']?.numericValue || 0),
    ttfb: Math.round(audits['server-response-time']?.numericValue || 0),
  };

  let opportunities: AuditItem[] = [];
  if (options.includeOpportunities) {
    opportunities = Object.values(audits)
      .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 1)
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .slice(0, 5)
      .map(a => ({ id: a.id, title: a.title, description: a.description, score: a.score, displayValue: a.displayValue }));
  }

  let diagnostics: AuditItem[] = [];
  if (options.includeDiagnostics) {
    diagnostics = Object.values(audits)
      .filter(a => a.details?.type === 'table' && a.score !== null && a.score < 1)
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .slice(0, 5)
      .map(a => ({ id: a.id, title: a.title, description: a.description, score: a.score, displayValue: a.displayValue }));
  }

  let accessibilityAudit: AccessibilityAudit | undefined;
  if (options.accessibilityAudit) {
    const a11yIds = new Set((categories.accessibility as { auditRefs?: { id: string }[] })?.auditRefs?.map(r => r.id) ?? []);
    const a11yAudits = a11yIds.size > 0
      ? Object.fromEntries(Object.entries(audits).filter(([id]) => a11yIds.has(id)))
      : audits;
    accessibilityAudit = buildAccessibilityAudit(scores.accessibility, a11yAudits);
  }

  return {
    url: data.id as string,
    fetchTime: data.analysisUTCTimestamp as string,
    strategy: options.strategy,
    scores, coreWebVitals, opportunities, diagnostics, accessibilityAudit,
  };
}

// ========================================================================
// 2. SECURITY SCAN — Direct HTTP Header Inspection
// ========================================================================

interface SecurityTest {
  id: string;
  name: string;
  passed: boolean;
  points: number;
  maxPoints: number;
  detail: string;
}

interface SecurityScanResult {
  url: string;
  scannedAt: string;
  grade: string;
  score: number;
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  tests: SecurityTest[];
  passed: boolean;
  summary: string;
  recommendations: string[];
  failureReason?: string;
}

// Score → grade mapping (0–100 scale)
function scoreToGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

// Fetch response headers from the final URL after redirects (GET, 10s timeout)
async function fetchHeadersForSecurity(url: string): Promise<Headers> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const { response } = await fetchWithSsrfGuard(
      url,
      {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (SecurityAudit/1.0)' },
      },
      { maxRedirects: 5, followRedirects: true }
    );
    return response.headers;
  } finally {
    clearTimeout(timer);
  }
}

// Evaluate the 10 security header tests (max 100 points total)
function evaluateSecurityHeaders(hdrs: Headers): SecurityTest[] {
  const h = (name: string) => hdrs.get(name)?.toLowerCase().trim() ?? '';
  const tests: SecurityTest[] = [];

  // 1. CSP present (15 pts)
  const csp = hdrs.get('content-security-policy') ?? '';
  const cspPresent = csp.length > 0;
  tests.push({
    id: 'csp_present', name: 'Content-Security-Policy', maxPoints: 15,
    passed: cspPresent, points: cspPresent ? 15 : 0,
    detail: cspPresent ? 'CSP header is present' : 'Content-Security-Policy header is missing',
  });

  // 2. CSP strong — no unsafe-inline / unsafe-eval (10 pts, only if CSP present)
  const cspWeak = csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'");
  const cspStrong = cspPresent && !cspWeak;
  tests.push({
    id: 'csp_strong', name: 'CSP: No unsafe-inline / unsafe-eval', maxPoints: 10,
    passed: cspStrong, points: cspStrong ? 10 : 0,
    detail: !cspPresent ? 'CSP not present' : cspWeak ? "CSP contains 'unsafe-inline' or 'unsafe-eval'" : 'CSP does not allow unsafe inline scripts',
  });

  // 3. HSTS with max-age ≥ 1 year (20 pts)
  const hsts = hdrs.get('strict-transport-security') ?? '';
  const maxAgeMatch = hsts.match(/max-age=(\d+)/i);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 0;
  const hstsOk = maxAge >= 31536000;
  tests.push({
    id: 'hsts', name: 'Strict-Transport-Security (HSTS)', maxPoints: 20,
    passed: hstsOk, points: hstsOk ? 20 : maxAge > 0 ? 5 : 0,
    detail: !hsts ? 'HSTS header is missing' : !hstsOk ? `HSTS max-age too short (${maxAge}s, need ≥ 31536000)` : `HSTS max-age is ${maxAge}s`,
  });

  // 4. HSTS includeSubDomains (5 pts)
  const hstsSubs = hsts.toLowerCase().includes('includesubdomains');
  tests.push({
    id: 'hsts_subdomains', name: 'HSTS: includeSubDomains', maxPoints: 5,
    passed: hstsSubs, points: hstsSubs ? 5 : 0,
    detail: hstsSubs ? 'HSTS covers all subdomains' : 'HSTS does not include subdomains',
  });

  // 5. X-Frame-Options (15 pts)
  const xfo = h('x-frame-options');
  const xfoOk = xfo === 'deny' || xfo === 'sameorigin';
  tests.push({
    id: 'x_frame_options', name: 'X-Frame-Options', maxPoints: 15,
    passed: xfoOk, points: xfo === 'deny' ? 15 : xfo === 'sameorigin' ? 12 : 0,
    detail: !xfo ? 'X-Frame-Options header is missing (clickjacking risk)' : xfoOk ? `X-Frame-Options: ${xfo.toUpperCase()}` : `Insecure X-Frame-Options value: ${xfo}`,
  });

  // 6. X-Content-Type-Options (10 pts)
  const xcto = h('x-content-type-options');
  const xctoOk = xcto === 'nosniff';
  tests.push({
    id: 'x_content_type_options', name: 'X-Content-Type-Options', maxPoints: 10,
    passed: xctoOk, points: xctoOk ? 10 : 0,
    detail: xctoOk ? 'X-Content-Type-Options: nosniff' : 'X-Content-Type-Options: nosniff is missing (MIME-sniffing risk)',
  });

  // 7. Referrer-Policy (10 pts)
  const rp = h('referrer-policy');
  const safeReferers = ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];
  const rpOk = safeReferers.includes(rp);
  tests.push({
    id: 'referrer_policy', name: 'Referrer-Policy', maxPoints: 10,
    passed: rpOk, points: rpOk ? 10 : rp ? 3 : 0,
    detail: !rp ? 'Referrer-Policy header is missing' : rp === 'unsafe-url' ? 'Referrer-Policy is unsafe-url (leaks full URL)' : rpOk ? `Referrer-Policy: ${rp}` : `Non-standard Referrer-Policy: ${rp}`,
  });

  // 8. Permissions-Policy (5 pts)
  const pp = hdrs.get('permissions-policy') ?? hdrs.get('feature-policy') ?? '';
  const ppOk = pp.length > 0;
  tests.push({
    id: 'permissions_policy', name: 'Permissions-Policy', maxPoints: 5,
    passed: ppOk, points: ppOk ? 5 : 0,
    detail: ppOk ? 'Permissions-Policy header is present' : 'Permissions-Policy header is missing',
  });

  // 9. Cross-Origin-Opener-Policy (5 pts)
  const coop = h('cross-origin-opener-policy');
  const coopOk = coop === 'same-origin' || coop === 'same-origin-allow-popups';
  tests.push({
    id: 'coop', name: 'Cross-Origin-Opener-Policy', maxPoints: 5,
    passed: coopOk, points: coopOk ? 5 : 0,
    detail: !coop ? 'COOP header is missing' : coopOk ? `COOP: ${coop}` : `Weak COOP value: ${coop}`,
  });

  // 10. Cross-Origin-Embedder-Policy (5 pts)
  const coep = h('cross-origin-embedder-policy');
  const coepOk = coep === 'require-corp' || coep === 'credentialless';
  tests.push({
    id: 'coep', name: 'Cross-Origin-Embedder-Policy', maxPoints: 5,
    passed: coepOk, points: coepOk ? 5 : 0,
    detail: !coep ? 'COEP header is missing' : coepOk ? `COEP: ${coep}` : `Weak COEP value: ${coep}`,
  });

  return tests;
}

function headerRecommendation(id: string): string {
  const recs: Record<string, string> = {
    csp_present: 'Add Content-Security-Policy header — define allowed sources for scripts, styles and fonts',
    csp_strong: "Remove 'unsafe-inline' and 'unsafe-eval' from CSP to prevent XSS attacks",
    hsts: 'Add Strict-Transport-Security with max-age=31536000 to enforce HTTPS',
    hsts_subdomains: 'Add includeSubDomains to HSTS to protect all subdomains',
    x_frame_options: 'Add X-Frame-Options: DENY or SAMEORIGIN to prevent clickjacking',
    x_content_type_options: 'Add X-Content-Type-Options: nosniff to prevent MIME-sniffing attacks',
    referrer_policy: 'Add Referrer-Policy: strict-origin-when-cross-origin to limit referrer leakage',
    permissions_policy: 'Add Permissions-Policy to restrict browser feature access (camera, microphone, geolocation)',
    coop: 'Add Cross-Origin-Opener-Policy: same-origin to isolate browsing context',
    coep: 'Add Cross-Origin-Embedder-Policy: require-corp to enable cross-origin isolation',
  };
  return recs[id] ?? `Improve ${id} security configuration`;
}

async function runSecurityScan(url: string, config: { minAcceptableScore: number }): Promise<SecurityScanResult> {
  const headers = await fetchHeadersForSecurity(url);
  const tests = evaluateSecurityHeaders(headers);
  const score = tests.reduce((sum, t) => sum + t.points, 0);
  const grade = scoreToGrade(score);
  const testsPassed = tests.filter(t => t.passed).length;
  const testsFailed = tests.filter(t => !t.passed).length;
  const recommendations = tests.filter(t => !t.passed).map(t => headerRecommendation(t.id));
  const gradeDesc: Record<string, string> = {
    'A+': 'exceptional security — exceeds best practices',
    A: 'excellent security — follows all best practices',
    B: 'good security — minor improvements needed',
    C: 'fair security — several improvements needed',
    D: 'poor security — significant vulnerabilities present',
    F: 'failing security — critical vulnerabilities present',
  };
  const result: SecurityScanResult = {
    url,
    scannedAt: new Date().toISOString(),
    grade,
    score,
    testsTotal: tests.length,
    testsPassed,
    testsFailed,
    tests,
    passed: score >= config.minAcceptableScore,
    summary: `Security grade ${grade} (${score}/100) — ${gradeDesc[grade] ?? 'unknown'}. ${testsPassed}/${tests.length} tests passed.`,
    recommendations,
  };
  if (!result.passed) result.failureReason = `Score ${score} is below minimum threshold of ${config.minAcceptableScore}`;
  return result;
}

// ========================================================================
// 3. SSL/TLS SCAN — SSL Labs + Direct TLS Fallback
// ========================================================================

interface SslScanResult {
  url: string; hostname: string; scannedAt: string; grade: string;
  gradeTrustIgnored?: string; protocol: string; certExpiry: string | null;
  certIssuer: string | null; daysUntilExpiry: number | null;
  supportsOldTls: boolean; forwardSecrecy: boolean;
  vulnerabilities: string[]; passed: boolean; summary: string; recommendations: string[];
}

const SSL_LABS_API = 'https://api.ssllabs.com/api/v4/analyze';

async function pollSslLabs(hostname: string, maxWaitSeconds: number, email: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'User-Agent': 'AIAssistant-SSLScan/1.0' };
  if (email) headers['email'] = email;

  const triggerRes = await fetch(`${SSL_LABS_API}?host=${encodeURIComponent(hostname)}&all=done`, { headers });
  if (!triggerRes.ok) {
    const body = await triggerRes.text().catch(() => '');
    throw new Error(`SSL Labs API error: ${triggerRes.status} ${triggerRes.statusText}${body ? ` — ${body}` : ''}`);
  }
  let data = await triggerRes.json() as Record<string, unknown>;
  const deadline = Date.now() + maxWaitSeconds * 1000;
  while (data.status !== 'READY' && data.status !== 'ERROR' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    const pollRes = await fetch(`${SSL_LABS_API}?host=${encodeURIComponent(hostname)}&all=done`, { headers });
    if (!pollRes.ok) throw new Error(`SSL Labs polling error: ${pollRes.status}`);
    data = await pollRes.json() as Record<string, unknown>;
  }
  if (data.status === 'ERROR') throw new Error(`SSL Labs error: ${(data.statusMessage as string) || 'Analysis failed'}`);
  if (data.status !== 'READY') throw new Error(`SSL Labs analysis timed out after ${maxWaitSeconds}s. Try again later.`);
  return data;
}

function normalizeSslResult(url: string, data: Record<string, unknown>): SslScanResult {
  const endpoints = (data.endpoints as Record<string, unknown>[]) || [];
  const endpoint = endpoints[0] || {};
  const details = (endpoint.details as Record<string, unknown>) || {};
  const grade = (endpoint.grade as string) || 'N/A';
  const gradeTrustIgnored = (endpoint.gradeTrustIgnored as string) || undefined;
  const protocols = (details.protocols as Array<{ name: string; version: string }>) || [];
  const sorted = [...protocols].sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
  const protocol = sorted.length > 0 ? `${sorted[0].name} ${sorted[0].version}` : 'Unknown';
  const certs = (data.certs as Record<string, unknown>[]) || [];
  const cert = certs[0] || (details.cert as Record<string, unknown>) || {};
  const notAfterMs = cert.notAfter as number | undefined;
  let certExpiry: string | null = null;
  let daysUntilExpiry: number | null = null;
  if (notAfterMs) {
    const expiryDate = new Date(notAfterMs);
    certExpiry = expiryDate.toISOString().split('T')[0];
    daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }
  const certIssuer = (cert.issuerLabel as string) || null;
  const supportsOldTls = protocols.some(p => p.name === 'TLS' && parseFloat(p.version) < 1.2);
  const forwardSecrecy = (details.forwardSecrecy as number || 0) >= 2;
  const vulnerabilities: string[] = [];
  if (details.vulnBeast) vulnerabilities.push('BEAST');
  if (details.heartbleed) vulnerabilities.push('Heartbleed');
  if (details.poodle) vulnerabilities.push('POODLE (SSLv3)');
  if ((details.poodleTls as number) === 2) vulnerabilities.push('POODLE (TLS)');
  if (details.freak) vulnerabilities.push('FREAK');
  if (details.logjam) vulnerabilities.push('Logjam');
  if (details.drownVulnerable) vulnerabilities.push('DROWN');
  if ((details.ticketbleed as number) === 2) vulnerabilities.push('Ticketbleed');
  if ((details.bleichenbacher as number) > 1) vulnerabilities.push('ROBOT/Bleichenbacher');
  const recommendations: string[] = [];
  if (grade === 'F' || grade === 'T') recommendations.push('Certificate is untrusted or TLS configuration has failed — resolve immediately.');
  if (grade === 'M') recommendations.push('Certificate name mismatch — ensure the certificate covers this hostname.');
  if (vulnerabilities.length > 0) recommendations.push(`Known vulnerabilities detected: ${vulnerabilities.join(', ')} — patch or reconfigure immediately.`);
  if (supportsOldTls) recommendations.push('Server supports deprecated TLS 1.0/1.1 — disable these protocol versions.');
  if (!forwardSecrecy) recommendations.push('Forward secrecy not fully supported — enable ECDHE cipher suites.');
  if (daysUntilExpiry !== null && daysUntilExpiry < 30) recommendations.push(`Certificate expires in ${daysUntilExpiry} days — renew immediately.`);
  else if (daysUntilExpiry !== null && daysUntilExpiry < 60) recommendations.push(`Certificate expires in ${daysUntilExpiry} days — schedule renewal soon.`);
  if (recommendations.length === 0) recommendations.push('SSL/TLS configuration is strong. Continue monitoring certificate expiry.');
  const passed = ['A+', 'A', 'A-', 'B'].includes(grade);
  const summaryParts = [`Grade: ${grade}`, `Protocol: ${protocol}`];
  if (certExpiry) summaryParts.push(`Cert expires: ${certExpiry} (${daysUntilExpiry}d)`);
  if (certIssuer) summaryParts.push(`Issuer: ${certIssuer}`);
  if (vulnerabilities.length > 0) summaryParts.push(`Vulnerabilities: ${vulnerabilities.join(', ')}`);
  return { url, hostname: new URL(url).hostname, scannedAt: new Date().toISOString(), grade, gradeTrustIgnored, protocol, certExpiry, certIssuer, daysUntilExpiry, supportsOldTls, forwardSecrecy, vulnerabilities, passed, summary: summaryParts.join(' | '), recommendations };
}

async function tlsDirectCheck(url: string, hostname: string): Promise<SslScanResult> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate(true);
      const protocol = socket.getProtocol() ?? 'Unknown';
      const cipher = socket.getCipher();
      socket.destroy();
      let certExpiry: string | null = null;
      let daysUntilExpiry: number | null = null;
      if (cert.valid_to) {
        const expiryDate = new Date(cert.valid_to);
        certExpiry = expiryDate.toISOString().split('T')[0];
        daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }
      const issuer = cert.issuer as unknown as Record<string, string>;
      const certIssuer = issuer?.O || issuer?.CN || null;
      const authorized = socket.authorized;
      const cipherName = cipher?.name ?? '';
      const forwardSecrecy = /ECDHE|DHE/.test(cipherName);
      const recommendations: string[] = [];
      if (!authorized) recommendations.push(`Certificate trust issue: ${socket.authorizationError || 'Unknown error'}`);
      if (daysUntilExpiry !== null && daysUntilExpiry < 30) recommendations.push(`Certificate expires in ${daysUntilExpiry} days — renew immediately.`);
      else if (daysUntilExpiry !== null && daysUntilExpiry < 60) recommendations.push(`Certificate expires in ${daysUntilExpiry} days — schedule renewal soon.`);
      if (!forwardSecrecy) recommendations.push('Forward secrecy not detected — consider enabling ECDHE cipher suites.');
      if (recommendations.length === 0) recommendations.push('Certificate is valid and TLS connection succeeded. Run a full SSL Labs scan for a detailed grade.');
      const passed = authorized && (daysUntilExpiry === null || daysUntilExpiry > 0);
      const summaryParts = [`Protocol: ${protocol}`, `Cipher: ${cipherName}`];
      if (certExpiry) summaryParts.push(`Cert expires: ${certExpiry} (${daysUntilExpiry}d)`);
      if (certIssuer) summaryParts.push(`Issuer: ${certIssuer}`);
      resolve({ url, hostname, scannedAt: new Date().toISOString(), grade: 'N/A (SSL Labs unavailable — direct TLS check)', protocol, certExpiry, certIssuer, daysUntilExpiry, supportsOldTls: false, forwardSecrecy, vulnerabilities: [], passed, summary: summaryParts.join(' | '), recommendations });
    });
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('TLS connection timed out')); });
    socket.on('error', reject);
  });
}

async function checkSslRateLimit(config: { rateLimitPerDay: number }): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:ssl:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  if (dailyCount && parseInt(dailyCount) >= config.rateLimitPerDay) {
    return { allowed: false, reason: `Daily SSL scan limit reached (${config.rateLimitPerDay}/day). Resets at midnight UTC.` };
  }
  return { allowed: true };
}

async function incrementSslRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:ssl:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

async function runSslScan(url: string, config: { maxWaitSeconds: number; rateLimitPerDay: number; email: string }): Promise<SslScanResult> {
  const hostname = new URL(url).hostname;
  const rateCheck = await checkSslRateLimit(config);
  if (!rateCheck.allowed) throw new Error(rateCheck.reason);

  if (!config.email) {
    const result = await tlsDirectCheck(url, hostname);
    await incrementSslRateLimit();
    return result;
  }
  try {
    const rawData = await pollSslLabs(hostname, config.maxWaitSeconds, config.email);
    const result = normalizeSslResult(url, rawData);
    await incrementSslRateLimit();
    return result;
  } catch {
    const result = await tlsDirectCheck(url, hostname);
    await incrementSslRateLimit();
    return result;
  }
}

// ========================================================================
// 4. DNS SECURITY SCAN — Google DNS-over-HTTPS
// ========================================================================

interface SpfResult { exists: boolean; record: string | null; mechanism: string | null; issue: string | null; }
interface DmarcResult { exists: boolean; record: string | null; policy: string | null; subdomainPolicy: string | null; pct: number | null; issue: string | null; }
interface DkimResult { checked: string[]; found: string[]; exists: boolean; }
interface DnssecResult { enabled: boolean; issue: string | null; }

interface DnsScanResult {
  url: string; hostname: string; scannedAt: string;
  spf: SpfResult; dmarc: DmarcResult; dkim: DkimResult; dnssec: DnssecResult;
  issuesCount: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  passed: boolean; summary: string; recommendations: string[];
}

const DNS_API = 'https://dns.google/resolve';

async function dnsQuery(name: string, type: string): Promise<string[]> {
  try {
    const res = await fetch(`${DNS_API}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { headers: { Accept: 'application/dns-json' } });
    if (!res.ok) return [];
    const data = await res.json() as { Answer?: Array<{ data: string }> };
    return (data.Answer || []).map(r => r.data.replace(/^"|"$/g, '').trim());
  } catch { return []; }
}

async function dnsQueryRaw(name: string, type: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${DNS_API}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { headers: { Accept: 'application/dns-json' } });
    if (!res.ok) return {};
    return await res.json() as Record<string, unknown>;
  } catch { return {}; }
}

async function checkSpf(hostname: string): Promise<SpfResult> {
  const records = await dnsQuery(hostname, 'TXT');
  const spfRecord = records.find(r => r.startsWith('v=spf1'));
  if (!spfRecord) return { exists: false, record: null, mechanism: null, issue: 'SPF record missing — anyone can send email appearing to be from this domain' };
  const allMatch = spfRecord.match(/([+\-~?])all/);
  const mechanism = allMatch ? allMatch[0] : null;
  let issue: string | null = null;
  if (mechanism === '+all') issue = 'SPF uses "+all" — allows ANY server to send mail. This provides no protection.';
  else if (mechanism === '?all') issue = 'SPF uses "?all" (neutral) — no enforcement. Consider changing to "~all" or "-all".';
  else if (!mechanism) issue = 'SPF record has no "all" mechanism — incomplete policy.';
  return { exists: true, record: spfRecord, mechanism, issue };
}

async function checkDmarc(hostname: string): Promise<DmarcResult> {
  const records = await dnsQuery(`_dmarc.${hostname}`, 'TXT');
  const dmarcRecord = records.find(r => r.startsWith('v=DMARC1'));
  if (!dmarcRecord) return { exists: false, record: null, policy: null, subdomainPolicy: null, pct: null, issue: 'DMARC record missing — no email authentication policy in place' };
  const policyMatch = dmarcRecord.match(/\bp=(\w+)/);
  const policy = policyMatch ? policyMatch[1].toLowerCase() : null;
  const spMatch = dmarcRecord.match(/\bsp=(\w+)/);
  const subdomainPolicy = spMatch ? spMatch[1].toLowerCase() : null;
  const pctMatch = dmarcRecord.match(/\bpct=(\d+)/);
  const pct = pctMatch ? parseInt(pctMatch[1], 10) : 100;
  let issue: string | null = null;
  if (policy === 'none') issue = 'DMARC policy is "none" — monitoring only, no enforcement. Upgrade to "quarantine" or "reject".';
  else if (pct !== null && pct < 100) issue = `DMARC pct=${pct} — policy only applies to ${pct}% of messages. Set pct=100 for full enforcement.`;
  return { exists: true, record: dmarcRecord, policy, subdomainPolicy, pct, issue };
}

async function checkDkim(hostname: string, selectors: string[]): Promise<DkimResult> {
  const checks = await Promise.allSettled(selectors.map(selector => dnsQuery(`${selector}._domainkey.${hostname}`, 'TXT')));
  const found: string[] = [];
  checks.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.length > 0 && result.value.some(r => r.includes('v=DKIM1') || r.includes('k=rsa') || r.includes('p='))) {
      found.push(selectors[index]);
    }
  });
  return { checked: selectors, found, exists: found.length > 0 };
}

async function checkDnssec(hostname: string): Promise<DnssecResult> {
  const dsData = await dnsQueryRaw(hostname, 'DS');
  const answers = (dsData.Answer as unknown[]) || [];
  const adData = await dnsQueryRaw(hostname, 'A');
  const adFlag = (adData as { AD?: boolean }).AD === true;
  const enabled = answers.length > 0 || adFlag;
  return { enabled, issue: enabled ? null : 'DNSSEC not enabled — DNS responses can be spoofed (DNS cache poisoning)' };
}

function assessDnsRisk(result: { spf: SpfResult; dmarc: DmarcResult; dkim: DkimResult; dnssec: DnssecResult }): { riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; issuesCount: number } {
  let highCount = 0;
  let mediumCount = 0;
  if (!result.spf.exists) highCount++;
  else if (result.spf.mechanism === '+all' || result.spf.mechanism === '?all') highCount++;
  if (!result.dmarc.exists) highCount++;
  else if (result.dmarc.policy === 'none') mediumCount++;
  if (!result.dkim.exists) mediumCount++;
  if (!result.dnssec.enabled) mediumCount++;
  const issuesCount = highCount + mediumCount;
  const riskLevel = highCount >= 2 ? 'CRITICAL' : highCount === 1 ? 'HIGH' : mediumCount >= 1 ? 'MEDIUM' : 'LOW';
  return { riskLevel, issuesCount };
}

function buildDnsRecommendations(result: { spf: SpfResult; dmarc: DmarcResult; dkim: DkimResult; dnssec: DnssecResult }): string[] {
  const recs: string[] = [];
  if (result.spf.issue) recs.push(`SPF: ${result.spf.issue}`);
  if (result.dmarc.issue) recs.push(`DMARC: ${result.dmarc.issue}`);
  if (!result.dkim.exists) recs.push(`DKIM: No DKIM record found on checked selectors (${result.dkim.checked.join(', ')}). Configure DKIM signing on your mail server and publish the public key.`);
  if (result.dnssec.issue) recs.push(`DNSSEC: ${result.dnssec.issue}`);
  if (recs.length === 0) recs.push('All email security records are properly configured. Continue monitoring for changes.');
  return recs;
}

async function checkDnsRateLimit(config: { rateLimitPerDay: number }): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:dns:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  if (dailyCount && parseInt(dailyCount) >= config.rateLimitPerDay) {
    return { allowed: false, reason: `Daily DNS scan limit reached (${config.rateLimitPerDay}/day). Resets at midnight UTC.` };
  }
  return { allowed: true };
}

async function incrementDnsRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:dns:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

async function runDnsScan(url: string, config: { rateLimitPerDay: number; dkimSelectors: string[] }): Promise<DnsScanResult> {
  const input = url.includes('://') ? url : `https://${url}`;
  const hostname = new URL(input).hostname;
  const rateCheck = await checkDnsRateLimit(config);
  if (!rateCheck.allowed) throw new Error(rateCheck.reason);

  const [spf, dmarc, dkim, dnssec] = await Promise.all([
    checkSpf(hostname), checkDmarc(hostname), checkDkim(hostname, config.dkimSelectors), checkDnssec(hostname),
  ]);
  const partial = { spf, dmarc, dkim, dnssec };
  const { riskLevel, issuesCount } = assessDnsRisk(partial);
  const recommendations = buildDnsRecommendations(partial);
  const passed = riskLevel === 'LOW';
  const checks = [
    spf.exists ? 'SPF OK' : 'SPF MISSING',
    dmarc.exists ? `DMARC (${dmarc.policy})` : 'DMARC MISSING',
    dkim.exists ? `DKIM (${dkim.found.join(', ')})` : 'DKIM NOT FOUND',
    dnssec.enabled ? 'DNSSEC OK' : 'DNSSEC OFF',
  ];
  await incrementDnsRateLimit();
  return { url, hostname, scannedAt: new Date().toISOString(), spf, dmarc, dkim, dnssec, issuesCount, riskLevel, passed, summary: `Risk: ${riskLevel} | ${checks.join(' | ')}`, recommendations };
}

// ========================================================================
// 5. COOKIE SECURITY AUDIT
// ========================================================================

interface CookieDetail {
  name: string; httpOnly: boolean; secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None' | 'missing';
  hasExpiry: boolean; domain?: string; path?: string;
  issues: string[]; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface CookieAuditResult {
  url: string; finalUrl: string; scannedAt: string;
  cookieCount: number; cookies: CookieDetail[];
  issueCount: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  passed: boolean; summary: string; recommendations: string[];
}

function parseCookieHeader(header: string): CookieDetail {
  const parts = header.split(';').map(p => p.trim());
  const nameValue = parts[0] || '';
  const name = nameValue.split('=')[0].trim();
  const directives = parts.slice(1).map(p => p.toLowerCase());
  const httpOnly = directives.includes('httponly');
  const secure = directives.includes('secure');
  const sameSiteDir = directives.find(d => d.startsWith('samesite='));
  let sameSite: CookieDetail['sameSite'] = 'missing';
  if (sameSiteDir) {
    const val = sameSiteDir.split('=')[1]?.trim();
    if (val === 'strict') sameSite = 'Strict';
    else if (val === 'lax') sameSite = 'Lax';
    else if (val === 'none') sameSite = 'None';
  }
  const hasExpiry = directives.some(d => d.startsWith('expires=') || d.startsWith('max-age='));
  const domainDir = directives.find(d => d.startsWith('domain='));
  const domain = domainDir ? domainDir.split('=')[1]?.trim() : undefined;
  const pathDir = directives.find(d => d.startsWith('path='));
  const path = pathDir ? pathDir.split('=')[1]?.trim() : undefined;
  const issues: string[] = [];
  if (!httpOnly) issues.push('Missing HttpOnly flag — JavaScript can read this cookie (XSS risk)');
  if (!secure) issues.push('Missing Secure flag — cookie may be transmitted over HTTP');
  if (sameSite === 'missing') issues.push('Missing SameSite attribute — vulnerable to CSRF attacks');
  if (sameSite === 'None' && !secure) issues.push('SameSite=None requires Secure flag — browsers will reject this cookie');
  if (sameSite === 'None') issues.push('SameSite=None allows cross-site sending — only use if cross-site access is required');
  const riskLevel: CookieDetail['riskLevel'] = issues.length >= 3 ? 'HIGH' : issues.length >= 1 ? 'MEDIUM' : 'LOW';
  return { name, httpOnly, secure, sameSite, hasExpiry, domain, path, issues, riskLevel };
}

async function checkCookieRateLimit(config: { rateLimitPerDay: number }): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:cookie:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  if (dailyCount && parseInt(dailyCount) >= config.rateLimitPerDay) {
    return { allowed: false, reason: `Daily cookie audit limit reached (${config.rateLimitPerDay}/day). Resets at midnight UTC.` };
  }
  return { allowed: true };
}

async function incrementCookieRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:cookie:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

async function runCookieAudit(url: string, config: { rateLimitPerDay: number; followRedirects: boolean }): Promise<CookieAuditResult> {
  const rateCheck = await checkCookieRateLimit(config);
  if (!rateCheck.allowed) throw new Error(rateCheck.reason);

  const { response, finalUrl } = await fetchWithSsrfGuard(
    url,
    { headers: { 'User-Agent': 'AIAssistant-CookieAudit/1.0' } },
    { followRedirects: config.followRedirects, maxRedirects: 10 }
  );
  const cookieHeaders: string[] = response.headers.getSetCookie();
  const cookies = cookieHeaders.map(parseCookieHeader);
  const allIssues = cookies.flatMap(c => c.issues);
  const issueCount = allIssues.length;
  const hasHighRisk = cookies.some(c => c.riskLevel === 'HIGH');
  const hasMediumRisk = cookies.some(c => c.riskLevel === 'MEDIUM');
  const riskLevel: CookieAuditResult['riskLevel'] = cookies.length === 0 ? 'LOW' : hasHighRisk ? 'HIGH' : hasMediumRisk ? 'MEDIUM' : 'LOW';
  const passed = riskLevel === 'LOW';
  const recommendations: string[] = [];
  const missingHttpOnly = cookies.filter(c => !c.httpOnly).map(c => c.name);
  const missingSecure = cookies.filter(c => !c.secure).map(c => c.name);
  const missingSameSite = cookies.filter(c => c.sameSite === 'missing').map(c => c.name);
  if (missingHttpOnly.length > 0) recommendations.push(`Add HttpOnly flag to: ${missingHttpOnly.join(', ')}`);
  if (missingSecure.length > 0) recommendations.push(`Add Secure flag to: ${missingSecure.join(', ')}`);
  if (missingSameSite.length > 0) recommendations.push(`Add SameSite=Lax (or Strict) to: ${missingSameSite.join(', ')}`);
  if (cookies.length === 0) recommendations.push('No Set-Cookie headers found on this URL. Cookies may be set on authenticated pages not reachable without login.');
  if (recommendations.length === 0) recommendations.push('All cookies have proper security flags configured.');
  await incrementCookieRateLimit();
  return { url, finalUrl, scannedAt: new Date().toISOString(), cookieCount: cookies.length, cookies, issueCount, riskLevel, passed, summary: `${cookies.length} cookie(s) found | ${issueCount} issue(s) | Risk: ${riskLevel}`, recommendations };
}

// ========================================================================
// 6. REDIRECT CHAIN AUDIT
// ========================================================================

interface RedirectHop {
  order: number; url: string; statusCode: number;
  protocol: 'http' | 'https'; issue?: string;
}

interface RedirectAuditResult {
  url: string; scannedAt: string; hopCount: number; hops: RedirectHop[];
  finalUrl: string; finalProtocol: 'http' | 'https';
  httpsUpgraded: boolean; upgradeOnFirstHop: boolean;
  hasMixedChain: boolean; hasLoop: boolean; excessiveHops: boolean;
  wwwRedirect: boolean; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  passed: boolean; summary: string; recommendations: string[];
}

async function followRedirects(startUrl: string, maxHops: number, timeoutMs: number): Promise<{ hops: RedirectHop[]; finalUrl: string }> {
  const hops: RedirectHop[] = [];
  const visited = new Set<string>();
  let currentUrl = startUrl;
  for (let i = 0; i < maxHops; i++) {
    if (visited.has(currentUrl)) {
      hops.push({ order: i + 1, url: currentUrl, statusCode: 0, protocol: currentUrl.startsWith('https') ? 'https' : 'http', issue: 'Redirect loop detected — same URL visited twice' });
      break;
    }
    visited.add(currentUrl);
    await validateUrlIsPublic(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { response: res } = await fetchWithSsrfGuard(
        currentUrl,
        { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'AIAssistant-RedirectAudit/1.0' } },
        { followRedirects: false }
      );
      clearTimeout(timer);
      const protocol: 'http' | 'https' = currentUrl.startsWith('https') ? 'https' : 'http';
      hops.push({ order: i + 1, url: currentUrl, statusCode: res.status, protocol });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get('location');
      if (!location) break;
      const nextUrl = new URL(location, currentUrl).href;
      await validateUrlIsPublic(nextUrl);
      currentUrl = nextUrl;
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        hops.push({ order: i + 1, url: currentUrl, statusCode: 0, protocol: currentUrl.startsWith('https') ? 'https' : 'http', issue: 'Request timed out' });
      }
      break;
    }
  }
  return { hops, finalUrl: currentUrl };
}

function analyseChain(hops: RedirectHop[], finalUrl: string, startUrl: string): Omit<RedirectAuditResult, 'url' | 'scannedAt' | 'hops' | 'finalUrl'> {
  const finalProtocol: 'http' | 'https' = finalUrl.startsWith('https') ? 'https' : 'http';
  const httpsUpgraded = startUrl.startsWith('http:') && finalProtocol === 'https';
  const upgradeOnFirstHop = hops.length >= 2 && hops[0].protocol === 'http' && hops[1].protocol === 'https';
  let hasMixedChain = false;
  for (let i = 0; i < hops.length - 1; i++) {
    if (hops[i].protocol === 'https' && hops[i + 1].protocol === 'http') {
      hasMixedChain = true;
      hops[i + 1].issue = 'HTTPS downgrade — HTTPS redirected to HTTP';
    }
  }
  const hasLoop = hops.some(h => h.issue?.includes('loop'));
  const excessiveHops = hops.length > 3;
  const startHostname = new URL(startUrl.startsWith('http') ? startUrl : `https://${startUrl}`).hostname;
  const finalHostname = new URL(finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`).hostname;
  const wwwRedirect = startHostname.startsWith('www.') !== finalHostname.startsWith('www.');
  const riskLevel: RedirectAuditResult['riskLevel'] = hasMixedChain || hasLoop ? 'HIGH' : excessiveHops || (startUrl.startsWith('http:') && !httpsUpgraded) ? 'MEDIUM' : 'LOW';
  const passed = riskLevel === 'LOW';
  const recommendations: string[] = [];
  if (hasMixedChain) recommendations.push('HTTPS to HTTP redirect detected mid-chain — this downgrades security and may expose session cookies');
  if (hasLoop) recommendations.push('Redirect loop detected — the server has a circular redirect configuration');
  if (startUrl.startsWith('http:') && !httpsUpgraded) recommendations.push('HTTP URL does not redirect to HTTPS — all HTTP traffic should redirect to HTTPS');
  if (!upgradeOnFirstHop && startUrl.startsWith('http:') && httpsUpgraded) recommendations.push('HTTP to HTTPS upgrade does not happen on first hop — consider consolidating to a single redirect');
  if (excessiveHops) recommendations.push(`${hops.length} redirect hops detected — more than 3 hops hurts SEO and performance. Consolidate to 1-2 hops.`);
  if (wwwRedirect) recommendations.push(`WWW canonicalisation redirect detected (${startHostname} -> ${finalHostname}) — ensure this is intentional and consistent`);
  if (recommendations.length === 0) recommendations.push('Redirect chain is clean — HTTP upgrades to HTTPS in one hop with no mixed content or loops.');
  return { hopCount: hops.length, finalProtocol, httpsUpgraded, upgradeOnFirstHop, hasMixedChain, hasLoop, excessiveHops, wwwRedirect, riskLevel, passed, summary: `${hops.length} hop(s) | Final: ${finalProtocol.toUpperCase()} | Risk: ${riskLevel}`, recommendations };
}

async function checkRedirectRateLimit(config: { rateLimitPerDay: number }): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `websiteaudit:redirect:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  if (dailyCount && parseInt(dailyCount) >= config.rateLimitPerDay) {
    return { allowed: false, reason: `Daily redirect audit limit reached (${config.rateLimitPerDay}/day). Resets at midnight UTC.` };
  }
  return { allowed: true };
}


async function runRedirectAudit(url: string, config: { maxHops: number; timeoutMs: number; rateLimitPerDay: number }): Promise<RedirectAuditResult> {
  const rateCheck = await checkRedirectRateLimit(config);
  if (!rateCheck.allowed) throw new Error(rateCheck.reason);

  const { hops, finalUrl } = await followRedirects(url, config.maxHops, config.timeoutMs);
  const analysis = analyseChain(hops, finalUrl, url);
  return { url, scannedAt: new Date().toISOString(), hops, finalUrl, ...analysis };
}


// ========================================================================
// UNIFIED CONFIG
// ========================================================================

interface WebsiteAnalysisConfig {
  // PageSpeed
  apiKey: string;
  defaultStrategy: 'mobile' | 'desktop';
  includeOpportunities: boolean;
  includeDiagnostics: boolean;
  // Security
  securityMinAcceptableScore: number;
  // SSL
  sslMaxWaitSeconds: number;
  sslRateLimitPerDay: number;
  sslEmail: string;
  // DNS
  dnsRateLimitPerDay: number;
  dkimSelectors: string[];
  // Cookie
  cookieRateLimitPerDay: number;
  cookieFollowRedirects: boolean;
  // Redirect
  redirectMaxHops: number;
  redirectTimeoutMs: number;
  redirectRateLimitPerDay: number;
  // Global
  cacheTTLSeconds: number;
}

const configSchema = {
  type: 'object',
  properties: {
    // PageSpeed
    apiKey: { type: 'string', title: 'Google API Key', description: 'Optional but recommended for higher rate limits. Get from https://console.cloud.google.com/apis/credentials', format: 'password' },
    defaultStrategy: { type: 'string', title: 'Default Strategy', description: 'Default device type for analysis', enum: ['mobile', 'desktop'], default: 'mobile' },
    includeOpportunities: { type: 'boolean', title: 'Include Opportunities', description: 'Include optimization opportunities in results', default: true },
    includeDiagnostics: { type: 'boolean', title: 'Include Diagnostics', description: 'Include detailed diagnostic information', default: true },
    // Security
    securityMinAcceptableScore: { type: 'number', title: 'Security Min Acceptable Score', description: 'Alert if score below this threshold (A+ = 90+, A = 75+, B = 60+)', minimum: 0, maximum: 100, default: 60 },
    // SSL
    sslMaxWaitSeconds: { type: 'number', title: 'SSL Labs Max Wait (seconds)', description: 'SSL Labs performs a full TLS handshake analysis on first scan — this takes 60–120s', minimum: 60, maximum: 300, default: 120 },
    sslRateLimitPerDay: { type: 'number', title: 'SSL Daily Scan Limit', description: 'Maximum SSL scans per 24 hours', minimum: 1, maximum: 50, default: 20 },
    sslEmail: { type: 'string', title: 'SSL Labs v4 Registered Email', description: 'Organisation email registered at https://api.ssllabs.com/api/v4/register — required for SSL Labs v4 API access', default: '' },
    // DNS
    dnsRateLimitPerDay: { type: 'number', title: 'DNS Daily Scan Limit', description: 'Maximum DNS scans per 24 hours', minimum: 1, maximum: 200, default: 50 },
    dkimSelectors: { type: 'array', title: 'DKIM Selectors to Check', description: 'List of DKIM selector names to probe', items: { type: 'string' }, default: ['default', 'google', 'selector1', 'selector2', 'mail', 'smtp', 'dkim'] },
    // Cookie
    cookieRateLimitPerDay: { type: 'number', title: 'Cookie Daily Audit Limit', description: 'Maximum cookie audits per 24 hours', minimum: 1, maximum: 200, default: 50 },
    cookieFollowRedirects: { type: 'boolean', title: 'Cookie Follow Redirects', description: 'Follow HTTP redirects before inspecting cookies', default: true },
    // Redirect
    redirectMaxHops: { type: 'number', title: 'Max Redirect Hops', description: 'Stop following after this many redirects', minimum: 3, maximum: 20, default: 10 },
    redirectTimeoutMs: { type: 'number', title: 'Redirect Request Timeout (ms)', description: 'Timeout per hop in milliseconds', minimum: 2000, maximum: 30000, default: 10000 },
    redirectRateLimitPerDay: { type: 'number', title: 'Redirect Daily Audit Limit', description: 'Maximum redirect audits per 24 hours', minimum: 1, maximum: 200, default: 50 },
    // Global
    cacheTTLSeconds: { type: 'number', title: 'Cache Duration (seconds)', description: 'How long to cache analysis results', minimum: 60, maximum: 86400, default: 86400 },
  },
};

const defaultConfig: WebsiteAnalysisConfig = {
  apiKey: '',
  defaultStrategy: 'mobile',
  includeOpportunities: true,
  includeDiagnostics: true,
  securityMinAcceptableScore: 70,
  sslMaxWaitSeconds: 120,
  sslRateLimitPerDay: 20,
  sslEmail: '',
  dnsRateLimitPerDay: 50,
  dkimSelectors: ['default', 'google', 'selector1', 'selector2', 'mail', 'smtp', 'dkim'],
  cookieRateLimitPerDay: 50,
  cookieFollowRedirects: true,
  redirectMaxHops: 10,
  redirectTimeoutMs: 10000,
  redirectRateLimitPerDay: 50,
  cacheTTLSeconds: 86400,
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (config.defaultStrategy && !['mobile', 'desktop'].includes(config.defaultStrategy as string)) errors.push('defaultStrategy must be "mobile" or "desktop"');
  if (config.cacheTTLSeconds !== undefined) {
    const v = config.cacheTTLSeconds as number;
    if (typeof v !== 'number' || v < 60 || v > 86400) errors.push('cacheTTLSeconds must be between 60 and 86400');
  }
  if (config.securityMinAcceptableScore !== undefined) {
    const v = config.securityMinAcceptableScore as number;
    if (typeof v !== 'number' || v < 0 || v > 100) errors.push('securityMinAcceptableScore must be between 0 and 100');
  }
  if (config.sslMaxWaitSeconds !== undefined) {
    const v = config.sslMaxWaitSeconds as number;
    if (typeof v !== 'number' || v < 60 || v > 300) errors.push('sslMaxWaitSeconds must be between 60 and 300');
  }
  if (config.redirectMaxHops !== undefined) {
    const v = config.redirectMaxHops as number;
    if (typeof v !== 'number' || v < 3 || v > 20) errors.push('redirectMaxHops must be between 3 and 20');
  }
  if (config.redirectTimeoutMs !== undefined) {
    const v = config.redirectTimeoutMs as number;
    if (typeof v !== 'number' || v < 2000 || v > 30000) errors.push('redirectTimeoutMs must be between 2000 and 30000');
  }
  if (config.dkimSelectors !== undefined && !Array.isArray(config.dkimSelectors)) errors.push('dkimSelectors must be an array of strings');
  return { valid: errors.length === 0, errors };
}

// ========================================================================
// CONFIG HELPERS
// ========================================================================

async function getWebsiteAnalysisConfig(categoryId?: number): Promise<{ enabled: boolean; config: WebsiteAnalysisConfig }> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('website_analysis', categoryId);
    return { enabled: effective.enabled, config: (effective.config as unknown as WebsiteAnalysisConfig) || defaultConfig };
  }
  const toolConfig = await getToolConfig('website_analysis');
  if (toolConfig) return { enabled: toolConfig.isEnabled, config: toolConfig.config as unknown as WebsiteAnalysisConfig };
  return { enabled: false, config: defaultConfig };
}

// ========================================================================
// TOOL DEFINITION
// ========================================================================

export const websiteAnalysisTool: ToolDefinition = {
  name: 'website_analysis',
  displayName: 'Website Analysis',
  description: 'Comprehensive website audit: performance (PageSpeed), security headers (Mozilla Observatory), SSL/TLS, DNS security (SPF/DMARC/DKIM/DNSSEC), cookie security, and redirect chain analysis.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'website_analysis',
      description: 'Comprehensive website audit tool. Analyzes: (1) PageSpeed — performance, accessibility, SEO, Core Web Vitals; (2) Security headers via Mozilla Observatory; (3) SSL/TLS configuration with grade; (4) DNS security — SPF, DMARC, DKIM, DNSSEC; (5) Cookie security — HttpOnly, Secure, SameSite; (6) Redirect chain — HTTP→HTTPS upgrade, loops, mixed content. All sub-analyses run in parallel. Use for any website audit, security review, performance check, or SEO analysis request.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL of the website to analyze (e.g., https://example.com). Must include protocol (http/https).' },
          strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'Device type for PageSpeed analysis. Mobile is typically more important for SEO.' },
          accessibilityAudit: { type: 'boolean', description: 'Set to true for a detailed WCAG 2.1 accessibility audit with violations mapped to specific WCAG criteria and levels (A/AA/AAA).' },
          performance: { type: 'boolean', description: 'Run PageSpeed performance analysis (default: true)' },
          security: { type: 'boolean', description: 'Run security headers analysis via Mozilla Observatory (default: true)' },
          ssl: { type: 'boolean', description: 'Run SSL/TLS configuration analysis (default: true)' },
          dns: { type: 'boolean', description: 'Run DNS security records check — SPF, DMARC, DKIM, DNSSEC (default: true)' },
          cookies: { type: 'boolean', description: 'Run cookie security audit — HttpOnly, Secure, SameSite flags (default: true)' },
          redirects: { type: 'boolean', description: 'Run redirect chain audit — HTTP→HTTPS upgrade, loops, mixed content (default: true)' },
        },
        required: ['url'],
      },
    },
  },

  execute: async (args: Record<string, unknown>, options?: ToolExecutionOptions): Promise<string> => {
    const url = (args.url as string) || '';
    const strategy = ((args.strategy as string) || 'mobile') as 'mobile' | 'desktop';
    const runAccessibility = args.accessibilityAudit === true;
    const runPerformance = args.performance !== false;
    const runSecurity = args.security !== false;
    const runSsl = args.ssl !== false;
    const runDns = args.dns !== false;
    const runCookies = args.cookies !== false;
    const runRedirects = args.redirects !== false;

    if (!url) {
      return JSON.stringify({ success: false, error: 'URL is required' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return JSON.stringify({ success: false, error: 'URL must use http or https protocol' });
      }
    } catch {
      return JSON.stringify({ success: false, error: 'Invalid URL format' });
    }
    // SSRF guard: block private/internal IP ranges
    try {
      await validateUrlIsPublic(url);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'SSRF guard rejected the URL',
      });
    }

    void parsedUrl;

    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config } = categoryIds.length > 0
      ? await getWebsiteAnalysisConfig(categoryIds[0])
      : await getWebsiteAnalysisConfig();

    if (!enabled) {
      return JSON.stringify({ success: false, error: 'Website analysis is currently disabled', errorCode: 'TOOL_DISABLED' });
    }

    const configOverride = options?.configOverride || {};
    const cfg = { ...config, ...configOverride } as WebsiteAnalysisConfig;

    const cacheKey = 'website_analysis:' + hashQuery(url) + ':' + strategy + ':' + (runAccessibility ? 'a11y' : 'noa11y');
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      return cached;
    }

    const results: Record<string, unknown> = {};
    const tasks: Promise<void>[] = [];

    if (runPerformance) {
      tasks.push(
        (async () => {
          try {
            results.pagespeed = await analyzePageSpeed(url, {
              apiKey: cfg.apiKey,
              strategy,
              includeOpportunities: cfg.includeOpportunities,
              includeDiagnostics: cfg.includeDiagnostics,
              accessibilityAudit: runAccessibility,
            });
          } catch (err) {
            results.pagespeed = { error: err instanceof Error ? err.message : 'PageSpeed analysis failed' };
          }
        })()
      );
    }

    if (runSecurity) {
      tasks.push(
        (async () => {
          try {
            results.security = await runSecurityScan(url, {
              minAcceptableScore: cfg.securityMinAcceptableScore,
            });
          } catch (err) {
            results.security = { error: err instanceof Error ? err.message : 'Security scan failed' };
          }
        })()
      );
    }

    if (runSsl) {
      tasks.push(
        (async () => {
          try {
            results.ssl = await runSslScan(url, {
              maxWaitSeconds: cfg.sslMaxWaitSeconds,
              rateLimitPerDay: cfg.sslRateLimitPerDay,
              email: cfg.sslEmail,
            });
          } catch (err) {
            results.ssl = { error: err instanceof Error ? err.message : 'SSL scan failed' };
          }
        })()
      );
    }

    if (runDns) {
      tasks.push(
        (async () => {
          try {
            results.dns = await runDnsScan(url, {
              rateLimitPerDay: cfg.dnsRateLimitPerDay,
              dkimSelectors: cfg.dkimSelectors,
            });
          } catch (err) {
            results.dns = { error: err instanceof Error ? err.message : 'DNS scan failed' };
          }
        })()
      );
    }

    if (runCookies) {
      tasks.push(
        (async () => {
          try {
            results.cookies = await runCookieAudit(url, {
              rateLimitPerDay: cfg.cookieRateLimitPerDay,
              followRedirects: cfg.cookieFollowRedirects,
            });
          } catch (err) {
            results.cookies = { error: err instanceof Error ? err.message : 'Cookie audit failed' };
          }
        })()
      );
    }

    if (runRedirects) {
      tasks.push(
        (async () => {
          try {
            results.redirects = await runRedirectAudit(url, {
              maxHops: cfg.redirectMaxHops,
              timeoutMs: cfg.redirectTimeoutMs,
              rateLimitPerDay: cfg.redirectRateLimitPerDay,
            });
          } catch (err) {
            results.redirects = { error: err instanceof Error ? err.message : 'Redirect audit failed' };
          }
        })()
      );
    }

    await Promise.allSettled(tasks);

    const response = JSON.stringify({ success: true, data: results }, null, 2);
    await cacheQuery(cacheKey, response, cfg.cacheTTLSeconds || 86400);

    return response;
  },

  validateConfig,
  defaultConfig: defaultConfig as unknown as Record<string, unknown>,
  configSchema,
};
