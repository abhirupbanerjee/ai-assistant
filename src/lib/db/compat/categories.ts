/**
 * Category Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import { sql } from 'kysely';
import { getDefaultOrganizationId as resolveDefaultOrganizationId } from '../../org-context';

// Re-export types
export type {
  DbCategory,
  CategoryWithStats,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../categories';

import type {
  DbCategory,
  CategoryWithStats,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../categories';

// Re-export helper (doesn't need DB access)
export { generateCategorySlug as generateSlug } from '../utils';
import { generateCategorySlug as generateSlug } from '../utils';

// ============ Category CRUD ============

const CATEGORY_SELECT = [
  'id',
  'name',
  'slug',
  'description',
  'created_by',
  'created_at',
  'organization_id',
] as const;

/**
 * Resolve the DEFAULT organization id (used when a category is created without
 * an explicit organization). Delegates to the canonical resolver in org-context.
 */
export async function getDefaultOrganizationId(): Promise<number | null> {
  return resolveDefaultOrganizationId(await getDb());
}

export async function getAllCategories(): Promise<DbCategory[]> {
  const db = await getDb();
  return db
    .selectFrom('categories')
    .select(CATEGORY_SELECT)
    .orderBy('name')
    .execute() as Promise<DbCategory[]>;
}

export async function getAllCategoriesWithStats(): Promise<CategoryWithStats[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('categories as c')
    .leftJoin('document_categories as dc', 'c.id', 'dc.category_id')
    .leftJoin('super_user_categories as suc', 'c.id', 'suc.category_id')
    .leftJoin('user_subscriptions as us', (join) =>
      join
        .onRef('c.id', '=', 'us.category_id')
        .on('us.is_active', '=', 1)
    )
    .select([
      'c.id',
      'c.name',
      'c.slug',
      'c.description',
      'c.created_by',
      'c.created_at',
      'c.organization_id',
      db.fn.count<number>(sql`DISTINCT dc.document_id`).as('documentCount'),
      db.fn.count<number>(sql`DISTINCT suc.user_id`).as('superUserCount'),
      db.fn.count<number>(sql`DISTINCT us.user_id`).as('subscriberCount'),
    ])
    .groupBy(['c.id', 'c.name', 'c.slug', 'c.description', 'c.created_by', 'c.created_at', 'c.organization_id'])
    .orderBy('c.name')
    .execute();

  return results as CategoryWithStats[];
}

export async function getCategoryById(id: number): Promise<DbCategory | undefined> {
  const db = await getDb();
  return db
    .selectFrom('categories')
    .select(CATEGORY_SELECT)
    .where('id', '=', id)
    .executeTakeFirst() as Promise<DbCategory | undefined>;
}

export async function getCategoryBySlug(slug: string): Promise<DbCategory | undefined> {
  const db = await getDb();
  return db
    .selectFrom('categories')
    .select(CATEGORY_SELECT)
    .where('slug', '=', slug)
    .executeTakeFirst() as Promise<DbCategory | undefined>;
}

export async function getCategoryByName(name: string): Promise<DbCategory | undefined> {
  const db = await getDb();
  return db
    .selectFrom('categories')
    .select(CATEGORY_SELECT)
    .where('name', '=', name)
    .executeTakeFirst() as Promise<DbCategory | undefined>;
}

export async function createCategory(input: CreateCategoryInput): Promise<DbCategory> {
  const slug = generateSlug(input.name);

  // Default to the DEFAULT organization when the caller does not specify one.
  const organizationId = input.organizationId ?? (await getDefaultOrganizationId());

  const db = await getDb();

  // Name/slug uniqueness is scoped to the organization so different tenants can
  // each create a category with the same name.
  const existingName = await db
    .selectFrom('categories')
    .select('id')
    .where('name', '=', input.name)
    .where('organization_id', 'is', organizationId)
    .executeTakeFirst();
  if (existingName) {
    throw new Error(`Category with name "${input.name}" already exists in this organization`);
  }

  const existingSlug = await db
    .selectFrom('categories')
    .select('id')
    .where('slug', '=', slug)
    .where('organization_id', 'is', organizationId)
    .executeTakeFirst();
  if (existingSlug) {
    throw new Error(`Category with slug "${slug}" already exists in this organization`);
  }

  const result = await db
    .insertInto('categories')
    .values({
      name: input.name,
      slug,
      description: input.description || null,
      created_by: input.createdBy,
      organization_id: organizationId,
    })
    .returning([...CATEGORY_SELECT])
    .executeTakeFirstOrThrow();

  return result as DbCategory;
}

