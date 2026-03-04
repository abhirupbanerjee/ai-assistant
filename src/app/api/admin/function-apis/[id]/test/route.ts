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
      // Get the first function to test, or the specified one
      const functionNames = Object.keys(config.endpointMappings);
      const functionToTest = testFunctionName || functionNames[0];

      if (!functionToTest || !config.endpointMappings[functionToTest]) {
        await updateFunctionAPITestStatus(id, false, 'No endpoints configured');
        return NextResponse.json({
          success: false,
          message: 'No endpoints configured to test',
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      const endpoint = config.endpointMappings[functionToTest];
      const url = new URL(endpoint.path, config.baseUrl).toString();

      // Build headers
      const headers = buildAuthHeaders(config);

      // Make test request
      const response = await fetch(url, {
        method: endpoint.method,
        headers,
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      });

      functionsTested.push(functionToTest);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        const errorMessage = `HTTP ${response.status}: ${response.statusText}. ${errorText.substring(0, 200)}`;

        await updateFunctionAPITestStatus(id, false, errorMessage);

        return NextResponse.json({
          success: false,
          message: `API returned error: ${response.status} ${response.statusText}`,
          functionsTested,
          latencyMs: Date.now() - startTime,
        } as FunctionAPITestResult);
      }

      // Try to parse response
      try {
        sampleResponse = await response.json();
      } catch {
        sampleResponse = await response.text();
      }

      // Success - update status
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
