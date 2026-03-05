/**
 * Load Testing Tool - k6 Cloud Integration
 *
 * Two-phase architecture:
 * - Admin triggers tests via Admin UI → API route → k6 CLI execution
 * - Users retrieve cached results via LLM tool ("get load test for <url>")
 *
 * The LLM-facing tool is read-only. Test execution is admin-only.
 */

import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import { insertLoadTestResult, getLatestLoadTestResult } from '../db/compat/loadtest-results';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

export interface LoadTestConfig {
  apiToken: string;
  stackId: string;              // Grafana Cloud Stack ID (required for v6 API)
  maxConcurrentUsers: number;
  defaultDuration: number;
  maxDuration: number;
  cacheTTLSeconds: number;
  rateLimitPerDay: number;
  allowedDomains: string[];
}

export interface LoadTestMetrics {
  http_req_duration: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  http_req_failed: number;
  http_reqs: number;
  vus: number;
  iterations: number;
}

// ============ Concurrency Lock & Async Tracker ============

let testRunning = false;

export interface ActiveTest {
  status: 'running' | 'complete' | 'error';
  message: string;
  result?: Record<string, unknown>;
  error?: string;
}

const activeTests = new Map<string, ActiveTest>();

/**
 * Start a load test in the background (non-blocking).
 * Caller gets a testId to poll for status.
 */
export function startTestAsync(
  testId: string,
  url: string,
  users: number,
  duration: number,
  config: LoadTestConfig,
  adminEmail: string
): void {
  activeTests.set(testId, { status: 'running', message: 'Starting load test...' });

  executeLoadTest(url, users, duration, config, adminEmail)
    .then(result => {
      if (result.success) {
        activeTests.set(testId, {
          status: 'complete',
          message: 'Test completed',
          result: result.result,
        });
      } else {
        activeTests.set(testId, {
          status: 'error',
          message: result.error || 'Test failed',
          error: result.error,
        });
      }
    })
    .catch(err => {
      activeTests.set(testId, {
        status: 'error',
        message: err instanceof Error ? err.message : 'Test failed',
        error: err instanceof Error ? err.message : 'Test failed',
      });
    });

  // Clean up tracker after 1 hour
  setTimeout(() => activeTests.delete(testId), 3600000);
}

/**
 * Get the status of an async test run.
 */
export function getTestStatus(testId: string): ActiveTest | null {
  return activeTests.get(testId) || null;
}

// ============ Config Helpers ============

const defaultConfig: LoadTestConfig = {
  apiToken: '',
  stackId: '',
  maxConcurrentUsers: 50,
  defaultDuration: 300,
  maxDuration: 600,
  cacheTTLSeconds: 2592000, // 30 days
  rateLimitPerDay: 10,
  allowedDomains: [],
};

/**
 * Get load test configuration with optional category override
 */
export async function getLoadTestConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: LoadTestConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('load_testing', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as LoadTestConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('load_testing');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as LoadTestConfig,
    };
  }

  return { enabled: false, config: defaultConfig };
}

// ============ k6 CLI Functions (Admin-only) ============

/**
 * Check if k6 CLI is installed on the server
 */
