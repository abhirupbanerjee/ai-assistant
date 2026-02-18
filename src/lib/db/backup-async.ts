/**
 * Async Database Backup/Restore Operations (Provider-Agnostic)
 *
 * Uses Kysely for database operations, works with both SQLite and PostgreSQL.
 * Use these functions for cross-provider migration:
 *   1. Export from SQLite with exportAllDataAsync()
 *   2. Set DATABASE_PROVIDER=postgres and run npm run db:setup
 *   3. Import to PostgreSQL with importAllDataAsync()
 */

import { getDb, transaction } from './kysely';

// Re-export all types from backup.ts for compatibility
export type {
  DocumentCategoryRecord,
  UserSubscriptionRecord,
  SuperUserCategoryRecord,
  ThreadRecord,
  MessageRecord,
  ThreadCategoryRecord,
  ThreadUploadRecord,
  ThreadOutputRecord,
  SettingRecord,
  ToolConfigRecord,
  CategoryToolConfigRecord,
  SkillRecord,
  CategorySkillRecord,
  CategoryPromptRecord,
  DataApiConfigRecord,
  DataApiCategoryRecord,
  DataCsvConfigRecord,
  DataCsvCategoryRecord,
  WorkspaceRecord,
  WorkspaceCategoryRecord,
  WorkspaceUserRecord,
  FunctionApiConfigRecord,
  FunctionApiCategoryRecord,
  UserMemoryRecord,
  ToolRoutingRuleRecord,
  ThreadShareRecord,
  TaskPlanRecord,
} from './backup';

// ============ Complete Backup Data Structure ============

export interface BackupData {
  version: string;
  exportedAt: string;
  provider: string;
  data: {
    users: unknown[];
    categories: unknown[];
    documents: unknown[];
    documentCategories: unknown[];
    userSubscriptions: unknown[];
    superUserCategories: unknown[];
    threads: unknown[];
    messages: unknown[];
    threadCategories: unknown[];
    threadUploads: unknown[];
    threadOutputs: unknown[];
    settings: unknown[];
    toolConfigs: unknown[];
    categoryToolConfigs: unknown[];
    skills: unknown[];
    categorySkills: unknown[];
    categoryPrompts: unknown[];
    dataApiConfigs: unknown[];
    dataApiCategories: unknown[];
    dataCsvConfigs: unknown[];
    dataCsvCategories: unknown[];
    workspaces: unknown[];
    workspaceCategories: unknown[];
    workspaceUsers: unknown[];
    functionApiConfigs: unknown[];
    functionApiCategories: unknown[];
    userMemories: unknown[];
    toolRoutingRules: unknown[];
    threadShares: unknown[];
    taskPlans: unknown[];
  };
}

// ============ Export All Data (Async, Provider-Agnostic) ============

/**
 * Export all database data as a provider-agnostic JSON structure.
 * Works with both SQLite and PostgreSQL.
 */
