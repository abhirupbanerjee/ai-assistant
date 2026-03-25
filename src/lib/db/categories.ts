/**
 * Category Database Operations
 *
 * CRUD operations for document categories
 * Each category maps to a vector store collection
 */

import { execute, queryAll, queryOne, transaction } from './index';

// ============ Types ============

export interface DbCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface CategoryWithStats extends DbCategory {
  documentCount: number;
  superUserCount: number;
  subscriberCount: number;
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  createdBy: string;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
}

// ============ Helper Functions ============

/**
 * Generate URL-safe slug from category name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ============ Category CRUD ============

/**
 * Get all categories
 */
export function getAllCategories(): DbCategory[] {
  return queryAll<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    ORDER BY name
  `);
}

/**
 * Get all categories with statistics
 */
export function getAllCategoriesWithStats(): CategoryWithStats[] {
  return queryAll<CategoryWithStats>(`
    SELECT
      c.id,
      c.name,
      c.slug,
      c.description,
      c.created_by,
      c.created_at,
      COUNT(DISTINCT dc.document_id) as documentCount,
      COUNT(DISTINCT suc.user_id) as superUserCount,
      COUNT(DISTINCT us.user_id) as subscriberCount
    FROM categories c
    LEFT JOIN document_categories dc ON c.id = dc.category_id
    LEFT JOIN super_user_categories suc ON c.id = suc.category_id
    LEFT JOIN user_subscriptions us ON c.id = us.category_id AND us.is_active = 1
    GROUP BY c.id
    ORDER BY c.name
  `);
}

/**
 * Get category by ID
 */
export function getCategoryById(id: number): DbCategory | undefined {
  return queryOne<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    WHERE id = ?
  `, [id]);
}

/**
 * Get category by slug
 */
export function getCategoryBySlug(slug: string): DbCategory | undefined {
  return queryOne<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    WHERE slug = ?
  `, [slug]);
}

/**
 * Get category by name
 */
export function getCategoryByName(name: string): DbCategory | undefined {
  return queryOne<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    WHERE name = ?
  `, [name]);
}

/**
 * Create a new category
 */
export function createCategory(input: CreateCategoryInput): DbCategory {
  const slug = generateSlug(input.name);

  // Check for unique name and slug
  const existingName = getCategoryByName(input.name);
  if (existingName) {
    throw new Error(`Category with name "${input.name}" already exists`);
  }

  const existingSlug = getCategoryBySlug(slug);
  if (existingSlug) {
    throw new Error(`Category with slug "${slug}" already exists`);
  }

  const result = execute(`
    INSERT INTO categories (name, slug, description, created_by)
    VALUES (?, ?, ?, ?)
  `, [input.name, slug, input.description || null, input.createdBy]);

  return getCategoryById(result.lastInsertRowid as number)!;
}

/**
 * Update a category
 */
export function updateCategory(id: number, input: UpdateCategoryInput): DbCategory | undefined {
  const current = getCategoryById(id);
  if (!current) return undefined;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined && input.name !== current.name) {
    // Check for duplicate name
    const existing = getCategoryByName(input.name);
    if (existing && existing.id !== id) {
      throw new Error(`Category with name "${input.name}" already exists`);
    }

    updates.push('name = ?');
    params.push(input.name);

    // Update slug too
    const newSlug = generateSlug(input.name);
    const existingSlug = getCategoryBySlug(newSlug);
    if (existingSlug && existingSlug.id !== id) {
      throw new Error(`Category with slug "${newSlug}" already exists`);
    }
    updates.push('slug = ?');
    params.push(newSlug);
  }

  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }

  if (updates.length === 0) {
    return current;
  }

  params.push(id);
  execute(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`, params);

  return getCategoryById(id);
}

/**
 * Delete a category
 * Documents in this category will have their category_id set to NULL (Unassigned)
 */
export function deleteCategory(id: number): boolean {
  const result = execute('DELETE FROM categories WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Check if category exists
 */
export function categoryExists(id: number): boolean {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM categories WHERE id = ?
  `, [id]);
  return (result?.count ?? 0) > 0;
}

// ============ Category Queries ============

/**
 * Get categories for a super user (their assigned categories + subscribed categories)
 */
