/**
 * Database Layer - Async Interface
 *
 * This module provides a unified async interface for database operations
 * using Kysely with PostgreSQL.
 *
 * Usage:
 *   import { getUserById, createCategory, ... } from '@/lib/db/compat';
 *
 * All operations use the Kysely query builder for async PostgreSQL access.
 * API routes should import from this module and use `await` for all operations.
 */

// Export database helper
export { getDb } from '../kysely';

// ============ Users ============
export {
  // Types
  type UserRole,
  type DbUser,
  type CreateUserInput,
  type UpdateUserInput,
  type UserWithSubscriptions,
  type UserWithAssignments,
  // User CRUD
  getAllUsers,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  deleteUserByEmail,
  userExists,
  isAdmin,
  isSuperUser,
  // Users by Role
  getAdmins,
  getSuperUsers,
  getRegularUsers,
  // Super User Category Assignments
  getSuperUserWithAssignments,
  assignCategoryToSuperUser,
  removeCategoryFromSuperUser,
  replaceSuperUserCategories,
  getSuperUserCategories,
  superUserHasCategory,
  // User Subscriptions
  getUserWithSubscriptions,
  addSubscription,
  removeSubscription,
  toggleSubscriptionActive,
  getActiveSubscriptions,
  userHasSubscription,
  getUsersSubscribedToCategory,
  // Bulk Operations
  createUserWithSubscriptions,
  createSuperUserWithAssignments,
  // Initialize from Environment
  initializeAdminsFromEnv,
  // Credentials Management
  setUserPassword,
  setCredentialsEnabled,
  clearUserPassword,
  canLoginWithCredentials,
  getCredentialUsers,
  initializeAdminCredentialsFromEnv,
} from './users';

// ============ Config ============
export {
  // Types
  type RagSettings,
  type LlmSettings,
  type TavilySettings,
  type UploadLimits,
  type SystemPrompt,
  type RetentionSettings,
  type AcronymMappings,
  type BrandingSettings,
  type PWASettings,
  type EmbeddingSettings,
  type RerankerSettings,
  type MemorySettings,
  type SummarizationSettings,
  type SkillsSettings,
  type OcrProvider,
  type OcrProviderConfig,
  type OcrSettings,
  type SuperuserSettings,
  type LimitsSettings,
  type TokenLimitsSettings,
  type ModelTokenLimits,
  type AvailableModel,
  type SettingKey,
  type ToolConfig,
  type AgentBotsSettings,
  type CredentialsAuthSettings,
  type LlmFallbackSettings,
  type RoutesSettings,
  type SpeechSettings,
  type SttProvider,
  type TtsProvider,
  type SttProviderConfig,
  type SttRouteConfig,
  type TtsProviderConfig,
  // Constants
  DEFAULT_PWA_SETTINGS,
  DEFAULT_OCR_SETTINGS,
  BRANDING_ICONS,
  DEFAULT_MODEL_ID,
  DEFAULT_CREDENTIALS_AUTH_SETTINGS,
  // Core Operations
  getSetting,
  setSetting,
  deleteSetting,
  getSettingMetadata,
  // Typed Getters
  getRagSettings,
  getLlmSettings,
  getTavilySettings,
  getUploadLimits,
  getSystemPrompt,
  getAcronymMappings,
  getRetentionSettings,
  getBrandingSettings,
  getEmbeddingSettings,
  getRerankerSettings,
  getMemorySettings,
  getSummarizationSettings,
  getSkillsSettings,
  getOcrSettings,
  getLimitsSettings,
  getTokenLimitsSettings,
  getModelTokenLimits,
  getEffectiveMaxTokens,
  getPWASettings,
  getSuperuserSettings,
  getAvailableModels,
  isToolCapableModelFromDb,
  getToolCapableModels,
  getDefaultSystemPrompt,
  // Typed Setters
  setRagSettings,
  setLlmSettings,
  setTavilySettings,
  setUploadLimits,
  setSystemPrompt,
  setAcronymMappings,
  setRetentionSettings,
  setBrandingSettings,
  setEmbeddingSettings,
  setRerankerSettings,
  setMemorySettings,
  setSummarizationSettings,
  setSkillsSettings,
  setOcrSettings,
  setLimitsSettings,
  setTokenLimitsSettings,
  setModelTokenLimit,
  setModelTokenLimits,
  setPWASettings,
  setSuperuserSettings,
  // Agent Bots, Credentials Auth, LLM Fallback
  getAgentBotsSettings,
  updateAgentBotsSettings,
  getCredentialsAuthSettings,
  setCredentialsAuthSettings,
  getLlmFallbackSettings,
  setLlmFallbackSettings,
  // LLM Routes
  getRoutesSettings,
  setRoutesSettings,
  // Speech (STT + TTS)
  getSpeechSettings,
  setSpeechSettings,
  // Bulk Operations
  getAllSettings,
  // Tool Config (async)
  getToolConfigAsync,
  upsertToolConfigAsync,
} from './config';

