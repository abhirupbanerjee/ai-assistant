import { countTokens } from '@/lib/summarization';
import { createEmbedding } from '@/lib/openai';
import { getVectorStore } from '@/lib/vector-store';
import {
  getCategoryMemoryAccess,
  getMemorySettings,
  listCategoryMemories,
  listExpiredApprovedCategoryMemories,
  type CategoryMemoryItem,
  type UserRole,
} from '@/lib/db/compat';

export const CATEGORY_MEMORY_COLLECTION = 'shared_category_memory';

export interface CategoryMemoryRetrieval {
  items: CategoryMemoryItem[];
  promptContext: string;
  diagnostics: { source: 'category'; ids: number[]; tokens: number; strategy: 'semantic' | 'database-fallback' | 'disabled' };
}

function vectorId(id: number): string {
  return `category-memory:${id}`;
}

export function formatSharedCategoryContext(items: CategoryMemoryItem[], tokenBudget = 800): string {
  if (items.length === 0) return '';
  const header = '[Shared Category Context]\nThe following approved, potentially time-sensitive context supplements category documents. It is subordinate to authoritative documents and must not override them.';
  const lines: string[] = [];
  for (const item of items) {
    const provenance = item.sourceReference ? ` Source: ${item.sourceReference}.` : '';
    const expiry = item.expiresAt ? ` Valid until: ${item.expiresAt}.` : '';
    const line = `- [${item.memoryType}] ${item.title}: ${item.content}${provenance}${expiry}`;
    if (countTokens(`${header}\n${[...lines, line].join('\n')}`) > tokenBudget) break;
    lines.push(line);
  }
  return lines.length ? `${header}\n${lines.join('\n')}` : '';
}

export async function deleteCategoryMemoryVector(id: number): Promise<void> {
  try {
    const store = await getVectorStore();
    await store.deleteDocuments(CATEGORY_MEMORY_COLLECTION, [vectorId(id)]);
  } catch (error) {
    console.warn('[CategoryMemory] Vector deletion failed; DB validity checks remain authoritative:', error);
  }
}

export async function syncCategoryMemoryVector(item: CategoryMemoryItem): Promise<void> {
  if (!item || item.status !== 'approved' || (item.validFrom && Date.parse(item.validFrom) > Date.now()) || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) {
    await deleteCategoryMemoryVector(item.id);
    return;
  }
  try {
    const text = `${item.title}\n${item.content}`;
    const embedding = await createEmbedding(text);
    const store = await getVectorStore();
    await store.addDocuments(CATEGORY_MEMORY_COLLECTION, [vectorId(item.id)], [embedding], [text], [{
      documentId: String(item.id),
      documentName: item.title,
      pageNumber: 1,
      chunkIndex: 0,
      source: 'global',
      categoryId: item.categoryId,
      status: item.status,
    } as never]);
  } catch (error) {
    console.warn('[CategoryMemory] Vector indexing failed; DB fallback remains available:', error);
  }
}

export async function retrieveCategoryMemory(input: {
  userId: number;
  role: UserRole;
  categoryId: number;
  query: string;
}): Promise<CategoryMemoryRetrieval> {
  const empty = (strategy: CategoryMemoryRetrieval['diagnostics']['strategy']): CategoryMemoryRetrieval => ({
    items: [], promptContext: '', diagnostics: { source: 'category', ids: [], tokens: 0, strategy },
  });
  const settings = await getMemorySettings();
  if (!settings.categoryMemoryEnabled) return empty('disabled');
  const access = await getCategoryMemoryAccess(input.userId, input.role, input.categoryId);
  if (!access.canRead || !access.categoryEnabled) return empty('disabled');

  // Expired vectors are removed best-effort before query. SQL validity remains the
  // final authority, so a stale point can never be injected.
  const expired = await listExpiredApprovedCategoryMemories(input.categoryId);
  await Promise.all(expired.map((item) => deleteCategoryMemoryVector(item.id)));
  const active = await listCategoryMemories(input.categoryId, false);
  if (!active.length) return empty('database-fallback');

  const byId = new Map(active.map((item) => [item.id, item]));
  let items: CategoryMemoryItem[] = [];
  let strategy: CategoryMemoryRetrieval['diagnostics']['strategy'] = 'database-fallback';
  try {
    const embedding = await createEmbedding(input.query);
    const store = await getVectorStore();
    const result = await store.query(
      CATEGORY_MEMORY_COLLECTION,
      embedding,
      Math.min(settings.categoryMemoryMaxRetrievedItems, 10),
      { categoryId: input.categoryId, status: 'approved' },
      0.2,
      true,
      input.query,
    );
    items = result.ids
      .map((id) => Number(id.replace('category-memory:', '')))
      .map((id) => byId.get(id))
      .filter((item): item is CategoryMemoryItem => Boolean(item));
    strategy = 'semantic';
  } catch (error) {
    console.warn('[CategoryMemory] Semantic retrieval failed; using bounded DB fallback:', error);
  }
  if (!items.length) items = active.slice(0, Math.min(settings.categoryMemoryMaxRetrievedItems, 10));
  const promptContext = formatSharedCategoryContext(items, settings.categoryMemoryTokenBudget);
  return {
    items,
    promptContext,
    diagnostics: { source: 'category', ids: items.map((item) => item.id), tokens: countTokens(promptContext), strategy },
  };
}
