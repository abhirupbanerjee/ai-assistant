/**
 * Backup Utility Module
 *
 * ZIP creation and restoration for system backups
 */

import archiver from 'archiver';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import {
  // Full export functions
  exportDocuments,
  exportCategories,
  exportDocumentCategories,
  exportUsers,
  exportUserSubscriptions,
  exportSuperUserCategories,
  exportThreads,
  exportMessages,
  exportThreadCategories,
  exportThreadUploads,
  exportThreadOutputs,
  exportSettings,
  exportToolConfigs,
  exportCategoryToolConfigs,
  exportSkills,
  exportCategorySkills,
  exportCategoryPrompts,
  exportDataApiConfigs,
  exportDataApiCategories,
  exportDataCsvConfigs,
  exportDataCsvCategories,
  exportWorkspaces,
  exportWorkspaceCategories,
  exportWorkspaceUsers,
  exportFunctionApiConfigs,
  exportFunctionApiCategories,
  exportUserMemories,
  exportToolRoutingRules,
  exportThreadShares,
  exportTaskPlans,
  // Agent bot exports
  exportAgentBots,
  exportAgentBotVersions,
  exportAgentBotVersionCategories,
  exportAgentBotVersionSkills,
  exportAgentBotVersionTools,
  exportAgentBotApiKeys,
  // Category-filtered export functions
  exportDocumentsForCategories,
  exportThreadsForCategoriesStrict,
  exportSkillsForCategories,
  exportWorkspacesForCategories,
  exportDataApiConfigsForCategories,
  exportDataCsvConfigsForCategories,
  exportFunctionApiConfigsForCategories,
  exportAgentBotsForCategories,
  exportAgentBotVersionsForBots,
  exportAgentBotApiKeysForBots,
  exportCategoryPromptsForCategories,
  exportCategoryToolConfigsForCategories,
  exportMessagesForThreads,
  exportThreadCategoriesFiltered,
  exportThreadUploadsForThreads,
  exportThreadOutputsForThreads,
  exportThreadSharesForThreads,
  exportTaskPlansForThreads,
  exportDocumentCategoriesFiltered,
  exportCategorySkillsFiltered,
  exportWorkspaceCategoriesFiltered,
  exportWorkspaceUsersForWorkspaces,
  exportDataApiCategoriesFiltered,
  exportDataCsvCategoriesFiltered,
  exportFunctionApiCategoriesFiltered,
  exportAgentBotVersionCategoriesFiltered,
  exportAgentBotVersionSkillsForVersions,
  exportAgentBotVersionToolsForVersions,
  exportCategoriesById,
  // Import functions
  importDocuments,
  importCategories,
  importDocumentCategories,
  importUsers,
  importUserSubscriptions,
  importSuperUserCategories,
  importThreads,
  importMessages,
  importThreadCategories,
  importThreadUploads,
  importThreadOutputs,
  importSettings,
  importToolConfigs,
  importCategoryToolConfigs,
  importSkills,
  importCategorySkills,
  importCategoryPrompts,
  importDataApiConfigs,
  importDataApiCategories,
  importDataCsvConfigs,
  importDataCsvCategories,
  importWorkspaces,
  importWorkspaceCategories,
  importWorkspaceUsers,
  importFunctionApiConfigs,
  importFunctionApiCategories,
  importUserMemories,
  importToolRoutingRules,
  importThreadShares,
  importTaskPlans,
  // Agent bot imports
  importAgentBots,
  importAgentBotVersions,
  importAgentBotVersionCategories,
  importAgentBotVersionSkills,
  importAgentBotVersionTools,
  importAgentBotApiKeys,
  clearAllData,
} from './db/compat/backup';
import { getGlobalDocsDir, getThreadsDir, ensureDir } from './storage';

// ============ Types ============

export type CategoryFilterMode = 'all' | 'selected';

export interface CategoryFilter {
  mode: CategoryFilterMode;
  categoryIds?: number[];  // Required when mode is 'selected'
}

export interface SkillFilter {
  mode: 'all' | 'selected';
  skillIds?: number[];  // Required when mode is 'selected'
}

export interface ToolFilter {
  mode: 'all' | 'selected';
  toolNames?: string[];  // Required when mode is 'selected'
}

export interface BackupOptions {
  includeDocuments: boolean;
  includeDocumentFiles: boolean;
  includeCategories: boolean;
  includeSettings: boolean;
  includeUsers: boolean;
  includeThreads: boolean;
  includeTools: boolean;
  includeSkills: boolean;
  includeCategoryPrompts: boolean;
  includeDataSources: boolean;
  // NEW backup options
  includeWorkspaces: boolean;
  includeFunctionApis: boolean;
  includeUserMemories: boolean;
  includeToolRouting: boolean;
  includeThreadShares: boolean;
  includeAgentBots: boolean;
  // Filters
  categoryFilter?: CategoryFilter;
  skillFilter?: SkillFilter;
  toolFilter?: ToolFilter;
}

export interface RestoreOptions {
  clearExisting: boolean;
  restoreDocuments: boolean;
  restoreDocumentFiles: boolean;
  restoreCategories: boolean;
  restoreSettings: boolean;
  restoreUsers: boolean;
  restoreThreads: boolean;
  restoreTools: boolean;
  restoreSkills: boolean;
  restoreCategoryPrompts: boolean;
  restoreDataSources: boolean;
  refreshVectorDb: boolean;
  // NEW restore options
  restoreWorkspaces: boolean;
  restoreFunctionApis: boolean;
  restoreUserMemories: boolean;
  restoreToolRouting: boolean;
  restoreThreadShares: boolean;
  restoreAgentBots: boolean;
}