// ============ Categories ============
export {
  // Types
  type DbCategory,
  type CategoryWithStats,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  // Helper
  generateSlug,
  // Category CRUD
  getAllCategories,
  getAllCategoriesWithStats,
  getCategoryById,
  getCategoryBySlug,
  getCategoryByName,
  createCategory,
  updateCategory,
  deleteCategory,
  categoryExists,
  // Category Queries
  getCategoriesForSuperUser,
  getCategoriesForUser,
  getAllSubscriptionsForUser,
  getSuperUsersForCategory,
  getSubscribersForCategory,
  // Category Statistics
  getCategoryDocumentCount,
  getUnassignedDocumentCount,
  // Bulk Operations
  bulkSubscribeUsers,
  getCategoryIdsBySlugs,
  getCategorySlugsByIds,
  // Superuser Category Management
  getCreatedCategoriesCount,
  getCategoriesCreatedBy,
  isCategoryCreatedBy,
  getDocumentIdsForCategory,
  deleteCategoryWithRelatedData,
  // Bulk Category Lookup
  type CategoryInfo,
  getCategoriesByIds,
} from './categories';

// ============ Threads ============
export {
  // Types
  type DbThread,
  type DbMessage,
  type DbThreadUpload,
  type DbThreadOutput,
  type ThreadWithDetails,
  type ParsedMessage,
  type ThreadContext,
  type WorkspaceOutputResult,
  type WorkspaceOutput,
  // Thread CRUD
  createThread,
  getThreadById,
  getThreadWithDetails,
  getThreadsForUser,
  getThreadCountForUser,
  updateThreadTitle,
  toggleThreadPin,
  updateThreadModel,
  getEffectiveModelForThread,
  deleteThread,
  userOwnsThread,
  getThreadOwner,
  // Thread Categories
  getThreadCategories,
  getThreadCategorySlugs,
  setThreadCategories,
  // Messages
  addMessage,
  getMessageById,
  getMessagesForThread,
  // Thread Uploads
  addThreadUpload,
  getThreadUploadById,
  getThreadUploads,
  getThreadUploadCount,
  deleteThreadUpload,
  // Thread Outputs
  addThreadOutput,
  getThreadOutputById,
  getThreadOutputs,
  linkOutputsToMessage,
  // Thread Context (for image generation)
  getThreadContext,
  // Workspace Outputs
  addWorkspaceOutput,
  getWorkspaceOutputById,
  incrementWorkspaceOutputDownloadCount,
  // Thread Output Helpers (for docgen)
  getExpiredThreadOutputs,
  deleteThreadOutput,
  incrementThreadOutputDownloadCount,
  getThreadOutputDownloadCount,
  // Cleanup
  getThreadsOlderThan,
  deleteThreadsOlderThan,
  getThreadUploadsStorageSize,
  getThreadOutputsStorageSize,
} from './threads';

// ============ Sharing ============
export {
  generateShareToken,
  validateShareAccess,
  createThreadShare,
  getShareById,
  getShareByToken,
  getThreadShares,
  getUserShares,
  countActiveThreadShares,
  countUserSharesInLastHour,
  updateShare,
  revokeShare,
  deleteShare,
  recordShareView,
  logShareAccess,
  getShareAccessLog,
  getSharingStats,
} from './sharing';