export function getCategoriesForSuperUser(userId: number): DbCategory[] {
  return queryAll<DbCategory>(`
    SELECT DISTINCT c.id, c.name, c.slug, c.description, c.created_by, c.created_at
    FROM categories c
    LEFT JOIN super_user_categories suc ON c.id = suc.category_id AND suc.user_id = ?
    LEFT JOIN user_subscriptions us ON c.id = us.category_id AND us.user_id = ? AND us.is_active = 1
    WHERE suc.user_id IS NOT NULL OR us.user_id IS NOT NULL
    ORDER BY c.name
  `, [userId, userId]);
}

/**
 * Get categories for a user (their active subscriptions)
 */
export function getCategoriesForUser(userId: number): DbCategory[] {
  return queryAll<DbCategory>(`
    SELECT c.id, c.name, c.slug, c.description, c.created_by, c.created_at
    FROM categories c
    JOIN user_subscriptions us ON c.id = us.category_id
    WHERE us.user_id = ? AND us.is_active = 1
    ORDER BY c.name
  `, [userId]);
}

/**
 * Get all subscriptions for a user (active and inactive)
 */
export function getAllSubscriptionsForUser(userId: number): (DbCategory & { isActive: boolean })[] {
  const results = queryAll<DbCategory & { is_active: number }>(`
    SELECT c.id, c.name, c.slug, c.description, c.created_by, c.created_at, us.is_active
    FROM categories c
    JOIN user_subscriptions us ON c.id = us.category_id
    WHERE us.user_id = ?
    ORDER BY c.name
  `, [userId]);

  return results.map(r => ({
    ...r,
    isActive: Boolean(r.is_active),
  }));
}

/**
 * Get super users assigned to a category
 */
export function getSuperUsersForCategory(categoryId: number): { userId: number; email: string; name: string | null }[] {
  return queryAll<{ userId: number; email: string; name: string | null }>(`
    SELECT u.id as userId, u.email, u.name
    FROM users u
    JOIN super_user_categories suc ON u.id = suc.user_id
    WHERE suc.category_id = ?
    ORDER BY u.email
  `, [categoryId]);
}

/**
 * Get subscribers for a category
 */
export function getSubscribersForCategory(categoryId: number, activeOnly: boolean = true): { userId: number; email: string; name: string | null; isActive: boolean }[] {
  const whereClause = activeOnly ? 'AND us.is_active = 1' : '';
  const results = queryAll<{ userId: number; email: string; name: string | null; is_active: number }>(`
    SELECT u.id as userId, u.email, u.name, us.is_active
    FROM users u
    JOIN user_subscriptions us ON u.id = us.user_id
    WHERE us.category_id = ? ${whereClause}
    ORDER BY u.email
  `, [categoryId]);

  return results.map(r => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    isActive: Boolean(r.is_active),
  }));
}

// ============ Category Statistics ============

/**
 * Get document count for a category
 */
export function getCategoryDocumentCount(categoryId: number): number {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM document_categories
    WHERE category_id = ?
  `, [categoryId]);
  return result?.count ?? 0;
}

/**
 * Get unassigned document count (documents with NULL category)
 */
export function getUnassignedDocumentCount(): number {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(DISTINCT d.id) as count
    FROM documents d
    LEFT JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id IS NULL
  `);
  return result?.count ?? 0;
}

// ============ Bulk Operations ============

/**
 * Subscribe multiple users to a category
 */
export function bulkSubscribeUsers(
  categoryId: number,
  userIds: number[],
  subscribedBy: string
): number {
  return transaction(() => {
    let count = 0;
    const stmt = execute;

    for (const userId of userIds) {
      try {
        stmt(`
          INSERT INTO user_subscriptions (user_id, category_id, subscribed_by)
          VALUES (?, ?, ?)
        `, [userId, categoryId, subscribedBy]);
        count++;
      } catch {
        // Already subscribed, skip
      }
    }

    return count;
  });
}

/**
 * Get category IDs by slugs
 */
export function getCategoryIdsBySlugs(slugs: string[]): number[] {
  if (slugs.length === 0) return [];

  const placeholders = slugs.map(() => '?').join(', ');
  const results = queryAll<{ id: number }>(`
    SELECT id FROM categories WHERE slug IN (${placeholders})
  `, slugs);

  return results.map(r => r.id);
}