export interface BackupManifest {
  version: string;
  createdAt: string;
  createdBy: string;
  application: {
    name: string;
    version: string;
  };
  contents: {
    documents: boolean;
    documentFiles: boolean;
    categories: boolean;
    settings: boolean;
    users: boolean;
    threads: boolean;
    tools: boolean;
    skills: boolean;
    categoryPrompts: boolean;
    dataSources: boolean;
    documentCount: number;
    categoryCount: number;
    userCount: number;
    threadCount: number;
    toolCount: number;
    skillCount: number;
    categoryPromptCount: number;
    dataSourceCount: number;
    totalFileSize: number;
    // NEW content flags
    workspaces: boolean;
    functionApis: boolean;
    userMemories: boolean;
    toolRouting: boolean;
    threadShares: boolean;
    taskPlans: boolean;
    agentBots: boolean;
    workspaceCount: number;
    functionApiCount: number;
    userMemoryCount: number;
    toolRoutingRuleCount: number;
    threadShareCount: number;
    taskPlanCount: number;
    agentBotCount: number;
    // Filter metadata
    categoryFilter?: {
      mode: CategoryFilterMode;
      categoryIds?: number[];
      categoryNames?: string[];
    };
    skillFilter?: {
      mode: 'all' | 'selected';
      skillIds?: number[];
      skillNames?: string[];
    };
    toolFilter?: {
      mode: 'all' | 'selected';
      toolNames?: string[];
    };
  };
  warnings: string[];
}

export interface RestoreResult {
  success: boolean;
  message: string;
  details: {
    documentsRestored: number;
    categoriesRestored: number;
    usersRestored: number;
    threadsRestored: number;
    filesRestored: number;
    settingsRestored: number;
    toolsRestored: number;
    skillsRestored: number;
    categoryPromptsRestored: number;
    dataSourcesRestored: number;
    // NEW restore counts
    workspacesRestored: number;
    functionApisRestored: number;
    userMemoriesRestored: number;
    toolRoutingRulesRestored: number;
    threadSharesRestored: number;
    taskPlansRestored: number;
    agentBotsRestored: number;
  };
  warnings: string[];
}

// ============ Backup Functions ============

/**
 * Generate timestamped backup filename
 */
export function getBackupFilename(): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '-')
    .slice(0, 19);
  return `backup-${timestamp}.zip`;
}

/**
 * Create backup ZIP stream
 */
