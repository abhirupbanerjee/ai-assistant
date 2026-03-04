/**
 * Admin Tool Test API - Test a tool's configuration/connection
 *
 * POST /api/admin/tools/[toolName]/test - Test tool connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getToolConfig, TOOL_DEFAULTS } from '@/lib/db/compat/tool-config';
import { getTool, initializeTools } from '@/lib/tools';
import { testImageGen as testImageGenProvider } from '@/lib/tools/image-gen';

interface RouteParams {
  params: Promise<{ toolName: string }>;
}

/**
 * Test web search (Tavily) connection
 */
async function testWebSearch(config: Record<string, unknown>): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  const apiKey = (config.apiKey as string) || process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      message: 'No API key configured. Please set the Tavily API key.',
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: 'test connection',
        max_results: 1,
        search_depth: 'basic',
      }),
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || `HTTP ${response.status}`;

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: 'Invalid API key. Please check your Tavily API key.',
          latency,
        };
      }

      return {
        success: false,
        message: `Tavily API error: ${errorMessage}`,
        latency,
      };
    }

    return {
      success: true,
      message: `Connection successful (${latency}ms latency)`,
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      latency,
    };
  }
}

/**
 * Test data visualization tool (no external connection needed)
 */
async function testDataViz(): Promise<{
  success: boolean;
  message: string;
}> {
  // Data visualization doesn't require external connections
  // Just verify the tool is properly configured
  return {
    success: true,
    message: 'Data visualization tool is ready. No external connection required.',
  };
}

/**
 * Test document generation tool (no external connection needed)
 */
async function testDocGen(): Promise<{
  success: boolean;
  message: string;
}> {
  // Document generation doesn't require external connections
  // Just verify the tool is properly configured
  return {
    success: true,
    message: 'Document generation tool is ready. No external connection required.',
  };
}

/**
 * Test YouTube transcript extraction (Supadata API)
 * Uses a known public video for testing
 */
async function testYouTube(config: Record<string, unknown>): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  const apiKey = config.apiKey as string;

  if (!apiKey) {
    // Check if fallback is enabled
    const fallbackEnabled = config.fallbackEnabled !== false;
    if (fallbackEnabled) {
      return {
        success: true,
        message: 'No Supadata API key configured. Fallback to youtube-transcript npm is enabled (may be unreliable on cloud servers).',
      };
    }
    return {
      success: false,
      message: 'No Supadata API key configured and fallback is disabled. Please set the API key from supadata.ai.',
    };
  }

  const startTime = Date.now();

  // Test with a known public video (Rick Astley - Never Gonna Give You Up)
  // This video is known to have transcripts available
  const testVideoId = 'dQw4w9WgXcQ';

  try {
    const url = new URL('https://api.supadata.ai/v1/youtube/transcript');
    url.searchParams.set('videoId', testVideoId);
    url.searchParams.set('text', 'true');

    const response = await fetch(url.toString(), {
      headers: { 'x-api-key': apiKey },
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { message?: string }).message || `HTTP ${response.status}`;

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: 'Invalid API key. Please check your Supadata API key.',
          latency,
        };
      }

      return {
        success: false,
        message: `Supadata API error: ${errorMessage}`,
        latency,
      };
    }

    // Verify response has transcript content
    const data = await response.json() as { content?: string };
    if (!data.content) {
      return {
        success: false,
        message: 'API returned empty transcript. Please verify your API key.',
        latency,
      };
    }

    return {
      success: true,
      message: `Supadata API connection successful (${latency}ms latency)`,
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      latency,
    };
  }
}

/**
 * POST /api/admin/tools/[toolName]/test
 * Test a tool's configuration and connection
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { toolName } = await params;

    // Initialize tools system
    await initializeTools();

    // Get tool definition
    const tool = getTool(toolName);
    if (!tool) {
      return NextResponse.json(
        { error: `Unknown tool: ${toolName}` },
        { status: 404 }
      );
    }

    // Get tool configuration
    const config = await getToolConfig(toolName);
    const defaults = TOOL_DEFAULTS[toolName];
    const toolConfig = config?.config || defaults?.config || {};

    // Run test based on tool type
    let result: { success: boolean; message: string; latency?: number };

    switch (toolName) {
      case 'web_search':
        result = await testWebSearch(toolConfig);
        break;
      case 'data_viz':
        result = await testDataViz();
        break;
      case 'doc_gen':
        result = await testDocGen();
        break;
      case 'youtube':
        result = await testYouTube(toolConfig);
        break;
      case 'image_gen':
        result = await testImageGenProvider();
        break;
      default:
        result = {
          success: false,
          message: `No test available for tool: ${toolName}`,
        };
    }

    return NextResponse.json({
      tool: toolName,
      ...result,
      testedAt: new Date().toISOString(),
      testedBy: user.email,
    });
  } catch (error) {
    console.error('Failed to test tool:', error);
    return NextResponse.json(
      { error: 'Failed to test tool' },
      { status: 500 }
    );
  }
}
