import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole } from '@/lib/users';
import { saveTestResult, type TopChunk } from '@/lib/db/compat';
import { getRagSettings, getCategoryById } from '@/lib/db/compat';
import { createEmbedding } from '@/lib/openai';
import { getVectorStore, getCollectionNames } from '@/lib/vector-store';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      query,
      categoryIds = [],
      overrideSettings = {},
      saveResult = false,
    } = body;

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // Get base RAG settings and apply overrides
    const baseSettings = await getRagSettings();
    const testSettings = {
      ...baseSettings,
      ...overrideSettings,
    };

    // Convert category IDs to slugs
    const categorySlugs: string[] = [];
    for (const catId of categoryIds) {
      const category = await getCategoryById(catId);
      if (category) {
        categorySlugs.push(category.slug);
      }
    }

    // Run the RAG query
    const startTime = Date.now();

    // Create embedding for the query
    const embedding = await createEmbedding(query.trim());

    // Query vector store
    const store = await getVectorStore();
    const collNames = getCollectionNames();

    // Build collection names from category slugs
    const collectionNames = categorySlugs.map(slug => collNames.forCategory(slug));

    const results = await store.queryMultipleCollections(
      collectionNames,
      embedding,
      testSettings.topKChunks || 20
    );

    const latencyMs = Date.now() - startTime;

    // Results contain parallel arrays: ids[], documents[], metadatas[], scores[]
    const scores = results.scores;

    // Calculate average similarity
    const avgSimilarity = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    // Filter by similarity threshold if set
    const threshold = testSettings.similarityThreshold || 0;
    const filteredIndices: number[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] >= threshold) {
        filteredIndices.push(i);
      }
    }

    // Build top chunks result
    const topChunks: TopChunk[] = filteredIndices.slice(0, 10).map(i => ({
      id: results.ids[i],
      documentName: results.metadatas[i]?.documentName || 'Unknown',
      text: results.documents[i]?.substring(0, 300) +
        (results.documents[i] && results.documents[i].length > 300 ? '...' : ''),
      score: Math.round(scores[i] * 10000) / 10000,
    }));

    // Save result if requested
    if (saveResult) {
      await saveTestResult(
        null, // queryId - not using saved queries for now
        query.trim(),
        testSettings,
        {
          chunksRetrieved: filteredIndices.length,
          avgSimilarity,
          latencyMs,
        },
        topChunks,
        user.email
      );
    }

    return NextResponse.json({
      settings: testSettings,
      metrics: {
        chunksRetrieved: filteredIndices.length,
        totalChunksFound: results.ids.length,
        avgSimilarity: Math.round(avgSimilarity * 10000) / 10000,
        latencyMs,
      },
      chunks: topChunks,
    });
  } catch (error) {
    console.error('[API] RAG test error:', error);
    return NextResponse.json(
      { error: 'RAG test failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