export async function createBackup(
  options: BackupOptions,
  userEmail: string
): Promise<{ stream: Readable; filename: string }> {
  const archive = archiver('zip', {
    zlib: { level: 6 }, // Compression level
  });

  const warnings: string[] = [];
  let totalFileSize = 0;

  // Check if category filtering is enabled
  const isFiltered = options.categoryFilter?.mode === 'selected' &&
    options.categoryFilter.categoryIds &&
    options.categoryFilter.categoryIds.length > 0;
  const categoryIds = isFiltered ? options.categoryFilter!.categoryIds! : [];

  // Variables to hold exported data
  let documents: Awaited<ReturnType<typeof exportDocuments>> = [];
  let categories: Awaited<ReturnType<typeof exportCategories>> = [];
  let documentCategories: Awaited<ReturnType<typeof exportDocumentCategories>> = [];
  let users: Awaited<ReturnType<typeof exportUsers>> = [];
  let userSubscriptions: Awaited<ReturnType<typeof exportUserSubscriptions>> = [];
  let superUserCategories: Awaited<ReturnType<typeof exportSuperUserCategories>> = [];
  let settings: Awaited<ReturnType<typeof exportSettings>> = [];
  let threads: Awaited<ReturnType<typeof exportThreads>> = [];
  let messages: Awaited<ReturnType<typeof exportMessages>> = [];
  let threadCategories: Awaited<ReturnType<typeof exportThreadCategories>> = [];
  let threadUploads: Awaited<ReturnType<typeof exportThreadUploads>> = [];
  let threadOutputs: Awaited<ReturnType<typeof exportThreadOutputs>> = [];
  let toolConfigs: Awaited<ReturnType<typeof exportToolConfigs>> = [];
  let categoryToolConfigs: Awaited<ReturnType<typeof exportCategoryToolConfigs>> = [];
  let skills: Awaited<ReturnType<typeof exportSkills>> = [];
  let categorySkills: Awaited<ReturnType<typeof exportCategorySkills>> = [];
  let categoryPrompts: Awaited<ReturnType<typeof exportCategoryPrompts>> = [];
  let dataApiConfigs: Awaited<ReturnType<typeof exportDataApiConfigs>> = [];
  let dataApiCategories: Awaited<ReturnType<typeof exportDataApiCategories>> = [];
  let dataCsvConfigs: Awaited<ReturnType<typeof exportDataCsvConfigs>> = [];
  let dataCsvCategories: Awaited<ReturnType<typeof exportDataCsvCategories>> = [];
  let workspaces: Awaited<ReturnType<typeof exportWorkspaces>> = [];
  let workspaceCategories: Awaited<ReturnType<typeof exportWorkspaceCategories>> = [];
  let workspaceUsers: Awaited<ReturnType<typeof exportWorkspaceUsers>> = [];
  let functionApiConfigs: Awaited<ReturnType<typeof exportFunctionApiConfigs>> = [];
  let functionApiCategories: Awaited<ReturnType<typeof exportFunctionApiCategories>> = [];
  let userMemories: Awaited<ReturnType<typeof exportUserMemories>> = [];
  let toolRoutingRules: Awaited<ReturnType<typeof exportToolRoutingRules>> = [];
  let threadShares: Awaited<ReturnType<typeof exportThreadShares>> = [];
  let taskPlans: Awaited<ReturnType<typeof exportTaskPlans>> = [];
  let agentBots: Awaited<ReturnType<typeof exportAgentBots>> = [];
  let agentBotVersions: Awaited<ReturnType<typeof exportAgentBotVersions>> = [];
  let agentBotVersionCategories: Awaited<ReturnType<typeof exportAgentBotVersionCategories>> = [];
  let agentBotVersionSkills: Awaited<ReturnType<typeof exportAgentBotVersionSkills>> = [];
  let agentBotVersionTools: Awaited<ReturnType<typeof exportAgentBotVersionTools>> = [];
  let agentBotApiKeys: Awaited<ReturnType<typeof exportAgentBotApiKeys>> = [];

  if (isFiltered) {
    // ==== CATEGORY-FILTERED BACKUP ====
    // Note: User memories are EXCLUDED from filtered backups

    // Categories - only selected ones
    if (options.includeCategories) {
      categories = await exportCategoriesById(categoryIds);
    }

    // Documents - include those linked to selected categories OR global
    if (options.includeDocuments) {
      documents = await exportDocumentsForCategories(categoryIds);
      if (options.includeCategories) {
        const docIds = documents.map(d => d.id);
        documentCategories = await exportDocumentCategoriesFiltered(docIds, categoryIds);
      }
    }

    // Users - always include all users (not filtered)
    if (options.includeUsers) {
      users = await exportUsers();
      userSubscriptions = await exportUserSubscriptions();
      superUserCategories = await exportSuperUserCategories();
    }

    // Settings - always include (global)
    if (options.includeSettings) {
      settings = await exportSettings();
    }

    // Threads - STRICT filtering: only threads where ALL categories are in selected set
    if (options.includeThreads) {
      threads = await exportThreadsForCategoriesStrict(categoryIds);
      const threadIds = threads.map(t => t.id);

      if (threadIds.length > 0) {
        messages = await exportMessagesForThreads(threadIds);
        threadCategories = await exportThreadCategoriesFiltered(threadIds, categoryIds);
        threadUploads = await exportThreadUploadsForThreads(threadIds);
        threadOutputs = await exportThreadOutputsForThreads(threadIds);
      }
    }

    // Tools - apply tool filter if enabled
    if (options.includeTools) {
      let allToolConfigs = await exportToolConfigs();
      // Apply tool filter if enabled
      if (options.toolFilter?.mode === 'selected' && options.toolFilter.toolNames?.length) {
        const toolNameSet = new Set(options.toolFilter.toolNames);
        allToolConfigs = allToolConfigs.filter(t => toolNameSet.has(t.tool_name));
      }
      toolConfigs = allToolConfigs;
      categoryToolConfigs = await exportCategoryToolConfigsForCategories(categoryIds);
      // Also filter category tool configs by selected tools
      if (options.toolFilter?.mode === 'selected' && options.toolFilter.toolNames?.length) {
        const toolNameSet = new Set(options.toolFilter.toolNames);
        categoryToolConfigs = categoryToolConfigs.filter(t => toolNameSet.has(t.tool_name));
      }
    }

    // Skills - include non-restricted + category-linked, apply skill filter if enabled
    if (options.includeSkills) {
      let allSkills = await exportSkillsForCategories(categoryIds);
      // Apply skill filter if enabled
      if (options.skillFilter?.mode === 'selected' && options.skillFilter.skillIds?.length) {
        const skillIdSet = new Set(options.skillFilter.skillIds);
        allSkills = allSkills.filter(s => skillIdSet.has(s.id));
      }
      skills = allSkills;
      const skillIds = skills.map(s => s.id);
      categorySkills = await exportCategorySkillsFiltered(skillIds, categoryIds);
    }

    // Category prompts - only for selected categories
    if (options.includeCategoryPrompts) {
      categoryPrompts = await exportCategoryPromptsForCategories(categoryIds);
    }

    // Data sources - only those linked to selected categories
    if (options.includeDataSources) {
      dataApiConfigs = await exportDataApiConfigsForCategories(categoryIds);
      const apiIds = dataApiConfigs.map(d => d.id);
      dataApiCategories = await exportDataApiCategoriesFiltered(apiIds, categoryIds);

      dataCsvConfigs = await exportDataCsvConfigsForCategories(categoryIds);
      const csvIds = dataCsvConfigs.map(d => d.id);
      dataCsvCategories = await exportDataCsvCategoriesFiltered(csvIds, categoryIds);
    }

    // Workspaces - only those linked to selected categories
    if (options.includeWorkspaces) {
      workspaces = await exportWorkspacesForCategories(categoryIds);
      const workspaceIds = workspaces.map(w => w.id);
      workspaceCategories = await exportWorkspaceCategoriesFiltered(workspaceIds, categoryIds);
      workspaceUsers = await exportWorkspaceUsersForWorkspaces(workspaceIds);
    }

    // Function APIs - only those linked to selected categories
    if (options.includeFunctionApis) {
      functionApiConfigs = await exportFunctionApiConfigsForCategories(categoryIds);
      const apiIds = functionApiConfigs.map(f => f.id);
      functionApiCategories = await exportFunctionApiCategoriesFiltered(apiIds, categoryIds);
    }

    // User memories - EXCLUDED from filtered backup
    // userMemories stays empty

    // Tool routing rules - always include (global)
    if (options.includeToolRouting) {
      toolRoutingRules = await exportToolRoutingRules();
    }

    // Thread shares - only for included threads
    if (options.includeThreadShares && threads.length > 0) {
      const threadIds = threads.map(t => t.id);
      threadShares = await exportThreadSharesForThreads(threadIds);
    }

    // Task plans - excluded from backup (transient workflow data)
    // taskPlans stays empty

    // Agent bots - only those with versions linked to selected categories
    if (options.includeAgentBots) {
      agentBots = await exportAgentBotsForCategories(categoryIds);
      const botIds = agentBots.map(b => b.id);

      if (botIds.length > 0) {
        agentBotVersions = await exportAgentBotVersionsForBots(botIds);
        const versionIds = agentBotVersions.map(v => v.id);

        agentBotVersionCategories = await exportAgentBotVersionCategoriesFiltered(versionIds, categoryIds);
        agentBotVersionSkills = await exportAgentBotVersionSkillsForVersions(versionIds);
        agentBotVersionTools = await exportAgentBotVersionToolsForVersions(versionIds);
        agentBotApiKeys = await exportAgentBotApiKeysForBots(botIds);
      }
    }

    // Add warning about filtered backup
    warnings.push(`This is a category-filtered backup containing only data linked to ${categoryIds.length} selected categories. User memories are excluded from filtered backups.`);

  } else {
    // ==== FULL BACKUP (existing logic) ====

    // Export database data (async for PostgreSQL support)
    documents = options.includeDocuments ? await exportDocuments() : [];
    categories = options.includeCategories ? await exportCategories() : [];
    documentCategories = options.includeDocuments || options.includeCategories
      ? await exportDocumentCategories()
      : [];
    users = options.includeUsers ? await exportUsers() : [];
    userSubscriptions = options.includeUsers ? await exportUserSubscriptions() : [];
    superUserCategories = options.includeUsers ? await exportSuperUserCategories() : [];
    settings = options.includeSettings ? await exportSettings() : [];

    // Thread data
    if (options.includeThreads) {
      threads = await exportThreads();
      messages = await exportMessages();
      threadCategories = await exportThreadCategories();
      threadUploads = await exportThreadUploads();
      threadOutputs = await exportThreadOutputs();
    }

    // Tools, skills, and category prompts data
    toolConfigs = options.includeTools ? await exportToolConfigs() : [];
    categoryToolConfigs = options.includeTools ? await exportCategoryToolConfigs() : [];
    skills = options.includeSkills ? await exportSkills() : [];
    categorySkills = options.includeSkills ? await exportCategorySkills() : [];
    categoryPrompts = options.includeCategoryPrompts ? await exportCategoryPrompts() : [];

    // Data sources
    dataApiConfigs = options.includeDataSources ? await exportDataApiConfigs() : [];
    dataApiCategories = options.includeDataSources ? await exportDataApiCategories() : [];
    dataCsvConfigs = options.includeDataSources ? await exportDataCsvConfigs() : [];
    dataCsvCategories = options.includeDataSources ? await exportDataCsvCategories() : [];

    // Workspaces
    workspaces = options.includeWorkspaces ? await exportWorkspaces() : [];
    workspaceCategories = options.includeWorkspaces ? await exportWorkspaceCategories() : [];
    workspaceUsers = options.includeWorkspaces ? await exportWorkspaceUsers() : [];

    // Function APIs
    functionApiConfigs = options.includeFunctionApis ? await exportFunctionApiConfigs() : [];
    functionApiCategories = options.includeFunctionApis ? await exportFunctionApiCategories() : [];

    // User memories (only in full backup)
    userMemories = options.includeUserMemories ? await exportUserMemories() : [];

    // Tool routing rules
    toolRoutingRules = options.includeToolRouting ? await exportToolRoutingRules() : [];

    // Thread shares
    threadShares = options.includeThreadShares ? await exportThreadShares() : [];

    // Task plans - excluded from backup (transient workflow data)
    // taskPlans stays empty

    // Agent bots
    agentBots = options.includeAgentBots ? await exportAgentBots() : [];
    agentBotVersions = options.includeAgentBots ? await exportAgentBotVersions() : [];
    agentBotVersionCategories = options.includeAgentBots ? await exportAgentBotVersionCategories() : [];
    agentBotVersionSkills = options.includeAgentBots ? await exportAgentBotVersionSkills() : [];
    agentBotVersionTools = options.includeAgentBots ? await exportAgentBotVersionTools() : [];
    agentBotApiKeys = options.includeAgentBots ? await exportAgentBotApiKeys() : [];
  }

  // Create manifest
  const manifest: BackupManifest = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    createdBy: userEmail,
    application: {
      name: 'Policy Bot',
      version: '1.0.0',
    },
    contents: {
      documents: options.includeDocuments,
      documentFiles: options.includeDocumentFiles,
      categories: options.includeCategories,
      settings: options.includeSettings,
      users: options.includeUsers,
      threads: options.includeThreads,
      tools: options.includeTools,
      skills: options.includeSkills,
      categoryPrompts: options.includeCategoryPrompts,
      dataSources: options.includeDataSources,
      documentCount: documents.length,
      categoryCount: categories.length,
      userCount: users.length,
      threadCount: threads.length,
      toolCount: toolConfigs.length,
      skillCount: skills.length,
      categoryPromptCount: categoryPrompts.length,
      dataSourceCount: dataApiConfigs.length + dataCsvConfigs.length,
      totalFileSize: 0, // Will be updated
      // NEW content flags
      workspaces: options.includeWorkspaces,
      functionApis: options.includeFunctionApis,
      userMemories: isFiltered ? false : options.includeUserMemories, // Excluded from filtered backup
      toolRouting: options.includeToolRouting,
      threadShares: options.includeThreadShares,
      taskPlans: false, // Excluded from backup (transient workflow data)
      agentBots: options.includeAgentBots,
      workspaceCount: workspaces.length,
      functionApiCount: functionApiConfigs.length,
      userMemoryCount: userMemories.length,
      toolRoutingRuleCount: toolRoutingRules.length,
      threadShareCount: threadShares.length,
      taskPlanCount: taskPlans.length,
      agentBotCount: agentBots.length,
      // Filter metadata
      categoryFilter: isFiltered ? {
        mode: 'selected',
        categoryIds: categoryIds,
        categoryNames: categories.map(c => c.name),
      } : undefined,
      skillFilter: options.skillFilter?.mode === 'selected' ? {
        mode: 'selected',
        skillIds: options.skillFilter.skillIds,
        skillNames: skills.map(s => s.name),
      } : undefined,
      toolFilter: options.toolFilter?.mode === 'selected' ? {
        mode: 'selected',
        toolNames: options.toolFilter.toolNames,
      } : undefined,
    },
    warnings,
  };

  // Add manifest
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  // Add database exports
  if (options.includeDocuments) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: documents.length, records: documents }, null, 2), { name: 'data/documents.json' });
  }

  if (options.includeCategories) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: categories.length, records: categories }, null, 2), { name: 'data/categories.json' });
  }

  if (options.includeDocuments || options.includeCategories) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: documentCategories.length, records: documentCategories }, null, 2), { name: 'data/document_categories.json' });
  }

  if (options.includeUsers) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: users.length, records: users }, null, 2), { name: 'data/users.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: userSubscriptions.length, records: userSubscriptions }, null, 2), { name: 'data/user_subscriptions.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: superUserCategories.length, records: superUserCategories }, null, 2), { name: 'data/super_user_categories.json' });
  }

  if (options.includeSettings) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: settings.length, records: settings }, null, 2), { name: 'data/settings.json' });
  }

  if (options.includeThreads) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: threads.length, records: threads }, null, 2), { name: 'data/threads.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: messages.length, records: messages }, null, 2), { name: 'data/messages.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: threadCategories.length, records: threadCategories }, null, 2), { name: 'data/thread_categories.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: threadUploads.length, records: threadUploads }, null, 2), { name: 'data/thread_uploads.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: threadOutputs.length, records: threadOutputs }, null, 2), { name: 'data/thread_outputs.json' });
  }

  // Add tools data
  if (options.includeTools) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: toolConfigs.length, records: toolConfigs }, null, 2), { name: 'data/tool_configs.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: categoryToolConfigs.length, records: categoryToolConfigs }, null, 2), { name: 'data/category_tool_configs.json' });
  }

  // Add skills data
  if (options.includeSkills) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: skills.length, records: skills }, null, 2), { name: 'data/skills.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: categorySkills.length, records: categorySkills }, null, 2), { name: 'data/category_skills.json' });
  }

  // Add category prompts data
  if (options.includeCategoryPrompts) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: categoryPrompts.length, records: categoryPrompts }, null, 2), { name: 'data/category_prompts.json' });
  }

  // Add data sources data
  if (options.includeDataSources) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: dataApiConfigs.length, records: dataApiConfigs }, null, 2), { name: 'data/data_api_configs.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: dataApiCategories.length, records: dataApiCategories }, null, 2), { name: 'data/data_api_categories.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: dataCsvConfigs.length, records: dataCsvConfigs }, null, 2), { name: 'data/data_csv_configs.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: dataCsvCategories.length, records: dataCsvCategories }, null, 2), { name: 'data/data_csv_categories.json' });
  }

  // NEW: Add workspaces data
  if (options.includeWorkspaces) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: workspaces.length, records: workspaces }, null, 2), { name: 'data/workspaces.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: workspaceCategories.length, records: workspaceCategories }, null, 2), { name: 'data/workspace_categories.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: workspaceUsers.length, records: workspaceUsers }, null, 2), { name: 'data/workspace_users.json' });
  }

  // NEW: Add function APIs data
  if (options.includeFunctionApis) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: functionApiConfigs.length, records: functionApiConfigs }, null, 2), { name: 'data/function_api_configs.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: functionApiCategories.length, records: functionApiCategories }, null, 2), { name: 'data/function_api_categories.json' });
  }

  // NEW: Add user memories data
  if (options.includeUserMemories) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: userMemories.length, records: userMemories }, null, 2), { name: 'data/user_memories.json' });
  }

  // NEW: Add tool routing rules data
  if (options.includeToolRouting) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: toolRoutingRules.length, records: toolRoutingRules }, null, 2), { name: 'data/tool_routing_rules.json' });
  }

  // NEW: Add thread shares data
  if (options.includeThreadShares) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: threadShares.length, records: threadShares }, null, 2), { name: 'data/thread_shares.json' });
  }

  // Task plans excluded from backup (transient workflow data)

  // NEW: Add agent bots data
  if (options.includeAgentBots) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: agentBots.length, records: agentBots }, null, 2), { name: 'data/agent_bots.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: agentBotVersions.length, records: agentBotVersions }, null, 2), { name: 'data/agent_bot_versions.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: agentBotVersionCategories.length, records: agentBotVersionCategories }, null, 2), { name: 'data/agent_bot_version_categories.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: agentBotVersionSkills.length, records: agentBotVersionSkills }, null, 2), { name: 'data/agent_bot_version_skills.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: agentBotVersionTools.length, records: agentBotVersionTools }, null, 2), { name: 'data/agent_bot_version_tools.json' });
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: agentBotApiKeys.length, records: agentBotApiKeys }, null, 2), { name: 'data/agent_bot_api_keys.json' });
  }

  // Add document files
  if (options.includeDocumentFiles && options.includeDocuments) {
    const globalDocsDir = getGlobalDocsDir();
    if (fs.existsSync(globalDocsDir)) {
      for (const doc of documents) {
        const filePath = path.join(globalDocsDir, doc.filepath);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalFileSize += stats.size;
          archive.file(filePath, { name: `files/global-docs/${doc.filepath}` });
        } else {
          warnings.push(`Document file not found: ${doc.filepath}`);
        }
      }
    }
  }

  // Add thread files
  if (options.includeThreads) {
    const threadsDir = getThreadsDir();
    if (fs.existsSync(threadsDir)) {
      // Add entire threads directory recursively
      archive.directory(threadsDir, 'files/threads');
    }
  }

  // Add CSV data source files
  if (options.includeDataSources && dataCsvConfigs.length > 0) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const csvDir = path.join(dataDir, 'csv-sources');
    if (fs.existsSync(csvDir)) {
      for (const csv of dataCsvConfigs) {
        const filePath = path.join(csvDir, csv.file_path);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalFileSize += stats.size;
          archive.file(filePath, { name: `files/csv-sources/${csv.file_path}` });
        } else {
          warnings.push(`CSV file not found: ${csv.file_path}`);
        }
      }
    }
  }

  // Update manifest with total file size
  manifest.contents.totalFileSize = totalFileSize;

  // Finalize archive
  archive.finalize();

  return {
    stream: archive as unknown as Readable,
    filename: getBackupFilename(),
  };
}

