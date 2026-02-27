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
  // Agent bot types
  AgentBotRecord,
  AgentBotVersionRecord,
  AgentBotVersionCategoryRecord,
  AgentBotVersionSkillRecord,
  AgentBotVersionToolRecord,
  AgentBotApiKeyRecord,
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
  // Agent bot types
  AgentBotRecord,
  AgentBotVersionRecord,
  AgentBotVersionCategoryRecord,
  AgentBotVersionSkillRecord,
  AgentBotVersionToolRecord,
  AgentBotApiKeyRecord,
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
  // Tool configs module has no compat layer and always uses SQLite
  // Always delegate to sync to match how tool configs are actually stored
  return sync.exportToolConfigs();
}

export async function exportCategoryToolConfigs(): Promise<CategoryToolConfigRecord[]> {
  // Category tool configs module has no compat layer and always uses SQLite
  // Always delegate to sync to match how category tool configs are actually stored
  return sync.exportCategoryToolConfigs();
}

export async function exportSkills(): Promise<SkillRecord[]> {
  // Skills module has no compat layer and always uses SQLite
  // Always delegate to sync to match how skills are actually stored
  return sync.exportSkills();
}

export async function exportCategorySkills(): Promise<CategorySkillRecord[]> {
  // Skills module has no compat layer and always uses SQLite
  // Always delegate to sync to match how skills are actually stored
  return sync.exportCategorySkills();
}

export async function exportCategoryPrompts(): Promise<CategoryPromptRecord[]> {
  // Category prompts module has no compat layer and always uses SQLite
  // Always delegate to sync to match how category prompts are actually stored
  return sync.exportCategoryPrompts();
}

export async function exportDataApiConfigs(): Promise<DataApiConfigRecord[]> {
  // Data API configs module has no compat layer and always uses SQLite
  // Always delegate to sync to match how data API configs are actually stored
  return sync.exportDataApiConfigs();
}

export async function exportDataApiCategories(): Promise<DataApiCategoryRecord[]> {
  // Data API categories module has no compat layer and always uses SQLite
  // Always delegate to sync to match how data API categories are actually stored
  return sync.exportDataApiCategories();
}

export async function exportDataCsvConfigs(): Promise<DataCsvConfigRecord[]> {
  // Data CSV configs module has no compat layer and always uses SQLite
  // Always delegate to sync to match how data CSV configs are actually stored
  return sync.exportDataCsvConfigs();
}

export async function exportDataCsvCategories(): Promise<DataCsvCategoryRecord[]> {
  // Data CSV categories module has no compat layer and always uses SQLite
  // Always delegate to sync to match how data CSV categories are actually stored
  return sync.exportDataCsvCategories();
}

export async function exportWorkspaces(): Promise<WorkspaceRecord[]> {
  // Workspaces module has no compat layer and always uses SQLite
  // Always delegate to sync to match how workspaces are actually stored
  return sync.exportWorkspaces();
}

export async function exportWorkspaceCategories(): Promise<WorkspaceCategoryRecord[]> {
  // Workspace categories module has no compat layer and always uses SQLite
  // Always delegate to sync to match how workspace categories are actually stored
  return sync.exportWorkspaceCategories();
}

export async function exportWorkspaceUsers(): Promise<WorkspaceUserRecord[]> {
  // Workspace users module has no compat layer and always uses SQLite
  // Always delegate to sync to match how workspace users are actually stored
  return sync.exportWorkspaceUsers();
}

export async function exportFunctionApiConfigs(): Promise<FunctionApiConfigRecord[]> {
  // Function API configs module has no compat layer and always uses SQLite
  // Always delegate to sync to match how function API configs are actually stored
  return sync.exportFunctionApiConfigs();
}

export async function exportFunctionApiCategories(): Promise<FunctionApiCategoryRecord[]> {
  // Function API categories module has no compat layer and always uses SQLite
  // Always delegate to sync to match how function API categories are actually stored
  return sync.exportFunctionApiCategories();
}

export async function exportUserMemories(): Promise<UserMemoryRecord[]> {
  // User memories module has no compat layer and always uses SQLite
  // Always delegate to sync to match how user memories are actually stored
  return sync.exportUserMemories();
}