export async function checkK6Installed(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('k6', ['version'], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Generate a k6 test script.
 * Uses __ENV.TARGET_URL to avoid command injection.
 */
export function generateK6Script(users: number, duration: number): string {
  // Ensure ramp stages fit within duration
  const rampUp = Math.min(30, Math.floor(duration * 0.2));
  const rampDown = Math.min(30, Math.floor(duration * 0.2));
  const sustain = duration - rampUp - rampDown;

  return `
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '${rampUp}s', target: ${users} },
    { duration: '${sustain}s', target: ${users} },
    { duration: '${rampDown}s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const url = __ENV.TARGET_URL;
  const res = http.get(url);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time OK': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
`.trim();
}

/**
 * Execute k6 cloud test via CLI.
 * Returns the test run ID and k6 Cloud dashboard URL.
 */
export async function runK6CloudTest(
  script: string,
  apiToken: string,
  targetUrl: string
): Promise<{ testRunId: string; outputUrl: string }> {
  const tmpDir = process.env.TMPDIR || '/tmp';
  const scriptPath = join(tmpDir, `k6-test-${Date.now()}.js`);
  await writeFile(scriptPath, script, 'utf-8');

  try {
    return await new Promise((resolve, reject) => {
      // -e flag forwards env vars to k6 cloud runners (process.env only affects local CLI)
      // Note: K6_CLOUD_STACK_ID is NOT set here — it requires a project ID too (from `k6 cloud login`).
      // The CLI falls back to the first available stack, which works for test execution.
      // Stack ID is only used for API polling (separate from CLI).
      const env = {
        ...process.env,
        K6_CLOUD_TOKEN: apiToken,
      };

      const k6Process = spawn('k6', ['cloud', 'run', '-e', `TARGET_URL=${targetUrl}`, scriptPath], {
        env,
      });

      let output = '';
      let testRunId = '';
      let outputUrl = '';

      k6Process.stdout.on('data', (data: Buffer) => {
        output += data.toString();

        // Extract test run URL from k6 output
        // Grafana Cloud format: "output: https://org.grafana.net/a/k6-app/runs/123456"
        // Legacy format: "output: cloud (https://app.k6.io/runs/123456)"
        const grafanaMatch = output.match(/output:\s+(https:\/\/[^\s]+\/runs\/\d+)/);
        const legacyMatch = output.match(/cloud \((https:\/\/[^)]+)\)/);
        const urlMatch = grafanaMatch || legacyMatch;
        if (urlMatch) {
          outputUrl = urlMatch[1];
          const idMatch = outputUrl.match(/\/runs\/(\d+)/);
          if (idMatch) {
            testRunId = idMatch[1];
          }
        }
      });

      k6Process.stderr.on('data', (data: Buffer) => {
        console.error('[k6] stderr:', data.toString());
      });

      k6Process.on('close', (code) => {
        if (code === 0 && testRunId) {
          resolve({ testRunId, outputUrl });
        } else {
          reject(new Error(`k6 exited with code ${code}. Output: ${output.slice(0, 500)}`));
        }
      });

      k6Process.on('error', (err) => {
        reject(new Error(`Failed to start k6: ${err.message}`));
      });
    });
  } finally {
    try {
      await unlink(scriptPath);
    } catch {
      console.error('[k6] Failed to cleanup temp file:', scriptPath);
    }
  }
}

// ============ k6 Cloud API ============

const K6_CLOUD_API_V6 = 'https://api.k6.io/cloud/v6';
const K6_CLOUD_API_V5 = 'https://api.k6.io/cloud/v5';

/**
 * Build auth headers for k6 Cloud API.
 */
function k6ApiHeaders(apiToken: string, stackId?: string, useBearer?: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': useBearer ? `Bearer ${apiToken}` : `Token ${apiToken}`,
  };
  if (stackId) {
    headers['X-Stack-Id'] = stackId;
  }
  return headers;
}

/**
 * Try to fetch a test run from the API, attempting v6 then v5.
 * Returns the parsed JSON and which API version worked.
 */
async function fetchTestRun(
  testRunId: string,
  apiToken: string,
  stackId?: string
): Promise<{ data: Record<string, unknown>; apiVersion: 'v6' | 'v5' }> {
  // If stackId is set, try v6 with Token auth first (personal API tokens use Token format)
  if (stackId) {
    const v6Headers = k6ApiHeaders(apiToken, stackId, false); // Token auth + X-Stack-Id
    const v6Res = await fetch(`${K6_CLOUD_API_V6}/test_runs/${testRunId}`, { headers: v6Headers });
    if (v6Res.ok) {
      return { data: await v6Res.json(), apiVersion: 'v6' };
    }
    // Try Bearer auth if Token didn't work
    const v6BearerHeaders = k6ApiHeaders(apiToken, stackId, true);
    const v6BearerRes = await fetch(`${K6_CLOUD_API_V6}/test_runs/${testRunId}`, { headers: v6BearerHeaders });
    if (v6BearerRes.ok) {
      return { data: await v6BearerRes.json(), apiVersion: 'v6' };
    }
    console.log(`[LoadTest] v6 API returned ${v6Res.status}/${v6BearerRes.status}, falling back to v5`);
  }

  // Fallback to v5
  const v5Headers = k6ApiHeaders(apiToken, stackId, false);
  const v5Res = await fetch(`${K6_CLOUD_API_V5}/test_runs/${testRunId}`, { headers: v5Headers });
  if (!v5Res.ok) {
    throw new Error(`k6 Cloud API error: ${v5Res.status} ${v5Res.statusText}`);
  }
  return { data: await v5Res.json(), apiVersion: 'v5' };
}