/**
 * Validate backup ZIP file
 */
export function validateBackupFile(zipBuffer: Buffer): {
  valid: boolean;
  manifest: BackupManifest | null;
  error?: string;
} {
  try {
    const zip = new AdmZip(zipBuffer);
    const manifestEntry = zip.getEntry('manifest.json');

    if (!manifestEntry) {
      return { valid: false, manifest: null, error: 'Invalid backup file: missing manifest.json' };
    }

    const manifestContent = manifestEntry.getData().toString('utf-8');
    const manifest = JSON.parse(manifestContent) as BackupManifest;

    if (!manifest.version || !manifest.createdAt || !manifest.contents) {
      return { valid: false, manifest: null, error: 'Invalid backup file: corrupt manifest' };
    }

    return { valid: true, manifest };
  } catch (error) {
    return { valid: false, manifest: null, error: `Failed to read backup file: ${error}` };
  }
}

/**
 * Restore from backup ZIP
 */
export async function restoreBackup(
  zipBuffer: Buffer,
  options: RestoreOptions
): Promise<RestoreResult> {
  const result: RestoreResult = {
    success: false,
    message: '',
    details: {
      documentsRestored: 0,
      categoriesRestored: 0,
      usersRestored: 0,
      threadsRestored: 0,
      filesRestored: 0,
      settingsRestored: 0,
      toolsRestored: 0,
      skillsRestored: 0,
      categoryPromptsRestored: 0,
      dataSourcesRestored: 0,
      // NEW restore counts
      workspacesRestored: 0,
      functionApisRestored: 0,
      userMemoriesRestored: 0,
      toolRoutingRulesRestored: 0,
      threadSharesRestored: 0,
      taskPlansRestored: 0,
      agentBotsRestored: 0,
    },
    warnings: [],
  };

  try {
    // Validate first
    const validation = validateBackupFile(zipBuffer);
    if (!validation.valid || !validation.manifest) {
      result.message = validation.error || 'Invalid backup file';
      return result;
    }

    const zip = new AdmZip(zipBuffer);
    const manifest = validation.manifest;

    // Clear existing data if requested
    if (options.clearExisting) {
      await clearAllData();
    }

    // Helper to read JSON from ZIP
    const readJsonFromZip = <T>(filename: string): T | null => {
      const entry = zip.getEntry(filename);
      if (!entry) return null;
      try {
        const content = entry.getData().toString('utf-8');
        const parsed = JSON.parse(content);
        return parsed.records as T;
      } catch {
        result.warnings.push(`Failed to parse ${filename}`);
        return null;
      }
    };

    // Restore data (async for PostgreSQL support)
    // Restore categories first (other tables depend on it)
    if (options.restoreCategories && manifest.contents.categories) {
      const categories = readJsonFromZip<Awaited<ReturnType<typeof exportCategories>>>('data/categories.json');
      if (categories && categories.length > 0) {
        await importCategories(categories);
        result.details.categoriesRestored = categories.length;
      }
    }

    // Restore users
    if (options.restoreUsers && manifest.contents.users) {
      const users = readJsonFromZip<Awaited<ReturnType<typeof exportUsers>>>('data/users.json');
      if (users && users.length > 0) {
        await importUsers(users);
        result.details.usersRestored = users.length;
      }

      const userSubs = readJsonFromZip<Awaited<ReturnType<typeof exportUserSubscriptions>>>('data/user_subscriptions.json');
      if (userSubs && userSubs.length > 0) {
        await importUserSubscriptions(userSubs);
      }

      const superUserCats = readJsonFromZip<Awaited<ReturnType<typeof exportSuperUserCategories>>>('data/super_user_categories.json');
      if (superUserCats && superUserCats.length > 0) {
        await importSuperUserCategories(superUserCats);
      }
    }

    // Restore documents
    if (options.restoreDocuments && manifest.contents.documents) {
      const documents = readJsonFromZip<Awaited<ReturnType<typeof exportDocuments>>>('data/documents.json');
      if (documents && documents.length > 0) {
        await importDocuments(documents);
        result.details.documentsRestored = documents.length;
      }

      const docCats = readJsonFromZip<Awaited<ReturnType<typeof exportDocumentCategories>>>('data/document_categories.json');
      if (docCats && docCats.length > 0) {
        await importDocumentCategories(docCats);
      }
    }

    // Restore threads
    if (options.restoreThreads && manifest.contents.threads) {
      const threads = readJsonFromZip<Awaited<ReturnType<typeof exportThreads>>>('data/threads.json');
      if (threads && threads.length > 0) {
        await importThreads(threads);
        result.details.threadsRestored = threads.length;
      }

      const messages = readJsonFromZip<Awaited<ReturnType<typeof exportMessages>>>('data/messages.json');
      if (messages && messages.length > 0) {
        await importMessages(messages);
      }

      const threadCats = readJsonFromZip<Awaited<ReturnType<typeof exportThreadCategories>>>('data/thread_categories.json');
      if (threadCats && threadCats.length > 0) {
        await importThreadCategories(threadCats);
      }

      const threadUploads = readJsonFromZip<Awaited<ReturnType<typeof exportThreadUploads>>>('data/thread_uploads.json');
      if (threadUploads && threadUploads.length > 0) {
        await importThreadUploads(threadUploads);
      }

      const threadOutputs = readJsonFromZip<Awaited<ReturnType<typeof exportThreadOutputs>>>('data/thread_outputs.json');
      if (threadOutputs && threadOutputs.length > 0) {
        await importThreadOutputs(threadOutputs);
      }
    }

    // Restore settings
    if (options.restoreSettings && manifest.contents.settings) {
      const settings = readJsonFromZip<Awaited<ReturnType<typeof exportSettings>>>('data/settings.json');
      if (settings && settings.length > 0) {
        await importSettings(settings);
        result.details.settingsRestored = settings.length;
      }
    }

    // Restore tools
    if (options.restoreTools && manifest.contents.tools) {
      const toolConfigs = readJsonFromZip<Awaited<ReturnType<typeof exportToolConfigs>>>('data/tool_configs.json');
      if (toolConfigs && toolConfigs.length > 0) {
        await importToolConfigs(toolConfigs);
        result.details.toolsRestored = toolConfigs.length;
      }

      const categoryToolConfigs = readJsonFromZip<Awaited<ReturnType<typeof exportCategoryToolConfigs>>>('data/category_tool_configs.json');
      if (categoryToolConfigs && categoryToolConfigs.length > 0) {
        await importCategoryToolConfigs(categoryToolConfigs);
      }
    }

    // Restore skills
    if (options.restoreSkills && manifest.contents.skills) {
      const skills = readJsonFromZip<Awaited<ReturnType<typeof exportSkills>>>('data/skills.json');
      if (skills && skills.length > 0) {
        await importSkills(skills);
        result.details.skillsRestored = skills.length;
      }

      const categorySkills = readJsonFromZip<Awaited<ReturnType<typeof exportCategorySkills>>>('data/category_skills.json');
      if (categorySkills && categorySkills.length > 0) {
        await importCategorySkills(categorySkills);
      }
    }

    // Restore category prompts (includes starter prompts)
    if (options.restoreCategoryPrompts && manifest.contents.categoryPrompts) {
      const categoryPrompts = readJsonFromZip<Awaited<ReturnType<typeof exportCategoryPrompts>>>('data/category_prompts.json');
      if (categoryPrompts && categoryPrompts.length > 0) {
        await importCategoryPrompts(categoryPrompts);
        result.details.categoryPromptsRestored = categoryPrompts.length;
      }
    }

    // Restore data sources
    if (options.restoreDataSources && manifest.contents.dataSources) {
      // Restore API configs first, then categories
      const dataApiConfigs = readJsonFromZip<Awaited<ReturnType<typeof exportDataApiConfigs>>>('data/data_api_configs.json');
      if (dataApiConfigs && dataApiConfigs.length > 0) {
        await importDataApiConfigs(dataApiConfigs);
        result.details.dataSourcesRestored += dataApiConfigs.length;
      }

      const dataApiCategories = readJsonFromZip<Awaited<ReturnType<typeof exportDataApiCategories>>>('data/data_api_categories.json');
      if (dataApiCategories && dataApiCategories.length > 0) {
        await importDataApiCategories(dataApiCategories);
      }

      // Restore CSV configs first, then categories
      const dataCsvConfigs = readJsonFromZip<Awaited<ReturnType<typeof exportDataCsvConfigs>>>('data/data_csv_configs.json');
      if (dataCsvConfigs && dataCsvConfigs.length > 0) {
        await importDataCsvConfigs(dataCsvConfigs);
        result.details.dataSourcesRestored += dataCsvConfigs.length;
      }

      const dataCsvCategories = readJsonFromZip<Awaited<ReturnType<typeof exportDataCsvCategories>>>('data/data_csv_categories.json');
      if (dataCsvCategories && dataCsvCategories.length > 0) {
        await importDataCsvCategories(dataCsvCategories);
      }
    }

    // NEW: Restore workspaces
    if (options.restoreWorkspaces && manifest.contents.workspaces) {
      const workspaces = readJsonFromZip<Awaited<ReturnType<typeof exportWorkspaces>>>('data/workspaces.json');
      if (workspaces && workspaces.length > 0) {
        await importWorkspaces(workspaces);
        result.details.workspacesRestored = workspaces.length;
      }

      const workspaceCategories = readJsonFromZip<Awaited<ReturnType<typeof exportWorkspaceCategories>>>('data/workspace_categories.json');
      if (workspaceCategories && workspaceCategories.length > 0) {
        await importWorkspaceCategories(workspaceCategories);
      }

      const workspaceUsers = readJsonFromZip<Awaited<ReturnType<typeof exportWorkspaceUsers>>>('data/workspace_users.json');
      if (workspaceUsers && workspaceUsers.length > 0) {
        await importWorkspaceUsers(workspaceUsers);
      }
    }

    // NEW: Restore function APIs
    if (options.restoreFunctionApis && manifest.contents.functionApis) {
      const functionApiConfigs = readJsonFromZip<Awaited<ReturnType<typeof exportFunctionApiConfigs>>>('data/function_api_configs.json');
      if (functionApiConfigs && functionApiConfigs.length > 0) {
        await importFunctionApiConfigs(functionApiConfigs);
        result.details.functionApisRestored = functionApiConfigs.length;
      }

      const functionApiCategories = readJsonFromZip<Awaited<ReturnType<typeof exportFunctionApiCategories>>>('data/function_api_categories.json');
      if (functionApiCategories && functionApiCategories.length > 0) {
        await importFunctionApiCategories(functionApiCategories);
      }
    }

    // NEW: Restore user memories
    if (options.restoreUserMemories && manifest.contents.userMemories) {
      const userMemories = readJsonFromZip<Awaited<ReturnType<typeof exportUserMemories>>>('data/user_memories.json');
      if (userMemories && userMemories.length > 0) {
        await importUserMemories(userMemories);
        result.details.userMemoriesRestored = userMemories.length;
      }
    }

    // NEW: Restore tool routing rules
    if (options.restoreToolRouting && manifest.contents.toolRouting) {
      const toolRoutingRules = readJsonFromZip<Awaited<ReturnType<typeof exportToolRoutingRules>>>('data/tool_routing_rules.json');
      if (toolRoutingRules && toolRoutingRules.length > 0) {
        await importToolRoutingRules(toolRoutingRules);
        result.details.toolRoutingRulesRestored = toolRoutingRules.length;
      }
    }

    // NEW: Restore thread shares
    if (options.restoreThreadShares && manifest.contents.threadShares) {
      const threadShares = readJsonFromZip<Awaited<ReturnType<typeof exportThreadShares>>>('data/thread_shares.json');
      if (threadShares && threadShares.length > 0) {
        await importThreadShares(threadShares);
        result.details.threadSharesRestored = threadShares.length;
      }
    }

    // Task plans excluded from restore (transient workflow data)

    // NEW: Restore agent bots
    if (options.restoreAgentBots && manifest.contents.agentBots) {
      // Import bots first
      const agentBots = readJsonFromZip<Awaited<ReturnType<typeof exportAgentBots>>>('data/agent_bots.json');
      if (agentBots && agentBots.length > 0) {
        await importAgentBots(agentBots);
        result.details.agentBotsRestored = agentBots.length;
      }

      // Then versions (depend on bots)
      const agentBotVersions = readJsonFromZip<Awaited<ReturnType<typeof exportAgentBotVersions>>>('data/agent_bot_versions.json');
      if (agentBotVersions && agentBotVersions.length > 0) {
        await importAgentBotVersions(agentBotVersions);
      }

      // Then version relationships
      const agentBotVersionCategories = readJsonFromZip<Awaited<ReturnType<typeof exportAgentBotVersionCategories>>>('data/agent_bot_version_categories.json');
      if (agentBotVersionCategories && agentBotVersionCategories.length > 0) {
        await importAgentBotVersionCategories(agentBotVersionCategories);
      }

      const agentBotVersionSkills = readJsonFromZip<Awaited<ReturnType<typeof exportAgentBotVersionSkills>>>('data/agent_bot_version_skills.json');
      if (agentBotVersionSkills && agentBotVersionSkills.length > 0) {
        await importAgentBotVersionSkills(agentBotVersionSkills);
      }

      const agentBotVersionTools = readJsonFromZip<Awaited<ReturnType<typeof exportAgentBotVersionTools>>>('data/agent_bot_version_tools.json');
      if (agentBotVersionTools && agentBotVersionTools.length > 0) {
        await importAgentBotVersionTools(agentBotVersionTools);
      }

      // Finally API keys
      const agentBotApiKeys = readJsonFromZip<Awaited<ReturnType<typeof exportAgentBotApiKeys>>>('data/agent_bot_api_keys.json');
      if (agentBotApiKeys && agentBotApiKeys.length > 0) {
        await importAgentBotApiKeys(agentBotApiKeys);
      }
    }

    // Restore document files (outside transaction - file system ops)
    if (options.restoreDocumentFiles && manifest.contents.documentFiles) {
      const globalDocsDir = getGlobalDocsDir();
      await ensureDir(globalDocsDir);

      const fileEntries = zip.getEntries().filter(e => e.entryName.startsWith('files/global-docs/'));
      for (const entry of fileEntries) {
        if (!entry.isDirectory) {
          const relativePath = entry.entryName.replace('files/global-docs/', '');
          const targetPath = path.join(globalDocsDir, relativePath);

          // Ensure directory exists
          await ensureDir(path.dirname(targetPath));

          // Extract file
          fs.writeFileSync(targetPath, entry.getData());
          result.details.filesRestored++;
        }
      }
    }

    // Restore thread files
    if (options.restoreThreads && manifest.contents.threads) {
      const threadsDir = getThreadsDir();
      await ensureDir(threadsDir);

      const fileEntries = zip.getEntries().filter(e => e.entryName.startsWith('files/threads/'));
      for (const entry of fileEntries) {
        if (!entry.isDirectory) {
          const relativePath = entry.entryName.replace('files/threads/', '');
          const targetPath = path.join(threadsDir, relativePath);

          // Ensure directory exists
          await ensureDir(path.dirname(targetPath));

          // Extract file
          fs.writeFileSync(targetPath, entry.getData());
          result.details.filesRestored++;
        }
      }
    }

    // Restore CSV data source files
    if (options.restoreDataSources && manifest.contents.dataSources) {
      const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
      const csvDir = path.join(dataDir, 'csv-sources');
      await ensureDir(csvDir);

      const fileEntries = zip.getEntries().filter(e => e.entryName.startsWith('files/csv-sources/'));
      for (const entry of fileEntries) {
        if (!entry.isDirectory) {
          const relativePath = entry.entryName.replace('files/csv-sources/', '');
          const targetPath = path.join(csvDir, relativePath);

          // Ensure directory exists
          await ensureDir(path.dirname(targetPath));

          // Extract file
          fs.writeFileSync(targetPath, entry.getData());
          result.details.filesRestored++;
        }
      }
    }

    result.success = true;
    result.message = 'Backup restored successfully';

  } catch (error) {
    result.message = `Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  return result;
}

/**
 * Get contents of a backup file without restoring
 */
export function getBackupContents(zipBuffer: Buffer): BackupManifest | null {
  const validation = validateBackupFile(zipBuffer);
  return validation.manifest;
}