// ============ Compliance ============
export {
  type ComplianceStats,
  saveComplianceResult,
  updateHitlResponse,
  getComplianceResult,
  getComplianceResultsForConversation,
  getRecentComplianceResults,
  getComplianceStats,
  deleteOldComplianceResults,
} from './compliance';

// ============ Documents ============
export {
  // Types
  type DocumentStatus,
  type DbDocument,
  type DocumentWithCategories,
  type CreateDocumentInput,
  type UpdateDocumentInput,
  // Document CRUD
  getAllDocuments,
  getAllDocumentsWithCategories,
  getDocumentById,
  getDocumentWithCategories,
  createDocument,
  updateDocument,
  deleteDocument,
  // Category Operations
  getDocumentCategories,
  addDocumentToCategory,
  removeDocumentFromCategory,
  setDocumentCategories,
  setDocumentGlobal,
  // Query Helpers
  getDocumentsByCategory,
  getGlobalDocuments,
  getUnassignedDocuments,
  getDocumentsByStatus,
  // Statistics
  getTotalChunkCount,
  getDocumentCountByStatus,
  getTotalStorageSize,
  // Folder Sync Operations
  updateDocumentFolderSync,
} from './documents';

// ============ Skills ============
export {
  // Types
  type Skill,
  type SkillWithCategories,
  type CreateSkillInput,
  type TriggerType,
  type MatchType,
  type ForceMode,
  type DataSourceFilter,
  type SkillComplianceConfig,
  type ResolvedSkills,
  // Read Operations
  getSkillById,
  getAllSkills,
  getSkillsByTrigger,
  getIndexSkillsForCategories,
  getKeywordSkills,
  getCategoriesForSkill,
  wouldToolSkillMatch,
  getSkillsByTool,
  getAllSkillsWithCategories,
  getSkillsWithToolRouting,
  getSkillsForTool,
  isToolRoutingMigrated,
  // Write Operations
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkillActive,
  // Restore Operations
  resetCoreSkillsToDefaults,
  removeCoreFlag,
  // Seed Operations
  seedCoreSkill,
  // Migration Operations
  migrateToolRoutingToSkills,
} from './skills';

// ============ Tool Config ============
export {
  // Types
  type ToolConfig as ToolConfigRecord,
  type ToolConfigAuditEntry,
  // Constants
  TOOL_DEFAULTS,
  getToolDefaultsForTool,
  // CRUD Operations
  getToolConfig,
  getAllToolConfigs,
  isToolEnabled,
  createToolConfig,
  updateToolConfig,
  deleteToolConfig,
  // Audit Operations
  getToolConfigAuditHistory,
  getAllToolConfigAuditHistory,
  // Migration Helpers
  migrateTavilySettingsIfNeeded,
  getWebSearchConfig,
  // Initialization
  ensureToolConfigsExist,
  resetToolToDefaults,
  getDescriptionOverride,
} from './tool-config';

// ============ Workspace Sessions ============
export {
  // Types
  type WorkspaceSession,
  // Session CRUD
  createSession,
  getSession,
  getSessionWithWorkspace,
  isSessionValid,
  updateSessionActivity,
  incrementMessageCount,
  getSessionMessageCount as getWorkspaceSessionMessageCount,
  extendSessionExpiry,
  // Session Queries
  getWorkspaceSessions,
  getUserSessions,
  getUserWorkspaceSession,
  getOrCreateUserSession,
  // Cleanup
  cleanupExpiredSessions,
  cleanupInactiveSessions,
  deleteSession,
  deleteWorkspaceSessions,
  // Statistics
  getWorkspaceSessionCount,
  getUniqueVisitorCount,
  getDailySessionCounts,
  getWorkspaceAnalytics,
} from './workspace-sessions';

