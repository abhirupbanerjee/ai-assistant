/**
 * Backup Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers for backup/restore operations that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb, getDatabaseProvider, transaction } from '../kysely';
import * as sync from '../backup';

// Re-export all types
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
} from '../backup';

import type { DbDocument } from '../documents';
import type { DbCategory } from '../categories';
import type { DbUser } from '../users';
import type {
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
} from '../backup';

// ============ Export Functions ============

export async function exportDocuments(): Promise<DbDocument[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportDocuments();
  }
  const db = await getDb();
  return db.selectFrom('documents').selectAll().orderBy('id').execute() as Promise<DbDocument[]>;
}

export async function exportCategories(): Promise<DbCategory[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportCategories();
  }
  const db = await getDb();
  return db.selectFrom('categories').selectAll().orderBy('id').execute() as Promise<DbCategory[]>;
}

export async function exportDocumentCategories(): Promise<DocumentCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportDocumentCategories();
  }
  const db = await getDb();
  return db.selectFrom('document_categories').selectAll().orderBy('document_id').execute() as Promise<DocumentCategoryRecord[]>;
}

export async function exportUsers(): Promise<DbUser[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportUsers();
  }
  const db = await getDb();
  return db.selectFrom('users').selectAll().orderBy('id').execute() as Promise<DbUser[]>;
}

export async function exportUserSubscriptions(): Promise<UserSubscriptionRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportUserSubscriptions();
  }
  const db = await getDb();
  return db.selectFrom('user_subscriptions').selectAll().orderBy('user_id').execute() as Promise<UserSubscriptionRecord[]>;
}

export async function exportSuperUserCategories(): Promise<SuperUserCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportSuperUserCategories();
  }
  const db = await getDb();
  return db.selectFrom('super_user_categories').selectAll().orderBy('user_id').execute() as Promise<SuperUserCategoryRecord[]>;
}

export async function exportThreads(): Promise<ThreadRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportThreads();
  }
  const db = await getDb();
  return db.selectFrom('threads').select(['id', 'user_id', 'title', 'created_at', 'updated_at']).orderBy('id').execute() as Promise<ThreadRecord[]>;
}

export async function exportMessages(): Promise<MessageRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportMessages();
  }
  const db = await getDb();
  return db.selectFrom('messages').selectAll().orderBy('thread_id').orderBy('created_at').execute() as Promise<MessageRecord[]>;
}

export async function exportThreadCategories(): Promise<ThreadCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportThreadCategories();
  }
  const db = await getDb();
  return db.selectFrom('thread_categories').selectAll().orderBy('thread_id').execute() as Promise<ThreadCategoryRecord[]>;
}

export async function exportThreadUploads(): Promise<ThreadUploadRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportThreadUploads();
  }
  const db = await getDb();
  return db.selectFrom('thread_uploads').selectAll().orderBy('id').execute() as Promise<ThreadUploadRecord[]>;
}

export async function exportThreadOutputs(): Promise<ThreadOutputRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportThreadOutputs();
  }
  const db = await getDb();
  return db.selectFrom('thread_outputs').selectAll().orderBy('id').execute() as Promise<ThreadOutputRecord[]>;
}

export async function exportSettings(): Promise<SettingRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportSettings();
  }
  const db = await getDb();
  return db.selectFrom('settings').selectAll().orderBy('key').execute() as Promise<SettingRecord[]>;
}

export async function exportToolConfigs(): Promise<ToolConfigRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportToolConfigs();
  }
  const db = await getDb();
  return db.selectFrom('tool_configs').selectAll().orderBy('tool_name').execute() as Promise<ToolConfigRecord[]>;
}

export async function exportCategoryToolConfigs(): Promise<CategoryToolConfigRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportCategoryToolConfigs();
  }
  const db = await getDb();
  return db.selectFrom('category_tool_configs').selectAll().orderBy('category_id').execute() as Promise<CategoryToolConfigRecord[]>;
}

export async function exportSkills(): Promise<SkillRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportSkills();
  }
  const db = await getDb();
  return db.selectFrom('skills').selectAll().orderBy('id').execute() as Promise<SkillRecord[]>;
}

export async function exportCategorySkills(): Promise<CategorySkillRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportCategorySkills();
  }
  const db = await getDb();
  return db.selectFrom('category_skills').selectAll().orderBy('category_id').execute() as Promise<CategorySkillRecord[]>;
}

export async function exportCategoryPrompts(): Promise<CategoryPromptRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportCategoryPrompts();
  }
  const db = await getDb();
  return db.selectFrom('category_prompts').selectAll().orderBy('category_id').execute() as Promise<CategoryPromptRecord[]>;
}

export async function exportDataApiConfigs(): Promise<DataApiConfigRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportDataApiConfigs();
  }
  const db = await getDb();
  return db.selectFrom('data_api_configs').selectAll().orderBy('name').execute() as Promise<DataApiConfigRecord[]>;
}

export async function exportDataApiCategories(): Promise<DataApiCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportDataApiCategories();
  }
  const db = await getDb();
  return db.selectFrom('data_api_categories').selectAll().orderBy('api_id').execute() as Promise<DataApiCategoryRecord[]>;
}

export async function exportDataCsvConfigs(): Promise<DataCsvConfigRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportDataCsvConfigs();
  }
  const db = await getDb();
  return db.selectFrom('data_csv_configs').selectAll().orderBy('name').execute() as Promise<DataCsvConfigRecord[]>;
}

export async function exportDataCsvCategories(): Promise<DataCsvCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportDataCsvCategories();
  }
  const db = await getDb();
  return db.selectFrom('data_csv_categories').selectAll().orderBy('csv_id').execute() as Promise<DataCsvCategoryRecord[]>;
}

export async function exportWorkspaces(): Promise<WorkspaceRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportWorkspaces();
  }
  const db = await getDb();
  return db.selectFrom('workspaces').selectAll().orderBy('name').execute() as Promise<WorkspaceRecord[]>;
}

export async function exportWorkspaceCategories(): Promise<WorkspaceCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportWorkspaceCategories();
  }
  const db = await getDb();
  return db.selectFrom('workspace_categories').selectAll().orderBy('workspace_id').execute() as Promise<WorkspaceCategoryRecord[]>;
}

export async function exportWorkspaceUsers(): Promise<WorkspaceUserRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportWorkspaceUsers();
  }
  const db = await getDb();
  return db.selectFrom('workspace_users').selectAll().orderBy('workspace_id').execute() as Promise<WorkspaceUserRecord[]>;
}

export async function exportFunctionApiConfigs(): Promise<FunctionApiConfigRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportFunctionApiConfigs();
  }
  const db = await getDb();
  return db.selectFrom('function_api_configs').selectAll().orderBy('name').execute() as Promise<FunctionApiConfigRecord[]>;
}

export async function exportFunctionApiCategories(): Promise<FunctionApiCategoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportFunctionApiCategories();
  }
  const db = await getDb();
  return db.selectFrom('function_api_categories').selectAll().orderBy('api_id').execute() as Promise<FunctionApiCategoryRecord[]>;
}

export async function exportUserMemories(): Promise<UserMemoryRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportUserMemories();
  }
  const db = await getDb();
  return db.selectFrom('user_memories').selectAll().orderBy('user_id').execute() as Promise<UserMemoryRecord[]>;
}

export async function exportToolRoutingRules(): Promise<ToolRoutingRuleRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportToolRoutingRules();
  }
  const db = await getDb();
  return db.selectFrom('tool_routing_rules').selectAll().orderBy('priority').execute() as Promise<ToolRoutingRuleRecord[]>;
}

export async function exportThreadShares(): Promise<ThreadShareRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportThreadShares();
  }
  const db = await getDb();
  return db.selectFrom('thread_shares').selectAll().orderBy('created_at').execute() as Promise<ThreadShareRecord[]>;
}

export async function exportTaskPlans(): Promise<TaskPlanRecord[]> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.exportTaskPlans();
  }
  const db = await getDb();
  return db.selectFrom('task_plans').selectAll().orderBy('created_at').execute() as Promise<TaskPlanRecord[]>;
}

// ============ Import Functions ============

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importBatch(
  tableName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trx: any
): Promise<void> {
  if (records.length === 0) return;
  // Import in batches of 100 to avoid query size limits
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    await trx.insertInto(tableName).values(batch).execute();
  }
}

export async function importDocuments(records: DbDocument[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importDocuments(records);
  }
  const db = await getDb();
  await importBatch('documents', records, db);
}

export async function importCategories(records: DbCategory[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importCategories(records);
  }
  const db = await getDb();
  await importBatch('categories', records, db);
}

export async function importDocumentCategories(records: DocumentCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importDocumentCategories(records);
  }
  const db = await getDb();
  await importBatch('document_categories', records, db);
}

export async function importUsers(records: DbUser[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importUsers(records);
  }
  const db = await getDb();
  await importBatch('users', records, db);
}

export async function importUserSubscriptions(records: UserSubscriptionRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importUserSubscriptions(records);
  }
  const db = await getDb();
  await importBatch('user_subscriptions', records, db);
}

export async function importSuperUserCategories(records: SuperUserCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importSuperUserCategories(records);
  }
  const db = await getDb();
  await importBatch('super_user_categories', records, db);
}

export async function importThreads(records: ThreadRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importThreads(records);
  }
  const db = await getDb();
  await importBatch('threads', records, db);
}

export async function importMessages(records: MessageRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importMessages(records);
  }
  const db = await getDb();
  await importBatch('messages', records, db);
}

export async function importThreadCategories(records: ThreadCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importThreadCategories(records);
  }
  const db = await getDb();
  await importBatch('thread_categories', records, db);
}

export async function importThreadUploads(records: ThreadUploadRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importThreadUploads(records);
  }
  const db = await getDb();
  await importBatch('thread_uploads', records, db);
}

export async function importThreadOutputs(records: ThreadOutputRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importThreadOutputs(records);
  }
  const db = await getDb();
  await importBatch('thread_outputs', records, db);
}

export async function importSettings(records: SettingRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importSettings(records);
  }
  const db = await getDb();
  await importBatch('settings', records, db);
}

export async function importToolConfigs(records: ToolConfigRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importToolConfigs(records);
  }
  const db = await getDb();
  await importBatch('tool_configs', records, db);
}

export async function importCategoryToolConfigs(records: CategoryToolConfigRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importCategoryToolConfigs(records);
  }
  const db = await getDb();
  await importBatch('category_tool_configs', records, db);
}

export async function importSkills(records: SkillRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importSkills(records);
  }
  const db = await getDb();
  await importBatch('skills', records, db);
}

export async function importCategorySkills(records: CategorySkillRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importCategorySkills(records);
  }
  const db = await getDb();
  await importBatch('category_skills', records, db);
}

export async function importCategoryPrompts(records: CategoryPromptRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importCategoryPrompts(records);
  }
  const db = await getDb();
  await importBatch('category_prompts', records, db);
}

export async function importDataApiConfigs(records: DataApiConfigRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importDataApiConfigs(records);
  }
  const db = await getDb();
  await importBatch('data_api_configs', records, db);
}

export async function importDataApiCategories(records: DataApiCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importDataApiCategories(records);
  }
  const db = await getDb();
  await importBatch('data_api_categories', records, db);
}

export async function importDataCsvConfigs(records: DataCsvConfigRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importDataCsvConfigs(records);
  }
  const db = await getDb();
  await importBatch('data_csv_configs', records, db);
}

export async function importDataCsvCategories(records: DataCsvCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importDataCsvCategories(records);
  }
  const db = await getDb();
  await importBatch('data_csv_categories', records, db);
}

export async function importWorkspaces(records: WorkspaceRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importWorkspaces(records);
  }
  const db = await getDb();
  await importBatch('workspaces', records, db);
}

export async function importWorkspaceCategories(records: WorkspaceCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importWorkspaceCategories(records);
  }
  const db = await getDb();
  await importBatch('workspace_categories', records, db);
}

export async function importWorkspaceUsers(records: WorkspaceUserRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importWorkspaceUsers(records);
  }
  const db = await getDb();
  await importBatch('workspace_users', records, db);
}

export async function importFunctionApiConfigs(records: FunctionApiConfigRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importFunctionApiConfigs(records);
  }
  const db = await getDb();
  await importBatch('function_api_configs', records, db);
}

export async function importFunctionApiCategories(records: FunctionApiCategoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importFunctionApiCategories(records);
  }
  const db = await getDb();
  await importBatch('function_api_categories', records, db);
}

export async function importUserMemories(records: UserMemoryRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importUserMemories(records);
  }
  const db = await getDb();
  await importBatch('user_memories', records, db);
}

export async function importToolRoutingRules(records: ToolRoutingRuleRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importToolRoutingRules(records);
  }
  const db = await getDb();
  await importBatch('tool_routing_rules', records, db);
}

export async function importThreadShares(records: ThreadShareRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importThreadShares(records);
  }
  const db = await getDb();
  await importBatch('thread_shares', records, db);
}

export async function importTaskPlans(records: TaskPlanRecord[]): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.importTaskPlans(records);
  }
  const db = await getDb();
  await importBatch('task_plans', records, db);
}

// ============ Clear Functions ============

export async function clearAllData(): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.clearAllData();
  }

  await transaction(async (trx) => {
    // Clear in reverse dependency order
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
    await trx.deleteFrom('users').execute();
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
    await trx.deleteFrom('categories').execute();
    await trx.deleteFrom('settings').execute();
  });
}

export async function clearDocumentData(): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.clearDocumentData();
  }
  await transaction(async (trx) => {
    await trx.deleteFrom('document_categories').execute();
    await trx.deleteFrom('documents').execute();
  });
}

export async function clearUserData(): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.clearUserData();
  }
  await transaction(async (trx) => {
    await trx.deleteFrom('user_subscriptions').execute();
    await trx.deleteFrom('super_user_categories').execute();
    await trx.deleteFrom('users').execute();
  });
}

export async function clearThreadData(): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.clearThreadData();
  }
  await transaction(async (trx) => {
    await trx.deleteFrom('thread_outputs').execute();
    await trx.deleteFrom('thread_uploads').execute();
    await trx.deleteFrom('thread_categories').execute();
    await trx.deleteFrom('messages').execute();
    await trx.deleteFrom('threads').execute();
  });
}

export async function clearSettings(): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.clearSettings();
  }
  const db = await getDb();
  await db.deleteFrom('settings').execute();
}

export async function clearCategories(): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.clearCategories();
  }
  const db = await getDb();
  await db.deleteFrom('categories').execute();
}