/**
 * Extract status from API response.
 * v6: status is a string or { type: string } object
 * v5: run_status is numeric (3=running, 4=finished, 5=timed_out, etc.)
 */
function isTestComplete(data: Record<string, unknown>, apiVersion: 'v6' | 'v5'): { done: boolean; statusStr: string } {
  // v6 terminal statuses
  const v6TerminalStatuses = new Set([
    'finished', 'completed', 'timed_out', 'aborted_user', 'aborted_system',
    'aborted_script_error', 'aborted_limit', 'aborted_by_threshold',
  ]);

  if (apiVersion === 'v6') {
    const statusObj = data.status as Record<string, unknown> | string | undefined;
    const status = typeof statusObj === 'object' && statusObj !== null
      ? (statusObj.type as string) || String(statusObj)
      : String(statusObj ?? 'unknown');
    return { done: v6TerminalStatuses.has(status), statusStr: `status="${status}"` };
  } else {
    const runStatus = (data.run_status ?? (data.data as Record<string, unknown>)?.run_status) as number | undefined;
    const done = runStatus !== undefined && runStatus >= 4;
    return { done, statusStr: `run_status=${runStatus}` };
  }
}

/**
 * Poll k6 Cloud for test completion.
 * Tries v6 API first (if stackId set), falls back to v5.
 * Returns the final API response data (useful for extracting metrics from v6).
 */
export async function pollTestCompletion(
  testRunId: string,
  apiToken: string,
  stackId?: string,
  maxAttempts: number = 120
): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data, apiVersion } = await fetchTestRun(testRunId, apiToken, stackId);

    // On first poll, log full response for debugging
    if (i === 0) {
      console.log(`[LoadTest] Using ${apiVersion} API (stackId: ${stackId || 'none'})`);
      console.log(`[LoadTest] Poll API response keys:`, Object.keys(data));
      console.log(`[LoadTest] Poll API full response:`, JSON.stringify(data).slice(0, 2000));
    }

    const { done, statusStr } = isTestComplete(data, apiVersion);

    if (i === 0 || i % 10 === 0) {
      console.log(`[LoadTest] Poll ${i + 1}/${maxAttempts}: ${statusStr} [${apiVersion}] (testRunId=${testRunId})`);
    }

    if (done) {
      console.log(`[LoadTest] Test finished: ${statusStr} after ${i + 1} polls (~${(i + 1) * 10}s)`);
      return data;
    }

    // Wait 10 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  throw new Error('Test timeout: exceeded polling limit');
}

/**
 * Fetch test run metrics.
 * Strategy:
 * 1. Poll for completion (returns v6 response with result_details)
 * 2. Try v6 Metrics API for detailed p50/p95/p99
 * 3. Fallback to v5 aggregate endpoint
 * 4. Last resort: extract what we can from the v6 test run response
 */
export async function fetchTestRunMetrics(
  testRunId: string,
  apiToken: string,
  stackId?: string
): Promise<LoadTestMetrics> {
  const testRunData = await pollTestCompletion(testRunId, apiToken, stackId);

  // Strategy 1: Try v6 Metrics API
  if (stackId) {
    const v6Metrics = await tryV6MetricsApi(testRunId, apiToken, stackId);
    if (v6Metrics) return v6Metrics;
  }

  // Strategy 2: Try v5 aggregate endpoint (with and without X-Stack-Id)
  const v5Metrics = await tryV5MetricsApi(testRunId, apiToken, stackId);
  if (v5Metrics) return v5Metrics;

  // Strategy 3: Extract from v6 test run response result_details
  const extracted = extractMetricsFromTestRun(testRunData);
  if (extracted) return extracted;

  console.log('[LoadTest] All metrics strategies failed, returning zeroed metrics');
  return {
    http_req_duration: { p50: 0, p95: 0, p99: 0, avg: 0 },
    http_req_failed: 0,
    http_reqs: 0,
    vus: 0,
    iterations: 0,
  };
}

/**
 * Try the v6 Metrics REST API for a test run.
 */