export async function updateCategory(
  id: number,
  input: UpdateCategoryInput
): Promise<DbCategory | undefined> {
  const current = await getCategoryById(id);
  if (!current) return undefined;

  const db = await getDb();
  const orgId = current.organization_id ?? null;
  const updates: Record<string, unknown> = {};

  if (input.name !== undefined && input.name !== current.name) {
    // Name/slug uniqueness is scoped to the organization.
    const existing = await db
      .selectFrom('categories')
      .select('id')
      .where('name', '=', input.name)
      .where('organization_id', 'is', orgId)
      .executeTakeFirst();
    if (existing && existing.id !== id) {
      throw new Error(`Category with name "${input.name}" already exists in this organization`);
    }

    updates.name = input.name;

    const newSlug = generateSlug(input.name);
    const existingSlug = await db
      .selectFrom('categories')
      .select('id')
      .where('slug', '=', newSlug)
      .where('organization_id', 'is', orgId)
      .executeTakeFirst();
    if (existingSlug && existingSlug.id !== id) {
      throw new Error(`Category with slug "${newSlug}" already exists in this organization`);
    }
    updates.slug = newSlug;
  }

  if (input.description !== undefined) {
    updates.description = input.description;
  }

  if (input.organizationId !== undefined) {
    updates.organization_id = input.organizationId;
  }

  if (Object.keys(updates).length === 0) {
    return current;
  }

  await db.updateTable('categories').set(updates).where('id', '=', id).execute();

  return getCategoryById(id);
}

export async function deleteCategory(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('categories').where('id', '=', id).executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function categoryExists(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('categories')
    .select(db.fn.count<number>('id').as('count'))
    .where('id', '=', id)
    .executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

// ============ Category Queries ============

export async function getCategoriesForSuperUser(userId: number): Promise<DbCategory[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('categories as c')
    .leftJoin('super_user_categories as suc', (join) =>
      join.onRef('c.id', '=', 'suc.category_id').on('suc.user_id', '=', userId)
    )
    .leftJoin('user_subscriptions as us', (join) =>
      join
        .onRef('c.id', '=', 'us.category_id')
        .on('us.user_id', '=', userId)
        .on('us.is_active', '=', 1)
    )
    .select(['c.id', 'c.name', 'c.slug', 'c.description', 'c.created_by', 'c.created_at', 'c.organization_id'])
    .where((eb) =>
      eb.or([eb('suc.user_id', 'is not', null), eb('us.user_id', 'is not', null)])
    )
    .distinct()
    .orderBy('c.name')
    .execute();

  return results as DbCategory[];
}

export async function getCategoriesForUser(userId: number): Promise<DbCategory[]> {
  const db = await getDb();
  return db
    .selectFrom('categories as c')
    .innerJoin('user_subscriptions as us', 'c.id', 'us.category_id')
    .select(['c.id', 'c.name', 'c.slug', 'c.description', 'c.created_by', 'c.created_at', 'c.organization_id'])
    .where('us.user_id', '=', userId)
    .where('us.is_active', '=', 1)
    .orderBy('c.name')
    .execute() as Promise<DbCategory[]>;
}

export async function getAllSubscriptionsForUser(
  userId: number
): Promise<(DbCategory & { isActive: boolean })[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('categories as c')
    .innerJoin('user_subscriptions as us', 'c.id', 'us.category_id')
    .select([
      'c.id',
      'c.name',
      'c.slug',
      'c.description',
      'c.created_by',
      'c.created_at',
      'c.organization_id',
      'us.is_active',
    ])
    .where('us.user_id', '=', userId)
    .orderBy('c.name')
    .execute();

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    created_by: r.created_by,
    created_at: r.created_at as string,
    organization_id: r.organization_id as number | null,
    isActive: Boolean(r.is_active),
  }));
}

export async function getSuperUsersForCategory(
  categoryId: number
): Promise<{ userId: number; email: string; name: string | null }[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('users as u')
    .innerJoin('super_user_categories as suc', 'u.id', 'suc.user_id')
    .select(['u.id as userId', 'u.email', 'u.name'])
    .where('suc.category_id', '=', categoryId)
    .orderBy('u.email')
    .execute();

  return results.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
  }));
}

export async function getSubscribersForCategory(
  categoryId: number,
  activeOnly: boolean = true
): Promise<{ userId: number; email: string; name: string | null; isActive: boolean }[]> {
  const db = await getDb();
  let query = db
    .selectFrom('users as u')
    .innerJoin('user_subscriptions as us', 'u.id', 'us.user_id')
    .select(['u.id as userId', 'u.email', 'u.name', 'us.is_active'])
    .where('us.category_id', '=', categoryId);

  if (activeOnly) {
    query = query.where('us.is_active', '=', 1);
  }

  const results = await query.orderBy('u.email').execute();

  return results.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    isActive: Boolean(r.is_active),
  }));
}