// ============ Workspace Threads ============
export {
  // Types
  type WorkspaceThread,
  type WorkspaceThreadWithMessages,
  type CreateWorkspaceThreadInput,
  type UpdateWorkspaceThreadInput,
  // Thread CRUD
  createThread as createWorkspaceThread,
  getThread as getWorkspaceThread,
  getThreadWithMessages as getWorkspaceThreadWithMessages,
  getThreadForSession,
  updateThread as updateWorkspaceThread,
  deleteThread as deleteWorkspaceThread,
  archiveThread,
  updateThreadTitle as updateWorkspaceThreadTitle,
  touchThread,
  // Thread Queries
  getSessionThreads,
  getWorkspaceThreads,
  getLatestThread,
  getOrCreateThread as getOrCreateWorkspaceThread,
  searchThreads as searchWorkspaceThreads,
  // Bulk Operations
  archiveAllSessionThreads,
  deleteSessionThreads,
  deleteWorkspaceThreads,
  // Statistics
  getSessionThreadCount,
  getWorkspaceThreadCount,
  getThreadMessageCount as getWorkspaceThreadMessageCount,
  autoTitleThread,
} from './workspace-threads';

// ============ Workspace Messages ============
export {
  // Types
  type WorkspaceMessage,
  type WorkspaceMessageSource,
  // Helpers
  parseSources,
  // Message CRUD
  addMessage as addWorkspaceMessage,
  getMessage as getWorkspaceMessage,
  updateMessageTokens,
  updateMessageLatency,
  deleteMessage as deleteWorkspaceMessage,
  // Message Queries
  getThreadMessages as getWorkspaceThreadMessages,
  getSessionMessages,
  getWorkspaceMessages,
  getRecentThreadMessages,
  getRecentSessionMessages,
  // Bulk Operations
  deleteThreadMessages as deleteWorkspaceThreadMessages,
  deleteSessionMessages,
  deleteWorkspaceMessages,
  // Statistics
  getThreadMessageCount as getWsThreadMessageCount,
  getSessionMessageCount as getWsSessionMessageCount,
  getWorkspaceMessageCount,
  getWorkspaceTotalTokens,
  getWorkspaceAverageLatency,
  getDailyMessageCounts,
  getMessageCountByRole,
} from './workspace-messages';

// ============ LLM Providers ============
export {
  // Types
  type LLMProvider,
  type CreateProviderInput,
  type UpdateProviderInput,
  // Constants
  DEFAULT_PROVIDERS,
  maskApiKey,
  // CRUD Operations
  getAllProviders,
  getEnabledProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  upsertProvider,
  // Configuration Helpers
  isProviderConfigured,
  getProviderApiKey,
  getProviderApiBase,
  // Seeding
  seedDefaultProviders,
} from './llm-providers';

// ============ Enabled Models ============
export {
  // Types
  type EnabledModel,
  type CreateEnabledModelInput,
  type UpdateEnabledModelInput,
  // CRUD Operations
  getAllEnabledModels,
  getActiveModels,
  getModelsByProvider,
  getEnabledModel,
  getDefaultModel,
  createEnabledModel,
  createEnabledModelsBatch,
  updateEnabledModel,
  deleteEnabledModel,
  deleteEnabledModelsBatch,
  setDefaultModel,
  disableModel,
  enableModel,
  // Capability Queries
  isModelToolCapable,
  isModelVisionCapable,
  isModelParallelToolCapable,
  isModelThinkingCapable,
  getToolCapableModelIds,
  // Sort Order
  updateModelSortOrder,
  // Migration/Seeding
  hasEnabledModels,
  seedModelsFromConfig,
  findDeprecatedModels,
  refreshModelCapabilities,
  refreshAllModelCapabilities,
} from './enabled-models';

