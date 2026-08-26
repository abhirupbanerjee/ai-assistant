import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdminRole } from '@/lib/auth';
import { saveBatchSuite, getBatchSuites, getBatchSuiteDetail, cleanupBatchSuites } from '@/lib/db/rag-profiling';
import { createEmbedding } from '@/lib/openai';
import { getVectorStore, resolveActiveCollectionNames } from '@/lib/vector-store';
import { getRagSettings, getCategoryById } from '@/lib/db/compat';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

     const body = await request.json();
     const { queries = [], name, categoryIds = [] } = body;

     if (!Array.isArray(queries) || queries.length === 0) {
       return NextResponse.json({ error: 'At least one query is required' }, { status: 400 });
     }

     if (queries.length > 20) {
       return NextResponse.json({ error: 'Maximum 20 queries per batch' }, { status: 400 });
     }

     // Get current RAG settings
     const settings = await getRagSettings();
     const store = await getVectorStore();
     const collNames = await resolveActiveCollectionNames();

     // Convert category IDs to slugs
     const categorySlugs: string[] = [];
     for (const catId of categoryIds) {
       const category = await getCategoryById(catId);
       if (category) {
         categorySlugs.push(category.slug);
       }
     }

     // Build collection names: use specific categories if provided, otherwise use global + legacy
     let collectionsToQuery: string[];
     if (categorySlugs.length > 0) {
       collectionsToQuery = categorySlugs.map(slug => collNames.forCategory(slug));
     } else {
       collectionsToQuery = [collNames.global, collNames.legacy];
     }

     // Run each query through the RAG pipeline
     const results = [];
     for (const query of queries) {
       const startTime = Date.now();

       // Create embedding
       const embedding = await createEmbedding(query.trim());

       // Query vector store
       const queryResults = await store.queryMultipleCollections(
         collectionsToQuery,
         embedding,
         settings.topKChunks || 20
       );

      const latencyMs = Date.now() - startTime;

      // Calculate metrics
      const scores = queryResults.scores;
      const avgSimilarity = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      const threshold = settings.similarityThreshold || 0;
      const filteredCount = scores.filter((s: number) => s >= threshold).length;

      results.push({
        query: query.trim(),
        chunksRetrieved: filteredCount,
        avgSimilarity: Math.round(avgSimilarity * 10000) / 10000,
        latencyMs,
      });
    }

    // Save the batch suite
    const suiteName = name || `Batch ${new Date().toLocaleString()}`;
    const suiteId = saveBatchSuite(suiteName, results, user.email);

    return NextResponse.json({
      suiteId,
      name: suiteName,
      queryCount: results.length,
      avgLatency: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length),
      avgSimilarity: results.reduce((s, r) => s + r.avgSimilarity, 0) / results.length,
      avgChunks: results.reduce((s, r) => s + r.chunksRetrieved, 0) / results.length,
      results,
    });
  } catch (error) {
    console.error('[API] RAG batch error:', error);
    return NextResponse.json(
      { error: 'Batch test failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (id) {
      const detail = getBatchSuiteDetail(parseInt(id));
      if (!detail) {
        return NextResponse.json({ error: 'Batch suite not found' }, { status: 404 });
      }
      return NextResponse.json(detail);
    }

    const suites = getBatchSuites(limit);
    return NextResponse.json({ suites });
  } catch (error) {
    console.error('[API] RAG batch list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch suites' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const keepRecent = parseInt(searchParams.get('keepRecent') || '20');

    const deleted = cleanupBatchSuites(keepRecent);

    return NextResponse.json({
      success: true,
      deletedCount: deleted,
    });
  } catch (error) {
    console.error('[API] RAG batch cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup batch suites' },
      { status: 500 }
    );
  }
}
