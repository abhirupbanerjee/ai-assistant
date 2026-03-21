/**
 * Admin Function API - Test connection
 *
 * POST /api/admin/function-apis/[id]/test - Test the API connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getFunctionAPIConfig,
  updateFunctionAPITestStatus,
} from '@/lib/db/compat';
import type { FunctionAPIConfig, FunctionAPITestResult } from '@/types/function-api';

/**
 * Build authentication headers for a Function API config
 */
function buildAuthHeaders(config: FunctionAPIConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  // Add default headers
  if (config.defaultHeaders) {
    Object.assign(headers, config.defaultHeaders);
  }

  // Add authentication
  if (config.authCredentials) {
    const credentials = config.authCredentials;

    switch (config.authType) {
      case 'api_key':
        headers[config.authHeader || 'X-API-Key'] = credentials;
        break;

      case 'bearer':
        headers['Authorization'] = `Bearer ${credentials}`;
        break;

      case 'basic':
        const encoded = Buffer.from(credentials).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;

      case 'none':
      default:
        break;
    }
  }

  return headers;
}

/**
 * POST /api/admin/function-apis/[id]/test
 * Test the Function API connection by calling one of its endpoints
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const config = await getFunctionAPIConfig(id);

    if (!config) {
      return NextResponse.json(
        { error: 'Function API not found' },
        { status: 404 }
      );
    }

    // Optional: get specific function to test from request body
    const body = await request.json().catch(() => ({}));
    const testFunctionName = body.functionName;

    const startTime = Date.now();
    const functionsTested: string[] = [];
    let sampleResponse: unknown = null;

    try {
      const headers = buildAuthHeaders(config);
      const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);

      // ── Step 1: Connectivity check ─────────────────────────────────────────
      // Hit the base URL (no auth) to confirm the server is reachable at all.
      const connectivityResponse = await fetch(config.baseUrl, {
        method: 'GET',
        signal: timeout,
      });
      // Any HTTP response (even 404/401) means the server is up.
      // Only network-level errors (ENOTFOUND, timeout, etc.) reach the catch block.

      // ── Step 2: Auth check ─────────────────────────────────────────────────
      // Use the first configured endpoint with placeholder values for path params.
      // Most REST APIs (including GitHub) validate auth before routing, so:
      //   401 → bad token
      //   404 → token is valid, path just doesn't exist with placeholder values
      //   200 → full success
      const functionNames = Object.keys(config.endpointMappings);
      const functionToTest = testFunctionName || functionNames[0];

      if (!functionToTest || !config.endpointMappings[functionToTest]) {
        // Server is up but no endpoints configured to test auth
        await updateFunctionAPITestStatus(id, true);
        return NextResponse.json({
          success: true,
          message: `Server reachable (HTTP ${connectivityResponse.status}). No endpoints configured for auth check.`,
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      const endpoint = config.endpointMappings[functionToTest];
      const testPath = endpoint.path.replace(/\{[^}]+\}/g, '_test');
      const url = new URL(testPath, config.baseUrl).toString();

      const authResponse = await fetch(url, {
        method: endpoint.method,
        headers,
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      });

      functionsTested.push(functionToTest);

      // Bad auth
      if (authResponse.status === 401) {
        const errorText = await authResponse.text().catch(() => '');
        const errorMessage = `Authentication failed: invalid or missing credentials. ${errorText.substring(0, 200)}`;
        await updateFunctionAPITestStatus(id, false, errorMessage);
        return NextResponse.json({
          success: false,
          message: 'Server is reachable but authentication failed (401). Check your token.',
          functionsTested,
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      // Forbidden — auth format accepted but insufficient scope
      if (authResponse.status === 403) {
        const errorText = await authResponse.text().catch(() => '');
        const errorMessage = `Forbidden (403): token accepted but may lack required permissions. ${errorText.substring(0, 200)}`;
        await updateFunctionAPITestStatus(id, false, errorMessage);
        return NextResponse.json({
          success: false,
          message: 'Server reachable, token accepted, but access is forbidden (403). Check token scopes/permissions.',
          functionsTested,
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      // 404 with placeholder path params is expected — auth passed
      if (authResponse.status === 404) {
        await updateFunctionAPITestStatus(id, true);
        return NextResponse.json({
          success: true,
          message: 'Server reachable and authentication successful. (404 expected — endpoint requires real parameter values.)',
          functionsTested,
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      if (!authResponse.ok) {
        const errorText = await authResponse.text().catch(() => 'Unknown error');
        const errorMessage = `HTTP ${authResponse.status}: ${authResponse.statusText}. ${errorText.substring(0, 200)}`;
        await updateFunctionAPITestStatus(id, false, errorMessage);
        return NextResponse.json({
          success: false,
          message: `API returned error: ${authResponse.status} ${authResponse.statusText}`,
          functionsTested,
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      // 200 — full success, capture sample response
      try {
        sampleResponse = await authResponse.json();
      } catch {
        sampleResponse = await authResponse.text();
      }

      await updateFunctionAPITestStatus(id, true);

      return NextResponse.json({
        success: true,
        message: 'Connection successful',
        functionsTested,
        latencyMs: Date.now() - startTime,
        sampleResponse: typeof sampleResponse === 'object'
          ? JSON.stringify(sampleResponse, null, 2).substring(0, 1000)
          : String(sampleResponse).substring(0, 1000),
      } as FunctionAPITestResult);

    } catch (error) {
      let errorMessage: string;

      if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          errorMessage = `Request timed out after ${config.timeoutSeconds} seconds`;
        } else if (error.message.includes('ENOTFOUND')) {
          errorMessage = 'Could not resolve hostname';
        } else if (error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Connection refused';
        } else {
          errorMessage = error.message;
        }
      } else {
        errorMessage = 'Unknown error';
      }

      await updateFunctionAPITestStatus(id, false, errorMessage);

      return NextResponse.json({
        success: false,
        message: errorMessage,
        functionsTested,
        latencyMs: Date.now() - startTime,
      } as FunctionAPITestResult);
    }

  } catch (error) {
    console.error('Failed to test function API:', error);
    return NextResponse.json(
      { error: 'Failed to test function API' },
      { status: 500 }
    );
  }
}