// ============ Folder Syncs ============
export {
  // Types
  type FolderSyncStatus,
  type FolderSyncFileStatus,
  type DbFolderSync,
  type FolderSync,
  type DbFolderSyncFile,
  type FolderSyncFile,
  type CreateFolderSyncInput,
  type CreateFolderSyncFileInput,
  type UpdateFolderSyncInput,
  type UpdateFolderSyncFileInput,
  // Folder Sync CRUD
  createFolderSync,
  getFolderSyncById,
  getFolderSyncsByUser,
  getAllFolderSyncs,
  updateFolderSync,
  deleteFolderSync,
  // Folder Sync File CRUD
  createFolderSyncFile,
  createFolderSyncFiles,
  getFolderSyncFileById,
  getFolderSyncFiles,
  findFolderSyncFileByPath,
  findFolderSyncFileByHash,
  updateFolderSyncFile,
  deleteFolderSyncFile,
  // Statistics
  getFolderSyncFileCountsByStatus,
  getPendingFolderSyncFiles,
  getFailedFolderSyncFiles,
  markAllPendingAsSkipped,
  resetFileStatusToPending,
} from './folder-syncs';

// ============ Category Prompts ============
export {
  // Types
  type StarterPrompt,
  type CategoryPrompt,
  type CategoryPromptRow,
  // Constants
  MAX_COMBINED_PROMPT_LENGTH,
  MAX_STARTER_PROMPTS,
  MAX_STARTER_LABEL_LENGTH,
  MAX_STARTER_PROMPT_LENGTH,
  // Dynamic Limit Getters
  getMaxCombinedPromptLength,
  getMaxStarterPrompts,
  getMaxStarterLabelLength,
  getMaxStarterPromptLength,
  // Read Operations
  getCategoryPrompt,
  getAllCategoryPrompts,
  getResolvedSystemPrompt,
  getAvailableCharLimit,
  getPromptCharacterInfo,
  // Write Operations
  setCategoryPrompt,
  deleteCategoryPrompt,
  setCategoryStarterPrompts,
  setCategoryWelcome,
  // Validation
  validatePromptAddendum,
  validateStarterPrompts,
  // Bulk Operations
  getCategoryPromptsForCategories,
} from './category-prompts';

// ============ Task Plans ============
export {
  // Types
  type TaskStatus,
  type PlanStatus,
  type Task,
  type TaskPlan,
  type TaskPlanStats,
  // Stats Calculation
  calculateStats,
  // CRUD Operations
  createTaskPlan,
  getTaskPlan,
  getActiveTaskPlan,
  getTaskPlansByThread,
  getTaskPlansByUser,
  updateTask,
  completePlan,
  cancelPlan,
  updateTaskPlanStatus,
  failPlan,
  deleteTaskPlan,
  cleanupOldPlans,
  // Autonomous Mode Operations
  createAutonomousPlan,
  getBudgetUsage,
  incrementBudgetUsage,
  transitionTaskState,
  recoverActivePlans,
  // Execution Control Operations
  pausePlan,
  resumePlan,
  stopPlan,
  skipTask,
  isPlanPaused,
  isPlanStopped,
  getPlanControlStatus,
} from './task-plans';

// ============ Data Sources ============
export {
  // Types
  type DataAPIConfig,
  type DataCSVConfig,
  type DataSource,
  type AuthConfig,
  type DataSourceAuditEntry,
  type DbDataAPIConfig,
  type DbDataCSVConfig,
  type DbDataAPICategory,
  type DbDataCSVCategory,
  type DbDataSourceAudit,
  // API Operations
  createDataAPI,
  getDataAPI,
  getDataAPIByName,
  getAllDataAPIs,
  getDataAPIsForCategories,
  updateDataAPI,
  updateAPIStatus,
  deleteDataAPI,
  setAPICategories,
  // CSV Operations
  createDataCSV,
  getDataCSV,
  getDataCSVByName,
  getAllDataCSVs,
  getDataCSVsForCategories,
  updateDataCSV,
  deleteDataCSV,
  setCSVCategories,
  // Unified Operations
  getAllDataSourcesForCategories,
  getDataSourceByName,
  getAllDataSources,
  // Audit Operations
  logDataSourceChange,
  getDataSourceAuditHistory,
  getAllDataSourceAuditHistory,
} from './data-sources';

