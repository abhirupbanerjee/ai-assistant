/**
 * Database Compatibility Layer - Async Interface
 *
 * This module provides a unified async interface for database operations
 * that works with both SQLite and PostgreSQL via Kysely.
 *
 * Usage:
 *   import { getUserById, createCategory, ... } from '@/lib/db/compat';
 *
 * For SQLite (DATABASE_PROVIDER=sqlite):
 *   - Delegates to existing sync modules (wrapped in promises)
 *   - Zero changes to existing functionality
 *
 * For PostgreSQL (DATABASE_PROVIDER=postgres):
 *   - Uses Kysely query builder for async operations
 *   - Full PostgreSQL feature support
 *
 * API routes should import from this module and use `await` for all operations.
 */

// Export database provider helper
export { getDatabaseProvider } from '../kysely';

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
  // Constants
  DEFAULT_PWA_SETTINGS,
  DEFAULT_OCR_SETTINGS,
  BRANDING_ICONS,
  DEFAULT_MODEL_ID,
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
} from './documents';