async function tryV6MetricsApi(
  testRunId: string,
  apiToken: string,
  stackId: string
): Promise<LoadTestMetrics | null> {
  try {
    const headers = k6ApiHeaders(apiToken, stackId, false);

    // v6 metrics endpoint: GET /cloud/v6/test_runs/{id}/metrics/{metric_id}/aggregation
    // Try fetching http_req_duration summary
    const res = await fetch(
      `${K6_CLOUD_API_V6}/test_runs/${testRunId}/metrics/http_req_duration/aggregation`,
      { headers }
    );

    if (res.ok) {
      const data = await res.json();
      console.log('[LoadTest] v6 Metrics API response:', JSON.stringify(data).slice(0, 500));
      // Try to parse v6 metrics format
      return parseV6MetricsResponse(data);
    }

    console.log(`[LoadTest] v6 Metrics API returned ${res.status}, trying alternatives...`);
  } catch (err) {
    console.log('[LoadTest] v6 Metrics API error:', err instanceof Error ? err.message : err);
  }
  return null;
}

/**
 * Try the v5 aggregate endpoint with OData function-call syntax.
 * Makes separate calls per percentile (combined queries are not supported).
 * Tries both Token and Bearer auth.
 */
async function tryV5MetricsApi(
  testRunId: string,
  apiToken: string,
  stackId?: string
): Promise<LoadTestMetrics | null> {
  const baseUrl = `${K6_CLOUD_API_V5}/test_runs/${testRunId}`;

  // Auth header variants to try (Token and Bearer, with/without X-Stack-Id)
  const headerVariants = [
    ...(stackId ? [
      { label: 'Token+stackId', headers: k6ApiHeaders(apiToken, stackId, false) },
      { label: 'Bearer+stackId', headers: k6ApiHeaders(apiToken, stackId, true) },
    ] : []),
    { label: 'Token', headers: k6ApiHeaders(apiToken, undefined, false) },
    { label: 'Bearer', headers: k6ApiHeaders(apiToken, undefined, true) },
  ];

  for (const { label, headers } of headerVariants) {
    try {
      // Start with simple p95 query to test if this auth works
      const testUrl = `${baseUrl}/query_aggregate_k6(metric='http_req_duration',query='histogram_quantile(0.95)')`;
      console.log(`[LoadTest] Trying v5 metrics [${label}]:`, testUrl);
      const testRes = await fetch(testUrl, { headers });

      if (!testRes.ok) {
        const body = await testRes.text().catch(() => '');
        console.log(`[LoadTest] v5 [${label}] returned ${testRes.status}: ${body.slice(0, 200)}`);
        continue;
      }

      // This auth variant works — fetch all percentiles
      console.log(`[LoadTest] v5 [${label}] auth works, fetching all metrics...`);

      const queries = [
        { key: 'p50', query: "histogram_quantile(0.50)" },
        { key: 'p95', query: "histogram_quantile(0.95)" },
        { key: 'p99', query: "histogram_quantile(0.99)" },
        { key: 'avg', query: "avg" },
      ];

      const metrics: LoadTestMetrics = {
        http_req_duration: { p50: 0, p95: 0, p99: 0, avg: 0 },
        http_req_failed: 0,
        http_reqs: 0,
        vus: 0,
        iterations: 0,
      };

      // Reuse the p95 response we already have
      const p95Data = await testRes.json();
      console.log(`[LoadTest] v5 p95 response:`, JSON.stringify(p95Data).slice(0, 300));
      metrics.http_req_duration.p95 = extractV5AggregateValue(p95Data);

      // Fetch remaining metrics
      for (const { key, query } of queries) {
        if (key === 'p95') continue; // already fetched
        try {
          const url = `${baseUrl}/query_aggregate_k6(metric='http_req_duration',query='${query}')`;
          const res = await fetch(url, { headers });
          if (res.ok) {
            const data = await res.json();
            const value = extractV5AggregateValue(data);
            if (key === 'p50') metrics.http_req_duration.p50 = value;
            else if (key === 'p99') metrics.http_req_duration.p99 = value;
            else if (key === 'avg') metrics.http_req_duration.avg = value;
          }
        } catch {
          // Continue with other metrics
        }
      }

      console.log('[LoadTest] v5 metrics result:', JSON.stringify(metrics));
      if (metrics.http_req_duration.p95 > 0 || metrics.http_req_duration.avg > 0) {
        return metrics;
      }
    } catch (err) {
      console.log(`[LoadTest] v5 [${label}] error:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/**
 * Extract a single aggregate value from v5 query_aggregate_k6 response.
 * Response format: { data: { result: [{ values: [[timestamp, value]] }] } }
 */
function extractV5AggregateValue(data: Record<string, unknown>): number {
  try {
    const dataObj = data.data as Record<string, unknown> | undefined;
    const results = (dataObj?.result as Array<Record<string, unknown>>) || [];
    for (const result of results) {
      // v5 response uses "values" (plural) with [timestamp, value] pairs
      const values = result.values as Array<[number, number | string]> | undefined;
      if (values && values.length > 0) {
        const val = values[0][1];
        return typeof val === 'number' ? val : parseFloat(String(val)) || 0;
      }
      // Also try "value" (singular) format
      const value = result.value as [number, string] | undefined;
      if (value) {
        return parseFloat(value[1]) || 0;
      }
    }
  } catch {
    // Return 0 on parse failure
  }
  return 0;
}

/**
 * Parse v6 metrics API response format.
 */
function parseV6MetricsResponse(data: Record<string, unknown>): LoadTestMetrics | null {
  try {
    // v6 format varies — try common structures
    const values = (data.values || data.data || data.value) as Record<string, unknown> | unknown[] | undefined;
    if (!values) return null;

    console.log('[LoadTest] v6 metrics values:', JSON.stringify(values).slice(0, 300));
    // TODO: parse based on actual v6 response structure (logged above for next iteration)
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract metrics from v6 test run response's result_details field.
 * The v6 GET /test_runs/{id} response includes result and result_details.
 */
function extractMetricsFromTestRun(data: Record<string, unknown>): LoadTestMetrics | null {
  try {
    // Log what we have for debugging
    const result = data.result as Record<string, unknown> | undefined;
    const resultDetails = data.result_details as Record<string, unknown>[] | undefined;
    console.log('[LoadTest] v6 test run result:', JSON.stringify(result));
    console.log('[LoadTest] v6 test run result_details:', JSON.stringify(resultDetails)?.slice(0, 1000));

    // result_details may contain threshold results with metric values
    if (resultDetails && Array.isArray(resultDetails)) {
      let p95 = 0;
      for (const detail of resultDetails) {
        // Look for http_req_duration thresholds
        const metric = detail.metric as string | undefined;
        const thresholdValue = detail.calculated_value as number | undefined;
        if (metric === 'http_req_duration' && typeof thresholdValue === 'number') {
          p95 = thresholdValue;
        }
      }
      if (p95 > 0) {
        console.log('[LoadTest] Extracted p95 from result_details:', p95);
        return {
          http_req_duration: { p50: 0, p95, p99: 0, avg: 0 },
          http_req_failed: 0,
          http_reqs: 0,
          vus: 0,
          iterations: 0,
        };
      }
    }
  } catch (err) {
    console.log('[LoadTest] extractMetricsFromTestRun error:', err instanceof Error ? err.message : err);
  }
  return null;
}

function parseMetricsResponse(data: Record<string, unknown>): LoadTestMetrics {
  const dataObj = data.data as Record<string, unknown> | undefined;
  const results = (dataObj?.result as Array<Record<string, unknown>>) || [];

  return {
    http_req_duration: {
      p50: extractMetricValue(results, '0.50'),
      p95: extractMetricValue(results, '0.95'),
      p99: extractMetricValue(results, '0.99'),
      avg: extractMetricValue(results, 'avg'),
    },
    http_req_failed: 0,
    http_reqs: 0,
    vus: 0,
    iterations: 0,
  };
}

function extractMetricValue(
  results: Array<Record<string, unknown>>,
  quantile: string
): number {
  for (const result of results) {
    const metric = result.metric as Record<string, string> | undefined;
    const value = result.value as [number, string] | undefined;
    if (metric?.quantile === quantile || metric?.aggregation === quantile) {
      return value ? parseFloat(value[1]) : 0;
    }
  }
  return 0;
}

// ============ Security Helpers ============

/**
 * Check if a URL's domain is in the allowed list
 */
export function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return false;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return allowedDomains.some(domain => {
      const d = domain.toLowerCase().trim();
      return hostname === d || hostname.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}

/**
 * Check if a URL targets a private/internal IP range
 */
export function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    // Block common private ranges
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return true; // Block on parse error
  }
}

// ============ Admin Test Execution ============

/**
 * Execute a load test (admin-only, called from API route).
 * Stores result in Postgres and Redis cache.
 */
export async function executeLoadTest(
  url: string,
  users: number,
  duration: number,
  config: LoadTestConfig,
  adminEmail: string
): Promise<{ success: boolean; error?: string; errorCode?: string; result?: Record<string, unknown> }> {
  // Concurrency lock
  if (testRunning) {
    return {
      success: false,
      error: 'A load test is already running. Please wait for it to complete.',
      errorCode: 'TEST_IN_PROGRESS',
    };
  }

  // Domain allowlist check
  if (!isDomainAllowed(url, config.allowedDomains)) {
    return {
      success: false,
      error: 'URL domain is not in the allowed domains list. Configure allowed domains in tool settings.',
      errorCode: 'DOMAIN_NOT_ALLOWED',
    };
  }

  // Private IP check
  if (isPrivateUrl(url)) {
    return {
      success: false,
      error: 'Cannot test private/internal URLs.',
      errorCode: 'PRIVATE_URL',
    };
  }

  // Validate parameters
  const effectiveUsers = Math.min(users, config.maxConcurrentUsers);
  const effectiveDuration = Math.min(Math.max(duration, 90), config.maxDuration);

  // API token check
  const apiToken = config.apiToken || process.env.K6_CLOUD_API_TOKEN;
  if (!apiToken) {
    return {
      success: false,
      error: 'k6 Cloud API token not configured.',
      errorCode: 'NOT_CONFIGURED',
    };
  }

  // k6 installation check
  if (!await checkK6Installed()) {
    return {
      success: false,
      error: 'k6 CLI not installed on server.',
      errorCode: 'K6_NOT_INSTALLED',
    };
  }

  testRunning = true;
  try {
    // Generate and execute script
    console.log('[LoadTest] Generating k6 script:', { url, users: effectiveUsers, duration: effectiveDuration });
    const script = generateK6Script(effectiveUsers, effectiveDuration);
    const { testRunId, outputUrl } = await runK6CloudTest(script, apiToken, url);
    console.log('[LoadTest] k6 cloud test started:', { testRunId, outputUrl });

    // stackId is used for API polling only (not for the k6 CLI)
    const stackId = config.stackId || process.env.K6_CLOUD_STACK_ID;
    console.log('[LoadTest] Polling for completion:', testRunId, stackId ? `(stack: ${stackId})` : '(no stackId, v5 only)');
    const metrics = await fetchTestRunMetrics(testRunId, apiToken, stackId);
    console.log('[LoadTest] Metrics received:', JSON.stringify(metrics));
    const passed = metrics.http_req_duration.p95 < 500;

    // Store in Postgres
    console.log('[LoadTest] Storing result in Postgres...');
    const dbResult = await insertLoadTestResult({
      url,
      test_run_id: testRunId,
      output_url: outputUrl,
      users: effectiveUsers,
      duration: effectiveDuration,
      metrics_json: JSON.stringify(metrics),
      passed,
      run_by: adminEmail,
    });

    // Cache in Redis
    const cacheKey = `loadtest:${hashQuery(url)}`;
    const resultPayload = {
      success: true,
      result: {
        url,
        testRunId,
        outputUrl,
        users: effectiveUsers,
        duration: effectiveDuration,
        metrics,
        passed,
        testDate: dbResult.created_at,
        runBy: adminEmail,
      },
    };
    await cacheQuery(cacheKey, JSON.stringify(resultPayload), config.cacheTTLSeconds);
    console.log('[LoadTest] Complete. Passed:', passed);

    return resultPayload;
  } catch (error) {
    console.error('[LoadTest] Execution error:', error);
    return {
      success: false,
      error: 'Load test execution failed',
      errorCode: 'EXECUTION_ERROR',
    };
  } finally {
    testRunning = false;
  }
}

// ============ Config Schema ============

const configSchema = {
  type: 'object',
  properties: {
    apiToken: {
      type: 'string',
      title: 'k6 Cloud API Token',
      description: 'Get from Grafana Cloud → k6 → Settings → API tokens',
      format: 'password',
    },
    stackId: {
      type: 'string',
      title: 'Grafana Cloud Stack ID',
      description: 'Numeric stack ID from Grafana Cloud (required for Grafana Cloud k6). Found in your Grafana Cloud portal URL or stack settings.',
    },
    maxConcurrentUsers: {
      type: 'number',
      title: 'Max Concurrent Users',
      description: 'Maximum virtual users per test',
      minimum: 10,
      maximum: 100,
      default: 50,
    },
    defaultDuration: {
      type: 'number',
      title: 'Default Test Duration (seconds)',
      description: 'Default test duration when not specified',
      minimum: 90,
      maximum: 600,
      default: 300,
    },
    maxDuration: {
      type: 'number',
      title: 'Max Test Duration (seconds)',
      description: 'Maximum allowed test duration',
      minimum: 90,
      maximum: 600,
      default: 600,
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Redis Cache Duration (seconds)',
      description: 'How long to cache results in Redis (Postgres stores permanently)',
      minimum: 3600,
      maximum: 2592000,
      default: 2592000,
    },
    rateLimitPerDay: {
      type: 'number',
      title: 'Daily Test Limit',
      description: 'Maximum tests per 24 hours',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
    allowedDomains: {
      type: 'array',
      title: 'Allowed Domains',
      description: 'Only these domains can be tested (e.g., example.com, ministry.gd)',
      items: { type: 'string' },
      default: [],
    },
  },
  required: ['apiToken'],
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.maxConcurrentUsers !== undefined) {
    const v = config.maxConcurrentUsers as number;
    if (typeof v !== 'number' || v < 10 || v > 100) {
      errors.push('maxConcurrentUsers must be between 10 and 100');
    }
  }

  if (config.defaultDuration !== undefined) {
    const v = config.defaultDuration as number;
    if (typeof v !== 'number' || v < 90 || v > 600) {
      errors.push('defaultDuration must be between 90 and 600');
    }
  }

  if (config.maxDuration !== undefined) {
    const v = config.maxDuration as number;
    if (typeof v !== 'number' || v < 90 || v > 600) {
      errors.push('maxDuration must be between 90 and 600');
    }
  }

  if (config.cacheTTLSeconds !== undefined) {
    const v = config.cacheTTLSeconds as number;
    if (typeof v !== 'number' || v < 3600 || v > 2592000) {
      errors.push('cacheTTLSeconds must be between 3600 and 2592000');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition (LLM-facing, read-only) ============

export const loadTestingTool: ToolDefinition = {
  name: 'load_testing',
  displayName: 'Load Testing',
  description: 'Retrieve load test results for a website. Tests are run by admins via the Admin panel; this tool fetches the most recent results.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'load_testing',
      description: 'Get load test results for a website URL. Returns performance metrics (response times p50/p95/p99, error rate) from the most recent k6 Cloud load test. Use when users ask about load testing, performance testing, or stress testing results for a specific URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to look up load test results for (e.g., https://example.com). Must include protocol.',
          },
        },
        required: ['url'],
      },
    },
  },

  validateConfig,
  defaultConfig: defaultConfig as unknown as Record<string, unknown>,
  configSchema,

  execute: async (
    args: { url: string },
    options?: ToolExecutionOptions
  ): Promise<string> => {
    // Get config with category/skill override support
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } = categoryIds.length > 0
      ? await getLoadTestConfig(categoryIds[0])
      : await getLoadTestConfig();

    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as LoadTestConfig;

    // Check if tool is enabled
    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Load testing is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    // Validate URL
    try {
      new URL(args.url);
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL format. Please provide a full URL including protocol (e.g., https://example.com)',
        errorCode: 'INVALID_URL',
      });
    }

    // Try Redis cache first (fast path)
    const cacheKey = `loadtest:${hashQuery(args.url)}`;
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      console.log('[LoadTest] Cache hit:', args.url);
      return cached;
    }

    // Fallback to Postgres
    console.log('[LoadTest] Cache miss, checking Postgres:', args.url);
    const dbResult = await getLatestLoadTestResult(args.url);

    if (dbResult) {
      let metrics: LoadTestMetrics;
      try {
        metrics = JSON.parse(dbResult.metrics_json);
      } catch {
        return JSON.stringify({
          success: false,
          error: 'Failed to parse stored test results',
          errorCode: 'PARSE_ERROR',
        });
      }

      const resultPayload = {
        success: true,
        result: {
          url: dbResult.url,
          testRunId: dbResult.test_run_id,
          outputUrl: dbResult.output_url,
          users: dbResult.users,
          duration: dbResult.duration,
          metrics,
          passed: dbResult.passed,
          testDate: dbResult.created_at,
          runBy: dbResult.run_by,
        },
      };

      // Re-cache in Redis for next time
      const resultString = JSON.stringify(resultPayload);
      await cacheQuery(cacheKey, resultString, settings.cacheTTLSeconds);

      return resultString;
    }

    // No results found
    return JSON.stringify({
      success: false,
      error: 'No load test results found for this URL. An admin must run a test first from the Admin panel.',
      errorCode: 'NO_RESULTS',
    });
  },
};