/**
 * Get category slugs by IDs
 */
export function getCategorySlugsByIds(ids: number[]): string[] {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => '?').join(', ');
  const results = queryAll<{ slug: string }>(`
    SELECT slug FROM categories WHERE id IN (${placeholders})
  `, ids);

  return results.map(r => r.slug);
}

// ============ Superuser Category Management ============

/**
 * Count categories created by a specific user (by email)
 */
export function getCreatedCategoriesCount(createdByEmail: string): number {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM categories WHERE created_by = ?
  `, [createdByEmail]);
  return result?.count ?? 0;
}

/**
 * Get categories created by a specific user (by email)
 */
export function getCategoriesCreatedBy(createdByEmail: string): DbCategory[] {
  return queryAll<DbCategory>(`
    SELECT id, name, slug, description, created_by, created_at
    FROM categories
    WHERE created_by = ?
    ORDER BY name
  `, [createdByEmail]);
}

/**
 * Check if a category was created by a specific user
 */
export function isCategoryCreatedBy(categoryId: number, email: string): boolean {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM categories WHERE id = ? AND created_by = ?
  `, [categoryId, email]);
  return (result?.count ?? 0) > 0;
}

/**
 * Get document IDs for a category (for cleanup)
 */
export function getDocumentIdsForCategory(categoryId: number): number[] {
  const results = queryAll<{ document_id: number }>(`
    SELECT document_id FROM document_categories WHERE category_id = ?
  `, [categoryId]);
  return results.map(r => r.document_id);
}

/**
 * Delete a category with full cleanup of all related data
 * This is a database-only operation - file/vector store cleanup must be done separately
 * Returns document IDs that were associated with this category for external cleanup
 */
export function deleteCategoryWithRelatedData(categoryId: number): { documentIds: number[]; deleted: boolean } {
  return transaction(() => {
    // Get document IDs before deletion (for external cleanup)
    const documentIds = getDocumentIdsForCategory(categoryId);

    // Delete in order to respect foreign keys (or rely on CASCADE)
    // These tables have ON DELETE CASCADE, but being explicit:

    // Remove document-category associations
    execute('DELETE FROM document_categories WHERE category_id = ?', [categoryId]);

    // Remove thread-category associations
    execute('DELETE FROM thread_categories WHERE category_id = ?', [categoryId]);

    // Remove user subscriptions
    execute('DELETE FROM user_subscriptions WHERE category_id = ?', [categoryId]);

    // Remove superuser assignments
    execute('DELETE FROM super_user_categories WHERE category_id = ?', [categoryId]);

    // Remove category prompts
    execute('DELETE FROM category_prompts WHERE category_id = ?', [categoryId]);

    // Remove category tool configs
    execute('DELETE FROM category_tool_configs WHERE category_id = ?', [categoryId]);

    // Remove category skills
    execute('DELETE FROM category_skills WHERE category_id = ?', [categoryId]);

    // Remove user memories for this category
    execute('DELETE FROM user_memories WHERE category_id = ?', [categoryId]);

    // Remove data source associations
    execute('DELETE FROM data_api_categories WHERE category_id = ?', [categoryId]);
    execute('DELETE FROM data_csv_categories WHERE category_id = ?', [categoryId]);
    execute('DELETE FROM function_api_categories WHERE category_id = ?', [categoryId]);

    // Finally delete the category
    const result = execute('DELETE FROM categories WHERE id = ?', [categoryId]);

    return {
      documentIds,
      deleted: result.changes > 0,
    };
  });
}

// ============ Bulk Category Lookup ============

/**
 * Get multiple categories by their IDs
 * Returns id, name, slug for each found category
 */
export function getCategoriesByIds(categoryIds: number[]): { id: number; name: string; slug: string }[] {
  if (categoryIds.length === 0) return [];

  const placeholders = categoryIds.map(() => '?').join(', ');
  return queryAll<{ id: number; name: string; slug: string }>(`
    SELECT id, name, slug FROM categories WHERE id IN (${placeholders})
  `, categoryIds);
}
