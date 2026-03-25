/**
 * Admin API - Vector Store Cleanup
 *
 * POST /api/admin/vector-store/cleanup - Delete orphaned vector store collections
 *
 * Query params:
 *   dryRun=true - Preview what would be deleted without actually deleting
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllCategories } from '@/lib/db/compat';
import {
  getVectorStore,
  getCollectionNames,
  getVectorStoreProvider,
} from '@/lib/vector-store';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dryRun') === 'true';

    const provider = getVectorStoreProvider();
    const store = await getVectorStore();
    const collNames = getCollectionNames();

    // Get all category slugs from database
    const categories = await getAllCategories();
    const validSlugs = new Set(categories.map((c) => c.slug));

    // Get all collections from vector store
    const allCollections = await store.listCollections();

    // Filter to only category collections
    const categoryCollections = allCollections
      .filter(collNames.isCategory)
      .map(name => ({
        name,
        slug: collNames.toSlug(name),
      }));

    // Find orphaned collections (exist in vector store but not in database)
    const orphaned: { name: string; slug: string; vectorCount: number }[] = [];

    for (const { name, slug } of categoryCollections) {
      if (!validSlugs.has(slug)) {
        const vectorCount = await store.getCollectionCount(name);
        orphaned.push({ name, slug, vectorCount });
      }
    }

    if (orphaned.length === 0) {
      return NextResponse.json({
        success: true,
        provider,
        message: 'No orphaned collections found',
        orphaned: [],
        deleted: [],
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        provider,
        dryRun: true,
        message: `Found ${orphaned.length} orphaned collection(s)`,
        orphaned,
        deleted: [],
      });
    }

    // Delete orphaned collections
    const deleted: string[] = [];
    const errors: { collection: string; error: string }[] = [];

    for (const { name } of orphaned) {
      try {
        await store.deleteCollection(name);
        deleted.push(name);
      } catch (err) {
        errors.push({
          collection: name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      provider,
      message: `Deleted ${deleted.length} orphaned collection(s)`,
      orphaned,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error cleaning up vector store:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup vector store collections' },
      { status: 500 }
    );
  }
}