export async function exportAllDataAsync(): Promise<BackupData> {
  const db = await getDb();
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';

  const [
    users,
    categories,
    documents,
    documentCategories,
    userSubscriptions,
    superUserCategories,
    threads,
    messages,
    threadCategories,
    threadUploads,
    threadOutputs,
    settings,
    toolConfigs,
    categoryToolConfigs,
    skills,
    categorySkills,
    categoryPrompts,
    dataApiConfigs,
    dataApiCategories,
    dataCsvConfigs,
    dataCsvCategories,
    workspaces,
    workspaceCategories,
    workspaceUsers,
    functionApiConfigs,
    functionApiCategories,
    userMemories,
    toolRoutingRules,
    threadShares,
    taskPlans,
  ] = await Promise.all([
    db.selectFrom('users').selectAll().execute(),
    db.selectFrom('categories').selectAll().execute(),
    db.selectFrom('documents').selectAll().execute(),
    db.selectFrom('document_categories').selectAll().execute(),
    db.selectFrom('user_subscriptions').selectAll().execute(),
    db.selectFrom('super_user_categories').selectAll().execute(),
    db.selectFrom('threads').selectAll().execute(),
    db.selectFrom('messages').selectAll().execute(),
    db.selectFrom('thread_categories').selectAll().execute(),
    db.selectFrom('thread_uploads').selectAll().execute(),
    db.selectFrom('thread_outputs').selectAll().execute(),
    db.selectFrom('settings').selectAll().execute(),
    db.selectFrom('tool_configs').selectAll().execute(),
    db.selectFrom('category_tool_configs').selectAll().execute(),
    db.selectFrom('skills').selectAll().execute(),
    db.selectFrom('category_skills').selectAll().execute(),
    db.selectFrom('category_prompts').selectAll().execute(),
    db.selectFrom('data_api_configs').selectAll().execute(),
    db.selectFrom('data_api_categories').selectAll().execute(),
    db.selectFrom('data_csv_configs').selectAll().execute(),
    db.selectFrom('data_csv_categories').selectAll().execute(),
    db.selectFrom('workspaces').selectAll().execute(),
    db.selectFrom('workspace_categories').selectAll().execute(),
    db.selectFrom('workspace_users').selectAll().execute(),
    db.selectFrom('function_api_configs').selectAll().execute(),
    db.selectFrom('function_api_categories').selectAll().execute(),
    db.selectFrom('user_memories').selectAll().execute(),
    db.selectFrom('tool_routing_rules').selectAll().execute(),
    db.selectFrom('thread_shares').selectAll().execute(),
    db.selectFrom('task_plans').selectAll().execute(),
  ]);

  return {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    provider,
    data: {
      users,
      categories,
      documents,
      documentCategories,
      userSubscriptions,
      superUserCategories,
      threads,
      messages,
      threadCategories,
      threadUploads,
      threadOutputs,
      settings,
      toolConfigs,
      categoryToolConfigs,
      skills,
      categorySkills,
      categoryPrompts,
      dataApiConfigs,
      dataApiCategories,
      dataCsvConfigs,
      dataCsvCategories,
      workspaces,
      workspaceCategories,
      workspaceUsers,
      functionApiConfigs,
      functionApiCategories,
      userMemories,
      toolRoutingRules,
      threadShares,
      taskPlans,
    },
  };
}

// ============ Import All Data (Async, Provider-Agnostic) ============

/**
 * Import all database data from a backup structure.
 * Works with both SQLite and PostgreSQL.
 * Clears existing data before importing.
 */
