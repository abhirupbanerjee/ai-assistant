import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import type { ApiError } from '@/types';

interface RerankerProviderStatus {
  provider: string;
  name: string;
  available: boolean;
  configured: boolean;
  error?: string;
  latency?: number;
}

/**
 * Test Cohere API availability
 */
async function testCohere(): Promise<{ available: boolean; configured: boolean; error?: string; latency?: number }> {
  const apiKey = process.env.COHERE_API_KEY;

  if (!apiKey || apiKey === 'your-cohere-api-key-here') {
    return { available: false, configured: false, error: 'COHERE_API_KEY not configured' };
  }

  const startTime = Date.now();

  try {
    // Test with a minimal rerank request
    const response = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'rerank-english-v3.0',
        query: 'test',
        documents: ['test document'],
        top_n: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return { available: true, configured: true, latency };
    }

    // Check for specific error types
    const errorData = await response.json().catch(() => null);
    const errorMsg = errorData?.message || `HTTP ${response.status}`;

    if (response.status === 401) {
      return { available: false, configured: true, error: 'Invalid API key' };
    }

    return { available: false, configured: true, error: errorMsg };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return { available: false, configured: true, error: 'Connection timeout' };
      }
      return { available: false, configured: true, error: error.message };
    }
    return { available: false, configured: true, error: 'Unknown error' };
  }
}

/**
 * Test Jina Reranker v2 availability (cross-encoder model)
 */
async function testJina(): Promise<{ available: boolean; configured: boolean; error?: string; latency?: number }> {
  const startTime = Date.now();

  try {
    // Try to dynamically import @xenova/transformers
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@xenova/transformers');

    // Disable local models to avoid file system issues during test
    env.allowLocalModels = false;

    // Verify the required classes exist for cross-encoder models
    if (typeof AutoTokenizer?.from_pretrained === 'function' &&
        typeof AutoModelForSequenceClassification?.from_pretrained === 'function') {
      const latency = Date.now() - startTime;
      return {
        available: true,
        configured: true,
        latency,
      };
    }

    return { available: false, configured: false, error: 'Required model classes not available' };
  } catch (error) {
    if (error instanceof Error) {
      // Check for common errors
      if (error.message.includes('onnxruntime')) {
        return {
          available: false,
          configured: true,
          error: 'ONNX runtime error - check glibc compatibility'
        };
      }
      if (error.message.includes('MODULE_NOT_FOUND') || error.message.includes('Cannot find module')) {
        return {
          available: false,
          configured: false,
          error: '@xenova/transformers not installed'
        };
      }
      return { available: false, configured: true, error: error.message };
    }
    return { available: false, configured: false, error: 'Unknown error' };
  }
}

/**
 * Test local reranker availability (legacy bi-encoder, checks if @xenova/transformers is available)
 */
async function testLocal(): Promise<{ available: boolean; configured: boolean; error?: string; latency?: number }> {
  const startTime = Date.now();

  try {
    // Try to dynamically import @xenova/transformers
    // This tests if the package is installed and loadable
    const { pipeline, env } = await import('@xenova/transformers');

    // Disable local models to avoid file system issues during test
    env.allowLocalModels = false;

    // Just verify the pipeline function exists
    if (typeof pipeline === 'function') {
      const latency = Date.now() - startTime;
      return {
        available: true,
        configured: true,
        latency,
      };
    }

    return { available: false, configured: false, error: 'Pipeline not available' };
  } catch (error) {
    if (error instanceof Error) {
      // Check for common errors
      if (error.message.includes('onnxruntime')) {
        return {
          available: false,
          configured: true,
          error: 'ONNX runtime error - check glibc compatibility'
        };
      }
      if (error.message.includes('MODULE_NOT_FOUND') || error.message.includes('Cannot find module')) {
        return {
          available: false,
          configured: false,
          error: '@xenova/transformers not installed'
        };
      }
      return { available: false, configured: true, error: error.message };
    }
    return { available: false, configured: false, error: 'Unknown error' };
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Test all reranker providers in parallel
    const [cohereResult, jinaResult, localResult] = await Promise.all([
      testCohere(),
      testJina(),
      testLocal(),
    ]);

    const providers: RerankerProviderStatus[] = [
      {
        provider: 'cohere',
        name: 'Cohere API',
        ...cohereResult,
      },
      {
        provider: 'jina',
        name: 'Jina Reranker v2 (Cross-encoder)',
        ...jinaResult,
      },
      {
        provider: 'local',
        name: 'Legacy Local (Bi-encoder)',
        ...localResult,
      },
    ];

    return NextResponse.json({
      providers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Reranker status check error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to check reranker status',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