// ============ Category Statistics ============

export async function getCategoryDocumentCount(categoryId: number): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('document_categories')
    .select(db.fn.count<number>('document_id').as('count'))
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return result?.count ?? 0;
}

export async function getUnassignedDocumentCount(): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('documents as d')
    .leftJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .select(db.fn.count<number>(sql`DISTINCT d.id`).as('count'))
    .where('dc.category_id', 'is', null)
    .executeTakeFirst();
  return result?.count ?? 0;
}

// ============ Bulk Operations ============

export async function bulkSubscribeUsers(
  categoryId: number,
  userIds: number[],
  subscribedBy: string
): Promise<number> {
  return transaction(async (trx) => {
    let count = 0;
    for (const userId of userIds) {
      try {
        await trx
          .insertInto('user_subscriptions')
          .values({
            user_id: userId,
            category_id: categoryId,
            subscribed_by: subscribedBy,
          })
          .execute();
        count++;
      } catch {
        // Already subscribed, skip
      }
    }
    return count;
  });
}

export async function getCategoryIdsBySlugs(slugs: string[]): Promise<number[]> {
  if (slugs.length === 0) return [];

  const db = await getDb();
  const results = await db
    .selectFrom('categories')
    .select('id')
    .where('slug', 'in', slugs)
    .execute();
  return results.map((r) => r.id);
}

export async function getCategorySlugsByIds(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];

  const db = await getDb();
  const results = await db
    .selectFrom('categories')
    .select('slug')
    .where('id', 'in', ids)
    .execute();
  return results.map((r) => r.slug);
}

// ============ Superuser Category Management ============

export async function getCreatedCategoriesCount(createdByEmail: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('categories')
    .select(db.fn.count<number>('id').as('count'))
    .where('created_by', '=', createdByEmail)
    .executeTakeFirst();
  return result?.count ?? 0;
}

export async function getCategoriesCreatedBy(createdByEmail: string): Promise<DbCategory[]> {
  const db = await getDb();
  return db
    .selectFrom('categories')
    .select(['id', 'name', 'slug', 'description', 'created_by', 'created_at'])
    .where('created_by', '=', createdByEmail)
    .orderBy('name')
    .execute() as Promise<DbCategory[]>;
}

export async function isCategoryCreatedBy(categoryId: number, email: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('categories')
    .select(db.fn.count<number>('id').as('count'))
    .where('id', '=', categoryId)
    .where('created_by', '=', email)
    .executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

export async function getDocumentIdsForCategory(categoryId: number): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('document_categories')
    .select('document_id')
    .where('category_id', '=', categoryId)
    .execute();
  return results.map((r) => r.document_id);
}

export async function deleteCategoryWithRelatedData(
  categoryId: number
): Promise<{ documentIds: number[]; deleted: boolean }> {
  return transaction(async (trx) => {
    // Get document IDs before deletion (for external cleanup)
    const docResults = await trx
      .selectFrom('document_categories')
      .select('document_id')
      .where('category_id', '=', categoryId)
      .execute();
    const documentIds = docResults.map((r) => r.document_id);

    // Delete in order to respect foreign keys
    await trx.deleteFrom('document_categories').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('thread_categories').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('user_subscriptions').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('super_user_categories').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('category_prompts').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('category_tool_configs').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('category_skills').where('category_id', '=', categoryId).execute();
    // category_memories and category_memory_events use ON DELETE CASCADE.
    await trx.deleteFrom('data_api_categories').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('data_csv_categories').where('category_id', '=', categoryId).execute();
    await trx.deleteFrom('function_api_categories').where('category_id', '=', categoryId).execute();

    // Finally delete the category
    const result = await trx
      .deleteFrom('categories')
      .where('id', '=', categoryId)
      .executeTakeFirst();

    return {
      documentIds,
      deleted: (result.numDeletedRows ?? BigInt(0)) > BigInt(0),
    };
  });
}

// ============ Bulk Category Lookup ============

export interface CategoryInfo {
  id: number;
  name: string;
  slug: string;
}

export async function getCategoriesByIds(categoryIds: number[]): Promise<CategoryInfo[]> {
  if (categoryIds.length === 0) return [];

  const db = await getDb();
  return db
    .selectFrom('categories')
    .select(['id', 'name', 'slug'])
    .where('id', 'in', categoryIds)
    .execute() as Promise<CategoryInfo[]>;
}
