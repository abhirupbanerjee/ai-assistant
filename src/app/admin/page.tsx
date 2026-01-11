'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, RefreshCw, Trash2, FileText, AlertCircle, Users, UserPlus, Shield, User, Settings, Save, FolderOpen, Plus, Edit2, BarChart3, Database, HardDrive, Globe, Tag, Landmark, DollarSign, Activity, Layers, Server, ScrollText, ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Cpu, Mic, Sparkles, Wand2, CheckCircle, Youtube, Filter, SortAsc, ImageIcon, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { type SortDirection } from '@/components/ui/SortableTable';
import BackupTab from '@/components/admin/BackupTab';
import SkillsTab from '@/components/admin/SkillsTab';
import ToolsTab from '@/components/admin/ToolsTab';
import StarterPromptsEditor from '@/components/admin/StarterPromptsEditor';
import AdminSidebarMenu from '@/components/admin/AdminSidebarMenu';
import CacheSettingsTab from '@/components/admin/CacheSettingsTab';
import { RagTuningDashboard } from '@/components/admin/RagTuningDashboard';
import WorkspacesTab from '@/components/admin/WorkspacesTab';
import type { GlobalDocument } from '@/types';

interface AllowedUser {
  id?: number;
  email: string;
  name?: string;
  role: 'admin' | 'superuser' | 'user';
  addedAt: string;
  addedBy: string;
  subscriptions?: { categoryId: number; categoryName: string; isActive: boolean }[];
  assignedCategories?: { categoryId: number; categoryName: string }[];
}

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: string;
  documentCount: number;
  superUserCount: number;
  subscriberCount: number;
}

interface SystemPromptConfig {
  prompt: string;
  updatedAt: string;
  updatedBy: string;
}

interface RAGSettings {
  topKChunks: number;
  maxContextChunks: number;
  similarityThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  queryExpansionEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  updatedAt: string;
  updatedBy: string;
}

interface LLMSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  promptOptimizationMaxTokens: number;
  updatedAt: string;
  updatedBy: string;
}

interface AcronymMappings {
  mappings: Record<string, string>;
  updatedAt: string;
  updatedBy: string;
}

interface ProviderStatus {
  provider: string;
  available: boolean;
  configured: boolean;
  error?: string;
}

interface ServiceStatus {
  category: 'llm' | 'embedding' | 'transcribe' | 'ocr' | 'reranker';
  name: string;
  model: string;
  provider: string;
  available: boolean;
  configured: boolean;
  error?: string;
  latency?: number;
}

interface RerankerProviderStatus {
  provider: string;
  name: string;
  available: boolean;
  configured: boolean;
  error?: string;
  latency?: number;
}

interface AvailableModel {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'mistral' | 'gemini' | 'ollama';
  defaultMaxTokens: number;
}

type TabType = 'dashboard' | 'documents' | 'categories' | 'users' | 'settings' | 'stats' | 'prompts' | 'tools' | 'workspaces';
type SettingsSection = 'rag' | 'rag-tuning' | 'llm' | 'reranker' | 'memory' | 'summarization' | 'limits' | 'backup' | 'branding' | 'cache' | 'superuser' | 'agent';
type PromptsSection = 'system-prompt' | 'category-prompts' | 'acronyms' | 'skills';
type ToolsSection = 'management' | 'dependencies' | 'routing';

interface BrandingSettings {
  botName: string;
  botIcon: string;
  subtitle?: string;
  welcomeTitle?: string;
  welcomeMessage?: string;
  accentColor?: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface RerankerSettings {
  enabled: boolean;
  provider: 'cohere' | 'local';
  topKForReranking: number;
  minRerankerScore: number;
  cacheTTLSeconds: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface MemorySettings {
  enabled: boolean;
  extractionThreshold: number;
  maxFactsPerCategory: number;
  autoExtractOnThreadEnd: boolean;
  extractionMaxTokens: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface SummarizationSettings {
  enabled: boolean;
  tokenThreshold: number;
  keepRecentMessages: number;
  summaryMaxTokens: number;
  archiveOriginalMessages: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

interface LimitsSettings {
  conversationHistoryMessages: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface UploadSettings {
  maxFilesPerInput: number;
  maxFilesPerThread: number;
  maxFileSizeMB: number;
  allowedTypes: string[];
  updatedAt?: string;
  updatedBy?: string;
}

interface TokenLimitsSettings {
  promptOptimizationMaxTokens: number;
  skillsMaxTotalTokens: number;
  memoryExtractionMaxTokens: number;
  summaryMaxTokens: number;
  systemPromptMaxTokens: number;
  categoryPromptMaxTokens: number;
  starterLabelMaxChars: number;
  starterPromptMaxChars: number;
  maxStartersPerCategory: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface ModelTokenLimitsState {
  limits: Record<string, number | 'default'>;
  updatedAt?: string;
  updatedBy?: string;
}

interface StarterPrompt {
  label: string;
  prompt: string;
}

interface CategoryPromptData {
  category: { id: number; name: string; slug: string };
  globalPrompt: string;
  categoryAddendum: string;
  starterPrompts: StarterPrompt[];
  welcomeTitle: string;
  welcomeMessage: string;
  combinedPrompt: string;
  charInfo: {
    globalLength: number;
    categoryLength: number;
    combinedLength: number;
    availableForCategory: number;
    maxCombined: number;
  };
  metadata: { updatedAt: string; updatedBy: string } | null;
}

interface OptimizationResult {
  original: string;
  optimized: string;
  changes: string[];
  tokensUsed: number;
}

interface AgentModelConfig {
  provider: 'openai' | 'gemini' | 'mistral';
  model: string;
  temperature: number;
  max_tokens?: number;
}

interface AgentSettings {
  budgetMaxLlmCalls: number;
  budgetMaxTokens: number;
  budgetMaxWebSearches: number;
  confidenceThreshold: number;
  budgetMaxDurationMinutes: number;
  taskTimeoutMinutes: number;
  plannerModel: AgentModelConfig;
  executorModel: AgentModelConfig;
  checkerModel: AgentModelConfig;
  summarizerModel: AgentModelConfig;
  // Streaming configuration
  streamingKeepaliveInterval: number;
  streamingMaxDuration: number;
  streamingToolTimeout: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface EmbeddingSettings {
  model: string;
  dimensions: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface SuperuserSettingsState {
  maxCategoriesPerSuperuser: number;
  updatedAt?: string;
  updatedBy?: string;
}

// Available icon options for branding with their Lucide components and PNG paths
const BRANDING_ICONS = [
  { key: 'government', label: 'Government', Icon: Landmark, png192: '/icons/bot/government-192.png', png512: '/icons/bot/government-512.png' },
  { key: 'operations', label: 'Operations', Icon: Settings, png192: '/icons/bot/operations-192.png', png512: '/icons/bot/operations-512.png' },
  { key: 'finance', label: 'Finance', Icon: DollarSign, png192: '/icons/bot/finance-192.png', png512: '/icons/bot/finance-512.png' },
  { key: 'kpi', label: 'KPI', Icon: BarChart3, png192: '/icons/bot/kpi-192.png', png512: '/icons/bot/kpi-512.png' },
  { key: 'logs', label: 'Logs', Icon: FileText, png192: '/icons/bot/logs-192.png', png512: '/icons/bot/logs-512.png' },
  { key: 'data', label: 'Data', Icon: Database, png192: '/icons/bot/data-192.png', png512: '/icons/bot/data-512.png' },
  { key: 'monitoring', label: 'Monitoring', Icon: Activity, png192: '/icons/bot/monitoring-192.png', png512: '/icons/bot/monitoring-512.png' },
  { key: 'architecture', label: 'Architecture', Icon: Layers, png192: '/icons/bot/architecture-192.png', png512: '/icons/bot/architecture-512.png' },
  { key: 'internet', label: 'Internet', Icon: Globe, png192: '/icons/bot/internet-192.png', png512: '/icons/bot/internet-512.png' },
  { key: 'systems', label: 'Systems', Icon: Server, png192: '/icons/bot/systems-192.png', png512: '/icons/bot/systems-512.png' },
  { key: 'policy', label: 'Policy', Icon: ScrollText, png192: '/icons/bot/policy-192.png', png512: '/icons/bot/policy-512.png' },
] as const;

interface SystemStats {
  database: {
    users: { total: number; admins: number; superUsers: number; regularUsers: number };
    categories: { total: number; withDocuments: number; totalSubscriptions: number };
    threads: { total: number; totalMessages: number; totalUploads: number };
    documents: { total: number; globalDocuments: number; categoryDocuments: number; totalChunks: number; byStatus: { processing: number; ready: number; error: number } };
  };
  chroma: {
    connected: boolean;
    collections: { name: string; documentCount: number }[];
    totalVectors: number;
  };
  storage: {
    globalDocsDir: { path: string; exists: boolean; fileCount: number; totalSizeMB: number };
    threadsDir: { path: string; exists: boolean; userCount: number; totalUploadSizeMB: number };
    dataDir: { path: string; exists: boolean; totalSizeMB: number };
  };
  recentActivity: {
    recentThreads: { id: string; title: string; userEmail: string; messageCount: number; createdAt: string }[];
    recentDocuments: { id: number; filename: string; uploadedBy: string; status: string; createdAt: string }[];
  };
}

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // Document state
  const [documents, setDocuments] = useState<GlobalDocument[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [docLoading, setDocLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<GlobalDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reindexing, setReindexing] = useState<string | null>(null);

  // Document search, filter, and sort state
  const [docSearchTerm, setDocSearchTerm] = useState('');
  const [docSortKey, setDocSortKey] = useState<keyof GlobalDocument | null>(null);
  const [docSortDirection, setDocSortDirection] = useState<SortDirection>(null);
  const [docCategoryFilter, setDocCategoryFilter] = useState<number | 'all' | 'global' | 'uncategorized'>('all');
  const [docSortOption, setDocSortOption] = useState<'newest' | 'oldest' | 'largest' | 'smallest' | 'a-z' | 'z-a'>('newest');

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text' | 'web' | 'youtube'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTextName, setUploadTextName] = useState('');
  const [uploadTextContent, setUploadTextContent] = useState('');
  const [uploadCategoryIds, setUploadCategoryIds] = useState<number[]>([]);
  const [uploadIsGlobal, setUploadIsGlobal] = useState(false);
  // URL upload state
  const [uploadUrls, setUploadUrls] = useState<string[]>(['', '', '', '', '']);
  const [uploadYoutubeUrl, setUploadYoutubeUrl] = useState('');
  const [uploadUrlName, setUploadUrlName] = useState('');
  const [urlIngestionResults, setUrlIngestionResults] = useState<Array<{
    url: string;
    success: boolean;
    filename?: string;
    error?: string;
    sourceType: 'youtube' | 'web';
  }> | null>(null);

  // Edit document modal state
  const [editingDoc, setEditingDoc] = useState<GlobalDocument | null>(null);
  const [editDocCategoryIds, setEditDocCategoryIds] = useState<number[]>([]);
  const [editDocIsGlobal, setEditDocIsGlobal] = useState(false);
  const [savingDocChanges, setSavingDocChanges] = useState(false);

  // User state
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [userLoading, setUserLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'superuser' | 'user'>('user');
  const [addingUser, setAddingUser] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AllowedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<AllowedUser | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);

  // Add user category selection state
  const [newUserSubscriptions, setNewUserSubscriptions] = useState<number[]>([]);
  const [newUserAssignedCategories, setNewUserAssignedCategories] = useState<number[]>([]);

  // Manage user subscriptions state
  const [managingUserSubs, setManagingUserSubs] = useState<AllowedUser | null>(null);
  const [editUserSubscriptions, setEditUserSubscriptions] = useState<number[]>([]);
  const [editUserAssignedCategories, setEditUserAssignedCategories] = useState<number[]>([]);
  const [savingUserSubs, setSavingUserSubs] = useState(false);

  // Category state
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryDescription, setEditCategoryDescription] = useState('');
  const [updatingCategory, setUpdatingCategory] = useState(false);

  // System prompt state
  const [systemPrompt, setSystemPrompt] = useState<SystemPromptConfig | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptModified, setPromptModified] = useState(false);

  // Category prompt state
  const [editingCategoryPrompt, setEditingCategoryPrompt] = useState<number | null>(null);
  const [categoryPromptData, setCategoryPromptData] = useState<CategoryPromptData | null>(null);
  const [categoryPromptLoading, setCategoryPromptLoading] = useState(false);
  const [editedCategoryAddendum, setEditedCategoryAddendum] = useState('');
  const [editedStarterPrompts, setEditedStarterPrompts] = useState<StarterPrompt[]>([]);
  const [editedWelcomeTitle, setEditedWelcomeTitle] = useState('');
  const [editedWelcomeMessage, setEditedWelcomeMessage] = useState('');
  const [savingCategoryPrompt, setSavingCategoryPrompt] = useState(false);
  const [categoryPromptModified, setCategoryPromptModified] = useState(false);
  const [starterPromptsModified, setStarterPromptsModified] = useState(false);
  const [welcomeModified, setWelcomeModified] = useState(false);

  // Prompt optimization state
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [showOptimizationDiff, setShowOptimizationDiff] = useState(false);

  // RAG/LLM settings state
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('llm');
  const [promptsSection, setPromptsSection] = useState<PromptsSection>('system-prompt');
  const [toolsSection, setToolsSection] = useState<ToolsSection>('management');

  // LLM collapse state
  const [llmSettingsExpanded, setLlmSettingsExpanded] = useState(true);
  const [llmTokenLimitsExpanded, setLlmTokenLimitsExpanded] = useState(false);
  const [ragSettings, setRagSettings] = useState<RAGSettings | null>(null);
  const [editedRag, setEditedRag] = useState<Omit<RAGSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);
  const [editedLlm, setEditedLlm] = useState<Omit<LLMSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [acronymMappings, setAcronymMappings] = useState<AcronymMappings | null>(null);
  const [editedAcronyms, setEditedAcronyms] = useState<string>('');
  const [brandingSettings, setBrandingSettings] = useState<BrandingSettings | null>(null);
  const [editedBranding, setEditedBranding] = useState<Omit<BrandingSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [rerankerSettings, setRerankerSettings] = useState<RerankerSettings | null>(null);
  const [editedReranker, setEditedReranker] = useState<Omit<RerankerSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [editedMemory, setEditedMemory] = useState<Omit<MemorySettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [summarizationSettings, setSummarizationSettings] = useState<SummarizationSettings | null>(null);
  const [editedSummarization, setEditedSummarization] = useState<Omit<SummarizationSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [limitsSettings, setLimitsSettingsState] = useState<LimitsSettings | null>(null);
  const [editedLimits, setEditedLimits] = useState<Omit<LimitsSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [editedAgent, setEditedAgent] = useState<Omit<AgentSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [uploadSettings, setUploadSettingsState] = useState<UploadSettings | null>(null);
  const [editedUpload, setEditedUpload] = useState<Omit<UploadSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [modelTokenLimits, setModelTokenLimits] = useState<ModelTokenLimitsState | null>(null);
  const [editedModelTokens, setEditedModelTokens] = useState<Record<string, number | 'default'>>({});
  const [savingModelTokens, setSavingModelTokens] = useState(false);
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings | null>(null);
  const [superuserSettings, setSuperuserSettings] = useState<SuperuserSettingsState | null>(null);
  const [editedSuperuser, setEditedSuperuser] = useState<Omit<SuperuserSettingsState, 'updatedAt' | 'updatedBy'> | null>(null);
  const [transcriptionModel, setTranscriptionModel] = useState<string>('whisper-1');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus[]>([]);

  // Dashboard filters and search
  const [dashboardCategoryFilter, setDashboardCategoryFilter] = useState<string>('all');
  const [dashboardProviderFilter, setDashboardProviderFilter] = useState<string>('all');
  const [dashboardSearch, setDashboardSearch] = useState<string>('');
  const [providersLoading, setProvidersLoading] = useState(true);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [ragModified, setRagModified] = useState(false);
  const [llmModified, setLlmModified] = useState(false);
  const [acronymsModified, setAcronymsModified] = useState(false);
  const [brandingModified, setBrandingModified] = useState(false);
  const [rerankerModified, setRerankerModified] = useState(false);
  const [memoryModified, setMemoryModified] = useState(false);
  const [summarizationModified, setSummarizationModified] = useState(false);
  const [limitsModified, setLimitsModified] = useState(false);
  const [uploadModified, setUploadModified] = useState(false);
  const [agentModified, setAgentModified] = useState(false);
  const [tokenLimitsSettings, setTokenLimitsSettingsState] = useState<TokenLimitsSettings | null>(null);
  const [editedTokenLimits, setEditedTokenLimits] = useState<Omit<TokenLimitsSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [tokenLimitsModified, setTokenLimitsModified] = useState(false);
  const [rerankerStatus, setRerankerStatus] = useState<RerankerProviderStatus[]>([]);
  const [rerankerStatusLoading, setRerankerStatusLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Stats state
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Load documents
  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/documents');

      if (response.status === 403) {
        router.push('/');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load documents');
      }

      const data = await response.json();
      setDocuments(data.documents.map((d: GlobalDocument) => ({
        ...d,
        uploadedAt: new Date(d.uploadedAt),
      })));
      setTotalChunks(data.totalChunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setDocLoading(false);
    }
  }, [router]);

  // Load users
  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users');

      if (response.status === 403) {
        router.push('/');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setUserLoading(false);
    }
  }, [router]);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/categories');

      if (response.status === 403) {
        router.push('/');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load categories');
      }

      const data = await response.json();
      setCategories(data.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setCategoryLoading(false);
    }
  }, [router]);

  // Load system prompt
  const loadSystemPrompt = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/system-prompt');

      if (response.status === 403) {
        router.push('/');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load system prompt');
      }

