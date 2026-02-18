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
  clearAllData,
} from './db/compat/backup';
import { getGlobalDocsDir, getThreadsDir, ensureDir } from './storage';

// ============ Types ============

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
  includeTaskPlans: boolean;
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
  restoreTaskPlans: boolean;
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
    workspaceCount: number;
    functionApiCount: number;
    userMemoryCount: number;
    toolRoutingRuleCount: number;
    threadShareCount: number;
    taskPlanCount: number;
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

  // Export database data (async for PostgreSQL support)
  const documents = options.includeDocuments ? await exportDocuments() : [];
  const categories = options.includeCategories ? await exportCategories() : [];
  const documentCategories = options.includeDocuments || options.includeCategories
    ? await exportDocumentCategories()
    : [];
  const users = options.includeUsers ? await exportUsers() : [];
  const userSubscriptions = options.includeUsers ? await exportUserSubscriptions() : [];
  const superUserCategories = options.includeUsers ? await exportSuperUserCategories() : [];
  const settings = options.includeSettings ? await exportSettings() : [];

  // Thread data
  let threads: Awaited<ReturnType<typeof exportThreads>> = [];
  let messages: Awaited<ReturnType<typeof exportMessages>> = [];
  let threadCategories: Awaited<ReturnType<typeof exportThreadCategories>> = [];
  let threadUploads: Awaited<ReturnType<typeof exportThreadUploads>> = [];
  let threadOutputs: Awaited<ReturnType<typeof exportThreadOutputs>> = [];

  if (options.includeThreads) {
    threads = await exportThreads();
    messages = await exportMessages();
    threadCategories = await exportThreadCategories();
    threadUploads = await exportThreadUploads();
    threadOutputs = await exportThreadOutputs();
  }

  // Tools, skills, and category prompts data
  const toolConfigs = options.includeTools ? await exportToolConfigs() : [];
  const categoryToolConfigs = options.includeTools ? await exportCategoryToolConfigs() : [];
  const skills = options.includeSkills ? await exportSkills() : [];
  const categorySkills = options.includeSkills ? await exportCategorySkills() : [];
  const categoryPrompts = options.includeCategoryPrompts ? await exportCategoryPrompts() : [];

  // Data sources
  const dataApiConfigs = options.includeDataSources ? await exportDataApiConfigs() : [];
  const dataApiCategories = options.includeDataSources ? await exportDataApiCategories() : [];
  const dataCsvConfigs = options.includeDataSources ? await exportDataCsvConfigs() : [];
  const dataCsvCategories = options.includeDataSources ? await exportDataCsvCategories() : [];

  // NEW: Workspaces
  const workspaces = options.includeWorkspaces ? await exportWorkspaces() : [];
  const workspaceCategories = options.includeWorkspaces ? await exportWorkspaceCategories() : [];
  const workspaceUsers = options.includeWorkspaces ? await exportWorkspaceUsers() : [];

  // NEW: Function APIs
  const functionApiConfigs = options.includeFunctionApis ? await exportFunctionApiConfigs() : [];
  const functionApiCategories = options.includeFunctionApis ? await exportFunctionApiCategories() : [];

  // NEW: User memories
  const userMemories = options.includeUserMemories ? await exportUserMemories() : [];

  // NEW: Tool routing rules
  const toolRoutingRules = options.includeToolRouting ? await exportToolRoutingRules() : [];

  // NEW: Thread shares
  const threadShares = options.includeThreadShares ? await exportThreadShares() : [];

  // NEW: Task plans
  const taskPlans = options.includeTaskPlans ? await exportTaskPlans() : [];

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
      userMemories: options.includeUserMemories,
      toolRouting: options.includeToolRouting,
      threadShares: options.includeThreadShares,
      taskPlans: options.includeTaskPlans,
      workspaceCount: workspaces.length,
      functionApiCount: functionApiConfigs.length,
      userMemoryCount: userMemories.length,
      toolRoutingRuleCount: toolRoutingRules.length,
      threadShareCount: threadShares.length,
      taskPlanCount: taskPlans.length,
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

  // NEW: Add task plans data
  if (options.includeTaskPlans) {
    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), count: taskPlans.length, records: taskPlans }, null, 2), { name: 'data/task_plans.json' });
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

    // NEW: Restore task plans
    if (options.restoreTaskPlans && manifest.contents.taskPlans) {
      const taskPlans = readJsonFromZip<Awaited<ReturnType<typeof exportTaskPlans>>>('data/task_plans.json');
      if (taskPlans && taskPlans.length > 0) {
        await importTaskPlans(taskPlans);
        result.details.taskPlansRestored = taskPlans.length;
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