export async function importAllDataAsync(backup: BackupData): Promise<void> {
  const { data } = backup;

  await transaction(async (trx) => {
    // Clear existing data in reverse dependency order
    await trx.deleteFrom('task_plans').execute();
    await trx.deleteFrom('thread_shares').execute();
    await trx.deleteFrom('thread_outputs').execute();
    await trx.deleteFrom('thread_uploads').execute();
    await trx.deleteFrom('thread_categories').execute();
    await trx.deleteFrom('messages').execute();
    await trx.deleteFrom('threads').execute();
    await trx.deleteFrom('document_categories').execute();
    await trx.deleteFrom('documents').execute();
    await trx.deleteFrom('user_memories').execute();
    await trx.deleteFrom('user_subscriptions').execute();
    await trx.deleteFrom('super_user_categories').execute();
    await trx.deleteFrom('workspace_users').execute();
    await trx.deleteFrom('workspace_categories').execute();
    await trx.deleteFrom('workspaces').execute();
    await trx.deleteFrom('category_tool_configs').execute();
    await trx.deleteFrom('tool_configs').execute();
    await trx.deleteFrom('tool_routing_rules').execute();
    await trx.deleteFrom('category_skills').execute();
    await trx.deleteFrom('skills').execute();
    await trx.deleteFrom('category_prompts').execute();
    await trx.deleteFrom('function_api_categories').execute();
    await trx.deleteFrom('function_api_configs').execute();
    await trx.deleteFrom('data_api_categories').execute();
    await trx.deleteFrom('data_api_configs').execute();
    await trx.deleteFrom('data_csv_categories').execute();
    await trx.deleteFrom('data_csv_configs').execute();
    await trx.deleteFrom('users').execute();
    await trx.deleteFrom('categories').execute();
    await trx.deleteFrom('settings').execute();

    // Import data in dependency order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertBatch = async (table: any, records: any[]) => {
      if (records.length === 0) return;
      // Insert in batches of 100 to avoid query size limits
      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100);
        await trx.insertInto(table).values(batch).execute();
      }
    };

    // Core tables first
    await insertBatch('users', data.users);
    await insertBatch('categories', data.categories);
    await insertBatch('settings', data.settings);

    // Category-dependent tables
    await insertBatch('category_prompts', data.categoryPrompts);
    await insertBatch('skills', data.skills);
    await insertBatch('category_skills', data.categorySkills);
    await insertBatch('tool_configs', data.toolConfigs);
    await insertBatch('category_tool_configs', data.categoryToolConfigs);
    await insertBatch('tool_routing_rules', data.toolRoutingRules);

    // User-dependent tables
    await insertBatch('super_user_categories', data.superUserCategories);
    await insertBatch('user_subscriptions', data.userSubscriptions);
    await insertBatch('user_memories', data.userMemories);

    // Document tables
    await insertBatch('documents', data.documents);
    await insertBatch('document_categories', data.documentCategories);

    // Thread tables
    await insertBatch('threads', data.threads);
    await insertBatch('thread_categories', data.threadCategories);
    await insertBatch('messages', data.messages);
    await insertBatch('thread_uploads', data.threadUploads);
    await insertBatch('thread_outputs', data.threadOutputs);
    await insertBatch('thread_shares', data.threadShares);
    await insertBatch('task_plans', data.taskPlans);

    // Data source tables
    await insertBatch('data_api_configs', data.dataApiConfigs);
    await insertBatch('data_api_categories', data.dataApiCategories);
    await insertBatch('data_csv_configs', data.dataCsvConfigs);
    await insertBatch('data_csv_categories', data.dataCsvCategories);
    await insertBatch('function_api_configs', data.functionApiConfigs);
    await insertBatch('function_api_categories', data.functionApiCategories);

    // Workspace tables
    await insertBatch('workspaces', data.workspaces);
    await insertBatch('workspace_categories', data.workspaceCategories);
    await insertBatch('workspace_users', data.workspaceUsers);
  });
}

// ============ Migration Helper ============

/**
 * Migrate data from current provider to target provider.
 * Usage:
 *   1. Set source provider in DATABASE_PROVIDER
 *   2. Call exportAllDataAsync() and save to file
 *   3. Change DATABASE_PROVIDER to target
 *   4. Run npm run db:setup
 *   5. Call importAllDataAsync() with saved data
 */
export async function migrateDatabase(
  sourceData: BackupData,
  options?: { resetSequences?: boolean }
): Promise<{ success: boolean; message: string }> {
  try {
    // Import the data
    await importAllDataAsync(sourceData);

    // Reset auto-increment sequences for PostgreSQL
    if (options?.resetSequences && process.env.DATABASE_PROVIDER === 'postgres') {
      const db = await getDb();
      // Reset sequences to max ID + 1 for SERIAL columns
      const tables = [
        'users',
        'categories',
        'documents',
        'thread_uploads',
        'thread_outputs',
        'user_memories',
        'thread_summaries',
        'storage_alerts',
        'tool_config_audit',
        'data_source_audit',
        'rag_test_queries',
        'rag_test_results',
        'share_access_log',
        'workspace_rate_limits',
        'workspace_analytics',
        'workspace_outputs',
        'folder_sync_files',
        'compliance_results',
        'skills',
      ];

      for (const table of tables) {
        try {
          // PostgreSQL-specific: reset sequence to max(id) + 1
          await db.executeQuery(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (db as any)
              .raw(
                `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
              )
              .compile()
          );
        } catch {
          // Table might not have a sequence, ignore
        }
      }
    }

    return {
      success: true,
      message: `Successfully migrated ${Object.keys(sourceData.data).length} tables`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