      const data = await response.json();
      setSystemPrompt(data);
      setEditedPrompt(data.prompt);
      setPromptModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system prompt');
    } finally {
      setPromptLoading(false);
    }
  }, [router]);

  // Load RAG/LLM settings
  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings');

      if (response.status === 403) {
        router.push('/');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load settings');
      }

      const data = await response.json();
      if (data.rag) {
        setRagSettings(data.rag);
        setEditedRag({
          topKChunks: data.rag.topKChunks,
          maxContextChunks: data.rag.maxContextChunks,
          similarityThreshold: data.rag.similarityThreshold,
          chunkSize: data.rag.chunkSize,
          chunkOverlap: data.rag.chunkOverlap,
          queryExpansionEnabled: data.rag.queryExpansionEnabled,
          cacheEnabled: data.rag.cacheEnabled,
          cacheTTLSeconds: data.rag.cacheTTLSeconds,
        });
      }
      if (data.llm) {
        setLlmSettings(data.llm);
        setEditedLlm({
          model: data.llm.model,
          temperature: data.llm.temperature,
          maxTokens: data.llm.maxTokens,
          promptOptimizationMaxTokens: data.llm.promptOptimizationMaxTokens,
        });
      }
      if (data.acronyms) {
        setAcronymMappings(data.acronyms);
        setEditedAcronyms(
          Object.entries(data.acronyms.mappings || {})
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        );
      }
      if (data.branding) {
        setBrandingSettings(data.branding);
        setEditedBranding({
          botName: data.branding.botName,
          botIcon: data.branding.botIcon,
          subtitle: data.branding.subtitle,
          welcomeTitle: data.branding.welcomeTitle,
          welcomeMessage: data.branding.welcomeMessage,
          accentColor: data.branding.accentColor,
        });
      }
      if (data.reranker) {
        setRerankerSettings(data.reranker);
        setEditedReranker({
          enabled: data.reranker.enabled,
          provider: data.reranker.provider,
          topKForReranking: data.reranker.topKForReranking,
          minRerankerScore: data.reranker.minRerankerScore,
          cacheTTLSeconds: data.reranker.cacheTTLSeconds,
        });
      }
      if (data.memory) {
        setMemorySettings(data.memory);
        setEditedMemory({
          enabled: data.memory.enabled,
          extractionThreshold: data.memory.extractionThreshold,
          maxFactsPerCategory: data.memory.maxFactsPerCategory,
          autoExtractOnThreadEnd: data.memory.autoExtractOnThreadEnd,
          extractionMaxTokens: data.memory.extractionMaxTokens,
        });
      }
      if (data.summarization) {
        setSummarizationSettings(data.summarization);
        setEditedSummarization({
          enabled: data.summarization.enabled,
          tokenThreshold: data.summarization.tokenThreshold,
          keepRecentMessages: data.summarization.keepRecentMessages,
          summaryMaxTokens: data.summarization.summaryMaxTokens,
          archiveOriginalMessages: data.summarization.archiveOriginalMessages,
        });
      }
      if (data.limits) {
        setLimitsSettingsState(data.limits);
        setEditedLimits({
          conversationHistoryMessages: data.limits.conversationHistoryMessages,
        });
      }
      if (data.uploadLimits) {
        setUploadSettingsState(data.uploadLimits);
        setEditedUpload({
          maxFilesPerInput: data.uploadLimits.maxFilesPerInput,
          maxFilesPerThread: data.uploadLimits.maxFilesPerThread ?? 10,
          maxFileSizeMB: data.uploadLimits.maxFileSizeMB,
          allowedTypes: data.uploadLimits.allowedTypes || [],
        });
      }
      if (data.modelTokenLimits) {
        setModelTokenLimits(data.modelTokenLimits);
        setEditedModelTokens(data.modelTokenLimits.limits || {});
      }
      if (data.tokenLimits) {
        setTokenLimitsSettingsState(data.tokenLimits);
        setEditedTokenLimits({
          promptOptimizationMaxTokens: data.tokenLimits.promptOptimizationMaxTokens,
          skillsMaxTotalTokens: data.tokenLimits.skillsMaxTotalTokens,
          memoryExtractionMaxTokens: data.tokenLimits.memoryExtractionMaxTokens,
          summaryMaxTokens: data.tokenLimits.summaryMaxTokens,
          systemPromptMaxTokens: data.tokenLimits.systemPromptMaxTokens,
          categoryPromptMaxTokens: data.tokenLimits.categoryPromptMaxTokens,
          starterLabelMaxChars: data.tokenLimits.starterLabelMaxChars,
          starterPromptMaxChars: data.tokenLimits.starterPromptMaxChars,
          maxStartersPerCategory: data.tokenLimits.maxStartersPerCategory,
        });
      }
      if (data.embedding) {
        setEmbeddingSettings(data.embedding);
      }
      if (data.models?.transcription) {
        setTranscriptionModel(data.models.transcription);
      }
      setAvailableModels((data.availableModels || []).filter(Boolean));
      setRagModified(false);
      setLlmModified(false);
      setAcronymsModified(false);
      setBrandingModified(false);
      setRerankerModified(false);
      setMemoryModified(false);
      setSummarizationModified(false);
      setLimitsModified(false);
      setUploadModified(false);
      setTokenLimitsModified(false);

      // Load superuser settings separately
      try {
        const superuserResponse = await fetch('/api/admin/settings/superuser');
        if (superuserResponse.ok) {
          const superuserData = await superuserResponse.json();
          setSuperuserSettings(superuserData);
          setEditedSuperuser({
            maxCategoriesPerSuperuser: superuserData.maxCategoriesPerSuperuser,
          });
        }
      } catch (err) {
        console.error('Failed to load superuser settings:', err);
      }

      // Load agent settings separately
      try {
        const agentResponse = await fetch('/api/admin/settings/agent');
        if (agentResponse.ok) {
          const agentData = await agentResponse.json();
          setAgentSettings(agentData);
          setEditedAgent({
            budgetMaxLlmCalls: agentData.budgetMaxLlmCalls,
            budgetMaxTokens: agentData.budgetMaxTokens,
            budgetMaxWebSearches: agentData.budgetMaxWebSearches,
            confidenceThreshold: agentData.confidenceThreshold,
            budgetMaxDurationMinutes: agentData.budgetMaxDurationMinutes,
            taskTimeoutMinutes: agentData.taskTimeoutMinutes,
            plannerModel: agentData.plannerModel,
            executorModel: agentData.executorModel,
            checkerModel: agentData.checkerModel,
            summarizerModel: agentData.summarizerModel,
            streamingKeepaliveInterval: agentData.streamingKeepaliveInterval ?? 10,
            streamingMaxDuration: agentData.streamingMaxDuration ?? 300,
            streamingToolTimeout: agentData.streamingToolTimeout ?? 60,
          });
        }
      } catch (err) {
        console.error('Failed to load agent settings:', err);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [router]);

  // Load system stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await fetch('/api/admin/stats');

      if (response.status === 403) {
        router.push('/');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load stats');
      }

      const data = await response.json();
      setSystemStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setStatsLoading(false);
    }
  }, [router]);

  // Load provider availability status
  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const response = await fetch('/api/admin/providers');

      if (response.status === 403) {
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load provider status');
      }

      const data = await response.json();
      setProviderStatus(data.providers || {});
      setServiceStatus((data.services || []).filter(Boolean));
    } catch (err) {
      console.error('Failed to load provider status:', err);
      // Don't show error to user - providers status is optional
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  // Load reranker provider status
  const loadRerankerStatus = useCallback(async () => {
    setRerankerStatusLoading(true);
    try {
      const response = await fetch('/api/admin/reranker-status');

      if (response.status === 403) {
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load reranker status');
      }

      const data = await response.json();
      setRerankerStatus((data.providers || []).filter(Boolean));
    } catch (err) {
      console.error('Failed to load reranker status:', err);
      // Don't show error to user - reranker status is optional
    } finally {
      setRerankerStatusLoading(false);
    }
  }, []);

  // Helper to get provider from model name
  const getModelProvider = useCallback((model: string): 'openai' | 'mistral' | 'ollama' | 'azure' => {
    if (model.startsWith('ollama-')) return 'ollama';
    if (model.startsWith('mistral') || model.startsWith('ministral')) return 'mistral';
    if (model.startsWith('azure-')) return 'azure';
    return 'openai';
  }, []);

  useEffect(() => {
    loadDocuments();
    loadUsers();
    loadCategories();
    loadSystemPrompt();
    loadSettings();
    loadStats();
    loadProviders();
    loadRerankerStatus();
  }, [loadDocuments, loadUsers, loadCategories, loadSystemPrompt, loadSettings, loadStats, loadProviders, loadRerankerStatus]);

  // URL validation helpers
  const isValidUrl = (string: string): boolean => {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  };

  const isYouTubeUrl = (url: string): boolean => {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(url);
  };

  // Get valid URLs from the batch input
  const getValidWebUrls = (): string[] => {
    return uploadUrls.filter(url => url.trim() && isValidUrl(url.trim()));
  };

  // Document handlers
  const handleUploadConfirm = async () => {
    if (uploadMode === 'file' && !uploadFile) return;
    if (uploadMode === 'text' && (!uploadTextName.trim() || !uploadTextContent.trim())) return;
    if (uploadMode === 'web' && getValidWebUrls().length === 0) return;
    if (uploadMode === 'youtube' && (!uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim()))) return;

    setUploading(true);
    setUploadProgress('Uploading...');
    setError(null);
    setUrlIngestionResults(null);

    try {
      let response: Response;

      if (uploadMode === 'file') {
        const formData = new FormData();
        formData.append('file', uploadFile!);
        formData.append('categoryIds', JSON.stringify(uploadCategoryIds));
        formData.append('isGlobal', String(uploadIsGlobal));

        response = await fetch('/api/admin/documents', {
          method: 'POST',
          body: formData,
        });
      } else if (uploadMode === 'text') {
        response = await fetch('/api/admin/documents/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: uploadTextName.trim(),
            content: uploadTextContent,
            categoryIds: uploadCategoryIds,
            isGlobal: uploadIsGlobal,
          }),
        });
      } else if (uploadMode === 'web') {
        // Web URLs mode
        const webUrls = getValidWebUrls();
        setUploadProgress('Extracting content...');
        response = await fetch('/api/admin/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: webUrls,
            categoryIds: uploadCategoryIds,
            isGlobal: uploadIsGlobal,
          }),
        });
      } else {
        // YouTube mode
        const youtubeUrl = uploadYoutubeUrl.trim();
        setUploadProgress('Extracting transcript...');
        response = await fetch('/api/admin/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl,
            name: uploadUrlName.trim() || undefined,
            categoryIds: uploadCategoryIds,
            isGlobal: uploadIsGlobal,
          }),
        });
      }

      const data = await response.json();

      if (uploadMode === 'web' || uploadMode === 'youtube') {
        // Handle URL ingestion results
        if (data.results) {
          setUrlIngestionResults(data.results);
          // Only close if all successful
          if (data.summary?.failed === 0) {
            setUploadProgress('Processing...');
            await loadDocuments();
            setShowUploadModal(false);
            resetUploadForm();
          } else {
            // Show results but don't close
            setUploadProgress(null);
            await loadDocuments();
          }
        } else if (!response.ok) {
          throw new Error(data.error || 'URL ingestion failed');
        }
      } else {
        if (!response.ok) {
          throw new Error(data.error || 'Upload failed');
        }
        setUploadProgress('Processing...');
        await loadDocuments();
        setShowUploadModal(false);
        resetUploadForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadTextName('');
    setUploadTextContent('');
    setUploadCategoryIds([]);
    setUploadIsGlobal(false);
    setUploadMode('file');
    setUploadUrls(['', '', '', '', '']);
    setUploadYoutubeUrl('');
    setUploadUrlName('');
    setUrlIngestionResults(null);
  };

  const handleEditDoc = (doc: GlobalDocument) => {
    setEditingDoc(doc);
    setEditDocCategoryIds(doc.categories?.map(c => c.id) || []);
    setEditDocIsGlobal(doc.isGlobal || false);
  };

  const handleSaveDocChanges = async () => {
    if (!editingDoc) return;

    setSavingDocChanges(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/documents/${editingDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: editDocCategoryIds,
          isGlobal: editDocIsGlobal,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update document');
      }

      await loadDocuments();
      setEditingDoc(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update document');
    } finally {
      setSavingDocChanges(false);
    }
  };

  const handleDeleteDoc = async () => {
    if (!deleteDoc) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/documents/${deleteDoc.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }

      setDocuments((prev) => prev.filter((d) => d.id !== deleteDoc.id));
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
      setDeleteDoc(null);
    }
  };

  const handleReindex = async (docId: string) => {
    setReindexing(docId);
    setError(null);

    try {
      const response = await fetch(`/api/admin/documents/${docId}?reindex=true`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Reindex failed');
      }

      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reindex failed');
    } finally {
      setReindexing(null);
    }
  };

  const handleRefreshAll = async () => {
    if (!confirm('This will clear the response cache and reindex all documents. This may take a few minutes. Continue?')) {
      return;
    }

    setRefreshingAll(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/refresh', {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Refresh failed');
      }

      const result = await response.json();
      await loadDocuments();
      alert(`Refresh complete! Cache cleared, ${result.documentsReindexed} documents reindexed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshingAll(false);
    }
  };

  // User handlers
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim()) return;

    setAddingUser(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newUserEmail.trim(),
          name: newUserName.trim() || undefined,
          role: newUserRole,
          subscriptions: newUserRole === 'user' ? newUserSubscriptions : undefined,
          assignedCategories: newUserRole === 'superuser' ? newUserAssignedCategories : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add user');
      }

      await loadUsers();
      setShowAddUser(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('user');
      setNewUserSubscriptions([]);
      setNewUserAssignedCategories([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;

    setDeletingUser(true);
    try {
      const response = await fetch(`/api/admin/users?email=${encodeURIComponent(deleteUser.email)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove user');
      }

      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    } finally {
      setDeletingUser(false);
      setDeleteUser(null);
    }
  };

  const handleUpdateRole = async (newRole: 'admin' | 'superuser' | 'user') => {
    if (!editingUser) return;

    setUpdatingRole(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: editingUser.email,
          role: newRole,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update role');
      }

      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setUpdatingRole(false);
      setEditingUser(null);
    }
  };

  const handleManageUserSubs = (user: AllowedUser) => {
    setManagingUserSubs(user);
    if (user.role === 'user') {
      setEditUserSubscriptions(user.subscriptions?.map(s => s.categoryId) || []);
      setEditUserAssignedCategories([]);
    } else if (user.role === 'superuser') {
      // Superusers have both: category assignments (for management) and subscriptions (for read access)
      setEditUserSubscriptions(user.subscriptions?.map(s => s.categoryId) || []);
      setEditUserAssignedCategories(user.assignedCategories?.map(c => c.categoryId) || []);
    }
  };

  const handleSaveUserSubs = async () => {
    if (!managingUserSubs) return;

    setSavingUserSubs(true);
    setError(null);

    try {
      // Use user ID from the managingUserSubs object
      const userId = managingUserSubs.id;

      if (!userId) {
        throw new Error('Could not find user ID');
      }

      if (managingUserSubs.role === 'user') {
        // Get current subscriptions
        const currentSubs = managingUserSubs.subscriptions?.map(s => s.categoryId) || [];

        // Add new subscriptions
        for (const catId of editUserSubscriptions) {
          if (!currentSubs.includes(catId)) {
            await fetch(`/api/admin/users/${userId}/subscriptions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoryId: catId }),
            });
          }
        }

        // Remove old subscriptions
        for (const catId of currentSubs) {
          if (!editUserSubscriptions.includes(catId)) {
            await fetch(`/api/admin/users/${userId}/subscriptions?categoryId=${catId}`, {
              method: 'DELETE',
            });
          }
        }
      } else if (managingUserSubs.role === 'superuser') {
        // Handle category assignments (for management access)
        const currentAssignments = managingUserSubs.assignedCategories?.map(c => c.categoryId) || [];

        // Add new assignments
        for (const catId of editUserAssignedCategories) {
          if (!currentAssignments.includes(catId)) {
            await fetch(`/api/admin/super-users/${userId}/categories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoryId: catId }),
            });
          }
        }

        // Remove old assignments
        for (const catId of currentAssignments) {
          if (!editUserAssignedCategories.includes(catId)) {
            await fetch(`/api/admin/super-users/${userId}/categories?categoryId=${catId}`, {
              method: 'DELETE',
            });
          }
        }

        // Handle subscriptions (for read access to other categories)
        const currentSubs = managingUserSubs.subscriptions?.map(s => s.categoryId) || [];

        // Add new subscriptions
        for (const catId of editUserSubscriptions) {
          if (!currentSubs.includes(catId)) {
            await fetch(`/api/admin/users/${userId}/subscriptions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoryId: catId }),
            });
          }
        }

        // Remove old subscriptions
        for (const catId of currentSubs) {
          if (!editUserSubscriptions.includes(catId)) {
            await fetch(`/api/admin/users/${userId}/subscriptions?categoryId=${catId}`, {
              method: 'DELETE',
            });
          }
        }
      }

      await loadUsers();
      setManagingUserSubs(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subscriptions');
    } finally {
      setSavingUserSubs(false);
    }
  };

  // Category handlers
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setAddingCategory(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          description: newCategoryDescription.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create category');
      }

      await loadCategories();
      setShowAddCategory(false);
      setNewCategoryName('');
      setNewCategoryDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setAddingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategory) return;

    setDeletingCategory(true);
    try {
      const response = await fetch(`/api/admin/categories/${deleteCategory.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete category');
      }

      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
    } finally {
      setDeletingCategory(false);
      setDeleteCategory(null);
    }
  };

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category);
    setEditCategoryName(category.name);
    setEditCategoryDescription(category.description || '');
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editCategoryName.trim()) return;

    setUpdatingCategory(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/categories/${editingCategory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editCategoryName.trim(),
          description: editCategoryDescription.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update category');
      }

      await loadCategories();
      setEditingCategory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
    } finally {
      setUpdatingCategory(false);
    }
  };

  // System prompt handlers
  const handlePromptChange = (value: string) => {
    setEditedPrompt(value);
    setPromptModified(value !== systemPrompt?.prompt);
  };

  const handleSavePrompt = async () => {
    if (!promptModified || !editedPrompt.trim()) return;

    setSavingPrompt(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: editedPrompt }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save system prompt');
      }

      const result = await response.json();
      setSystemPrompt(result.config);
      setPromptModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save system prompt');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleResetPrompt = () => {
    if (systemPrompt) {
      setEditedPrompt(systemPrompt.prompt);
      setPromptModified(false);
    }
  };

  // Restore system prompt to JSON config default
  const [restoringPrompt, setRestoringPrompt] = useState(false);
  const handleRestoreDefaultPrompt = async () => {
    setRestoringPrompt(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/system-prompt', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore default prompt');
      }

      const data = await response.json();
      // Update both states to the restored default
      // Save button will be disabled since they match (default is already active)
      setSystemPrompt({
        prompt: data.prompt,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      });
      setEditedPrompt(data.prompt);
      setPromptModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore default prompt');
    } finally {
      setRestoringPrompt(false);
    }
  };

  // Category prompt handlers
  const loadCategoryPrompt = async (categoryId: number) => {
    setCategoryPromptLoading(true);
    try {
      const response = await fetch(`/api/categories/${categoryId}/prompt`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load category prompt');
      }
      const data = await response.json();
      setCategoryPromptData(data);
      setEditedCategoryAddendum(data.categoryAddendum || '');
      setEditedStarterPrompts(data.starterPrompts || []);
      setEditedWelcomeTitle(data.welcomeTitle || '');
      setEditedWelcomeMessage(data.welcomeMessage || '');
      setCategoryPromptModified(false);
      setStarterPromptsModified(false);
      setWelcomeModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load category prompt');
    } finally {
      setCategoryPromptLoading(false);
    }
  };

  const handleOpenCategoryPromptModal = async (categoryId: number) => {
    setEditingCategoryPrompt(categoryId);
    await loadCategoryPrompt(categoryId);
  };

  const handleCloseCategoryPromptModal = () => {
    setEditingCategoryPrompt(null);
    setCategoryPromptData(null);
    setEditedCategoryAddendum('');
    setEditedWelcomeTitle('');
    setEditedWelcomeMessage('');
    setCategoryPromptModified(false);
    setWelcomeModified(false);
  };

  const handleCategoryAddendumChange = (value: string) => {
    setEditedCategoryAddendum(value);
    setCategoryPromptModified(value !== (categoryPromptData?.categoryAddendum || ''));
  };

  const handleStarterPromptsChange = (starters: StarterPrompt[]) => {
    setEditedStarterPrompts(starters);
    const original = categoryPromptData?.starterPrompts || [];
    setStarterPromptsModified(JSON.stringify(starters) !== JSON.stringify(original));
  };

  const handleWelcomeTitleChange = (value: string) => {
    setEditedWelcomeTitle(value);
    const originalTitle = categoryPromptData?.welcomeTitle || '';
    const originalMessage = categoryPromptData?.welcomeMessage || '';
    setWelcomeModified(value !== originalTitle || editedWelcomeMessage !== originalMessage);
  };

  const handleWelcomeMessageChange = (value: string) => {
    setEditedWelcomeMessage(value);
    const originalTitle = categoryPromptData?.welcomeTitle || '';
    const originalMessage = categoryPromptData?.welcomeMessage || '';
    setWelcomeModified(editedWelcomeTitle !== originalTitle || value !== originalMessage);
  };

  const handleSaveCategoryPrompt = async () => {
    if (!editingCategoryPrompt) return;

    setSavingCategoryPrompt(true);
    setError(null);

    try {
      const response = await fetch(`/api/categories/${editingCategoryPrompt}/prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptAddendum: editedCategoryAddendum,
          starterPrompts: editedStarterPrompts.length > 0 ? editedStarterPrompts : null,
          welcomeTitle: editedWelcomeTitle || null,
          welcomeMessage: editedWelcomeMessage || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || data.details?.join(', ') || 'Failed to save category prompt');
      }

      const data = await response.json();
      setCategoryPromptData(prev => prev ? {
        ...prev,
        categoryAddendum: data.categoryAddendum || '',
        starterPrompts: data.starterPrompts || [],
        welcomeTitle: data.welcomeTitle || '',
        welcomeMessage: data.welcomeMessage || '',
        combinedPrompt: data.combinedPrompt,
        charInfo: data.charInfo,
        metadata: data.metadata,
      } : null);
      setCategoryPromptModified(false);
      setStarterPromptsModified(false);
      setWelcomeModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save category prompt');
    } finally {
      setSavingCategoryPrompt(false);
    }
  };

  const handleResetCategoryToGlobal = async () => {
    if (!editingCategoryPrompt) return;

    setSavingCategoryPrompt(true);
    setError(null);

    try {
      const response = await fetch(`/api/categories/${editingCategoryPrompt}/prompt`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reset category prompt');
      }

      // Reload the category prompt data
      await loadCategoryPrompt(editingCategoryPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset category prompt');
    } finally {
      setSavingCategoryPrompt(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!editingCategoryPrompt || !editedCategoryAddendum.trim()) return;

    setOptimizing(true);
    setError(null);

    try {
      const response = await fetch(`/api/categories/${editingCategoryPrompt}/prompt/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryAddendum: editedCategoryAddendum }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to optimize prompt');
      }

      const result: OptimizationResult = await response.json();
      setOptimizationResult(result);
      setShowOptimizationDiff(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize prompt');
    } finally {
      setOptimizing(false);
    }
  };

  const handleAcceptOptimization = () => {
    if (!optimizationResult) return;
    setEditedCategoryAddendum(optimizationResult.optimized);
    setCategoryPromptModified(optimizationResult.optimized !== (categoryPromptData?.categoryAddendum || ''));
    setShowOptimizationDiff(false);
    setOptimizationResult(null);
  };

  const handleRejectOptimization = () => {
    setShowOptimizationDiff(false);
    setOptimizationResult(null);
  };

  // RAG settings handlers
  const handleRagChange = <K extends keyof Omit<RAGSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<RAGSettings, 'updatedAt' | 'updatedBy'>[K]
  ) => {
    if (!editedRag) return;
    const updated = { ...editedRag, [key]: value };
    setEditedRag(updated);
    setRagModified(
      JSON.stringify(updated) !== JSON.stringify({
        topKChunks: ragSettings?.topKChunks,
        maxContextChunks: ragSettings?.maxContextChunks,
        similarityThreshold: ragSettings?.similarityThreshold,
        chunkSize: ragSettings?.chunkSize,
        chunkOverlap: ragSettings?.chunkOverlap,
        queryExpansionEnabled: ragSettings?.queryExpansionEnabled,
        cacheEnabled: ragSettings?.cacheEnabled,
        cacheTTLSeconds: ragSettings?.cacheTTLSeconds,
      })
    );
  };

  const handleSaveRag = async () => {
    if (!ragModified || !editedRag) return;

    setSavingSettings(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rag', settings: editedRag }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save RAG settings');
      }

      const result = await response.json();
      setRagSettings(result.settings);
      setRagModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save RAG settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetRag = () => {
    if (ragSettings) {
      setEditedRag({
        topKChunks: ragSettings.topKChunks,
        maxContextChunks: ragSettings.maxContextChunks,
        similarityThreshold: ragSettings.similarityThreshold,
        chunkSize: ragSettings.chunkSize,
        chunkOverlap: ragSettings.chunkOverlap,
        queryExpansionEnabled: ragSettings.queryExpansionEnabled,
        cacheEnabled: ragSettings.cacheEnabled,
        cacheTTLSeconds: ragSettings.cacheTTLSeconds,
      });
      setRagModified(false);
    }
  };

  // LLM settings handlers
  const handleLlmChange = <K extends keyof Omit<LLMSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<LLMSettings, 'updatedAt' | 'updatedBy'>[K]
  ) => {
    if (!editedLlm) return;
    const updated = { ...editedLlm, [key]: value };
    setEditedLlm(updated);
    setLlmModified(
      JSON.stringify(updated) !== JSON.stringify({
        model: llmSettings?.model,
        temperature: llmSettings?.temperature,
        maxTokens: llmSettings?.maxTokens,
      })
    );
  };

  const handleSaveLlm = async () => {
    if (!llmModified || !editedLlm) return;

    setSavingSettings(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'llm', settings: editedLlm }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save LLM settings');
      }

      const result = await response.json();
      setLlmSettings(result.settings);
      setLlmModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save LLM settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetLlm = () => {
    if (llmSettings) {
      setEditedLlm({
        model: llmSettings.model,
        temperature: llmSettings.temperature,
        maxTokens: llmSettings.maxTokens,
        promptOptimizationMaxTokens: llmSettings.promptOptimizationMaxTokens,
      });
      setLlmModified(false);
    }
  };

  // Model token limit handlers
  const handleModelTokenChange = (model: string, value: number | 'default') => {
    setEditedModelTokens(prev => ({
      ...prev,
      [model]: value
    }));
  };

  const handleSaveModelToken = async (model: string) => {
    setSavingModelTokens(true);
    setError(null);

    try {
      const value = editedModelTokens[model];
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'model-tokens',
          settings: { model, maxTokens: value ?? 'default' }
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save model token limit');
      }

      const result = await response.json();
      setModelTokenLimits(result.modelTokenLimits);
      setEditedModelTokens(result.modelTokenLimits.limits || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model token limit');
    } finally {
      setSavingModelTokens(false);
    }
  };

  const handleResetModelToken = (model: string) => {
    // Reset to default by setting value to 'default'
    handleModelTokenChange(model, 'default');
  };

  // Restore all settings to defaults
  const handleRestoreAllDefaults = async () => {
    setRestoringDefaults(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'restoreAllDefaults', settings: {} }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore defaults');
      }

      // Reload all settings
      await loadSettings();
      await loadSystemPrompt();
      setShowRestoreConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore defaults');
    } finally {
      setRestoringDefaults(false);
    }
  };

  // Acronym handlers
  const handleAcronymsChange = (value: string) => {
    setEditedAcronyms(value);
    const originalText = Object.entries(acronymMappings?.mappings || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    setAcronymsModified(value !== originalText);
  };

  const parseAcronyms = (text: string): Record<string, string> => {
    const mappings: Record<string, string> = {};
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        mappings[key.trim().toLowerCase()] = valueParts.join('=').trim();
      }
    }
    return mappings;
  };

  const handleSaveAcronyms = async () => {
    if (!acronymsModified) return;

    setSavingSettings(true);
    setError(null);

    try {
      const mappings = parseAcronyms(editedAcronyms);
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'acronyms', settings: { mappings } }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save acronym mappings');
      }

      const result = await response.json();
      setAcronymMappings(result.settings);
      setAcronymsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save acronym mappings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetAcronyms = () => {
    if (acronymMappings) {
      setEditedAcronyms(
        Object.entries(acronymMappings.mappings)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      );
      setAcronymsModified(false);
    }
  };

  // Branding handlers
  const handleSaveBranding = async () => {
    if (!editedBranding || !brandingModified) return;

    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'branding', settings: editedBranding }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save branding settings');
      }

      const data = await response.json();
      setBrandingSettings(data.branding);
      setBrandingModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetBranding = () => {
    if (brandingSettings) {
      setEditedBranding({
        botName: brandingSettings.botName,
        botIcon: brandingSettings.botIcon,
        subtitle: brandingSettings.subtitle,
        welcomeTitle: brandingSettings.welcomeTitle,
        welcomeMessage: brandingSettings.welcomeMessage,
        accentColor: brandingSettings.accentColor,
      });
      setBrandingModified(false);
    }
  };

  // Reranker handlers
  const handleSaveReranker = async () => {
    if (!editedReranker || !rerankerModified) return;

    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reranker', settings: editedReranker }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save reranker settings');
      }

      const data = await response.json();
      setRerankerSettings(data.reranker);
      setRerankerModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reranker settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetReranker = () => {
    if (rerankerSettings) {
      setEditedReranker({
        enabled: rerankerSettings.enabled,
        provider: rerankerSettings.provider,
        topKForReranking: rerankerSettings.topKForReranking,
        minRerankerScore: rerankerSettings.minRerankerScore,
        cacheTTLSeconds: rerankerSettings.cacheTTLSeconds,
      });
      setRerankerModified(false);
    }
  };

  // Memory settings handlers
  const handleSaveMemory = async () => {
    if (!editedMemory || !memoryModified) return;

    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'memory', settings: editedMemory }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save memory settings');
      }

      const data = await response.json();
      setMemorySettings(data.memory);
      setMemoryModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetMemory = () => {
    if (memorySettings) {
      setEditedMemory({
        enabled: memorySettings.enabled,
        extractionThreshold: memorySettings.extractionThreshold,
        maxFactsPerCategory: memorySettings.maxFactsPerCategory,
        autoExtractOnThreadEnd: memorySettings.autoExtractOnThreadEnd,
        extractionMaxTokens: memorySettings.extractionMaxTokens,
      });
      setMemoryModified(false);
    }
  };

  // Summarization settings handlers
  const handleSaveSummarization = async () => {
    if (!editedSummarization || !summarizationModified) return;

    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'summarization', settings: editedSummarization }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save summarization settings');
      }

      const data = await response.json();
      setSummarizationSettings(data.summarization);
      setSummarizationModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save summarization settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetSummarization = () => {
    if (summarizationSettings) {
      setEditedSummarization({
        enabled: summarizationSettings.enabled,
        tokenThreshold: summarizationSettings.tokenThreshold,
        keepRecentMessages: summarizationSettings.keepRecentMessages,
        summaryMaxTokens: summarizationSettings.summaryMaxTokens,
        archiveOriginalMessages: summarizationSettings.archiveOriginalMessages,
      });
      setSummarizationModified(false);
    }
  };

  // Limits settings handlers
  const handleSaveLimits = async () => {
    if (!editedLimits || !limitsModified) return;
    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'limits', settings: editedLimits }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save limits settings');
      }

      const data = await response.json();
      setLimitsSettingsState(data.limits);
      setLimitsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save limits settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetLimits = () => {
    if (limitsSettings) {
      setEditedLimits({
        conversationHistoryMessages: limitsSettings.conversationHistoryMessages,
      });
      setLimitsModified(false);
    }
  };

  // Upload settings handlers
  const handleSaveUpload = async () => {
    if (!editedUpload || !uploadModified) return;
    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'uploadLimits', settings: editedUpload }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save upload settings');
      }

      const data = await response.json();
      setUploadSettingsState(data.uploadLimits);
      setUploadModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save upload settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetUpload = () => {
    if (uploadSettings) {
      setEditedUpload({
        maxFilesPerInput: uploadSettings.maxFilesPerInput,
        maxFilesPerThread: uploadSettings.maxFilesPerThread ?? 10,
        maxFileSizeMB: uploadSettings.maxFileSizeMB,
        allowedTypes: uploadSettings.allowedTypes || [],
      });
      setUploadModified(false);
    }
  };

  const handleToggleFileType = (type: string) => {
    if (!editedUpload) return;
    const currentTypes = editedUpload.allowedTypes || [];
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(t => t !== type)
      : [...currentTypes, type];
    setEditedUpload({ ...editedUpload, allowedTypes: newTypes });
    setUploadModified(true);
  };

  // Agent settings handlers
  const handleSaveAgent = async () => {
    if (!editedAgent || !agentModified) return;
    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedAgent),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save agent settings');
      }

      const data = await response.json();
      setAgentSettings(data.settings);
      setAgentModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetAgent = () => {
    if (agentSettings) {
      setEditedAgent({
        budgetMaxLlmCalls: agentSettings.budgetMaxLlmCalls,
        budgetMaxTokens: agentSettings.budgetMaxTokens,
        budgetMaxWebSearches: agentSettings.budgetMaxWebSearches,
        confidenceThreshold: agentSettings.confidenceThreshold,
        budgetMaxDurationMinutes: agentSettings.budgetMaxDurationMinutes,
        taskTimeoutMinutes: agentSettings.taskTimeoutMinutes,
        plannerModel: agentSettings.plannerModel,
        executorModel: agentSettings.executorModel,
        checkerModel: agentSettings.checkerModel,
        summarizerModel: agentSettings.summarizerModel,
        streamingKeepaliveInterval: agentSettings.streamingKeepaliveInterval ?? 10,
        streamingMaxDuration: agentSettings.streamingMaxDuration ?? 300,
        streamingToolTimeout: agentSettings.streamingToolTimeout ?? 60,
      });
      setAgentModified(false);
    }
  };

  const handleSaveTokenLimits = async () => {
    if (!editedTokenLimits || !tokenLimitsModified) return;
    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'token-limits', settings: editedTokenLimits }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save token limits settings');
      }

      const data = await response.json();
      setTokenLimitsSettingsState(data.tokenLimits);
      setTokenLimitsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token limits settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetTokenLimits = () => {
    if (tokenLimitsSettings) {
      setEditedTokenLimits({
        promptOptimizationMaxTokens: tokenLimitsSettings.promptOptimizationMaxTokens,
        skillsMaxTotalTokens: tokenLimitsSettings.skillsMaxTotalTokens,
        memoryExtractionMaxTokens: tokenLimitsSettings.memoryExtractionMaxTokens,
        summaryMaxTokens: tokenLimitsSettings.summaryMaxTokens,
        systemPromptMaxTokens: tokenLimitsSettings.systemPromptMaxTokens,
        categoryPromptMaxTokens: tokenLimitsSettings.categoryPromptMaxTokens,
        starterLabelMaxChars: tokenLimitsSettings.starterLabelMaxChars,
        starterPromptMaxChars: tokenLimitsSettings.starterPromptMaxChars,
        maxStartersPerCategory: tokenLimitsSettings.maxStartersPerCategory,
      });
      setTokenLimitsModified(false);
    }
  };

  // Utility functions
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Fuzzy search helper
  const fuzzyMatch = (pattern: string, text: string): number => {
    pattern = pattern.toLowerCase();
    text = text.toLowerCase();
    let patternIdx = 0;
    let score = 0;
    let lastMatchIdx = -1;
    for (let i = 0; i < text.length && patternIdx < pattern.length; i++) {
      if (text[i] === pattern[patternIdx]) {
        if (lastMatchIdx === i - 1) score += 2;
        else score += 1;
        if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '-' || text[i - 1] === '_') score += 3;
        lastMatchIdx = i;
        patternIdx++;
      }
    }
    return patternIdx < pattern.length ? -1 : score;
  };

  // Document search and sort logic
  const filteredAndSortedDocs = useMemo(() => {
    let result = [...documents];

    // Apply category filter
    if (docCategoryFilter !== 'all') {
      if (docCategoryFilter === 'global') {
        result = result.filter(doc => doc.isGlobal);
      } else if (docCategoryFilter === 'uncategorized') {
        result = result.filter(doc => !doc.isGlobal && (!doc.categories || doc.categories.length === 0));
      } else {
        // Filter by specific category ID
        result = result.filter(doc => doc.categories?.some(c => c.id === docCategoryFilter));
      }
    }

    // Apply fuzzy search
    if (docSearchTerm.trim()) {
      result = result
        .map(doc => ({
          doc,
          score: Math.max(
            fuzzyMatch(docSearchTerm, doc.filename),
            fuzzyMatch(docSearchTerm, doc.categories?.map(c => c.name).join(' ') || ''),
            fuzzyMatch(docSearchTerm, doc.status)
          ),
        }))
        .filter(r => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map(r => r.doc);
    }

    // Apply sorting from dropdown (takes precedence over column header sort)
    if (docSortOption && !docSearchTerm.trim()) {
      result.sort((a, b) => {
        switch (docSortOption) {
          case 'newest':
            return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
          case 'oldest':
            return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
          case 'largest':
            return b.size - a.size;
          case 'smallest':
            return a.size - b.size;
          case 'a-z':
            return a.filename.toLowerCase().localeCompare(b.filename.toLowerCase());
          case 'z-a':
            return b.filename.toLowerCase().localeCompare(a.filename.toLowerCase());
          default:
            return 0;
        }
      });
    } else if (docSortKey && docSortDirection) {
      // Apply column header sorting only if dropdown sort is not being used
      result.sort((a, b) => {
        let aVal: string | number | Date | undefined;
        let bVal: string | number | Date | undefined;

        switch (docSortKey) {
          case 'filename':
            aVal = a.filename.toLowerCase();
            bVal = b.filename.toLowerCase();
            break;
          case 'size':
            aVal = a.size;
            bVal = b.size;
            break;
          case 'chunkCount':
            aVal = a.chunkCount;
            bVal = b.chunkCount;
            break;
          case 'status':
            aVal = a.status;
            bVal = b.status;
            break;
          case 'uploadedAt':
            aVal = new Date(a.uploadedAt).getTime();
            bVal = new Date(b.uploadedAt).getTime();
            break;
          default:
            return 0;
        }

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return docSortDirection === 'asc' ? 1 : -1;
        if (bVal == null) return docSortDirection === 'asc' ? -1 : 1;

        let comparison = 0;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else {
          comparison = (aVal as number) - (bVal as number);
        }

        return docSortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [documents, docSearchTerm, docSortKey, docSortDirection, docCategoryFilter, docSortOption]);

  // Dashboard services filter and search
  const filteredDashboardServices = useMemo(() => {
    // Combine services from API with reranker status (filter out any null items)
    const allServices: ServiceStatus[] = [
      ...serviceStatus.filter(Boolean),
      ...rerankerStatus.filter(Boolean).map(r => ({
        category: 'reranker' as const,
        name: r.name,
        model: r.provider === 'cohere' ? 'rerank-english-v3.0' : 'Transformers.js',
        provider: r.provider === 'cohere' ? 'Cohere' : 'Local',
        available: r.available,
        configured: r.configured,
        error: r.error,
        latency: r.latency,
      })),
    ];

    let result = allServices;

    // Apply category filter
    if (dashboardCategoryFilter !== 'all') {
      result = result.filter(s => s.category === dashboardCategoryFilter);
    }

    // Apply provider filter
    if (dashboardProviderFilter !== 'all') {
      result = result.filter(s => s?.provider?.toLowerCase() === dashboardProviderFilter.toLowerCase());
    }

    // Apply search
    if (dashboardSearch.trim()) {
      const search = dashboardSearch.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(search) ||
        s.model.toLowerCase().includes(search)
      );
    }

    return result;
  }, [serviceStatus, rerankerStatus, dashboardCategoryFilter, dashboardProviderFilter, dashboardSearch]);

  // Get unique providers from services for filter dropdown
  const dashboardProviders = useMemo(() => {
    const allServices: ServiceStatus[] = [
      ...serviceStatus.filter(Boolean),
      ...rerankerStatus.filter(Boolean).map(r => ({
        category: 'reranker' as const,
        name: r.name,
        model: r.provider === 'cohere' ? 'rerank-english-v3.0' : 'Transformers.js',
        provider: r.provider === 'cohere' ? 'Cohere' : 'Local',
        available: r.available,
        configured: r.configured,
        error: r.error,
        latency: r.latency,
      })),
    ];
    const providers = new Set(allServices.map(s => s?.provider).filter(Boolean));
    return Array.from(providers).sort();
  }, [serviceStatus, rerankerStatus]);

  // Toggle sort for documents
  const handleDocSort = (key: keyof GlobalDocument) => {
    if (docSortKey === key) {
      if (docSortDirection === 'asc') {
        setDocSortDirection('desc');
      } else if (docSortDirection === 'desc') {
        setDocSortKey(null);
        setDocSortDirection(null);
      }
    } else {
      setDocSortKey(key);
      setDocSortDirection('asc');
    }
  };

  // Sortable header component
  const SortableDocHeader = ({ columnKey, label, className = '' }: { columnKey: keyof GlobalDocument; label: string; className?: string }) => {
    const isActive = docSortKey === columnKey;
    return (
      <th className={`px-6 py-3 font-medium ${className}`}>
        <button
          onClick={() => handleDocSort(columnKey)}
          className="flex items-center gap-1 hover:text-blue-600 transition-colors group"
        >
          {label}
          <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
            {isActive && docSortDirection === 'asc' ? (
              <ChevronUp size={14} className="text-blue-600" />
            ) : isActive && docSortDirection === 'desc' ? (
              <ChevronDown size={14} className="text-blue-600" />
            ) : (
              <ChevronsUpDown size={14} className="text-gray-400" />
            )}
          </span>
        </button>
      </th>
    );
  };

  if (docLoading && userLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 h-16">
        <div className="h-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-sm text-gray-500 hidden sm:block">
                Manage documents and users
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout with Sidebar */}
      <div className="flex">
        {/* Sidebar Navigation */}
        <AdminSidebarMenu
          activeTab={activeTab}
          settingsSection={settingsSection}
          promptsSection={promptsSection}
          toolsSection={toolsSection}
          onTabChange={setActiveTab}
          onSettingsChange={setSettingsSection}
          onPromptsChange={setPromptsSection}
          onToolsChange={setToolsSection}
        />

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600"
            >
              &times;
            </button>
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Active Configuration Card */}
            <div className="bg-white rounded-lg border shadow-sm">
              <div className="px-6 py-4 border-b">
                <h2 className="font-semibold text-gray-900">Active Configuration</h2>
                <p className="text-sm text-gray-500">Currently selected services and models</p>
              </div>
              <div className="p-6">
                {settingsLoading ? (
                  <div className="py-4 flex justify-center">
                    <Spinner size="md" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* LLM */}
                    <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Cpu size={20} className="text-blue-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">LLM</p>
                        <p className="text-sm font-semibold text-gray-900 truncate" title={llmSettings?.model || 'Not configured'}>
                          {llmSettings?.model || 'Not configured'}
                        </p>
                        <p className="text-xs text-gray-500">
                          Temp: {llmSettings?.temperature ?? '-'} | Max tokens: {llmSettings?.maxTokens ?? '-'}
                        </p>
                      </div>
                    </div>

                    {/* Embedding */}
                    <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Database size={20} className="text-purple-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Embedding</p>
                        <p className="text-sm font-semibold text-gray-900 truncate" title={embeddingSettings?.model || 'Not configured'}>
                          {embeddingSettings?.model || 'Not configured'}
                        </p>
                        <p className="text-xs text-gray-500">
                          Dimensions: {embeddingSettings?.dimensions ?? '-'}
                        </p>
                      </div>
                    </div>

                    {/* Reranker */}
                    <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                      <div className={`p-2 rounded-lg ${rerankerSettings?.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                        <Sparkles size={20} className={rerankerSettings?.enabled ? 'text-green-600' : 'text-gray-400'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Reranker</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {rerankerSettings?.enabled ? (
                            <span className="capitalize">{rerankerSettings.provider}</span>
                          ) : (
                            <span className="text-gray-500">Disabled</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {rerankerSettings?.enabled
                            ? `Top-K: ${rerankerSettings.topKForReranking} | Min score: ${rerankerSettings.minRerankerScore}`
                            : 'Enable in Settings'}
                        </p>
                      </div>
                    </div>

                    {/* Transcription */}
                    <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                      <div className="p-2 bg-orange-100 rounded-lg">
                        <Mic size={20} className="text-orange-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transcription</p>
                        <p className="text-sm font-semibold text-gray-900 truncate" title={transcriptionModel}>
                          {transcriptionModel}
                        </p>
                        <p className="text-xs text-gray-500">
                          OpenAI Whisper
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* System Status Card */}
            <div className="bg-white rounded-lg border shadow-sm">
              <div className="px-6 py-4 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900">System Status</h2>
                    <p className="text-sm text-gray-500">
                      {dashboardCategoryFilter !== 'all' || dashboardProviderFilter !== 'all' || dashboardSearch
                        ? `${filteredDashboardServices.length} of ${serviceStatus.length + rerankerStatus.length} services`
                        : `${serviceStatus.length + rerankerStatus.length} services`}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      loadProviders();
                      loadRerankerStatus();
                    }}
                    disabled={providersLoading || rerankerStatusLoading}
                  >
                    <RefreshCw size={16} className={`mr-2 ${(providersLoading || rerankerStatusLoading) ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="p-6">
                {/* Status Legend */}
                <div className="flex gap-6 text-sm mb-4 pb-4 border-b">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                    Available
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />
                    Configured (error)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-gray-400 rounded-full" />
                    Not Configured
                  </span>
                </div>

                {/* Filters and Search */}
                <div className="flex flex-wrap gap-4 mb-4">
                  {/* Category Filter */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-600">Category:</label>
                    <select
                      value={dashboardCategoryFilter}
                      onChange={(e) => setDashboardCategoryFilter(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      <option value="llm">LLM</option>
                      <option value="embedding">Embedding</option>
                      <option value="transcribe">Transcribe</option>
                      <option value="ocr">OCR</option>
                      <option value="reranker">Reranker</option>
                    </select>
                  </div>

                  {/* Provider Filter */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-600">Provider:</label>
                    <select
                      value={dashboardProviderFilter}
                      onChange={(e) => setDashboardProviderFilter(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All</option>
                      {dashboardProviders.map(p => (
                        <option key={p} value={p.toLowerCase()}>{p}</option>
                      ))}
                    </select>
                  </div>

                  {/* Search */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={dashboardSearch}
                        onChange={(e) => setDashboardSearch(e.target.value)}
                        placeholder="Search service / model..."
                        className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {dashboardSearch && (
                        <button
                          onClick={() => setDashboardSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status Table */}
                {(providersLoading || rerankerStatusLoading) ? (
                  <div className="py-12 flex justify-center">
                    <Spinner size="lg" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Provider</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Service / Model</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredDashboardServices.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                              No services match your filters
                            </td>
                          </tr>
                        ) : (
                          filteredDashboardServices.filter(Boolean).map((service, idx) => (
                            <tr key={`${service.category}-${service.model}-${idx}`} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-500 capitalize">{service.category}</td>
                              <td className="px-4 py-3 font-medium text-gray-900 capitalize">{service.provider}</td>
                              <td className="px-4 py-3 text-gray-600">
                                <div>{service.name}</div>
                                <div className="text-xs text-gray-400">{service.model}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                  service.available
                                    ? 'bg-green-100 text-green-800'
                                    : service.configured
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  <span className={`w-2 h-2 rounded-full ${
                                    service.available ? 'bg-green-500' : service.configured ? 'bg-yellow-500' : 'bg-gray-400'
                                  }`} />
                                  {service.available
                                    ? (service.latency ? `${service.latency}ms` : 'Online')
                                    : service.configured ? 'Error' : 'N/A'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Error Details */}
                {(() => {
                  const errors = filteredDashboardServices
                    .filter(s => s && !s.available && s.error)
                    .map(s => ({ category: s.category, provider: s.name, error: s.error! }));

                  if (errors.length === 0) return null;

                  return (
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center gap-2 text-sm font-medium text-yellow-700 mb-2">
                        <AlertCircle size={16} />
                        Errors ({errors.length})
                      </div>
                      <div className="space-y-1 text-sm">
                        {errors.map((err, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-gray-600">
                            <span className="text-gray-400">•</span>
                            <span><span className="font-medium capitalize">{err.category} - {err.provider}:</span> {err.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Knowledge Base Documents</h2>
                  <p className="text-sm text-gray-500">
                    {docSearchTerm ? `${filteredAndSortedDocs.length} of ${documents.length}` : documents.length} documents, {totalChunks} chunks indexed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={refreshingAll || documents.length === 0}
                    loading={refreshingAll}
                    onClick={handleRefreshAll}
                    title="Clear cache and reindex all documents"
                  >
                    <RefreshCw size={18} className={`mr-2 ${refreshingAll ? 'animate-spin' : ''}`} />
                    {refreshingAll ? 'Refreshing...' : 'Refresh All'}
                  </Button>
                  <Button
                    disabled={uploading}
                    loading={uploading}
                    onClick={() => {
                      setUploadMode('file');
                      setUploadFile(null);
                      setUploadTextName('');
                      setUploadTextContent('');
                      setUploadCategoryIds([]);
                      setUploadIsGlobal(false);
                      setShowUploadModal(true);
                    }}
                  >
                    <Upload size={18} className="mr-2" />
                    {uploadProgress || 'Upload Document'}
                  </Button>
                </div>
              </div>
              {/* Search, Filter, and Sort controls */}
              {documents.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {/* Search bar */}
                  <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={docSearchTerm}
                      onChange={(e) => setDocSearchTerm(e.target.value)}
                      placeholder="Search documents..."
                      className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {docSearchTerm && (
                      <button
                        onClick={() => setDocSearchTerm('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Category Filter */}
                  <div className="flex items-center gap-2">
                    <Filter size={16} className="text-gray-400" />
                    <select
                      value={docCategoryFilter === 'all' ? 'all' : docCategoryFilter === 'global' ? 'global' : docCategoryFilter === 'uncategorized' ? 'uncategorized' : String(docCategoryFilter)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'all' || val === 'global' || val === 'uncategorized') {
                          setDocCategoryFilter(val);
                        } else {
                          setDocCategoryFilter(parseInt(val, 10));
                        }
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    >
                      <option value="all">All Categories</option>
                      <option value="global">Global</option>
                      <option value="uncategorized">Uncategorized</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Sort Dropdown */}
                  <div className="flex items-center gap-2">
                    <SortAsc size={16} className="text-gray-400" />
                    <select
                      value={docSortOption}
                      onChange={(e) => setDocSortOption(e.target.value as typeof docSortOption)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="largest">Largest First</option>
                      <option value="smallest">Smallest First</option>
                      <option value="a-z">Name (A-Z)</option>
                      <option value="z-a">Name (Z-A)</option>
                    </select>
                  </div>

                  {/* Clear filters button */}
                  {(docCategoryFilter !== 'all' || docSearchTerm) && (
                    <button
                      onClick={() => {
                        setDocCategoryFilter('all');
                        setDocSearchTerm('');
                      }}
                      className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {documents.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No documents yet</h3>
                <p className="text-gray-500 mb-4">
                  Upload PDF documents to build your policy knowledge base
                </p>
              </div>
            ) : filteredAndSortedDocs.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No matching documents</h3>
                <p className="text-gray-500 mb-4">
                  Try adjusting your search or filter criteria
                </p>
                <button
                  onClick={() => {
                    setDocCategoryFilter('all');
                    setDocSearchTerm('');
                  }}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 text-left text-sm text-gray-600">
                    <tr>
                      <SortableDocHeader columnKey="filename" label="Document" />
                      <th className="px-6 py-3 font-medium">Categories</th>
                      <SortableDocHeader columnKey="size" label="Size" />
                      <SortableDocHeader columnKey="chunkCount" label="Chunks" />
                      <SortableDocHeader columnKey="status" label="Status" />
                      <SortableDocHeader columnKey="uploadedAt" label="Uploaded" />
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredAndSortedDocs.map((doc) => (
                      <tr key={doc.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-blue-600" />
                            <span className="font-medium text-gray-900">{doc.filename}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {doc.isGlobal && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                                <Globe size={10} />
                                Global
                              </span>
                            )}
                            {doc.categories && doc.categories.length > 0 ? (
                              doc.categories.map(cat => (
                                <span
                                  key={cat.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full"
                                >
                                  <Tag size={10} />
                                  {cat.name}
                                </span>
                              ))
                            ) : !doc.isGlobal ? (
                              <span className="text-gray-400 text-xs italic">Uncategorized</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {formatFileSize(doc.size)}
                        </td>
                        <td className="px-6 py-4 text-gray-600">{doc.chunkCount}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                              doc.status === 'ready'
                                ? 'bg-green-100 text-green-700'
                                : doc.status === 'processing'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {doc.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {formatDate(doc.uploadedAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <a
                              href={`/api/admin/documents/${doc.id}/download`}
                              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                              title="Download"
                              download
                            >
                              <Download size={16} />
                            </a>
                            <button
                              onClick={() => handleEditDoc(doc)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Edit categories"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleReindex(doc.id)}
                              disabled={reindexing === doc.id}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                              title="Reindex"
                            >
                              {reindexing === doc.id ? (
                                <Spinner size="sm" />
                              ) : (
                                <RefreshCw size={16} />
                              )}
                            </button>
                            <button
                              onClick={() => setDeleteDoc(doc)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Document Categories</h2>
                  <p className="text-sm text-gray-500">
                    {categories.length} categories defined
                  </p>
                </div>
                <Button onClick={() => setShowAddCategory(true)}>
                  <Plus size={18} className="mr-2" />
                  Add Category
                </Button>
              </div>
            </div>

            {categoryLoading ? (
              <div className="px-6 py-12 flex justify-center">
                <Spinner size="lg" />
              </div>
            ) : categories.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No categories yet</h3>
                <p className="text-gray-500 mb-4">
                  Create categories to organize documents and control user access
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 text-left text-sm text-gray-600">
                    <tr>
                      <th className="px-6 py-3 font-medium">Category</th>
                      <th className="px-6 py-3 font-medium">Slug</th>
                      <th className="px-6 py-3 font-medium">Documents</th>
                      <th className="px-6 py-3 font-medium">Super Users</th>
                      <th className="px-6 py-3 font-medium">Subscribers</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {categories.map((cat) => (
                      <tr key={cat.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <FolderOpen className="w-5 h-5 text-blue-600" />
                            <div>
                              <span className="font-medium text-gray-900">{cat.name}</span>
                              {cat.description && (
                                <p className="text-sm text-gray-500">{cat.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600 font-mono text-sm">
                          {cat.slug}
                        </td>
                        <td className="px-6 py-4 text-gray-600">{cat.documentCount}</td>
                        <td className="px-6 py-4 text-gray-600">{cat.superUserCount}</td>
                        <td className="px-6 py-4 text-gray-600">{cat.subscriberCount}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleEditCategory(cat)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Edit"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteCategory(cat)}
                              disabled={cat.documentCount > 0}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                              title={cat.documentCount > 0 ? 'Remove documents first' : 'Delete'}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Allowed Users</h2>
                  <p className="text-sm text-gray-500">
                    {users.length} users with access
                  </p>
                </div>
                <Button onClick={() => setShowAddUser(true)}>
                  <UserPlus size={18} className="mr-2" />
                  Add User
                </Button>
              </div>
            </div>

            {users.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No users yet</h3>
                <p className="text-gray-500 mb-4">
                  Add users to grant them access to the application
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 text-left text-sm text-gray-600">
                    <tr>
                      <th className="px-6 py-3 font-medium">User</th>
                      <th className="px-6 py-3 font-medium">Role</th>
                      <th className="px-6 py-3 font-medium">Categories</th>
                      <th className="px-6 py-3 font-medium">Added</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((user) => (
                      <tr key={user.email} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              user.role === 'admin' ? 'bg-purple-100' :
                              user.role === 'superuser' ? 'bg-orange-100' : 'bg-gray-100'
                            }`}>
                              {user.role === 'admin' ? (
                                <Shield size={16} className="text-purple-600" />
                              ) : user.role === 'superuser' ? (
                                <UserPlus size={16} className="text-orange-600" />
                              ) : (
                                <User size={16} className="text-gray-600" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">
                                {user.name || user.email.split('@')[0]}
                              </p>
                              <p className="text-sm text-gray-500">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                              user.role === 'admin'
                                ? 'bg-purple-100 text-purple-700'
                                : user.role === 'superuser'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {user.role === 'superuser' ? 'super user' : user.role}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {user.role === 'admin' ? (
                              <span className="text-gray-400 text-xs italic">All access</span>
                            ) : user.role === 'superuser' ? (
                              <>
                                {/* Assigned categories for management */}
                                {user.assignedCategories && user.assignedCategories.length > 0 ? (
                                  user.assignedCategories.map(cat => (
                                    <span
                                      key={`assigned-${cat.categoryId}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full"
                                      title="Manages this category"
                                    >
                                      <FolderOpen size={10} />
                                      {cat.categoryName}
                                    </span>
                                  ))
                                ) : null}
                                {/* Subscriptions for read access */}
                                {user.subscriptions && user.subscriptions.length > 0 ? (
                                  user.subscriptions.map(sub => (
                                    <span
                                      key={`sub-${sub.categoryId}`}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                                        sub.isActive
                                          ? 'bg-blue-100 text-blue-700'
                                          : 'bg-gray-100 text-gray-500'
                                      }`}
                                      title="Subscribed (read access)"
                                    >
                                      <Tag size={10} />
                                      {sub.categoryName}
                                    </span>
                                  ))
                                ) : null}
                                {/* Show message if no categories at all */}
                                {(!user.assignedCategories || user.assignedCategories.length === 0) &&
                                 (!user.subscriptions || user.subscriptions.length === 0) && (
                                  <span className="text-gray-400 text-xs italic">No categories</span>
                                )}
                              </>
                            ) : (
                              user.subscriptions && user.subscriptions.length > 0 ? (
                                user.subscriptions.map(sub => (
                                  <span
                                    key={sub.categoryId}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                                      sub.isActive
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    <Tag size={10} />
                                    {sub.categoryName}
                                  </span>
                                ))
                              ) : (
                                <span className="text-gray-400 text-xs italic">No subscriptions</span>
                              )
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {formatDate(user.addedAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            {user.role !== 'admin' && (
                              <button
                                onClick={() => handleManageUserSubs(user)}
                                className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                                title={user.role === 'superuser' ? 'Manage assigned categories' : 'Manage subscriptions'}
                              >
                                <FolderOpen size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => setEditingUser(user)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Change role"
                            >
                              <Shield size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteUser(user)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Remove user"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <>
              {/* LLM Settings Section */}
              {settingsSection === 'llm' && (
                <div className="space-y-4">
                  {/* LLM Settings Card */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div
                      className="px-6 py-4 border-b cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setLlmSettingsExpanded(!llmSettingsExpanded)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button className="p-1 hover:bg-gray-100 rounded">
                            {llmSettingsExpanded ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
                          </button>
                          <div>
                            <h2 className="font-semibold text-gray-900">LLM Settings</h2>
                            <p className="text-sm text-gray-500">Configure the language model parameters</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="secondary"
                            onClick={() => setShowRestoreConfirm(true)}
                            disabled={restoringDefaults}
                            className="text-orange-600 border-orange-300 hover:bg-orange-50"
                          >
                            <RefreshCw size={16} className="mr-2" />
                            Reset All
                          </Button>
                          {llmModified && (
                            <Button variant="secondary" onClick={handleResetLlm} disabled={savingSettings}>
                              Reset
                            </Button>
                          )}
                          <Button onClick={handleSaveLlm} disabled={!llmModified || savingSettings} loading={savingSettings}>
                            <Save size={18} className="mr-2" />
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                    {llmSettingsExpanded && (settingsLoading ? (
                      <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                    ) : editedLlm && (
                      <div className="p-6 space-y-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
                        <select
                          value={editedLlm.model}
                          onChange={(e) => handleLlmChange('model', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          {availableModels.filter(Boolean).map((model) => {
                            const status = providerStatus[model.provider];
                            const available = status?.available ?? true;
                            return (
                              <option
                                key={model.id}
                                value={model.id}
                                disabled={!available}
                              >
                                {model.name} {!available ? '(unavailable)' : ''}
                              </option>
                            );
                          })}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          {availableModels.find(m => m.id === editedLlm.model)?.description}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Temperature: {editedLlm.temperature}
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={editedLlm.temperature}
                          onChange={(e) => handleLlmChange('temperature', parseFloat(e.target.value))}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>0 (Deterministic)</span>
                          <span>2 (Creative)</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Max Tokens</label>
                        <input
                          type="number"
                          min="100"
                          max="16000"
                          value={editedLlm.maxTokens}
                          onChange={(e) => handleLlmChange('maxTokens', parseInt(e.target.value) || 2000)}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Maximum length of generated responses (100-16000)</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Prompt Optimization Max Tokens</label>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-medium text-gray-900">{editedLlm.promptOptimizationMaxTokens.toLocaleString()}</span>
                          <span className="text-xs text-gray-400">tokens</span>
                        </div>
                        <p className="mt-1 text-xs text-blue-500">Configure in Settings → Limits → Token Limits</p>
                      </div>
                      {llmSettings && (
                          <p className="text-xs text-gray-500 pt-4 border-t">
                            Last updated: {formatDate(llmSettings.updatedAt)} by {llmSettings.updatedBy}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Multimodal/Vision Support Info Card */}
                  <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                    <div className="flex items-start gap-3">
                      <ImageIcon className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <h3 className="font-medium text-blue-900">Image/Vision Support</h3>
                        <p className="text-sm text-blue-700 mt-1">
                          Users can upload images (PNG, JPG, WebP) in chat. Images are sent visually to the LLM for analysis.
                        </p>
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">✓ Vision</span>
                            <span className="text-blue-800">GPT-4.1 family, Gemini 2.5/3, Mistral Large 3, Mistral Small 3.2</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">— No Vision</span>
                            <span className="text-blue-800">Ollama models (text-only fallback via OCR)</span>
                          </div>
                        </div>
                        <p className="text-xs text-blue-600 mt-3">
                          Note: LiteLLM proxy handles format conversion between providers automatically.
                          Models without vision support will receive OCR-extracted text instead.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Per-Model Token Limits Card */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div
                      className="px-6 py-4 border-b cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setLlmTokenLimitsExpanded(!llmTokenLimitsExpanded)}
                    >
                      <div className="flex items-center gap-3">
                        <button className="p-1 hover:bg-gray-100 rounded">
                          {llmTokenLimitsExpanded ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
                        </button>
                        <div>
                          <h2 className="font-semibold text-gray-900">Per-Model Token Limits</h2>
                          <p className="text-sm text-gray-500">Override default max tokens for specific models</p>
                        </div>
                      </div>
                    </div>
                    {llmTokenLimitsExpanded && (settingsLoading ? (
                      <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                    ) : (
                      <div className="p-6">
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead>
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Default</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Limit</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {availableModels.filter(Boolean).map((model) => {
                                const modelId = model.id;
                                const modelDefault = model.defaultMaxTokens;
                                const currentValue = editedModelTokens[modelId];
                                const isCustom = currentValue !== undefined && currentValue !== 'default';
                                const savedValue = modelTokenLimits?.limits?.[modelId];
                                const isModified = currentValue !== (savedValue ?? 'default');

                                return (
                                  <tr key={modelId} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                      {model.name}
                                      <span className="text-xs text-gray-400 ml-2">({modelId})</span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500">
                                      {modelDefault.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min="100"
                                          max="16000"
                                          value={isCustom ? currentValue : ''}
                                          placeholder={modelDefault.toString()}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '') {
                                              handleModelTokenChange(modelId, 'default');
                                            } else {
                                              handleModelTokenChange(modelId, parseInt(val) || modelDefault);
                                            }
                                          }}
                                          className="w-24 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                        {isCustom && (
                                          <span className="text-xs text-blue-600 font-medium">Custom</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        {isModified && (
                                          <Button
                                            size="sm"
                                            onClick={() => handleSaveModelToken(modelId)}
                                            disabled={savingModelTokens}
                                            loading={savingModelTokens}
                                          >
                                            <Save size={14} className="mr-1" />
                                            Save
                                          </Button>
                                        )}
                                        {isCustom && (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => handleResetModelToken(modelId)}
                                            disabled={savingModelTokens}
                                          >
                                            Reset
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {modelTokenLimits?.updatedAt && (
                          <p className="text-xs text-gray-500 mt-4 pt-4 border-t">
                            Last updated: {formatDate(modelTokenLimits.updatedAt)} by {modelTokenLimits.updatedBy}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RAG Settings Section */}
              {settingsSection === 'rag' && (
                <div className="space-y-4">
                  {/* Embedding Model Info Card */}
                  <div className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <Cpu size={20} className="text-purple-600" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-gray-900">Active Embedding Model</h3>
                          <p className="text-sm text-gray-600">
                            {embeddingSettings?.model || 'Not configured'}
                            {embeddingSettings?.dimensions && (
                              <span className="text-gray-400 ml-2">({embeddingSettings.dimensions} dimensions)</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {embeddingSettings?.updatedAt && (
                          <span>Updated: {formatDate(embeddingSettings.updatedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* RAG Configuration Card */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div className="px-6 py-4 border-b">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="font-semibold text-gray-900">RAG</h2>
                          <p className="text-sm text-gray-500">Configure retrieval and chunking parameters</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {ragModified && (
                            <Button variant="secondary" onClick={handleResetRag} disabled={savingSettings}>
                              Reset
                            </Button>
                          )}
                          <Button onClick={handleSaveRag} disabled={!ragModified || savingSettings} loading={savingSettings}>
                            <Save size={18} className="mr-2" />
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                    {settingsLoading ? (
                      <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                    ) : editedRag && (
                      <div className="p-6 space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Top K Chunks</label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={editedRag.topKChunks}
                            onChange={(e) => handleRagChange('topKChunks', parseInt(e.target.value) || 15)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Chunks retrieved per query (1-50)</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Max Context Chunks</label>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={editedRag.maxContextChunks}
                            onChange={(e) => handleRagChange('maxContextChunks', parseInt(e.target.value) || 12)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Max chunks sent to LLM (1-30)</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Similarity Threshold: {editedRag.similarityThreshold}
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={editedRag.similarityThreshold}
                            onChange={(e) => handleRagChange('similarityThreshold', parseFloat(e.target.value))}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>0 (All)</span>
                            <span>1 (Exact)</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Cache TTL (seconds)</label>
                          <input
                            type="number"
                            min="0"
                            max="86400"
                            value={editedRag.cacheTTLSeconds}
                            onChange={(e) => handleRagChange('cacheTTLSeconds', parseInt(e.target.value) || 3600)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Response cache duration (0-86400)</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Chunk Size</label>
                          <input
                            type="number"
                            min="100"
                            max="2000"
                            value={editedRag.chunkSize}
                            onChange={(e) => handleRagChange('chunkSize', parseInt(e.target.value) || 500)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Characters per chunk (100-2000)</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Chunk Overlap</label>
                          <input
                            type="number"
                            min="0"
                            max={editedRag.chunkSize / 2}
                            value={editedRag.chunkOverlap}
                            onChange={(e) => handleRagChange('chunkOverlap', parseInt(e.target.value) || 50)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Overlap between chunks</p>
                        </div>
                      </div>
                      <div className="flex gap-6 pt-4 border-t">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editedRag.queryExpansionEnabled}
                            onChange={(e) => handleRagChange('queryExpansionEnabled', e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">Query Expansion (acronyms)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editedRag.cacheEnabled}
                            onChange={(e) => handleRagChange('cacheEnabled', e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">Response Caching</span>
                        </label>
                      </div>
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm text-yellow-800">
                          Chunk size/overlap changes only affect new documents. Use &quot;Refresh All&quot; on the Documents tab to reindex existing documents.
                        </p>
                      </div>
                      {ragSettings && (
                        <p className="text-xs text-gray-500 pt-4 border-t">
                          Last updated: {formatDate(ragSettings.updatedAt)} by {ragSettings.updatedBy}
                        </p>
                      )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* RAG Tuning Section */}
              {settingsSection === 'rag-tuning' && (
                <RagTuningDashboard />
              )}

              {/* Branding Section */}
              {settingsSection === 'branding' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Branding</h2>
                        <p className="text-sm text-gray-500">Customize the bot&apos;s name and icon</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {brandingModified && (
                          <Button variant="secondary" onClick={handleResetBranding} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveBranding} disabled={!brandingModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedBranding ? (
                    <div className="p-6 space-y-6">
                      {/* Bot Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Bot Name</label>
                        <input
                          type="text"
                          value={editedBranding.botName}
                          onChange={(e) => {
                            setEditedBranding({ ...editedBranding, botName: e.target.value });
                            setBrandingModified(true);
                          }}
                          placeholder="Policy Bot"
                          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">This name appears in the sidebar header</p>
                      </div>

                      {/* Bot Icon */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Bot Icon</label>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                          {BRANDING_ICONS.map(({ key, label, Icon }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setEditedBranding({ ...editedBranding, botIcon: key });
                                setBrandingModified(true);
                              }}
                              className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all ${
                                editedBranding.botIcon === key
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600'
                              }`}
                            >
                              <Icon size={24} />
                              <span className="mt-1 text-xs">{label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Subtitle */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Header Subtitle
                          <span className="ml-1 text-xs text-gray-400 font-normal">
                            ({(editedBranding.subtitle || '').length}/100 chars)
                          </span>
                        </label>
                        <input
                          type="text"
                          value={editedBranding.subtitle || ''}
                          onChange={(e) => {
                            setEditedBranding({ ...editedBranding, subtitle: e.target.value || undefined });
                            setBrandingModified(true);
                          }}
                          maxLength={100}
                          placeholder="Ask questions about policy documents"
                          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Custom subtitle shown below the header title (optional)
                        </p>
                      </div>

                      {/* Global Welcome Message */}
                      <div className="border-t pt-4">
                        <label className="block text-sm font-medium text-gray-900 mb-3">
                          Global Welcome Screen
                        </label>
                        <p className="text-xs text-gray-500 mb-3">
                          Default welcome message shown when no category-specific welcome is configured.
                        </p>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Welcome Title
                              <span className="ml-1 text-gray-400 font-normal">
                                ({(editedBranding.welcomeTitle || '').length}/50 chars)
                              </span>
                            </label>
                            <input
                              type="text"
                              value={editedBranding.welcomeTitle || ''}
                              onChange={(e) => {
                                setEditedBranding({ ...editedBranding, welcomeTitle: e.target.value || undefined });
                                setBrandingModified(true);
                              }}
                              maxLength={50}
                              placeholder="e.g., Welcome to Policy Bot"
                              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Welcome Message
                              <span className="ml-1 text-gray-400 font-normal">
                                ({(editedBranding.welcomeMessage || '').length}/200 chars)
                              </span>
                            </label>
                            <textarea
                              value={editedBranding.welcomeMessage || ''}
                              onChange={(e) => {
                                setEditedBranding({ ...editedBranding, welcomeMessage: e.target.value || undefined });
                                setBrandingModified(true);
                              }}
                              maxLength={200}
                              rows={2}
                              placeholder="e.g., How can I help you with policy questions today?"
                              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Accent Color */}
                      <div className="border-t pt-4">
                        <label className="block text-sm font-medium text-gray-900 mb-3">
                          Accent Color
                        </label>
                        <p className="text-xs text-gray-500 mb-3">
                          Primary color used for buttons, links, and interactive elements throughout the UI.
                        </p>
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <input
                              type="color"
                              value={editedBranding.accentColor || '#2563eb'}
                              onChange={(e) => {
                                setEditedBranding({ ...editedBranding, accentColor: e.target.value });
                                setBrandingModified(true);
                              }}
                              className="w-14 h-14 rounded-lg cursor-pointer border-2 border-gray-200 p-1"
                              title="Choose accent color"
                            />
                          </div>
                          <div className="flex-1 max-w-xs">
                            <label className="block text-xs text-gray-500 mb-1">Hex Value</label>
                            <input
                              type="text"
                              value={editedBranding.accentColor || '#2563eb'}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (/^#[0-9A-Fa-f]{0,6}$/.test(value)) {
                                  setEditedBranding({ ...editedBranding, accentColor: value });
                                  setBrandingModified(true);
                                }
                              }}
                              placeholder="#2563eb"
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            />
                          </div>
                        </div>
                        {/* Quick presets */}
                        <div className="mt-3">
                          <p className="text-xs text-gray-500 mb-2">Quick presets:</p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { color: '#2563eb', label: 'Blue' },
                              { color: '#059669', label: 'Green' },
                              { color: '#7c3aed', label: 'Purple' },
                              { color: '#ea580c', label: 'Orange' },
                              { color: '#dc2626', label: 'Red' },
                              { color: '#1f2937', label: 'Dark' },
                            ].map(({ color, label }) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => {
                                  setEditedBranding({ ...editedBranding, accentColor: color });
                                  setBrandingModified(true);
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                                  editedBranding.accentColor === color
                                    ? 'border-gray-900 ring-1 ring-gray-900'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                <span
                                  className="w-4 h-4 rounded-full border border-gray-200"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="text-xs text-gray-700">{label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Preview */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Preview</label>
                        <div className="inline-flex items-center gap-2 px-4 py-3 bg-gray-100 rounded-lg">
                          {(() => {
                            const iconData = BRANDING_ICONS.find(i => i.key === editedBranding.botIcon);
                            const accentColor = editedBranding.accentColor || '#2563eb';
                            if (iconData) {
                              const IconComponent = iconData.Icon;
                              return <IconComponent size={24} style={{ color: accentColor }} />;
                            }
                            return <ScrollText size={24} style={{ color: accentColor }} />;
                          })()}
                          <span className="text-xl font-bold text-gray-900">{editedBranding.botName || 'Policy Bot'}</span>
                        </div>
                        {/* Button preview */}
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
                            style={{ backgroundColor: editedBranding.accentColor || '#2563eb' }}
                          >
                            Send Message
                          </button>
                          <span className="text-xs text-gray-500">Button preview</span>
                        </div>
                      </div>

                      {/* Last Updated */}
                      {brandingSettings?.updatedAt && (
                        <p className="text-xs text-gray-500">
                          Last updated: {formatDate(brandingSettings.updatedAt)} by {brandingSettings.updatedBy}
                        </p>
                      )}

                      {/* PWA Icons - Auto-set from Bot Icon */}
                      <div className="mt-6 pt-6 border-t">
                        <label className="block text-sm font-medium text-gray-900 mb-2">
                          PWA App Icons
                        </label>
                        <p className="text-xs text-gray-500 mb-4">
                          App icons are automatically set from the selected bot icon above.
                        </p>

                        {(() => {
                          const selectedIcon = BRANDING_ICONS.find(i => i.key === editedBranding.botIcon);
                          if (!selectedIcon) return null;
                          return (
                            <div className="grid grid-cols-2 gap-4">
                              {/* 192x192 Preview */}
                              <div>
                                <p className="text-xs font-medium text-gray-700 mb-2">192×192</p>
                                <div className="flex items-center justify-center h-24 bg-gray-50 border rounded-lg">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={selectedIcon.png192}
                                    alt="192x192 icon preview"
                                    className="w-12 h-12 object-contain"
                                  />
                                </div>
                              </div>

                              {/* 512x512 Preview */}
                              <div>
                                <p className="text-xs font-medium text-gray-700 mb-2">512×512</p>
                                <div className="flex items-center justify-center h-24 bg-gray-50 border rounded-lg">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={selectedIcon.png512}
                                    alt="512x512 icon preview"
                                    className="w-16 h-16 object-contain"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        <p className="text-xs text-gray-400 mt-3">
                          Icons will be updated when you save branding settings.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Reranker Section */}
              {settingsSection === 'reranker' && (
                <div className="space-y-4">
                  {/* Reranker Status Dashboard */}
                  <div className="bg-white rounded-lg border shadow-sm p-4">
                    <h3 className="text-sm font-medium text-gray-900 mb-3">Reranker Status</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {rerankerStatus.map((status) => (
                        <div key={status.provider} className={`p-3 rounded-lg border ${
                          status.available ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                        }`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${status.available ? 'bg-green-500' : 'bg-gray-400'}`} />
                              <span className="font-medium text-gray-900">{status.name}</span>
                            </div>
                            {editedReranker?.provider === status.provider && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Active</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {status.available ? 'Available' : (status.error || 'Unavailable')}
                            {status.latency && ` • ${status.latency}ms`}
                          </p>
                        </div>
                      ))}
                      {rerankerStatus.length === 0 && (
                        <p className="text-sm text-gray-500 col-span-2">No reranker providers found</p>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                      <span className="font-medium">Default:</span> {editedReranker?.provider === 'cohere' ? 'Cohere API' : 'Local'} •
                      <span className="font-medium ml-2">Fallback:</span> {editedReranker?.provider === 'cohere' ? 'Local' : 'None'}
                    </div>
                  </div>

                  {/* Reranker Configuration Card */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div className="px-6 py-4 border-b">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="font-semibold text-gray-900">Reranker</h2>
                          <p className="text-sm text-gray-500">Configure document reranking for improved RAG quality</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {rerankerModified && (
                            <Button variant="secondary" onClick={handleResetReranker} disabled={savingSettings}>
                              Reset
                            </Button>
                          )}
                          <Button onClick={handleSaveReranker} disabled={!rerankerModified || savingSettings} loading={savingSettings}>
                            <Save size={18} className="mr-2" />
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                    {settingsLoading ? (
                      <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                    ) : editedReranker ? (
                      <div className="p-6 space-y-6">
                        {/* Enable/Disable Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="font-medium text-gray-900">Enable Reranker</label>
                          <p className="text-sm text-gray-500">Rerank retrieved chunks for better relevance ordering</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={editedReranker.enabled}
                          onChange={(e) => {
                            setEditedReranker({ ...editedReranker, enabled: e.target.checked });
                            setRerankerModified(true);
                          }}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>

                      {/* Provider Selection */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Reranker Provider</label>
                        <select
                          value={editedReranker.provider}
                          onChange={(e) => {
                            setEditedReranker({ ...editedReranker, provider: e.target.value as 'cohere' | 'local' });
                            setRerankerModified(true);
                          }}
                          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          {(() => {
                            const cohereStatus = rerankerStatus.find(s => s?.provider === 'cohere');
                            const localStatus = rerankerStatus.find(s => s?.provider === 'local');
                            const cohereAvailable = cohereStatus?.available ?? true;
                            const localAvailable = localStatus?.available ?? true;
                            return (
                              <>
                                <option value="cohere" disabled={!cohereAvailable}>
                                  Cohere API (Fast, requires API key){!cohereAvailable ? ' (unavailable)' : ''}
                                </option>
                                <option value="local" disabled={!localAvailable}>
                                  Local (Free, slower first load){!localAvailable ? ' (unavailable)' : ''}
                                </option>
                              </>
                            );
                          })()}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          {editedReranker.provider === 'cohere'
                            ? 'Uses Cohere rerank-english-v3.0 model. Requires COHERE_API_KEY in environment.'
                            : 'Uses local all-MiniLM-L6-v2 model with semantic similarity. First load downloads model.'}
                        </p>
                      </div>

                      {/* Settings Grid */}
                      <div className="grid grid-cols-2 gap-6">
                        {/* Top K for Reranking */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Top K for Reranking</label>
                          <input
                            type="number"
                            min="5"
                            max="100"
                            value={editedReranker.topKForReranking}
                            onChange={(e) => {
                              setEditedReranker({ ...editedReranker, topKForReranking: parseInt(e.target.value) || 50 });
                              setRerankerModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Number of chunks to rerank (5-100)</p>
                        </div>

                        {/* Min Score Threshold */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Min Score Threshold</label>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={editedReranker.minRerankerScore}
                            onChange={(e) => {
                              setEditedReranker({ ...editedReranker, minRerankerScore: parseFloat(e.target.value) || 0.3 });
                              setRerankerModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Chunks below this score are filtered (0-1)</p>
                        </div>

                        {/* Cache TTL */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Cache Duration</label>
                          <input
                            type="number"
                            min="60"
                            max="86400"
                            value={editedReranker.cacheTTLSeconds}
                            onChange={(e) => {
                              setEditedReranker({ ...editedReranker, cacheTTLSeconds: parseInt(e.target.value) || 3600 });
                              setRerankerModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            {Math.floor(editedReranker.cacheTTLSeconds / 60)} minutes (60s - 86,400s)
                          </p>
                        </div>
                      </div>

                        {/* Last Updated */}
                        {rerankerSettings?.updatedAt && (
                          <p className="text-xs text-gray-500">
                            Last updated: {formatDate(rerankerSettings.updatedAt)} by {rerankerSettings.updatedBy}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Memory Section */}
              {settingsSection === 'memory' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">User Memory</h2>
                        <p className="text-sm text-gray-500">
                          Extract and store facts about users across conversations
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {memoryModified && (
                          <Button variant="secondary" onClick={handleResetMemory} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveMemory} disabled={!memoryModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedMemory ? (
                    <div className="p-6 space-y-6">
                      {/* Enable/Disable Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="font-medium text-gray-900">Enable Memory</label>
                          <p className="text-sm text-gray-500">Automatically extract and remember facts about users</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={editedMemory.enabled}
                          onChange={(e) => {
                            setEditedMemory({ ...editedMemory, enabled: e.target.checked });
                            setMemoryModified(true);
                          }}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>

                      {/* Settings Grid */}
                      <div className="grid grid-cols-2 gap-6">
                        {/* Extraction Threshold */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Extraction Threshold</label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={editedMemory.extractionThreshold}
                            onChange={(e) => {
                              setEditedMemory({ ...editedMemory, extractionThreshold: parseInt(e.target.value) || 5 });
                              setMemoryModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Minimum messages before extraction (1-50)</p>
                        </div>

                        {/* Max Facts Per Category */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Max Facts Per Category</label>
                          <input
                            type="number"
                            min="5"
                            max="100"
                            value={editedMemory.maxFactsPerCategory}
                            onChange={(e) => {
                              setEditedMemory({ ...editedMemory, maxFactsPerCategory: parseInt(e.target.value) || 20 });
                              setMemoryModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Maximum facts stored per category (5-100)</p>
                        </div>

                        {/* Extraction Max Tokens */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Extraction Max Tokens</label>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-medium text-gray-900">{editedMemory.extractionMaxTokens.toLocaleString()}</span>
                            <span className="text-xs text-gray-400">tokens</span>
                          </div>
                          <p className="mt-1 text-xs text-blue-500">Configure in Settings → Limits → Token Limits</p>
                        </div>
                      </div>

                      {/* Auto Extract Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="font-medium text-gray-900">Auto-Extract on Thread End</label>
                          <p className="text-sm text-gray-500">Automatically extract facts when conversations end</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={editedMemory.autoExtractOnThreadEnd}
                          onChange={(e) => {
                            setEditedMemory({ ...editedMemory, autoExtractOnThreadEnd: e.target.checked });
                            setMemoryModified(true);
                          }}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>

                      {/* Last Updated */}
                      {memorySettings?.updatedAt && (
                        <p className="text-xs text-gray-500">
                          Last updated: {formatDate(memorySettings.updatedAt)} by {memorySettings.updatedBy}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Summarization Section */}
              {settingsSection === 'summarization' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Thread Summarization</h2>
                        <p className="text-sm text-gray-500">
                          Automatically compress long conversations to reduce token usage
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {summarizationModified && (
                          <Button variant="secondary" onClick={handleResetSummarization} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveSummarization} disabled={!summarizationModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedSummarization ? (
                    <div className="p-6 space-y-6">
                      {/* Enable/Disable Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="font-medium text-gray-900">Enable Summarization</label>
                          <p className="text-sm text-gray-500">Automatically summarize threads when token threshold is exceeded</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={editedSummarization.enabled}
                          onChange={(e) => {
                            setEditedSummarization({ ...editedSummarization, enabled: e.target.checked });
                            setSummarizationModified(true);
                          }}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>

                      {/* Settings Grid */}
                      <div className="grid grid-cols-2 gap-6">
                        {/* Token Threshold */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Token Threshold</label>
                          <input
                            type="number"
                            min="1000"
                            max="1000000"
                            step="1000"
                            value={editedSummarization.tokenThreshold}
                            onChange={(e) => {
                              setEditedSummarization({ ...editedSummarization, tokenThreshold: parseInt(e.target.value) || 100000 });
                              setSummarizationModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Trigger summarization at this token count</p>
                        </div>

                        {/* Keep Recent Messages */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Keep Recent Messages</label>
                          <input
                            type="number"
                            min="2"
                            max="50"
                            value={editedSummarization.keepRecentMessages}
                            onChange={(e) => {
                              setEditedSummarization({ ...editedSummarization, keepRecentMessages: parseInt(e.target.value) || 10 });
                              setSummarizationModified(true);
                            }}
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">Messages to exclude from summarization (2-50)</p>
                        </div>

                        {/* Summary Max Tokens */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Summary Max Tokens</label>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-medium text-gray-900">{editedSummarization.summaryMaxTokens.toLocaleString()}</span>
                            <span className="text-xs text-gray-400">tokens</span>
                          </div>
                          <p className="mt-1 text-xs text-blue-500">Configure in Settings → Limits → Token Limits</p>
                        </div>
                      </div>

                      {/* Archive Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="font-medium text-gray-900">Archive Original Messages</label>
                          <p className="text-sm text-gray-500">Keep original messages for reference (viewable in thread details)</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={editedSummarization.archiveOriginalMessages}
                          onChange={(e) => {
                            setEditedSummarization({ ...editedSummarization, archiveOriginalMessages: e.target.checked });
                            setSummarizationModified(true);
                          }}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>

                      {/* Last Updated */}
                      {summarizationSettings?.updatedAt && (
                        <p className="text-xs text-gray-500">
                          Last updated: {formatDate(summarizationSettings.updatedAt)} by {summarizationSettings.updatedBy}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Limits Section */}
              {settingsSection === 'limits' && (
                <div className="space-y-6">
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Limits</h2>
                        <p className="text-sm text-gray-500">Configure system limits and constraints</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {limitsModified && (
                          <Button variant="secondary" onClick={handleResetLimits} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveLimits} disabled={!limitsModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedLimits ? (
                    <div className="p-6 space-y-6">
                      {/* Conversation History Messages */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Conversation History Messages</label>
                        <input
                          type="number"
                          min="3"
                          max="50"
                          value={editedLimits.conversationHistoryMessages}
                          onChange={(e) => {
                            setEditedLimits({ ...editedLimits, conversationHistoryMessages: parseInt(e.target.value) || 5 });
                            setLimitsModified(true);
                          }}
                          className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">
                          Number of recent messages sent to the LLM for context (3-50).
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          Higher values allow skills like quizzes to maintain state across more turns, but increase token usage.
                          Recommended: 15-20 for multi-turn skills like quiz_generator.
                        </p>
                      </div>

                      {/* Last Updated */}
                      {limitsSettings?.updatedAt && (
                        <p className="text-xs text-gray-500">
                          Last updated: {formatDate(limitsSettings.updatedAt)} by {limitsSettings.updatedBy}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
                {/* Token Limits Card */}
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Token Limits</h2>
                        <p className="text-sm text-gray-500">Configure token budgets for various LLM operations</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {tokenLimitsModified && (
                          <Button variant="secondary" onClick={handleResetTokenLimits} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveTokenLimits} disabled={!tokenLimitsModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedTokenLimits ? (
                    <div className="p-6">
                      {/* Token Limits Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Setting</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Range</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {/* Prompt Optimization */}
                            <tr>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Prompt Optimization</td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="100"
                                  max="8000"
                                  value={editedTokenLimits.promptOptimizationMaxTokens}
                                  onChange={(e) => {
                                    setEditedTokenLimits({ ...editedTokenLimits, promptOptimizationMaxTokens: parseInt(e.target.value) || 2000 });
                                    setTokenLimitsModified(true);
                                  }}
                                  className="w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">100-8,000</td>
                              <td className="px-4 py-3 text-sm text-gray-500">Max tokens for LLM calls that optimize/rewrite user queries</td>
                            </tr>
                            {/* Skills Max Total */}
                            <tr>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Skills Max Total</td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="500"
                                  max="20000"
                                  value={editedTokenLimits.skillsMaxTotalTokens}
                                  onChange={(e) => {
                                    setEditedTokenLimits({ ...editedTokenLimits, skillsMaxTotalTokens: parseInt(e.target.value) || 3000 });
                                    setTokenLimitsModified(true);
                                  }}
                                  className="w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">500-20,000</td>
                              <td className="px-4 py-3 text-sm text-gray-500">Combined token budget for all active skill prompts</td>
                            </tr>
                            {/* Memory Extraction */}
                            <tr>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Memory Extraction</td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="100"
                                  max="8000"
                                  value={editedTokenLimits.memoryExtractionMaxTokens}
                                  onChange={(e) => {
                                    setEditedTokenLimits({ ...editedTokenLimits, memoryExtractionMaxTokens: parseInt(e.target.value) || 1000 });
                                    setTokenLimitsModified(true);
                                  }}
                                  className="w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">100-8,000</td>
                              <td className="px-4 py-3 text-sm text-gray-500">Max tokens for LLM calls that extract user facts from conversations</td>
                            </tr>
                            {/* Summary Max */}
                            <tr>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Summary Max</td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="100"
                                  max="10000"
                                  value={editedTokenLimits.summaryMaxTokens}
                                  onChange={(e) => {
                                    setEditedTokenLimits({ ...editedTokenLimits, summaryMaxTokens: parseInt(e.target.value) || 2000 });
                                    setTokenLimitsModified(true);
                                  }}
                                  className="w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">100-10,000</td>
                              <td className="px-4 py-3 text-sm text-gray-500">Max tokens for auto-generated conversation summaries</td>
                            </tr>
                            {/* System Prompt */}
                            <tr>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">System Prompt</td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="500"
                                  max="4000"
                                  value={editedTokenLimits.systemPromptMaxTokens}
                                  onChange={(e) => {
                                    setEditedTokenLimits({ ...editedTokenLimits, systemPromptMaxTokens: parseInt(e.target.value) || 2000 });
                                    setTokenLimitsModified(true);
                                  }}
                                  className="w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">500-4,000</td>
                              <td className="px-4 py-3 text-sm text-gray-500">Max tokens for the global system prompt</td>
                            </tr>
                            {/* Category Prompt */}
                            <tr>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Category Prompt</td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="250"
                                  max="2000"
                                  value={editedTokenLimits.categoryPromptMaxTokens}
                                  onChange={(e) => {
                                    setEditedTokenLimits({ ...editedTokenLimits, categoryPromptMaxTokens: parseInt(e.target.value) || 500 });
                                    setTokenLimitsModified(true);
                                  }}
                                  className="w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">250-2,000</td>
                              <td className="px-4 py-3 text-sm text-gray-500">Max tokens for category-specific instructions</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Starter Prompt Limits */}
                      <div className="mt-6 pt-6 border-t">
                        <h3 className="font-medium text-gray-900 mb-4">Starter Prompt Limits</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Starters per Category</label>
                            <input
                              type="number"
                              min="3"
                              max="10"
                              value={editedTokenLimits.maxStartersPerCategory}
                              onChange={(e) => {
                                setEditedTokenLimits({ ...editedTokenLimits, maxStartersPerCategory: parseInt(e.target.value) || 6 });
                                setTokenLimitsModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <p className="mt-1 text-xs text-gray-500">3-10 starter buttons per category</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Label Max Characters</label>
                            <input
                              type="number"
                              min="20"
                              max="50"
                              value={editedTokenLimits.starterLabelMaxChars}
                              onChange={(e) => {
                                setEditedTokenLimits({ ...editedTokenLimits, starterLabelMaxChars: parseInt(e.target.value) || 30 });
                                setTokenLimitsModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <p className="mt-1 text-xs text-gray-500">20-50 chars for button labels</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Max Characters</label>
                            <input
                              type="number"
                              min="200"
                              max="1000"
                              value={editedTokenLimits.starterPromptMaxChars}
                              onChange={(e) => {
                                setEditedTokenLimits({ ...editedTokenLimits, starterPromptMaxChars: parseInt(e.target.value) || 500 });
                                setTokenLimitsModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <p className="mt-1 text-xs text-gray-500">200-1,000 chars for prompt text</p>
                          </div>
                        </div>
                      </div>

                      {/* Total Context Token Budget Summary */}
                      <div className="mt-6 pt-6 border-t bg-gray-50 -mx-6 -mb-6 px-6 py-4 rounded-b-lg">
                        <h3 className="font-medium text-gray-900 mb-3">Total Context Token Budget</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">System Prompt:</span>
                            <span className="font-medium">{editedTokenLimits.systemPromptMaxTokens.toLocaleString()} tokens</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Category Prompt:</span>
                            <span className="font-medium">{editedTokenLimits.categoryPromptMaxTokens.toLocaleString()} tokens</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Skills:</span>
                            <span className="font-medium">{editedTokenLimits.skillsMaxTotalTokens.toLocaleString()} tokens</span>
                          </div>
                          <div className="flex justify-between pt-2 border-t border-gray-200">
                            <span className="text-gray-900 font-medium">Total Context:</span>
                            <span className="font-bold text-blue-600">
                              {(editedTokenLimits.systemPromptMaxTokens + editedTokenLimits.categoryPromptMaxTokens + editedTokenLimits.skillsMaxTotalTokens).toLocaleString()} tokens
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-gray-500">
                          Note: Memory ({editedTokenLimits.memoryExtractionMaxTokens.toLocaleString()}) and Summary ({editedTokenLimits.summaryMaxTokens.toLocaleString()}) tokens are for separate LLM calls, not added to context.
                        </p>
                      </div>

                      {/* Last Updated */}
                      {tokenLimitsSettings?.updatedAt && (
                        <p className="text-xs text-gray-500 mt-4">
                          Last updated: {formatDate(tokenLimitsSettings.updatedAt)} by {tokenLimitsSettings.updatedBy}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Upload Settings Card */}
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Upload Settings</h2>
                        <p className="text-sm text-gray-500">Configure file upload limits and allowed types for chat</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {uploadModified && (
                          <Button variant="secondary" onClick={handleResetUpload} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveUpload} disabled={!uploadModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedUpload ? (
                    <div className="p-6 space-y-6">
                      {/* Max Files Per Upload */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Max Files Per Upload</label>
                        <input
                          type="number"
                          min="0"
                          max={editedUpload.maxFilesPerThread || 10}
                          value={editedUpload.maxFilesPerInput}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 0;
                            const maxPerThread = editedUpload.maxFilesPerThread || 10;
                            setEditedUpload({
                              ...editedUpload,
                              maxFilesPerInput: Math.min(value, maxPerThread)
                            });
                            setUploadModified(true);
                          }}
                          className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">
                          Maximum files per upload batch (0 disables, must be ≤ Max Files Per Thread)
                        </p>
                      </div>

                      {/* Max Files Per Thread */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Max Files Per Thread</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={editedUpload.maxFilesPerThread}
                          onChange={(e) => {
                            const newMax = parseInt(e.target.value) || 0;
                            setEditedUpload({
                              ...editedUpload,
                              maxFilesPerThread: newMax,
                              // Auto-adjust maxFilesPerInput if it exceeds new maxFilesPerThread
                              maxFilesPerInput: Math.min(editedUpload.maxFilesPerInput, newMax)
                            });
                            setUploadModified(true);
                          }}
                          className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">
                          Maximum total files allowed per thread (0-100, 0 disables uploads)
                        </p>
                      </div>

                      {/* Max File Size */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Maximum File Size (MB)</label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={editedUpload.maxFileSizeMB}
                          onChange={(e) => {
                            setEditedUpload({ ...editedUpload, maxFileSizeMB: parseInt(e.target.value) || 10 });
                            setUploadModified(true);
                          }}
                          className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">
                          Maximum file size users can upload (1-100 MB)
                        </p>
                      </div>

                      {/* Allowed File Types */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-3">Allowed File Types</label>
                        <div className="space-y-3">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editedUpload.allowedTypes?.includes('application/pdf') || false}
                              onChange={() => handleToggleFileType('application/pdf')}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">PDF Documents (.pdf)</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(editedUpload.allowedTypes?.includes('image/png') && editedUpload.allowedTypes?.includes('image/jpeg') && editedUpload.allowedTypes?.includes('image/webp')) || false}
                              onChange={() => {
                                const hasImages = editedUpload.allowedTypes?.includes('image/png') && editedUpload.allowedTypes?.includes('image/jpeg') && editedUpload.allowedTypes?.includes('image/webp');
                                let newTypes = editedUpload.allowedTypes || [];
                                if (hasImages) {
                                  newTypes = newTypes.filter(t => t !== 'image/png' && t !== 'image/jpeg' && t !== 'image/webp');
                                } else {
                                  if (!newTypes.includes('image/png')) newTypes = [...newTypes, 'image/png'];
                                  if (!newTypes.includes('image/jpeg')) newTypes = [...newTypes, 'image/jpeg'];
                                  if (!newTypes.includes('image/webp')) newTypes = [...newTypes, 'image/webp'];
                                }
                                setEditedUpload({ ...editedUpload, allowedTypes: newTypes });
                                setUploadModified(true);
                              }}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Images (.png, .jpg, .jpeg, .webp)</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editedUpload.allowedTypes?.includes('text/plain') || false}
                              onChange={() => handleToggleFileType('text/plain')}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Text Files (.txt)</span>
                          </label>
                        </div>
                        <p className="mt-2 text-sm text-gray-500">
                          Select which file types users can upload in chat conversations
                        </p>
                      </div>

                      {/* Last Updated */}
                      {uploadSettings?.updatedAt && (
                        <p className="text-xs text-gray-500">
                          Last updated: {formatDate(uploadSettings.updatedAt)} by {uploadSettings.updatedBy}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
                </div>
              )}

              {/* Agent Settings Section */}
              {settingsSection === 'agent' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Autonomous Agent Settings</h2>
                        <p className="text-sm text-gray-500">Configure autonomous mode budget limits and behavior</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {agentModified && (
                          <Button variant="secondary" onClick={handleResetAgent} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveAgent} disabled={!agentModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : editedAgent ? (
                    <div className="p-6 space-y-6">
                      {/* Budget Limits Section */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-900 border-b pb-2">Budget Limits</h3>

                        {/* Max LLM Calls */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">
                            Max LLM Calls (Global)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="10000"
                            value={editedAgent.budgetMaxLlmCalls}
                            onChange={(e) => {
                              setEditedAgent({ ...editedAgent, budgetMaxLlmCalls: parseInt(e.target.value) || 1 });
                              setAgentModified(true);
                            }}
                            className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <p className="mt-1 text-sm text-gray-500">
                            Maximum LLM API calls across all active autonomous plans (1-10,000).
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Warnings at 50% and 75%, hard stop at 100%. Default: 500
                          </p>
                        </div>

                        {/* Max Tokens */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">
                            Max Tokens (Global)
                          </label>
                          <input
                            type="number"
                            min="1000"
                            max="100000000"
                            step="1000"
                            value={editedAgent.budgetMaxTokens}
                            onChange={(e) => {
                              setEditedAgent({ ...editedAgent, budgetMaxTokens: parseInt(e.target.value) || 1000 });
                              setAgentModified(true);
                            }}
                            className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <p className="mt-1 text-sm text-gray-500">
                            Maximum tokens consumed across all active autonomous plans (1,000-100,000,000).
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Includes input and output tokens. Default: 2,000,000
                          </p>
                        </div>

                        {/* Max Web Searches */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">
                            Max Web Searches (Global)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={editedAgent.budgetMaxWebSearches}
                            onChange={(e) => {
                              setEditedAgent({ ...editedAgent, budgetMaxWebSearches: parseInt(e.target.value) || 1 });
                              setAgentModified(true);
                            }}
                            className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <p className="mt-1 text-sm text-gray-500">
                            Maximum web searches across all active autonomous plans (1-1,000).
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Future enhancement. Default: 100
                          </p>
                        </div>

                        {/* Max Duration */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">
                            Max Duration (Minutes)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="480"
                            value={editedAgent.budgetMaxDurationMinutes}
                            onChange={(e) => {
                              setEditedAgent({ ...editedAgent, budgetMaxDurationMinutes: parseInt(e.target.value) || 1 });
                              setAgentModified(true);
                            }}
                            className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <p className="mt-1 text-sm text-gray-500">
                            Maximum duration for autonomous plan execution (1-480 minutes).
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Plans exceeding this duration will be terminated. Default: 30 minutes
                          </p>
                        </div>
                      </div>

                      {/* Model Configuration Section */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-900 border-b pb-2">Model Configuration</h3>
                        <p className="text-xs text-gray-600 -mt-2">Configure LLM models for each agent role</p>

                        {/* Planner Model */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Planner Model</label>
                            <select
                              value={`${editedAgent.plannerModel.provider}:${editedAgent.plannerModel.model}`}
                              onChange={(e) => {
                                const [provider, model] = e.target.value.split(':');
                                setEditedAgent({
                                  ...editedAgent,
                                  plannerModel: { ...editedAgent.plannerModel, provider: provider as 'openai' | 'gemini' | 'mistral', model }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            >
                              <optgroup label="OpenAI GPT-4.1 Family">
                                <option value="openai:gpt-4.1">GPT-4.1 (High Performance)</option>
                                <option value="openai:gpt-4.1-mini">GPT-4.1 Mini (Balanced)</option>
                                <option value="openai:gpt-4.1-nano">GPT-4.1 Nano (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Gemini 2.5 Family">
                                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Balanced)</option>
                                <option value="gemini:gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Mistral">
                                <option value="mistral:mistral-large-3">Mistral Large 3</option>
                                <option value="mistral:mistral-small-3.2">Mistral Small 3.2 (Cost-Effective)</option>
                              </optgroup>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Temperature</label>
                            <input
                              type="number"
                              min="0"
                              max="2"
                              step="0.1"
                              value={editedAgent.plannerModel.temperature}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  plannerModel: { ...editedAgent.plannerModel, temperature: parseFloat(e.target.value) || 0 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Max Tokens</label>
                            <input
                              type="number"
                              min="1024"
                              max="32768"
                              step="1024"
                              value={editedAgent.plannerModel.max_tokens || 8192}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  plannerModel: { ...editedAgent.plannerModel, max_tokens: parseInt(e.target.value) || 8192 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                        </div>

                        {/* Executor Model */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Executor Model</label>
                            <select
                              value={`${editedAgent.executorModel.provider}:${editedAgent.executorModel.model}`}
                              onChange={(e) => {
                                const [provider, model] = e.target.value.split(':');
                                setEditedAgent({
                                  ...editedAgent,
                                  executorModel: { ...editedAgent.executorModel, provider: provider as 'openai' | 'gemini' | 'mistral', model }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            >
                              <optgroup label="OpenAI GPT-4.1 Family">
                                <option value="openai:gpt-4.1">GPT-4.1 (High Performance)</option>
                                <option value="openai:gpt-4.1-mini">GPT-4.1 Mini (Balanced)</option>
                                <option value="openai:gpt-4.1-nano">GPT-4.1 Nano (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Gemini 2.5 Family">
                                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Balanced)</option>
                                <option value="gemini:gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Mistral">
                                <option value="mistral:mistral-large-3">Mistral Large 3</option>
                                <option value="mistral:mistral-small-3.2">Mistral Small 3.2 (Cost-Effective)</option>
                              </optgroup>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Temperature</label>
                            <input
                              type="number"
                              min="0"
                              max="2"
                              step="0.1"
                              value={editedAgent.executorModel.temperature}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  executorModel: { ...editedAgent.executorModel, temperature: parseFloat(e.target.value) || 0 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Max Tokens</label>
                            <input
                              type="number"
                              min="1024"
                              max="32768"
                              step="1024"
                              value={editedAgent.executorModel.max_tokens || 4096}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  executorModel: { ...editedAgent.executorModel, max_tokens: parseInt(e.target.value) || 4096 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                        </div>

                        {/* Checker Model */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Checker Model</label>
                            <select
                              value={`${editedAgent.checkerModel.provider}:${editedAgent.checkerModel.model}`}
                              onChange={(e) => {
                                const [provider, model] = e.target.value.split(':');
                                setEditedAgent({
                                  ...editedAgent,
                                  checkerModel: { ...editedAgent.checkerModel, provider: provider as 'openai' | 'gemini' | 'mistral', model }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            >
                              <optgroup label="OpenAI GPT-4.1 Family">
                                <option value="openai:gpt-4.1">GPT-4.1 (High Performance)</option>
                                <option value="openai:gpt-4.1-mini">GPT-4.1 Mini (Balanced)</option>
                                <option value="openai:gpt-4.1-nano">GPT-4.1 Nano (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Gemini 2.5 Family">
                                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Balanced)</option>
                                <option value="gemini:gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Mistral">
                                <option value="mistral:mistral-large-3">Mistral Large 3</option>
                                <option value="mistral:mistral-small-3.2">Mistral Small 3.2 (Cost-Effective)</option>
                              </optgroup>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Temperature</label>
                            <input
                              type="number"
                              min="0"
                              max="2"
                              step="0.1"
                              value={editedAgent.checkerModel.temperature}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  checkerModel: { ...editedAgent.checkerModel, temperature: parseFloat(e.target.value) || 0 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Max Tokens</label>
                            <input
                              type="number"
                              min="1024"
                              max="32768"
                              step="1024"
                              value={editedAgent.checkerModel.max_tokens || 2048}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  checkerModel: { ...editedAgent.checkerModel, max_tokens: parseInt(e.target.value) || 2048 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                        </div>

                        {/* Summarizer Model */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Summarizer Model</label>
                            <select
                              value={`${editedAgent.summarizerModel.provider}:${editedAgent.summarizerModel.model}`}
                              onChange={(e) => {
                                const [provider, model] = e.target.value.split(':');
                                setEditedAgent({
                                  ...editedAgent,
                                  summarizerModel: { ...editedAgent.summarizerModel, provider: provider as 'openai' | 'gemini' | 'mistral', model }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            >
                              <optgroup label="OpenAI GPT-4.1 Family">
                                <option value="openai:gpt-4.1">GPT-4.1 (High Performance)</option>
                                <option value="openai:gpt-4.1-mini">GPT-4.1 Mini (Balanced)</option>
                                <option value="openai:gpt-4.1-nano">GPT-4.1 Nano (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Gemini 2.5 Family">
                                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Balanced)</option>
                                <option value="gemini:gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Cost-Effective)</option>
                              </optgroup>
                              <optgroup label="Mistral">
                                <option value="mistral:mistral-large-3">Mistral Large 3</option>
                                <option value="mistral:mistral-small-3.2">Mistral Small 3.2 (Cost-Effective)</option>
                              </optgroup>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Temperature</label>
                            <input
                              type="number"
                              min="0"
                              max="2"
                              step="0.1"
                              value={editedAgent.summarizerModel.temperature}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  summarizerModel: { ...editedAgent.summarizerModel, temperature: parseFloat(e.target.value) || 0 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">Max Tokens</label>
                            <input
                              type="number"
                              min="1024"
                              max="32768"
                              step="1024"
                              value={editedAgent.summarizerModel.max_tokens || 4096}
                              onChange={(e) => {
                                setEditedAgent({
                                  ...editedAgent,
                                  summarizerModel: { ...editedAgent.summarizerModel, max_tokens: parseInt(e.target.value) || 4096 }
                                });
                                setAgentModified(true);
                              }}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Quality & Behavior Section */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-900 border-b pb-2">Quality & Behavior</h3>

                        {/* Confidence Threshold */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">
                            Confidence Threshold (%)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={editedAgent.confidenceThreshold}
                            onChange={(e) => {
                              setEditedAgent({ ...editedAgent, confidenceThreshold: parseInt(e.target.value) || 0 });
                              setAgentModified(true);
                            }}
                            className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <p className="mt-1 text-sm text-gray-500">
                            Minimum confidence score for auto-approval (0-100%).
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Tasks below this threshold are flagged for manual review. Default: 80%
                          </p>
                        </div>

                        {/* Task Timeout */}
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">
                            Task Timeout (Minutes)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="60"
                            value={editedAgent.taskTimeoutMinutes}
                            onChange={(e) => {
                              setEditedAgent({ ...editedAgent, taskTimeoutMinutes: parseInt(e.target.value) || 1 });
                              setAgentModified(true);
                            }}
                            className="w-full max-w-xs px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <p className="mt-1 text-sm text-gray-500">
                            Maximum time for a single task execution (1-60 minutes).
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Tasks exceeding this timeout will be skipped during crash recovery. Default: 5 minutes
                          </p>
                        </div>
                      </div>

                      {/* Streaming Configuration */}
                      <div className="pt-4 border-t border-gray-100">
                        <h4 className="font-medium text-gray-900 mb-4">Streaming Configuration</h4>
                        <p className="text-sm text-gray-600 mb-4">
                          Configure SSE streaming timeouts for long-running autonomous tasks.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Keepalive Interval */}
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">
                              Keepalive Interval (Seconds)
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="60"
                              value={editedAgent.streamingKeepaliveInterval}
                              onChange={(e) => {
                                setEditedAgent({ ...editedAgent, streamingKeepaliveInterval: parseInt(e.target.value) || 10 });
                                setAgentModified(true);
                              }}
                              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              Keep connection alive (5-60s). Default: 10s
                            </p>
                          </div>

                          {/* Max Stream Duration */}
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">
                              Max Stream Duration (Seconds)
                            </label>
                            <input
                              type="number"
                              min="60"
                              max="600"
                              value={editedAgent.streamingMaxDuration}
                              onChange={(e) => {
                                setEditedAgent({ ...editedAgent, streamingMaxDuration: parseInt(e.target.value) || 300 });
                                setAgentModified(true);
                              }}
                              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              Max stream time (60-600s). Default: 300s
                            </p>
                          </div>

                          {/* Tool Timeout */}
                          <div>
                            <label className="block text-sm font-medium text-gray-900 mb-1">
                              Tool Timeout (Seconds)
                            </label>
                            <input
                              type="number"
                              min="30"
                              max="300"
                              value={editedAgent.streamingToolTimeout}
                              onChange={(e) => {
                                setEditedAgent({ ...editedAgent, streamingToolTimeout: parseInt(e.target.value) || 60 });
                                setAgentModified(true);
                              }}
                              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              Per-tool timeout (30-300s). Default: 60s
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-gray-400">
                          For Traefik: ensure <code className="bg-gray-100 px-1 rounded">respondingTimeouts.readTimeout</code> is greater than Max Stream Duration.
                        </p>
                      </div>

                      {/* Info Box */}
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                        <div className="flex gap-3">
                          <AlertCircle size={20} className="text-purple-600 flex-shrink-0 mt-0.5" />
                          <div className="text-sm text-purple-900">
                            <p className="font-medium mb-1">Autonomous Mode Behavior</p>
                            <ul className="space-y-1 text-xs text-purple-800">
                              <li>• <strong>Fail-Fast:</strong> No retries on task failure, skip and continue</li>
                              <li>• <strong>Budget Warnings:</strong> Alerts at 50% and 75%, hard stop at 100%</li>
                              <li>• <strong>Quality Assurance:</strong> Checker agent validates all task results</li>
                              <li>• <strong>Crash Recovery:</strong> Idempotent state transitions allow resumption</li>
                              <li>• <strong>Model Presets:</strong> Users can select: Default, Quality, Economy, Compliance</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      {/* Last Updated */}
                      {agentSettings?.updatedAt && (
                        <p className="text-xs text-gray-500">
                          Last updated: {formatDate(agentSettings.updatedAt)} by {agentSettings.updatedBy}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Backup Section */}
              {settingsSection === 'backup' && (
                <BackupTab />
              )}

              {/* Cache Section */}
              {settingsSection === 'cache' && (
                <CacheSettingsTab />
              )}

              {/* Superuser Section */}
              {settingsSection === 'superuser' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-gray-900">Superuser Settings</h3>
                    <p className="text-sm text-gray-500">Configure limits and permissions for superusers</p>
                  </div>
                  <div className="p-6 space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Max Categories per Superuser
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={editedSuperuser?.maxCategoriesPerSuperuser ?? 5}
                        onChange={(e) => setEditedSuperuser({
                          ...editedSuperuser,
                          maxCategoriesPerSuperuser: parseInt(e.target.value, 10) || 5,
                        })}
                        className="w-full max-w-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-sm text-gray-500 mt-1">
                        Maximum number of categories each superuser can create (1-100)
                      </p>
                    </div>

                    {superuserSettings?.updatedAt && (
                      <p className="text-sm text-gray-500">
                        Last updated: {new Date(superuserSettings.updatedAt).toLocaleString()}
                        {superuserSettings.updatedBy && ` by ${superuserSettings.updatedBy}`}
                      </p>
                    )}

                    <div className="flex gap-3 pt-4 border-t">
                      <Button
                        onClick={async () => {
                          if (!editedSuperuser) return;
                          setSavingSettings(true);
                          try {
                            const response = await fetch('/api/admin/settings/superuser', {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(editedSuperuser),
                            });
                            if (!response.ok) {
                              const data = await response.json();
                              throw new Error(data.error || 'Failed to save');
                            }
                            const data = await response.json();
                            setSuperuserSettings(data.settings);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to save');
                          } finally {
                            setSavingSettings(false);
                          }
                        }}
                        loading={savingSettings}
                        disabled={
                          !editedSuperuser ||
                          editedSuperuser.maxCategoriesPerSuperuser === superuserSettings?.maxCategoriesPerSuperuser
                        }
                      >
                        <Save size={16} className="mr-2" />
                        Save Changes
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (superuserSettings) {
                            setEditedSuperuser({
                              maxCategoriesPerSuperuser: superuserSettings.maxCategoriesPerSuperuser,
                            });
                          }
                        }}
                        disabled={
                          !superuserSettings ||
                          editedSuperuser?.maxCategoriesPerSuperuser === superuserSettings?.maxCategoriesPerSuperuser
                        }
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                </div>
              )}
          </>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            {statsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : systemStats ? (
              <>
                {/* Database Stats */}
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b flex items-center gap-3">
                    <Database className="text-blue-600" size={20} />
                    <h2 className="font-semibold text-gray-900">Database Statistics</h2>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      {/* Users */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-2xl font-bold text-gray-900">{systemStats.database.users.total}</div>
                        <div className="text-sm text-gray-500">Total Users</div>
                        <div className="mt-2 text-xs text-gray-400">
                          {systemStats.database.users.admins} admins, {systemStats.database.users.superUsers} super users
                        </div>
                      </div>
                      {/* Categories */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-2xl font-bold text-gray-900">{systemStats.database.categories.total}</div>
                        <div className="text-sm text-gray-500">Categories</div>
                        <div className="mt-2 text-xs text-gray-400">
                          {systemStats.database.categories.withDocuments} with documents
                        </div>
                      </div>
                      {/* Threads */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-2xl font-bold text-gray-900">{systemStats.database.threads.total}</div>
                        <div className="text-sm text-gray-500">Threads</div>
                        <div className="mt-2 text-xs text-gray-400">
                          {systemStats.database.threads.totalMessages} messages
                        </div>
                      </div>
                      {/* Documents */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-2xl font-bold text-gray-900">{systemStats.database.documents.total}</div>
                        <div className="text-sm text-gray-500">Documents</div>
                        <div className="mt-2 text-xs text-gray-400">
                          {systemStats.database.documents.totalChunks} chunks indexed
                        </div>
                      </div>
                    </div>
                    {/* Document Status */}
                    <div className="mt-6 pt-4 border-t">
                      <div className="text-sm font-medium text-gray-700 mb-2">Document Status</div>
                      <div className="flex gap-4">
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                          {systemStats.database.documents.byStatus.ready} ready
                        </span>
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">
                          {systemStats.database.documents.byStatus.processing} processing
                        </span>
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
                          {systemStats.database.documents.byStatus.error} error
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ChromaDB Stats */}
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Database className="text-purple-600" size={20} />
                      <h2 className="font-semibold text-gray-900">ChromaDB Vector Store</h2>
                    </div>
                    <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                      systemStats.chroma.connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {systemStats.chroma.connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="p-6">
                    <div className="text-2xl font-bold text-gray-900 mb-4">
                      {systemStats.chroma.totalVectors.toLocaleString()} total vectors
                    </div>
                    {systemStats.chroma.collections.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">Collections</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {systemStats.chroma.collections.map((col) => (
                            <div key={col.name} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                              <div className="font-medium text-gray-900 truncate">{col.name}</div>
                              <div className="text-xs text-gray-500">{col.documentCount.toLocaleString()} vectors</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* File Storage Stats */}
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b flex items-center gap-3">
                    <HardDrive className="text-green-600" size={20} />
                    <h2 className="font-semibold text-gray-900">File Storage</h2>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-lg font-bold text-gray-900">{systemStats.storage.dataDir.totalSizeMB} MB</div>
                        <div className="text-sm text-gray-500">Total Data Size</div>
                        <div className="mt-1 text-xs text-gray-400 truncate" title={systemStats.storage.dataDir.path}>
                          {systemStats.storage.dataDir.path}
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-lg font-bold text-gray-900">{systemStats.storage.globalDocsDir.totalSizeMB} MB</div>
                        <div className="text-sm text-gray-500">Uploaded Documents</div>
                        <div className="mt-1 text-xs text-gray-400">
                          {systemStats.storage.globalDocsDir.fileCount} files
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-lg font-bold text-gray-900">{systemStats.storage.threadsDir.totalUploadSizeMB} MB</div>
                        <div className="text-sm text-gray-500">Thread Uploads</div>
                        <div className="mt-1 text-xs text-gray-400">
                          {systemStats.storage.threadsDir.userCount} users
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Recent Threads */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div className="px-6 py-4 border-b">
                      <h2 className="font-semibold text-gray-900">Recent Threads</h2>
                    </div>
                    <div className="divide-y max-h-80 overflow-y-auto">
                      {systemStats.recentActivity.recentThreads.length === 0 ? (
                        <div className="px-6 py-8 text-center text-gray-500 text-sm">No threads yet</div>
                      ) : (
                        systemStats.recentActivity.recentThreads.map((thread) => (
                          <div key={thread.id} className="px-6 py-3">
                            <div className="text-sm font-medium text-gray-900 truncate">{thread.title}</div>
                            <div className="text-xs text-gray-500">
                              {thread.userEmail} - {thread.messageCount} messages
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Recent Documents */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div className="px-6 py-4 border-b">
                      <h2 className="font-semibold text-gray-900">Recent Documents</h2>
                    </div>
                    <div className="divide-y max-h-80 overflow-y-auto">
                      {systemStats.recentActivity.recentDocuments.length === 0 ? (
                        <div className="px-6 py-8 text-center text-gray-500 text-sm">No documents yet</div>
                      ) : (
                        systemStats.recentActivity.recentDocuments.map((doc) => (
                          <div key={doc.id} className="px-6 py-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-gray-900 truncate flex-1">{doc.filename}</div>
                              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ml-2 ${
                                doc.status === 'ready' ? 'bg-green-100 text-green-700' :
                                doc.status === 'processing' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {doc.status}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500">{doc.uploadedBy}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Refresh Button */}
                <div className="flex justify-center">
                  <Button variant="secondary" onClick={loadStats} disabled={statsLoading}>
                    <RefreshCw size={16} className={`mr-2 ${statsLoading ? 'animate-spin' : ''}`} />
                    Refresh Stats
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">Failed to load stats</div>
            )}
          </div>
        )}

        {/* Prompts Tab */}
        {activeTab === 'prompts' && (
          <>
              {/* System Prompt Section */}
              {promptsSection === 'system-prompt' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">System Prompt</h2>
                        <p className="text-sm text-gray-500">
                          Define the AI assistant&apos;s behavior and instructions
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {promptModified && (
                          <Button variant="secondary" onClick={handleResetPrompt} disabled={savingPrompt}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSavePrompt} disabled={!promptModified || savingPrompt} loading={savingPrompt}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {promptLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : (
                    <div className="p-6">
                      <textarea
                        value={editedPrompt}
                        onChange={(e) => handlePromptChange(e.target.value)}
                        rows={16}
                        className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                        placeholder="Enter the system prompt..."
                      />
                      <div className="mt-3 flex items-center justify-between">
                        {systemPrompt && (
                          <p className="text-xs text-gray-500">
                            Last updated: {formatDate(systemPrompt.updatedAt)} by {systemPrompt.updatedBy}
                          </p>
                        )}
                        <Button
                          variant="secondary"
                          onClick={handleRestoreDefaultPrompt}
                          disabled={restoringPrompt || savingPrompt}
                          loading={restoringPrompt}
                          className="text-orange-600 border-orange-300 hover:bg-orange-50"
                        >
                          <RefreshCw size={16} className="mr-2" />
                          Restore to Default
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Category Prompts Section */}
              {promptsSection === 'category-prompts' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div>
                      <h2 className="font-semibold text-gray-900">Category-Specific Prompts</h2>
                      <p className="text-sm text-gray-500">
                        Add custom prompt guidance for specific categories (appended to global prompt)
                      </p>
                    </div>
                  </div>
                  <div className="p-6">
                    {categories.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">
                        No categories yet. Create categories first.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-3 font-medium text-gray-700">Category</th>
                              <th className="pb-3 font-medium text-gray-700">Custom Prompt</th>
                              <th className="pb-3 font-medium text-gray-700 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {categories.map((cat) => (
                              <tr key={cat.id} className="hover:bg-gray-50">
                                <td className="py-3">
                                  <span className="font-medium text-gray-900">{cat.name}</span>
                                  <span className="ml-2 text-xs text-gray-400">({cat.slug})</span>
                                </td>
                                <td className="py-3">
                                  <span className="text-gray-500 text-xs">Click Edit to configure</span>
                                </td>
                                <td className="py-3 text-right">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleOpenCategoryPromptModal(cat.id)}
                                  >
                                    <Edit2 size={14} className="mr-1" />
                                    Edit
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Acronyms Section */}
              {promptsSection === 'acronyms' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-gray-900">Acronyms</h2>
                        <p className="text-sm text-gray-500">Define acronym expansions for query enhancement</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {acronymsModified && (
                          <Button variant="secondary" onClick={handleResetAcronyms} disabled={savingSettings}>
                            Reset
                          </Button>
                        )}
                        <Button onClick={handleSaveAcronyms} disabled={!acronymsModified || savingSettings} loading={savingSettings}>
                          <Save size={18} className="mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                  {settingsLoading ? (
                    <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
                  ) : (
                    <div className="p-6">
                      <textarea
                        value={editedAcronyms}
                        onChange={(e) => handleAcronymsChange(e.target.value)}
                        rows={12}
                        className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                        placeholder="ea=enterprise architecture&#10;it=information technology"
                      />
                      <p className="mt-2 text-sm text-gray-500">
                        One mapping per line in format: acronym=expansion. Used to expand queries for better retrieval.
                      </p>
                      {acronymMappings && (
                        <p className="mt-4 text-xs text-gray-500">
                          Last updated: {formatDate(acronymMappings.updatedAt)} by {acronymMappings.updatedBy}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Skills Section */}
              {promptsSection === 'skills' && (
                <SkillsTab />
              )}
          </>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <ToolsTab activeSubTab={toolsSection} />
        )}

        {/* Workspaces Tab */}
        {activeTab === 'workspaces' && (
          <WorkspacesTab isAdmin={true} />
        )}
        </main>
      </div>

      {/* Delete Document Modal */}
      <Modal
        isOpen={!!deleteDoc}
        onClose={() => setDeleteDoc(null)}
        title="Delete Document?"
      >
        <p className="text-gray-600 mb-4">
          Are you sure you want to delete &quot;{deleteDoc?.filename}&quot;?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This will remove the document and all {deleteDoc?.chunkCount} indexed chunks from the knowledge base.
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setDeleteDoc(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteDoc}
            loading={deleting}
          >
            Delete
          </Button>
        </div>
      </Modal>

      {/* Upload Document Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setUploadFile(null);
          setUploadTextName('');
          setUploadTextContent('');
          setUploadCategoryIds([]);
          setUploadIsGlobal(false);
          setUploadMode('file');
        }}
        title="Upload Document"
      >
        {/* Tabs */}
        <div className="flex border-b mb-4">
          <button
            onClick={() => setUploadMode('file')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'file'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Upload size={16} className="inline mr-2" />
            File
          </button>
          <button
            onClick={() => setUploadMode('text')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'text'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText size={16} className="inline mr-2" />
            Text
          </button>
          <button
            onClick={() => setUploadMode('web')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'web'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Globe size={16} className="inline mr-2" />
            Web
          </button>
          <button
            onClick={() => setUploadMode('youtube')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'youtube'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Youtube size={16} className="inline mr-2" />
            YouTube
          </button>
        </div>

        <div className="space-y-4">
          {/* File Upload Mode */}
          {uploadMode === 'file' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File
              </label>
              {uploadFile ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-gray-700 truncate">{uploadFile.name}</span>
                  <span className="text-xs text-gray-500 ml-auto">
                    {formatFileSize(uploadFile.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setUploadFile(null)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <X size={14} className="text-gray-500" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-gray-50 transition-colors">
                  <Upload size={24} className="text-gray-400 mb-2" />
                  <span className="text-sm text-gray-500">Click to select a file</span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setUploadFile(file);
                    }}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          )}

          {/* Text Content Mode */}
          {uploadMode === 'text' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Name *
                </label>
                <input
                  type="text"
                  value={uploadTextName}
                  onChange={(e) => setUploadTextName(e.target.value)}
                  placeholder="e.g., Company Policy Overview"
                  maxLength={255}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Content *
                </label>
                <textarea
                  value={uploadTextContent}
                  onChange={(e) => setUploadTextContent(e.target.value)}
                  placeholder="Paste your text content here..."
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {uploadTextContent.length.toLocaleString()} characters
                </p>
              </div>
            </>
          )}

          {/* Web Mode */}
          {uploadMode === 'web' && (
            <>
              {/* URL Ingestion Results */}
              {urlIngestionResults && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Ingestion Results</h4>
                  <div className="space-y-2">
                    {urlIngestionResults.map((result, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 text-sm ${
                          result.success ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {result.success ? (
                          <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate">{result.url}</p>
                          {result.success ? (
                            <p className="text-xs text-green-600">{result.filename}</p>
                          ) : (
                            <p className="text-xs text-red-600">{result.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setUrlIngestionResults(null)}
                    className="mt-2 text-xs text-blue-600 hover:underline"
                  >
                    Clear results
                  </button>
                </div>
              )}

              {/* Web URLs Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Web URLs (up to 5 - saves API credits)
                </label>
                <div className="space-y-2">
                  {uploadUrls.map((url, index) => (
                    <input
                      key={index}
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const newUrls = [...uploadUrls];
                        newUrls[index] = e.target.value;
                        setUploadUrls(newUrls);
                      }}
                      placeholder={index === 0 ? 'https://example.com/article' : '(optional)'}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
                        url && !isValidUrl(url) ? 'border-red-300' : 'border-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Tip: Add up to 5 URLs to optimize API credit usage (1 credit per 5 URLs)
                </p>
              </div>
            </>
          )}

          {/* YouTube Mode */}
          {uploadMode === 'youtube' && (
            <>
              {/* URL Ingestion Results */}
              {urlIngestionResults && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Ingestion Results</h4>
                  <div className="space-y-2">
                    {urlIngestionResults.map((result, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 text-sm ${
                          result.success ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {result.success ? (
                          <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate">{result.url}</p>
                          {result.success ? (
                            <p className="text-xs text-green-600">{result.filename}</p>
                          ) : (
                            <p className="text-xs text-red-600">{result.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setUrlIngestionResults(null)}
                    className="mt-2 text-xs text-blue-600 hover:underline"
                  >
                    Clear results
                  </button>
                </div>
              )}

              {/* YouTube URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  YouTube URL
                </label>
                <input
                  type="url"
                  value={uploadYoutubeUrl}
                  onChange={(e) => setUploadYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
                    uploadYoutubeUrl && !isYouTubeUrl(uploadYoutubeUrl) ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {uploadYoutubeUrl && isYouTubeUrl(uploadYoutubeUrl) && (
                  <p className="text-xs text-green-600 mt-1">
                    YouTube video detected - transcript will be extracted
                  </p>
                )}
              </div>

              {/* Custom name for YouTube */}
              {uploadYoutubeUrl && isYouTubeUrl(uploadYoutubeUrl) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Document Name <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={uploadUrlName}
                    onChange={(e) => setUploadUrlName(e.target.value)}
                    placeholder="Auto-generated from video title if not provided"
                    maxLength={255}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Categories
            </label>
            <div className="border border-gray-200 rounded-lg p-2">
              <div className="flex flex-wrap gap-2 mb-2">
                {uploadCategoryIds.length === 0 ? (
                  <span className="text-sm text-gray-500">No categories selected</span>
                ) : (
                  uploadCategoryIds.map(catId => {
                    const cat = categories.find(c => c.id === catId);
                    return cat ? (
                      <span
                        key={catId}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                      >
                        <Tag size={10} />
                        {cat.name}
                        <button
                          type="button"
                          onClick={() => setUploadCategoryIds(ids => ids.filter(id => id !== catId))}
                          className="hover:bg-blue-200 rounded-full p-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })
                )}
              </div>
              <select
                value=""
                onChange={(e) => {
                  const catId = parseInt(e.target.value, 10);
                  if (catId && !uploadCategoryIds.includes(catId)) {
                    setUploadCategoryIds([...uploadCategoryIds, catId]);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Add category...</option>
                {categories
                  .filter(cat => !uploadCategoryIds.includes(cat.id))
                  .map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))
                }
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="uploadIsGlobal"
              checked={uploadIsGlobal}
              onChange={(e) => setUploadIsGlobal(e.target.checked)}
              className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
            />
            <label htmlFor="uploadIsGlobal" className="flex items-center gap-2 text-sm text-gray-700">
              <Globe size={16} className="text-purple-600" />
              Global document (available in all categories)
            </label>
          </div>

          <p className="text-xs text-gray-500">
            {uploadIsGlobal
              ? 'Global documents are indexed into all category collections for universal access.'
              : uploadCategoryIds.length > 0
              ? `This document will be available to users subscribed to the selected ${uploadCategoryIds.length === 1 ? 'category' : 'categories'}.`
              : 'Select categories or mark as global to control document visibility.'}
          </p>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => {
              setShowUploadModal(false);
              resetUploadForm();
            }}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUploadConfirm}
            loading={uploading}
            disabled={
              uploadMode === 'file'
                ? !uploadFile
                : uploadMode === 'text'
                ? (!uploadTextName.trim() || !uploadTextContent.trim())
                : uploadMode === 'web'
                ? getValidWebUrls().length === 0
                : !uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim())
            }
          >
            <Upload size={18} className="mr-2" />
            {uploadProgress || 'Upload'}
          </Button>
        </div>
      </Modal>

      {/* Edit Document Modal */}
      <Modal
        isOpen={!!editingDoc}
        onClose={() => setEditingDoc(null)}
        title="Edit Document Categories"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
            <FileText className="w-5 h-5 text-blue-600" />
            <span className="text-sm text-gray-700 truncate font-medium">{editingDoc?.filename}</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Categories
            </label>
            <div className="border border-gray-200 rounded-lg p-2">
              <div className="flex flex-wrap gap-2 mb-2">
                {editDocCategoryIds.length === 0 ? (
                  <span className="text-sm text-gray-500">No categories selected</span>
                ) : (
                  editDocCategoryIds.map(catId => {
                    const cat = categories.find(c => c.id === catId);
                    return cat ? (
                      <span
                        key={catId}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                      >
                        <Tag size={10} />
                        {cat.name}
                        <button
                          type="button"
                          onClick={() => setEditDocCategoryIds(ids => ids.filter(id => id !== catId))}
                          className="hover:bg-blue-200 rounded-full p-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })
                )}
              </div>
              <select
                value=""
                onChange={(e) => {
                  const catId = parseInt(e.target.value, 10);
                  if (catId && !editDocCategoryIds.includes(catId)) {
                    setEditDocCategoryIds([...editDocCategoryIds, catId]);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Add category...</option>
                {categories
                  .filter(cat => !editDocCategoryIds.includes(cat.id))
                  .map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))
                }
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="editDocIsGlobal"
              checked={editDocIsGlobal}
              onChange={(e) => setEditDocIsGlobal(e.target.checked)}
              className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
            />
            <label htmlFor="editDocIsGlobal" className="flex items-center gap-2 text-sm text-gray-700">
              <Globe size={16} className="text-purple-600" />
              Global document (available in all categories)
            </label>
          </div>

          <p className="text-xs text-gray-500">
            {editDocIsGlobal
              ? 'This document will be re-indexed into all category collections.'
              : editDocCategoryIds.length > 0
              ? `This document will be re-indexed into the selected ${editDocCategoryIds.length === 1 ? 'category' : 'categories'}.`
              : 'Select categories or mark as global. Changes will trigger re-indexing.'}
          </p>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => setEditingDoc(null)}
            disabled={savingDocChanges}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveDocChanges}
            loading={savingDocChanges}
          >
            <Save size={18} className="mr-2" />
            Save Changes
          </Button>
        </div>
      </Modal>

      {/* Add User Modal */}
      <Modal
        isOpen={showAddUser}
        onClose={() => setShowAddUser(false)}
        title="Add User"
      >
        <form onSubmit={handleAddUser}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address *
              </label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name (optional)
              </label>
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <select
                value={newUserRole}
                onChange={(e) => {
                  setNewUserRole(e.target.value as 'admin' | 'superuser' | 'user');
                  setNewUserSubscriptions([]);
                  setNewUserAssignedCategories([]);
                }}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="user">User - Can use chat and upload documents</option>
                <option value="superuser">Super User - Can manage assigned categories</option>
                <option value="admin">Admin - Full access including user management</option>
              </select>
            </div>

            {/* Category selection for users */}
            {newUserRole === 'user' && categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subscribe to Categories
                </label>
                <div className="border border-gray-200 rounded-lg p-2">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {newUserSubscriptions.length === 0 ? (
                      <span className="text-sm text-gray-500">No categories selected</span>
                    ) : (
                      newUserSubscriptions.map(catId => {
                        const cat = categories.find(c => c.id === catId);
                        return cat ? (
                          <span
                            key={catId}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                          >
                            <Tag size={10} />
                            {cat.name}
                            <button
                              type="button"
                              onClick={() => setNewUserSubscriptions(ids => ids.filter(id => id !== catId))}
                              className="hover:bg-blue-200 rounded-full p-0.5"
                            >
                              ×
                            </button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      const catId = parseInt(e.target.value, 10);
                      if (catId && !newUserSubscriptions.includes(catId)) {
                        setNewUserSubscriptions([...newUserSubscriptions, catId]);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Add category subscription...</option>
                    {categories
                      .filter(cat => !newUserSubscriptions.includes(cat.id))
                      .map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))
                    }
                  </select>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  User will have access to documents in these categories.
                </p>
              </div>
            )}

            {/* Category assignment for super users */}
            {newUserRole === 'superuser' && categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign Categories to Manage
                </label>
                <div className="border border-gray-200 rounded-lg p-2">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {newUserAssignedCategories.length === 0 ? (
                      <span className="text-sm text-gray-500">No categories assigned</span>
                    ) : (
                      newUserAssignedCategories.map(catId => {
                        const cat = categories.find(c => c.id === catId);
                        return cat ? (
                          <span
                            key={catId}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full"
                          >
                            <FolderOpen size={10} />
                            {cat.name}
                            <button
                              type="button"
                              onClick={() => setNewUserAssignedCategories(ids => ids.filter(id => id !== catId))}
                              className="hover:bg-orange-200 rounded-full p-0.5"
                            >
                              ×
                            </button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      const catId = parseInt(e.target.value, 10);
                      if (catId && !newUserAssignedCategories.includes(catId)) {
                        setNewUserAssignedCategories([...newUserAssignedCategories, catId]);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Assign category...</option>
                    {categories
                      .filter(cat => !newUserAssignedCategories.includes(cat.id))
                      .map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))
                    }
                  </select>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Super user will be able to manage users subscribed to these categories.
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAddUser(false);
                setNewUserSubscriptions([]);
                setNewUserAssignedCategories([]);
              }}
              disabled={addingUser}
            >
              Cancel
            </Button>
            <Button type="submit" loading={addingUser}>
              Add User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete User Modal */}
      <Modal
        isOpen={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        title="Remove User?"
      >
        <p className="text-gray-600 mb-4">
          Are you sure you want to remove access for &quot;{deleteUser?.email}&quot;?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This user will no longer be able to sign in to the application.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setDeleteUser(null)}
            disabled={deletingUser}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteUser}
            loading={deletingUser}
          >
            Remove
          </Button>
        </div>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title="Change User Role"
      >
        <p className="text-gray-600 mb-4">
          Change role for &quot;{editingUser?.email}&quot;
        </p>
        <div className="space-y-2 mb-6">
          <button
            onClick={() => handleUpdateRole('user')}
            disabled={updatingRole || editingUser?.role === 'user'}
            className={`w-full p-3 text-left border rounded-lg transition-colors ${
              editingUser?.role === 'user'
                ? 'border-blue-500 bg-blue-50'
                : 'hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <User size={20} className="text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">User</p>
                <p className="text-sm text-gray-500">Can use chat and upload documents</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => handleUpdateRole('superuser')}
            disabled={updatingRole || editingUser?.role === 'superuser'}
            className={`w-full p-3 text-left border rounded-lg transition-colors ${
              editingUser?.role === 'superuser'
                ? 'border-orange-500 bg-orange-50'
                : 'hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <UserPlus size={20} className="text-orange-600" />
              <div>
                <p className="font-medium text-gray-900">Super User</p>
                <p className="text-sm text-gray-500">Can manage assigned categories</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => handleUpdateRole('admin')}
            disabled={updatingRole || editingUser?.role === 'admin'}
            className={`w-full p-3 text-left border rounded-lg transition-colors ${
              editingUser?.role === 'admin'
                ? 'border-purple-500 bg-purple-50'
                : 'hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <Shield size={20} className="text-purple-600" />
              <div>
                <p className="font-medium text-gray-900">Admin</p>
                <p className="text-sm text-gray-500">Full access including user management</p>
              </div>
            </div>
          </button>
        </div>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => setEditingUser(null)}
            disabled={updatingRole}
          >
            {updatingRole ? <Spinner size="sm" /> : 'Close'}
          </Button>
        </div>
      </Modal>

      {/* Manage User Subscriptions Modal */}
      <Modal
        isOpen={!!managingUserSubs}
        onClose={() => setManagingUserSubs(null)}
        title={managingUserSubs?.role === 'superuser' ? 'Manage Superuser Access' : 'Manage Subscriptions'}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              managingUserSubs?.role === 'superuser' ? 'bg-orange-100' : 'bg-gray-100'
            }`}>
              {managingUserSubs?.role === 'superuser' ? (
                <UserPlus size={16} className="text-orange-600" />
              ) : (
                <User size={16} className="text-gray-600" />
              )}
            </div>
            <div>
              <p className="font-medium text-gray-900 text-sm">
                {managingUserSubs?.name || managingUserSubs?.email.split('@')[0]}
              </p>
              <p className="text-xs text-gray-500">{managingUserSubs?.email}</p>
            </div>
          </div>

          {managingUserSubs?.role === 'user' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category Subscriptions
              </label>
              <div className="border border-gray-200 rounded-lg p-2">
                <div className="flex flex-wrap gap-2 mb-2">
                  {editUserSubscriptions.length === 0 ? (
                    <span className="text-sm text-gray-500">No subscriptions</span>
                  ) : (
                    editUserSubscriptions.map(catId => {
                      const cat = categories.find(c => c.id === catId);
                      return cat ? (
                        <span
                          key={catId}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                        >
                          <Tag size={10} />
                          {cat.name}
                          <button
                            type="button"
                            onClick={() => setEditUserSubscriptions(ids => ids.filter(id => id !== catId))}
                            className="hover:bg-blue-200 rounded-full p-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ) : null;
                    })
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const catId = parseInt(e.target.value, 10);
                    if (catId && !editUserSubscriptions.includes(catId)) {
                      setEditUserSubscriptions([...editUserSubscriptions, catId]);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">Add subscription...</option>
                  {categories
                    .filter(cat => !editUserSubscriptions.includes(cat.id))
                    .map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))
                  }
                </select>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                User will have access to documents in subscribed categories.
              </p>
            </div>
          )}

          {managingUserSubs?.role === 'superuser' && (
            <>
              {/* Assigned Categories - for management access */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assigned Categories (Management)
                </label>
                <div className="border border-gray-200 rounded-lg p-2">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {editUserAssignedCategories.length === 0 ? (
                      <span className="text-sm text-gray-500">No categories assigned</span>
                    ) : (
                      editUserAssignedCategories.map(catId => {
                        const cat = categories.find(c => c.id === catId);
                        return cat ? (
                          <span
                            key={catId}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full"
                          >
                            <FolderOpen size={10} />
                            {cat.name}
                            <button
                              type="button"
                              onClick={() => setEditUserAssignedCategories(ids => ids.filter(id => id !== catId))}
                              className="hover:bg-orange-200 rounded-full p-0.5"
                            >
                              ×
                            </button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      const catId = parseInt(e.target.value, 10);
                      if (catId && !editUserAssignedCategories.includes(catId)) {
                        setEditUserAssignedCategories([...editUserAssignedCategories, catId]);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Assign category...</option>
                    {categories
                      .filter(cat => !editUserAssignedCategories.includes(cat.id))
                      .map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))
                    }
                  </select>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Superuser can manage documents and users for these categories.
                </p>
              </div>

              {/* Subscriptions - for read access to other categories */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subscriptions (Read Access)
                </label>
                <div className="border border-gray-200 rounded-lg p-2">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {editUserSubscriptions.length === 0 ? (
                      <span className="text-sm text-gray-500">No subscriptions</span>
                    ) : (
                      editUserSubscriptions.map(catId => {
                        const cat = categories.find(c => c.id === catId);
                        return cat ? (
                          <span
                            key={catId}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                          >
                            <Tag size={10} />
                            {cat.name}
                            <button
                              type="button"
                              onClick={() => setEditUserSubscriptions(ids => ids.filter(id => id !== catId))}
                              className="hover:bg-blue-200 rounded-full p-0.5"
                            >
                              ×
                            </button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      const catId = parseInt(e.target.value, 10);
                      if (catId && !editUserSubscriptions.includes(catId)) {
                        setEditUserSubscriptions([...editUserSubscriptions, catId]);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Add subscription...</option>
                    {categories
                      .filter(cat => !editUserSubscriptions.includes(cat.id))
                      .map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))
                    }
                  </select>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Superuser can chat with and access documents in these additional categories.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => setManagingUserSubs(null)}
            disabled={savingUserSubs}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveUserSubs}
            loading={savingUserSubs}
          >
            <Save size={18} className="mr-2" />
            Save Changes
          </Button>
        </div>
      </Modal>

      {/* Add Category Modal */}
      <Modal
        isOpen={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        title="Create Category"
      >
        <form onSubmit={handleAddCategory}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category Name *
              </label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g., Human Resources"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                A URL-safe slug will be generated automatically
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <textarea
                value={newCategoryDescription}
                onChange={(e) => setNewCategoryDescription(e.target.value)}
                placeholder="Brief description of this category"
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAddCategory(false)}
              disabled={addingCategory}
            >
              Cancel
            </Button>
            <Button type="submit" loading={addingCategory}>
              Create Category
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Category Modal */}
      <Modal
        isOpen={!!deleteCategory}
        onClose={() => setDeleteCategory(null)}
        title="Delete Category?"
      >
        <p className="text-gray-600 mb-4">
          Are you sure you want to delete &quot;{deleteCategory?.name}&quot;?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This will remove the category. Documents assigned to this category will become unassigned.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setDeleteCategory(null)}
            disabled={deletingCategory}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteCategory}
            loading={deletingCategory}
          >
            Delete
          </Button>
        </div>
      </Modal>

      {/* Edit Category Modal */}
      <Modal
        isOpen={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        title="Edit Category"
      >
        <form onSubmit={handleUpdateCategory}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category Name *
              </label>
              <input
                type="text"
                value={editCategoryName}
                onChange={(e) => setEditCategoryName(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={editCategoryDescription}
                onChange={(e) => setEditCategoryDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingCategory(null)}
              disabled={updatingCategory}
            >
              Cancel
            </Button>
            <Button type="submit" loading={updatingCategory}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Restore All Defaults Confirmation Modal */}
      <Modal
        isOpen={showRestoreConfirm}
        onClose={() => setShowRestoreConfirm(false)}
        title="Reset to JSON Config Defaults?"
      >
        <p className="text-gray-600 mb-4">
          This will reset ALL settings to the values defined in <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">config/defaults.json</code>:
        </p>
        <ul className="text-sm text-gray-600 list-disc list-inside mb-4 space-y-1">
          <li><strong>LLM Settings:</strong> Model, temperature, max tokens</li>
          <li><strong>RAG Settings:</strong> Chunk size, overlap, thresholds</li>
          <li><strong>Embedding Settings:</strong> Model and dimensions</li>
          <li><strong>Reranker Settings:</strong> Provider and configuration</li>
          <li><strong>System Prompt:</strong> From system-prompt.md</li>
          <li><strong>Branding:</strong> Bot name and icon</li>
          <li><strong>All other settings:</strong> Tavily, acronyms, retention, uploads</li>
        </ul>
        <p className="text-sm text-orange-600 font-medium">
          This action cannot be undone. All customizations made via Admin UI will be cleared.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => setShowRestoreConfirm(false)}
            disabled={restoringDefaults}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRestoreAllDefaults}
            loading={restoringDefaults}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Reset to Defaults
          </Button>
        </div>
      </Modal>

      {/* Category Prompt Edit Modal */}
      <Modal
        isOpen={editingCategoryPrompt !== null}
        onClose={handleCloseCategoryPromptModal}
        title={`Edit Prompt: ${categoryPromptData?.category.name || 'Category'}`}
      >
        {categoryPromptLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : categoryPromptData ? (
          <div className="space-y-6">
            {/* Global Prompt Preview (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Global System Prompt
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  ({categoryPromptData.charInfo.globalLength} chars)
                </span>
              </label>
              <div className="bg-gray-50 border rounded-lg p-3 max-h-40 overflow-y-auto">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono">
                  {categoryPromptData.globalPrompt}
                </pre>
              </div>
            </div>

            {/* Category Addendum (Editable) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category-Specific Addendum
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  ({editedCategoryAddendum.length} / {categoryPromptData.charInfo.availableForCategory} chars available)
                </span>
              </label>
              <textarea
                value={editedCategoryAddendum}
                onChange={(e) => handleCategoryAddendumChange(e.target.value)}
                rows={6}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm ${
                  editedCategoryAddendum.length > categoryPromptData.charInfo.availableForCategory
                    ? 'border-red-300 bg-red-50'
                    : ''
                }`}
                placeholder="Add category-specific guidance here (optional)..."
              />
              {editedCategoryAddendum.length > categoryPromptData.charInfo.availableForCategory && (
                <p className="mt-1 text-xs text-red-600">
                  Exceeds available character limit
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                This text will be appended to the global system prompt for this category.
              </p>
            </div>

            {/* Starter Prompts */}
            <div className="border-t pt-4">
              <StarterPromptsEditor
                starters={editedStarterPrompts}
                onChange={handleStarterPromptsChange}
                disabled={savingCategoryPrompt}
              />
            </div>

            {/* Welcome Message Configuration */}
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Welcome Screen (Optional)
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Custom welcome message shown to users on the chat home screen for this category.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Welcome Title
                    <span className="ml-1 text-gray-400 font-normal">
                      ({editedWelcomeTitle.length}/50 chars)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={editedWelcomeTitle}
                    onChange={(e) => handleWelcomeTitleChange(e.target.value)}
                    maxLength={50}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm ${
                      editedWelcomeTitle.length > 50 ? 'border-red-300 bg-red-50' : ''
                    }`}
                    placeholder="e.g., Welcome to LEAPai"
                    disabled={savingCategoryPrompt}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Welcome Message
                    <span className="ml-1 text-gray-400 font-normal">
                      ({editedWelcomeMessage.length}/200 chars)
                    </span>
                  </label>
                  <textarea
                    value={editedWelcomeMessage}
                    onChange={(e) => handleWelcomeMessageChange(e.target.value)}
                    maxLength={200}
                    rows={2}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm ${
                      editedWelcomeMessage.length > 200 ? 'border-red-300 bg-red-50' : ''
                    }`}
                    placeholder="e.g., How can I help you with policy questions today?"
                    disabled={savingCategoryPrompt}
                  />
                </div>
              </div>
            </div>

            {/* Combined Preview (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Combined Prompt Preview
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  (Total: {categoryPromptData.charInfo.globalLength + (editedCategoryAddendum ? editedCategoryAddendum.length + 42 : 0)} / {categoryPromptData.charInfo.maxCombined} chars)
                </span>
              </label>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                  {categoryPromptData.globalPrompt}
                  {editedCategoryAddendum && (
                    <>
                      {'\n\n--- Category-Specific Guidelines ---\n\n'}
                      <span className="text-blue-700">{editedCategoryAddendum}</span>
                    </>
                  )}
                </pre>
              </div>
            </div>

            {/* Metadata */}
            {categoryPromptData.metadata && (
              <p className="text-xs text-gray-500">
                Last updated: {formatDate(categoryPromptData.metadata.updatedAt)} by {categoryPromptData.metadata.updatedBy}
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={handleResetCategoryToGlobal}
                  disabled={savingCategoryPrompt || optimizing || !categoryPromptData.categoryAddendum}
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <RefreshCw size={16} className="mr-2" />
                  Reset to Global Only
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleOptimizePrompt}
                  disabled={savingCategoryPrompt || optimizing || !editedCategoryAddendum.trim()}
                  loading={optimizing}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50"
                >
                  <Wand2 size={16} className="mr-2" />
                  Optimize
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={handleCloseCategoryPromptModal}
                  disabled={savingCategoryPrompt || optimizing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveCategoryPrompt}
                  disabled={
                    (!categoryPromptModified && !starterPromptsModified && !welcomeModified) ||
                    savingCategoryPrompt ||
                    optimizing ||
                    editedCategoryAddendum.length > categoryPromptData.charInfo.availableForCategory
                  }
                  loading={savingCategoryPrompt}
                >
                  <Save size={16} className="mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">Failed to load category prompt data</p>
        )}
      </Modal>

      {/* Optimization Diff Modal */}
      <Modal
        isOpen={showOptimizationDiff && optimizationResult !== null}
        onClose={handleRejectOptimization}
        title="Optimization Results"
      >
        {optimizationResult && (
          <div className="space-y-4">
            {/* Changes Made */}
            {optimizationResult.changes.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Changes Made:</h4>
                <ul className="space-y-1">
                  {optimizationResult.changes.map((change, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                      <CheckCircle size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {optimizationResult.changes.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-2">
                No optimization changes needed - the prompt is already efficient.
              </div>
            )}

            {/* Side by Side Diff */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Original
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    ({optimizationResult.original.length} chars)
                  </span>
                </label>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 h-48 overflow-y-auto">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                    {optimizationResult.original || <span className="text-gray-400 italic">Empty</span>}
                  </pre>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Optimized
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    ({optimizationResult.optimized.length} chars)
                  </span>
                </label>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 h-48 overflow-y-auto">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                    {optimizationResult.optimized || <span className="text-gray-400 italic">Empty</span>}
                  </pre>
                </div>
              </div>
            </div>

            {/* Tokens Used */}
            <p className="text-xs text-gray-500 text-center">
              Tokens used: {optimizationResult.tokensUsed.toLocaleString()}
            </p>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="secondary" onClick={handleRejectOptimization}>
                Reject
              </Button>
              <Button
                onClick={handleAcceptOptimization}
                disabled={optimizationResult.original === optimizationResult.optimized}
              >
                <CheckCircle size={16} className="mr-2" />
                Accept Optimization
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