// ============ Workspaces ============
export {
  // Types
  type Workspace,
  type WorkspaceWithRelations,
  type WorkspaceType,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type CreatorRole,
  // Read Operations
  getWorkspaceBySlug,
  getWorkspaceById,
  getWorkspaceWithRelations,
  listWorkspaces,
  listWorkspacesByCreator,
  listWorkspacesForUser,
  // Write Operations
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  toggleWorkspaceEnabled,
  // Category Operations
  getWorkspaceCategoryIds,
  getWorkspaceCategorySlugs,
  setWorkspaceCategories,
  // Access Control
  canUserAccessWorkspace,
  isUserInWorkspaceAccessList,
  validateDomain,
  // Utility
  slugExists,
  getWorkspaceCountByType,
  searchWorkspaces,
} from './workspaces';

// ============ Workspace Users ============
export {
  // Types
  type WorkspaceUser,
  // User Management
  addUserToWorkspace,
  removeUserFromWorkspace,
  getWorkspaceUsers,
  isUserInWorkspaceAccessList as isUserInWorkspaceList,
  bulkAddUsersToWorkspace,
  bulkRemoveUsersFromWorkspace,
  getWorkspaceUserCount,
  getUserWorkspaces,
  clearWorkspaceUsers,
  setWorkspaceUsers,
  // Validation Helpers
  getEligibleUsersForWorkspace,
  canSuperuserManageWorkspaceUsers,
} from './workspace-users';

// ============ Agent Bots ============
export {
  // Types
  type AgentBot,
  type AgentBotWithRelations,
  type AgentBotRow,
  type AgentBotVersionSummary,
  // CreatorRole already exported from workspaces
  type CreateAgentBotInput,
  type UpdateAgentBotInput,
  // Helper
  generateSlugFromName,
  // Agent Bot CRUD
  getAgentBotById,
  getAgentBotBySlug,
  getAgentBotWithRelations,
  listAgentBots,
  listAgentBotsByCreator,
  createAgentBot,
  updateAgentBot,
  deleteAgentBot,
  toggleAgentBotActive,
  // Existence Checks
  nameExists as agentBotNameExists,
  slugExists as agentBotSlugExists,
  // Statistics
  getAgentBotCount,
  // Active Bot Queries
  getActiveAgentBotBySlug,
  getAgentBotCategoryIds,
  checkSuperuserAgentBotAccess,
  searchAgentBots,
} from './agent-bots';

// ============ Agent Bot Versions ============
export {
  // Types
  type AgentBotVersion,
  type AgentBotVersionWithRelations,
  type AgentBotVersionRow,
  type AgentBotVersionTool,
  type AgentBotVersionToolRow,
  type InputSchema,
  type OutputConfig,
  type CreateAgentBotVersionInput,
  type UpdateAgentBotVersionInput,
  // Version CRUD
  getVersionById,
  getVersionWithRelations,
  listVersions,
  getDefaultVersion,
  getVersionByNumber,
  createVersion,
  updateVersion,
  deleteVersion,
  setDefaultVersion,
  // Category/Skill/Tool Operations
  getVersionCategoryIds,
  getVersionSkillIds,
  getVersionTools,
  getEnabledVersionTools,
  // Utility
  duplicateVersion,
  getVersionCount,
  getActiveVersionCount,
} from './agent-bot-versions';

// ============ Agent Bot Jobs ============
export {
  // Types
  type AgentBotJob,
  type AgentBotJobWithOutputs,
  type AgentBotJobRow,
  type AgentBotJobOutput,
  type AgentBotJobOutputRow,
  type AgentBotJobFile,
  type AgentBotJobFileRow,
  type JobStatus,
  type OutputType,
  type TokenUsage,
  type FileExtractionStatus,
  // Job CRUD
  getJobById,
  getJobWithOutputs,
  createJob,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  listJobs,
  listPendingJobs,
  getJobCountsByStatus,
  listJobsForAgentBot,
  // Job Outputs
  addJobOutput,
  getJobOutputs,
  getOutputById,
  // Job Files
  addJobFile,
  getJobFiles,
  updateFileExtractionStatus,
  getFileById,
  updateJobInputFiles,
  // Analytics & Cleanup
  getJobStats,
  getUsageStats,
  getOutputTypeDistribution,
  cleanupExpiredJobs,
  cleanupOldJobs,
  getJobsNeedingWebhookDelivery,
} from './agent-bot-jobs';

