/**
 * Backup Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';

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
  const db = await getDb();
  return db.selectFrom('documents').selectAll().orderBy('id').execute() as Promise<DbDocument[]>;
}

export async function exportCategories(): Promise<DbCategory[]> {
  const db = await getDb();
  return db.selectFrom('categories').selectAll().orderBy('id').execute() as Promise<DbCategory[]>;
}

export async function exportDocumentCategories(): Promise<DocumentCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('document_categories').selectAll().orderBy('document_id').execute() as Promise<DocumentCategoryRecord[]>;
}

export async function exportUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db.selectFrom('users').selectAll().orderBy('id').execute() as Promise<DbUser[]>;
}

export async function exportUserSubscriptions(): Promise<UserSubscriptionRecord[]> {
  const db = await getDb();
  return db.selectFrom('user_subscriptions').selectAll().orderBy('user_id').execute() as Promise<UserSubscriptionRecord[]>;
}

export async function exportSuperUserCategories(): Promise<SuperUserCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('super_user_categories').selectAll().orderBy('user_id').execute() as Promise<SuperUserCategoryRecord[]>;
}

export async function exportThreads(): Promise<ThreadRecord[]> {
  const db = await getDb();
  return db.selectFrom('threads').select(['id', 'user_id', 'title', 'created_at', 'updated_at']).orderBy('id').execute() as Promise<ThreadRecord[]>;
}

export async function exportMessages(): Promise<MessageRecord[]> {
  const db = await getDb();
  return db.selectFrom('messages').selectAll().orderBy('thread_id').orderBy('created_at').execute() as Promise<MessageRecord[]>;
}

export async function exportThreadCategories(): Promise<ThreadCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('thread_categories').selectAll().orderBy('thread_id').execute() as Promise<ThreadCategoryRecord[]>;
}

export async function exportThreadUploads(): Promise<ThreadUploadRecord[]> {
  const db = await getDb();
  return db.selectFrom('thread_uploads').selectAll().orderBy('id').execute() as Promise<ThreadUploadRecord[]>;
}

export async function exportThreadOutputs(): Promise<ThreadOutputRecord[]> {
  const db = await getDb();
  return db.selectFrom('thread_outputs').selectAll().orderBy('id').execute() as Promise<ThreadOutputRecord[]>;
}

export async function exportSettings(): Promise<SettingRecord[]> {
  const db = await getDb();
  return db.selectFrom('settings').selectAll().orderBy('key').execute() as Promise<SettingRecord[]>;
}

export async function exportToolConfigs(): Promise<ToolConfigRecord[]> {
  const db = await getDb();
  return db.selectFrom('tool_configs').selectAll().orderBy('tool_name').execute() as Promise<ToolConfigRecord[]>;
}

export async function exportCategoryToolConfigs(): Promise<CategoryToolConfigRecord[]> {
  const db = await getDb();
  return db.selectFrom('category_tool_configs').selectAll().orderBy('category_id').execute() as Promise<CategoryToolConfigRecord[]>;
}

export async function exportSkills(): Promise<SkillRecord[]> {
  const db = await getDb();
  return db.selectFrom('skills').selectAll().orderBy('id').execute() as Promise<SkillRecord[]>;
}

export async function exportCategorySkills(): Promise<CategorySkillRecord[]> {
  const db = await getDb();
  return db.selectFrom('category_skills').selectAll().orderBy('skill_id').execute() as Promise<CategorySkillRecord[]>;
}

export async function exportCategoryPrompts(): Promise<CategoryPromptRecord[]> {
  const db = await getDb();
  return db.selectFrom('category_prompts').selectAll().orderBy('category_id').execute() as Promise<CategoryPromptRecord[]>;
}

export async function exportDataApiConfigs(): Promise<DataApiConfigRecord[]> {
  const db = await getDb();
  return db.selectFrom('data_api_configs').selectAll().orderBy('id').execute() as Promise<DataApiConfigRecord[]>;
}

export async function exportDataApiCategories(): Promise<DataApiCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('data_api_categories').selectAll().orderBy('api_id').execute() as Promise<DataApiCategoryRecord[]>;
}

export async function exportDataCsvConfigs(): Promise<DataCsvConfigRecord[]> {
  const db = await getDb();
  return db.selectFrom('data_csv_configs').selectAll().orderBy('id').execute() as Promise<DataCsvConfigRecord[]>;
}

export async function exportDataCsvCategories(): Promise<DataCsvCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('data_csv_categories').selectAll().orderBy('csv_id').execute() as Promise<DataCsvCategoryRecord[]>;
}

export async function exportWorkspaces(): Promise<WorkspaceRecord[]> {
  const db = await getDb();
  return db.selectFrom('workspaces').selectAll().orderBy('id').execute() as Promise<WorkspaceRecord[]>;
}

export async function exportWorkspaceCategories(): Promise<WorkspaceCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('workspace_categories').selectAll().orderBy('workspace_id').execute() as Promise<WorkspaceCategoryRecord[]>;
}

export async function exportWorkspaceUsers(): Promise<WorkspaceUserRecord[]> {
  const db = await getDb();
  return db.selectFrom('workspace_users').selectAll().orderBy('workspace_id').execute() as Promise<WorkspaceUserRecord[]>;
}

export async function exportFunctionApiConfigs(): Promise<FunctionApiConfigRecord[]> {
  const db = await getDb();
  return db.selectFrom('function_api_configs').selectAll().orderBy('id').execute() as Promise<FunctionApiConfigRecord[]>;
}

export async function exportFunctionApiCategories(): Promise<FunctionApiCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('function_api_categories').selectAll().orderBy('api_id').execute() as Promise<FunctionApiCategoryRecord[]>;
}

export async function exportUserMemories(): Promise<UserMemoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('user_memories').selectAll().orderBy('id').execute() as Promise<UserMemoryRecord[]>;
}

export async function exportToolRoutingRules(): Promise<ToolRoutingRuleRecord[]> {
  const db = await getDb();
  return db.selectFrom('tool_routing_rules').selectAll().orderBy('id').execute() as Promise<ToolRoutingRuleRecord[]>;
}

export async function exportThreadShares(): Promise<ThreadShareRecord[]> {
  const db = await getDb();
  return db.selectFrom('thread_shares').selectAll().orderBy('created_at').execute() as Promise<ThreadShareRecord[]>;
}

export async function exportTaskPlans(): Promise<TaskPlanRecord[]> {
  const db = await getDb();
  return db.selectFrom('task_plans').selectAll().orderBy('created_at').execute() as Promise<TaskPlanRecord[]>;
}

// ============ Agent Bot Export Functions ============

export async function exportAgentBots(): Promise<AgentBotRecord[]> {
  const db = await getDb();
  return db.selectFrom('agent_bots').selectAll().orderBy('created_at').execute() as Promise<AgentBotRecord[]>;
}

export async function exportAgentBotVersions(): Promise<AgentBotVersionRecord[]> {
  const db = await getDb();
  return db.selectFrom('agent_bot_versions').selectAll().orderBy('agent_bot_id').execute() as Promise<AgentBotVersionRecord[]>;
}

export async function exportAgentBotVersionCategories(): Promise<AgentBotVersionCategoryRecord[]> {
  const db = await getDb();
  return db.selectFrom('agent_bot_version_categories').selectAll().orderBy('version_id').execute() as Promise<AgentBotVersionCategoryRecord[]>;
}

export async function exportAgentBotVersionSkills(): Promise<AgentBotVersionSkillRecord[]> {
  const db = await getDb();
  return db.selectFrom('agent_bot_version_skills').selectAll().orderBy('version_id').execute() as Promise<AgentBotVersionSkillRecord[]>;
}

export async function exportAgentBotVersionTools(): Promise<AgentBotVersionToolRecord[]> {
  const db = await getDb();
  return db.selectFrom('agent_bot_version_tools').selectAll().orderBy('version_id').execute() as Promise<AgentBotVersionToolRecord[]>;
}

export async function exportAgentBotApiKeys(): Promise<AgentBotApiKeyRecord[]> {
  const db = await getDb();
  return db.selectFrom('agent_bot_api_keys').selectAll().orderBy('agent_bot_id').execute() as Promise<AgentBotApiKeyRecord[]>;
}

// ============ Category-Filtered Export Functions ============

export async function exportDocumentsForCategories(categoryIds: number[]): Promise<DbDocument[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('documents as d')
    .selectAll('d')
    .innerJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .where('dc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('d.id')
    .execute() as Promise<DbDocument[]>;
}

export async function exportThreadsForCategoriesStrict(categoryIds: number[]): Promise<ThreadRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('threads as t')
    .select(['t.id', 't.user_id', 't.title', 't.created_at', 't.updated_at'])
    .innerJoin('thread_categories as tc', 't.id', 'tc.thread_id')
    .where('tc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('t.id')
    .execute() as Promise<ThreadRecord[]>;
}

export async function exportSkillsForCategories(categoryIds: number[]): Promise<SkillRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('skills as s')
    .selectAll('s')
    .innerJoin('category_skills as cs', 's.id', 'cs.skill_id')
    .where('cs.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('s.id')
    .execute() as Promise<SkillRecord[]>;
}

export async function exportWorkspacesForCategories(categoryIds: number[]): Promise<WorkspaceRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('workspaces as w')
    .selectAll('w')
    .innerJoin('workspace_categories as wc', 'w.id', 'wc.workspace_id')
    .where('wc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('w.id')
    .execute() as Promise<WorkspaceRecord[]>;
}

export async function exportDataApiConfigsForCategories(categoryIds: number[]): Promise<DataApiConfigRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('data_api_configs as d')
    .selectAll('d')
    .innerJoin('data_api_categories as dc', 'd.id', 'dc.api_id')
    .where('dc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('d.id')
    .execute() as Promise<DataApiConfigRecord[]>;
}

export async function exportDataCsvConfigsForCategories(categoryIds: number[]): Promise<DataCsvConfigRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('data_csv_configs as d')
    .selectAll('d')
    .innerJoin('data_csv_categories as dc', 'd.id', 'dc.csv_id')
    .where('dc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('d.id')
    .execute() as Promise<DataCsvConfigRecord[]>;
}

export async function exportFunctionApiConfigsForCategories(categoryIds: number[]): Promise<FunctionApiConfigRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('function_api_configs as f')
    .selectAll('f')
    .innerJoin('function_api_categories as fc', 'f.id', 'fc.api_id')
    .where('fc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('f.id')
    .execute() as Promise<FunctionApiConfigRecord[]>;
}

export async function exportAgentBotsForCategories(categoryIds: number[]): Promise<AgentBotRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('agent_bots as ab')
    .selectAll('ab')
    .innerJoin('agent_bot_versions as v', 'ab.id', 'v.agent_bot_id')
    .innerJoin('agent_bot_version_categories as vc', 'v.id', 'vc.version_id')
    .where('vc.category_id', 'in', categoryIds)
    .distinct()
    .orderBy('ab.id')
    .execute() as Promise<AgentBotRecord[]>;
}

export async function exportAgentBotVersionsForBots(botIds: string[]): Promise<AgentBotVersionRecord[]> {
  if (botIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('agent_bot_versions')
    .selectAll()
    .where('agent_bot_id', 'in', botIds)
    .orderBy('agent_bot_id')
    .execute() as Promise<AgentBotVersionRecord[]>;
}

export async function exportAgentBotApiKeysForBots(botIds: string[]): Promise<AgentBotApiKeyRecord[]> {
  if (botIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('agent_bot_api_keys')
    .selectAll()
    .where('agent_bot_id', 'in', botIds)
    .orderBy('agent_bot_id')
    .execute() as Promise<AgentBotApiKeyRecord[]>;
}

export async function exportCategoryPromptsForCategories(categoryIds: number[]): Promise<CategoryPromptRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('category_prompts')
    .selectAll()
    .where('category_id', 'in', categoryIds)
    .orderBy('category_id')
    .execute() as Promise<CategoryPromptRecord[]>;
}

export async function exportCategoryToolConfigsForCategories(categoryIds: number[]): Promise<CategoryToolConfigRecord[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('category_tool_configs')
    .selectAll()
    .where('category_id', 'in', categoryIds)
    .orderBy('category_id')
    .execute() as Promise<CategoryToolConfigRecord[]>;
}

export async function exportMessagesForThreads(threadIds: string[]): Promise<MessageRecord[]> {
  if (threadIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('messages')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .orderBy('thread_id')
    .orderBy('created_at')
    .execute() as Promise<MessageRecord[]>;
}

export async function exportThreadCategoriesFiltered(threadIds: string[], categoryIds: number[]): Promise<ThreadCategoryRecord[]> {
  if (threadIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('thread_categories')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('thread_id')
    .execute() as Promise<ThreadCategoryRecord[]>;
}

export async function exportThreadUploadsForThreads(threadIds: string[]): Promise<ThreadUploadRecord[]> {
  if (threadIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('thread_uploads')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .orderBy('id')
    .execute() as Promise<ThreadUploadRecord[]>;
}

export async function exportThreadOutputsForThreads(threadIds: string[]): Promise<ThreadOutputRecord[]> {
  if (threadIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('thread_outputs')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .orderBy('id')
    .execute() as Promise<ThreadOutputRecord[]>;
}

export async function exportThreadSharesForThreads(threadIds: string[]): Promise<ThreadShareRecord[]> {
  if (threadIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('thread_shares')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .orderBy('created_at')
    .execute() as Promise<ThreadShareRecord[]>;
}

export async function exportTaskPlansForThreads(threadIds: string[]): Promise<TaskPlanRecord[]> {
  if (threadIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('task_plans')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .orderBy('created_at')
    .execute() as Promise<TaskPlanRecord[]>;
}

export async function exportDocumentCategoriesFiltered(docIds: number[], categoryIds: number[]): Promise<DocumentCategoryRecord[]> {
  if (docIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('document_categories')
    .selectAll()
    .where('document_id', 'in', docIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('document_id')
    .execute() as Promise<DocumentCategoryRecord[]>;
}

export async function exportCategorySkillsFiltered(skillIds: number[], categoryIds: number[]): Promise<CategorySkillRecord[]> {
  if (skillIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('category_skills')
    .selectAll()
    .where('skill_id', 'in', skillIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('skill_id')
    .execute() as Promise<CategorySkillRecord[]>;
}

export async function exportWorkspaceCategoriesFiltered(workspaceIds: string[], categoryIds: number[]): Promise<WorkspaceCategoryRecord[]> {
  if (workspaceIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('workspace_categories')
    .selectAll()
    .where('workspace_id', 'in', workspaceIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('workspace_id')
    .execute() as Promise<WorkspaceCategoryRecord[]>;
}

export async function exportWorkspaceUsersForWorkspaces(workspaceIds: string[]): Promise<WorkspaceUserRecord[]> {
  if (workspaceIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('workspace_users')
    .selectAll()
    .where('workspace_id', 'in', workspaceIds)
    .orderBy('workspace_id')
    .execute() as Promise<WorkspaceUserRecord[]>;
}

export async function exportDataApiCategoriesFiltered(apiIds: string[], categoryIds: number[]): Promise<DataApiCategoryRecord[]> {
  if (apiIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('data_api_categories')
    .selectAll()
    .where('api_id', 'in', apiIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('api_id')
    .execute() as Promise<DataApiCategoryRecord[]>;
}

export async function exportDataCsvCategoriesFiltered(csvIds: string[], categoryIds: number[]): Promise<DataCsvCategoryRecord[]> {
  if (csvIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('data_csv_categories')
    .selectAll()
    .where('csv_id', 'in', csvIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('csv_id')
    .execute() as Promise<DataCsvCategoryRecord[]>;
}

export async function exportFunctionApiCategoriesFiltered(apiIds: string[], categoryIds: number[]): Promise<FunctionApiCategoryRecord[]> {
  if (apiIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('function_api_categories')
    .selectAll()
    .where('api_id', 'in', apiIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('api_id')
    .execute() as Promise<FunctionApiCategoryRecord[]>;
}

export async function exportAgentBotVersionCategoriesFiltered(versionIds: string[], categoryIds: number[]): Promise<AgentBotVersionCategoryRecord[]> {
  if (versionIds.length === 0 || categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('agent_bot_version_categories')
    .selectAll()
    .where('version_id', 'in', versionIds)
    .where('category_id', 'in', categoryIds)
    .orderBy('version_id')
    .execute() as Promise<AgentBotVersionCategoryRecord[]>;
}

export async function exportAgentBotVersionSkillsForVersions(versionIds: string[]): Promise<AgentBotVersionSkillRecord[]> {
  if (versionIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('agent_bot_version_skills')
    .selectAll()
    .where('version_id', 'in', versionIds)
    .orderBy('version_id')
    .execute() as Promise<AgentBotVersionSkillRecord[]>;
}

export async function exportAgentBotVersionToolsForVersions(versionIds: string[]): Promise<AgentBotVersionToolRecord[]> {
  if (versionIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('agent_bot_version_tools')
    .selectAll()
    .where('version_id', 'in', versionIds)
    .orderBy('version_id')
    .execute() as Promise<AgentBotVersionToolRecord[]>;
}

export async function exportCategoriesById(categoryIds: number[]): Promise<DbCategory[]> {
  if (categoryIds.length === 0) return [];
  const db = await getDb();
  return db
    .selectFrom('categories')
    .selectAll()
    .where('id', 'in', categoryIds)
    .orderBy('id')
    .execute() as Promise<DbCategory[]>;
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
  const db = await getDb();
  await importBatch('documents', records, db);
}

export async function importCategories(records: DbCategory[]): Promise<void> {
  const db = await getDb();
  await importBatch('categories', records, db);
}

export async function importDocumentCategories(records: DocumentCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('document_categories', records, db);
}

export async function importUsers(records: DbUser[]): Promise<void> {
  const db = await getDb();
  await importBatch('users', records, db);
}

export async function importUserSubscriptions(records: UserSubscriptionRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('user_subscriptions', records, db);
}

export async function importSuperUserCategories(records: SuperUserCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('super_user_categories', records, db);
}

export async function importThreads(records: ThreadRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('threads', records, db);
}

export async function importMessages(records: MessageRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('messages', records, db);
}

export async function importThreadCategories(records: ThreadCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('thread_categories', records, db);
}

export async function importThreadUploads(records: ThreadUploadRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('thread_uploads', records, db);
}

export async function importThreadOutputs(records: ThreadOutputRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('thread_outputs', records, db);
}

export async function importSettings(records: SettingRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('settings', records, db);
}

export async function importToolConfigs(records: ToolConfigRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('tool_configs', records, db);
}

export async function importCategoryToolConfigs(records: CategoryToolConfigRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('category_tool_configs', records, db);
}

export async function importSkills(records: SkillRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('skills', records, db);
}

export async function importCategorySkills(records: CategorySkillRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('category_skills', records, db);
}

export async function importCategoryPrompts(records: CategoryPromptRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('category_prompts', records, db);
}

export async function importDataApiConfigs(records: DataApiConfigRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('data_api_configs', records, db);
}

export async function importDataApiCategories(records: DataApiCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('data_api_categories', records, db);
}

export async function importDataCsvConfigs(records: DataCsvConfigRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('data_csv_configs', records, db);
}

export async function importDataCsvCategories(records: DataCsvCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('data_csv_categories', records, db);
}

export async function importWorkspaces(records: WorkspaceRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('workspaces', records, db);
}

export async function importWorkspaceCategories(records: WorkspaceCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('workspace_categories', records, db);
}

export async function importWorkspaceUsers(records: WorkspaceUserRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('workspace_users', records, db);
}

export async function importFunctionApiConfigs(records: FunctionApiConfigRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('function_api_configs', records, db);
}

export async function importFunctionApiCategories(records: FunctionApiCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('function_api_categories', records, db);
}

export async function importUserMemories(records: UserMemoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('user_memories', records, db);
}

export async function importToolRoutingRules(records: ToolRoutingRuleRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('tool_routing_rules', records, db);
}

export async function importThreadShares(records: ThreadShareRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('thread_shares', records, db);
}

export async function importTaskPlans(records: TaskPlanRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('task_plans', records, db);
}

// ============ Agent Bot Import Functions ============

export async function importAgentBots(records: AgentBotRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('agent_bots', records, db);
}

export async function importAgentBotVersions(records: AgentBotVersionRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('agent_bot_versions', records, db);
}

export async function importAgentBotVersionCategories(records: AgentBotVersionCategoryRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('agent_bot_version_categories', records, db);
}

export async function importAgentBotVersionSkills(records: AgentBotVersionSkillRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('agent_bot_version_skills', records, db);
}

export async function importAgentBotVersionTools(records: AgentBotVersionToolRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('agent_bot_version_tools', records, db);
}

export async function importAgentBotApiKeys(records: AgentBotApiKeyRecord[]): Promise<void> {
  const db = await getDb();
  await importBatch('agent_bot_api_keys', records, db);
}

// ============ Clear Functions ============

export async function clearAllData(): Promise<void> {
  await transaction(async (trx) => {
    // Agent bot tables
    await trx.deleteFrom('agent_bot_api_keys').execute();
    await trx.deleteFrom('agent_bot_version_tools').execute();
    await trx.deleteFrom('agent_bot_version_skills').execute();
    await trx.deleteFrom('agent_bot_version_categories').execute();
    await trx.deleteFrom('agent_bot_versions').execute();
    await trx.deleteFrom('agent_bots').execute();
    // Thread data
    await trx.deleteFrom('thread_outputs').execute();
    await trx.deleteFrom('thread_uploads').execute();
    await trx.deleteFrom('thread_categories').execute();
    await trx.deleteFrom('thread_shares').execute();
    await trx.deleteFrom('task_plans').execute();
    await trx.deleteFrom('messages').execute();
    await trx.deleteFrom('threads').execute();
    // User data
    await trx.deleteFrom('user_subscriptions').execute();
    await trx.deleteFrom('super_user_categories').execute();
    await trx.deleteFrom('user_memories').execute();
    await trx.deleteFrom('users').execute();
    // Document data
    await trx.deleteFrom('document_categories').execute();
    await trx.deleteFrom('documents').execute();
    // Config data
    await trx.deleteFrom('category_prompts').execute();
    await trx.deleteFrom('category_tool_configs').execute();
    await trx.deleteFrom('category_skills').execute();
    await trx.deleteFrom('tool_configs').execute();
    await trx.deleteFrom('tool_routing_rules').execute();
    await trx.deleteFrom('skills').execute();
    await trx.deleteFrom('settings').execute();
    // Data sources
    await trx.deleteFrom('data_api_categories').execute();
    await trx.deleteFrom('data_api_configs').execute();
    await trx.deleteFrom('data_csv_categories').execute();
    await trx.deleteFrom('data_csv_configs').execute();
    await trx.deleteFrom('function_api_categories').execute();
    await trx.deleteFrom('function_api_configs').execute();
    // Workspaces
    await trx.deleteFrom('workspace_users').execute();
    await trx.deleteFrom('workspace_categories').execute();
    await trx.deleteFrom('workspaces').execute();
    // Categories last (due to FK refs)
    await trx.deleteFrom('categories').execute();
  });
}

export async function clearDocumentData(): Promise<void> {
  await transaction(async (trx) => {
    await trx.deleteFrom('document_categories').execute();
    await trx.deleteFrom('documents').execute();
  });
}

export async function clearUserData(): Promise<void> {
  await transaction(async (trx) => {
    await trx.deleteFrom('user_subscriptions').execute();
    await trx.deleteFrom('super_user_categories').execute();
    await trx.deleteFrom('users').execute();
  });
}

export async function clearThreadData(): Promise<void> {
  await transaction(async (trx) => {
    await trx.deleteFrom('thread_outputs').execute();
    await trx.deleteFrom('thread_uploads').execute();
    await trx.deleteFrom('thread_categories').execute();
    await trx.deleteFrom('messages').execute();
    await trx.deleteFrom('threads').execute();
  });
}

export async function clearSettings(): Promise<void> {
  const db = await getDb();
  await db.deleteFrom('settings').execute();
}

export async function clearCategories(): Promise<void> {
  const db = await getDb();
  await db.deleteFrom('categories').execute();
}
