import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireElevated } from '@/lib/auth';
import { getRedisClient } from '@/lib/redis';

// GET - Fetch cache stats and info
export async function GET() {
  try {
    await requireElevated();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && (error.message === 'Elevated access required' || error.message === 'Admin access required')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    throw error;
  }

  try {
    const redis = await getRedisClient();

    // Get memory info
    const infoString = await redis.info('memory');
    const memoryInfo = parseRedisInfo(infoString);

    // Get server info for uptime
    const serverInfoString = await redis.info('server');
    const serverInfo = parseRedisInfo(serverInfoString);

    // Get key counts by pattern
    const queryKeys = await redis.keys('query:*');
    const tavilyKeys = await redis.keys('tavily:*');
    const dataApiKeys = await redis.keys('data_api:*');
    const functionApiKeys = await redis.keys('function_api:*');

    // Get config (maxmemory)
    const maxmemoryConfig = await redis.configGet('maxmemory');
    const maxmemoryPolicyConfig = await redis.configGet('maxmemory-policy');

    const maxmemoryValue = maxmemoryConfig.maxmemory || '0';
    const maxmemoryPolicyValue = maxmemoryPolicyConfig['maxmemory-policy'] || 'noeviction';

    return NextResponse.json({
      memory: {
        used: memoryInfo.used_memory_human || 'N/A',
        usedBytes: parseInt(memoryInfo.used_memory || '0'),
        peak: memoryInfo.used_memory_peak_human || 'N/A',
        peakBytes: parseInt(memoryInfo.used_memory_peak || '0'),
        rss: memoryInfo.used_memory_rss_human || 'N/A',
      },
      config: {
        maxmemory: maxmemoryValue,
        maxmemoryHuman: formatBytes(parseInt(maxmemoryValue)),
        maxmemoryPolicy: maxmemoryPolicyValue,
      },
      keys: {
        rag: queryKeys.length,
        tavily: tavilyKeys.length,
        dataApi: dataApiKeys.length,
        functionApi: functionApiKeys.length,
        total: queryKeys.length + tavilyKeys.length + dataApiKeys.length + functionApiKeys.length,
      },
      uptime: serverInfo.uptime_in_seconds
        ? formatUptime(parseInt(serverInfo.uptime_in_seconds))
        : 'N/A',
    });
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    return NextResponse.json({ error: 'Failed to get cache stats' }, { status: 500 });
  }
}

// POST - Flush cache or update config
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    throw error;
  }

  try {
    const { action, value } = await request.json();
    const redis = await getRedisClient();

    switch (action) {
      case 'flush-rag': {
        const keys = await redis.keys('query:*');
        if (keys.length > 0) {
          await redis.del(keys);
        }
        return NextResponse.json({ success: true, deleted: keys.length, type: 'RAG' });
      }

      case 'flush-tavily': {
        const keys = await redis.keys('tavily:*');
        if (keys.length > 0) {
          await redis.del(keys);
        }
        return NextResponse.json({ success: true, deleted: keys.length, type: 'Tavily' });
      }

      case 'flush-data-api': {
        const keys = await redis.keys('data_api:*');
        if (keys.length > 0) {
          await redis.del(keys);
        }
        return NextResponse.json({ success: true, deleted: keys.length, type: 'Data API' });
      }

      case 'flush-function-api': {
        const keys = await redis.keys('function_api:*');
        if (keys.length > 0) {
          await redis.del(keys);
        }
        return NextResponse.json({ success: true, deleted: keys.length, type: 'Function API' });
      }

      case 'flush-all': {
        await redis.flushAll();
        return NextResponse.json({ success: true, type: 'All' });
      }

      case 'set-maxmemory': {
        // Value should be in MB, convert to bytes
        const bytes = parseInt(value) * 1024 * 1024;
        await redis.configSet('maxmemory', bytes.toString());
        return NextResponse.json({ success: true, maxmemory: bytes });
      }

      case 'set-policy': {
        // Valid policies
        const validPolicies = [
          'noeviction',
          'allkeys-lru',
          'allkeys-lfu',
          'volatile-lru',
          'volatile-lfu',
          'allkeys-random',
          'volatile-random',
          'volatile-ttl'
        ];
        if (!validPolicies.includes(value)) {
          return NextResponse.json({ error: 'Invalid policy' }, { status: 400 });
        }
        await redis.configSet('maxmemory-policy', value);
        return NextResponse.json({ success: true, policy: value });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Cache operation failed:', error);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}

// Helper: Parse Redis INFO output
function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {};
  info.split('\n').forEach(line => {
    const [key, value] = line.split(':');
    if (key && value) {
      result[key.trim()] = value.trim();
    }
  });
  return result;
}

// Helper: Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return 'No Limit';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: Format uptime to human readable
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}