// ============ Agent Bot API Keys ============
export {
  // Types
  type AgentBotApiKey,
  type AgentBotApiKeyWithStats,
  type AgentBotApiKeyRow,
  type CreateApiKeyResult,
  type CreateApiKeyInput,
  type RateLimitInfo,
  type RateLimitCheckResult,
  // API Key CRUD
  getApiKeyById,
  getApiKeyWithStats,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  deleteApiKey,
  updateLastUsed,
  // Validation
  validateApiKey,
  getAgentBotIdFromApiKey,
  // Rate Limiting
  checkRateLimit,
  incrementUsage,
  getRateLimitInfo,
  // Usage Analytics
  getApiKeyUsageStats,
  getAgentBotUsageStats,
  // Utility
  getActiveKeyCount,
  keyNameExists,
  cleanupOldUsageRecords,
} from './agent-bot-api-keys';

// ============ Tool Routing ============
export {
  // Types
  type ToolRoutingRule,
  type ToolRoutingRuleInput,
  // Read Operations
  getActiveRoutingRules,
  getAllRoutingRules,
  getRoutingRuleById,
  getRoutingRulesByTool,
  // Write Operations
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  // Utility
  hasRoutingRules,
  seedDefaultRoutingRules,
} from './tool-routing';

// ============ Agent Config ============
export {
  // Types
  type AgentModelConfig,
  type StoredAgentModelConfigs,
  type StreamingConfig,
  // Streaming Config
  getStreamingConfig,
  setStreamingConfig,
  // Agent Model Config
  getAgentModelConfigs,
  setAgentModelConfigs,
  validateAgentModelConfig,
  // Summarizer System Prompt
  getSummarizerSystemPrompt,
  setSummarizerSystemPrompt,
  // Planner System Prompt
  getPlannerSystemPrompt,
  setPlannerSystemPrompt,
  // Executor System Prompt
  getExecutorSystemPrompt,
  setExecutorSystemPrompt,
  // Checker System Prompt
  getCheckerSystemPrompt,
  setCheckerSystemPrompt,
  // Autonomous Mode Toggle
  getAutonomousModeEnabled,
  setAutonomousModeEnabled,
} from './agent-config';

// ============ RAG Testing ============
export {
  // Types
  type RagTestQuery,
  type RagTestResult,
  type TopChunk,
  type RagTestMetrics,
  // Test Queries
  createTestQuery,
  getAllTestQueries,
  getTestQueryById,
  deleteTestQuery,
  // Test Results
  saveTestResult,
  getRecentResults,
  getResultsForQuery,
  cleanupOldResults,
  getTestStats,
} from './rag-testing';

// ============ Function API Config ============
export {
  // Types
  type FunctionAPIConfig,
  type FunctionAPIAuthType,
  type FunctionAPIStatus,
  type EndpointMapping,
  type DbFunctionAPIConfig,
  type DbFunctionAPICategory,
  type CreateFunctionAPIRequest,
  type UpdateFunctionAPIRequest,
  // CRUD Operations
  createFunctionAPIConfig,
  getFunctionAPIConfig,
  getFunctionAPIConfigByName,
  getAllFunctionAPIConfigs,
  getEnabledFunctionAPIConfigs,
  getFunctionAPIConfigsForCategories,
  updateFunctionAPIConfig,
  updateFunctionAPITestStatus,
  deleteFunctionAPIConfig,
  // Function Lookup Helpers
  findConfigForFunction,
  getAllFunctionNamesForCategories,
  getToolDefinitionsForCategories,
  // Validation
  validateToolsSchema,
  validateEndpointMappings,
} from './function-api-config';

// ============ Token Usage ============
export {
  type TokenUsageCategory,
  type TokenUsageByUser,
  type TokenUsageByModel,
  type DailyTokenUsage,
  type TokenUsageSummary,
  type TokenUsageFilters,
  logTokenUsage,
  getTokenUsageSummary,
  getFilterOptions as getTokenUsageFilterOptions,
} from './token-usage';