export async function exportToolRoutingRules(): Promise<ToolRoutingRuleRecord[]> {
  // Tool routing rules module has no compat layer and always uses SQLite
  // Always delegate to sync to match how tool routing rules are actually stored
  return sync.exportToolRoutingRules();
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

// ============ Agent Bot Export Functions ============
// Note: Agent bot tables use sync functions only as they're not yet in the Kysely DB schema

export async function exportAgentBots(): Promise<AgentBotRecord[]> {
  // Always use sync - agent bot tables not in Kysely schema
  return sync.exportAgentBots();
}

export async function exportAgentBotVersions(): Promise<AgentBotVersionRecord[]> {
  return sync.exportAgentBotVersions();
}

export async function exportAgentBotVersionCategories(): Promise<AgentBotVersionCategoryRecord[]> {
  return sync.exportAgentBotVersionCategories();
}

export async function exportAgentBotVersionSkills(): Promise<AgentBotVersionSkillRecord[]> {
  return sync.exportAgentBotVersionSkills();
}

export async function exportAgentBotVersionTools(): Promise<AgentBotVersionToolRecord[]> {
  return sync.exportAgentBotVersionTools();
}

export async function exportAgentBotApiKeys(): Promise<AgentBotApiKeyRecord[]> {
  return sync.exportAgentBotApiKeys();
}

// ============ Category-Filtered Export Functions ============
// These functions use sync implementations for all providers due to complex SQL with parameters

export async function exportDocumentsForCategories(categoryIds: number[]): Promise<DbDocument[]> {
  return sync.exportDocumentsForCategories(categoryIds);
}

export async function exportThreadsForCategoriesStrict(categoryIds: number[]): Promise<ThreadRecord[]> {
  return sync.exportThreadsForCategoriesStrict(categoryIds);
}

export async function exportSkillsForCategories(categoryIds: number[]): Promise<SkillRecord[]> {
  return sync.exportSkillsForCategories(categoryIds);
}

export async function exportWorkspacesForCategories(categoryIds: number[]): Promise<WorkspaceRecord[]> {
  return sync.exportWorkspacesForCategories(categoryIds);
}

export async function exportDataApiConfigsForCategories(categoryIds: number[]): Promise<DataApiConfigRecord[]> {
  return sync.exportDataApiConfigsForCategories(categoryIds);
}

export async function exportDataCsvConfigsForCategories(categoryIds: number[]): Promise<DataCsvConfigRecord[]> {
  return sync.exportDataCsvConfigsForCategories(categoryIds);
}

export async function exportFunctionApiConfigsForCategories(categoryIds: number[]): Promise<FunctionApiConfigRecord[]> {
  return sync.exportFunctionApiConfigsForCategories(categoryIds);
}

export async function exportAgentBotsForCategories(categoryIds: number[]): Promise<AgentBotRecord[]> {
  return sync.exportAgentBotsForCategories(categoryIds);
}

export async function exportAgentBotVersionsForBots(botIds: string[]): Promise<AgentBotVersionRecord[]> {
  return sync.exportAgentBotVersionsForBots(botIds);
}

export async function exportAgentBotApiKeysForBots(botIds: string[]): Promise<AgentBotApiKeyRecord[]> {
  return sync.exportAgentBotApiKeysForBots(botIds);
}

export async function exportCategoryPromptsForCategories(categoryIds: number[]): Promise<CategoryPromptRecord[]> {
  return sync.exportCategoryPromptsForCategories(categoryIds);
}

export async function exportCategoryToolConfigsForCategories(categoryIds: number[]): Promise<CategoryToolConfigRecord[]> {
  return sync.exportCategoryToolConfigsForCategories(categoryIds);
}

export async function exportMessagesForThreads(threadIds: string[]): Promise<MessageRecord[]> {
  return sync.exportMessagesForThreads(threadIds);
}

export async function exportThreadCategoriesFiltered(threadIds: string[], categoryIds: number[]): Promise<ThreadCategoryRecord[]> {
  return sync.exportThreadCategoriesFiltered(threadIds, categoryIds);
}

export async function exportThreadUploadsForThreads(threadIds: string[]): Promise<ThreadUploadRecord[]> {
  return sync.exportThreadUploadsForThreads(threadIds);
}

export async function exportThreadOutputsForThreads(threadIds: string[]): Promise<ThreadOutputRecord[]> {
  return sync.exportThreadOutputsForThreads(threadIds);
}

export async function exportThreadSharesForThreads(threadIds: string[]): Promise<ThreadShareRecord[]> {
  return sync.exportThreadSharesForThreads(threadIds);
}

export async function exportTaskPlansForThreads(threadIds: string[]): Promise<TaskPlanRecord[]> {
  return sync.exportTaskPlansForThreads(threadIds);
}

export async function exportDocumentCategoriesFiltered(docIds: number[], categoryIds: number[]): Promise<DocumentCategoryRecord[]> {
  return sync.exportDocumentCategoriesFiltered(docIds, categoryIds);
}

export async function exportCategorySkillsFiltered(skillIds: number[], categoryIds: number[]): Promise<CategorySkillRecord[]> {
  return sync.exportCategorySkillsFiltered(skillIds, categoryIds);
}

export async function exportWorkspaceCategoriesFiltered(workspaceIds: string[], categoryIds: number[]): Promise<WorkspaceCategoryRecord[]> {
  return sync.exportWorkspaceCategoriesFiltered(workspaceIds, categoryIds);
}

export async function exportWorkspaceUsersForWorkspaces(workspaceIds: string[]): Promise<WorkspaceUserRecord[]> {
  return sync.exportWorkspaceUsersForWorkspaces(workspaceIds);
}

export async function exportDataApiCategoriesFiltered(apiIds: string[], categoryIds: number[]): Promise<DataApiCategoryRecord[]> {
  return sync.exportDataApiCategoriesFiltered(apiIds, categoryIds);
}

export async function exportDataCsvCategoriesFiltered(csvIds: string[], categoryIds: number[]): Promise<DataCsvCategoryRecord[]> {
  return sync.exportDataCsvCategoriesFiltered(csvIds, categoryIds);
}

export async function exportFunctionApiCategoriesFiltered(apiIds: string[], categoryIds: number[]): Promise<FunctionApiCategoryRecord[]> {
  return sync.exportFunctionApiCategoriesFiltered(apiIds, categoryIds);
}

export async function exportAgentBotVersionCategoriesFiltered(versionIds: string[], categoryIds: number[]): Promise<AgentBotVersionCategoryRecord[]> {
  return sync.exportAgentBotVersionCategoriesFiltered(versionIds, categoryIds);
}

export async function exportAgentBotVersionSkillsForVersions(versionIds: string[]): Promise<AgentBotVersionSkillRecord[]> {
  return sync.exportAgentBotVersionSkillsForVersions(versionIds);
}

export async function exportAgentBotVersionToolsForVersions(versionIds: string[]): Promise<AgentBotVersionToolRecord[]> {
  return sync.exportAgentBotVersionToolsForVersions(versionIds);
}

export async function exportCategoriesById(categoryIds: number[]): Promise<DbCategory[]> {
  return sync.exportCategoriesById(categoryIds);
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

// ============ Agent Bot Import Functions ============
// Note: Agent bot tables use sync functions only as they're not yet in the Kysely DB schema

export async function importAgentBots(records: AgentBotRecord[]): Promise<void> {
  return sync.importAgentBots(records);
}

export async function importAgentBotVersions(records: AgentBotVersionRecord[]): Promise<void> {
  return sync.importAgentBotVersions(records);
}

export async function importAgentBotVersionCategories(records: AgentBotVersionCategoryRecord[]): Promise<void> {
  return sync.importAgentBotVersionCategories(records);
}

export async function importAgentBotVersionSkills(records: AgentBotVersionSkillRecord[]): Promise<void> {
  return sync.importAgentBotVersionSkills(records);
}

export async function importAgentBotVersionTools(records: AgentBotVersionToolRecord[]): Promise<void> {
  return sync.importAgentBotVersionTools(records);
}

export async function importAgentBotApiKeys(records: AgentBotApiKeyRecord[]): Promise<void> {
  return sync.importAgentBotApiKeys(records);
}

// ============ Clear Functions ============

export async function clearAllData(): Promise<void> {
  // Always use sync - includes agent bot tables not in Kysely schema
  return sync.clearAllData();
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
