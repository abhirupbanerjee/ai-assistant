'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, AlertCircle, ChevronUp, ChevronDown, Users, Settings, MessageSquare, Coins, Key } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import BackupTab from '@/components/admin/BackupTab';
import SkillsTab from '@/components/admin/SkillsTab';
import ToolsTab from '@/components/admin/ToolsTab';
import AdminSidebarMenu from '@/components/admin/AdminSidebarMenu';
import CacheSettingsTab from '@/components/admin/CacheSettingsTab';
import WorkspacesTab from '@/components/admin/WorkspacesTab';
import { AgentBotsManagement, AgentBotDetail } from '@/components/admin/agent-bots';
import MemorySettingsTab from '@/components/admin/settings/MemorySettings';
import SummarizationSettingsTab from '@/components/admin/settings/SummarizationSettings';
import SuperuserSettingsTab from '@/components/admin/settings/SuperuserSettings';
import CredentialsAuthSettingsTab from '@/components/admin/settings/CredentialsAuthSettings';
import ApiKeysSettings from '@/components/admin/settings/ApiKeysSettings';
import RoutesSettingsPanel from '@/components/admin/settings/RoutesSettings';
import UnifiedLLMSettings from '@/components/admin/settings/UnifiedLLMSettings';
import UnifiedRAGSettings from '@/components/admin/settings/UnifiedRAGSettings';
import RerankerSettingsTab from '@/components/admin/settings/RerankerSettings';
import DocumentProcessingTab from '@/components/admin/settings/DocumentProcessing';
import SpeechSettingsTab from '@/components/admin/settings/SpeechSettings';
import DashboardPage from '@/components/admin/dashboard/DashboardPage';
import UserManagement from '@/components/admin/users/UserManagement';
import CategoriesManagement from '@/components/admin/categories/CategoriesManagement';
import DocumentsManagement from '@/components/admin/documents/DocumentsManagement';
import SystemPromptSettings from '@/components/admin/prompts/SystemPromptSettings';
import CategoryPromptsSettings from '@/components/admin/prompts/CategoryPromptsSettings';
import BrandingSettingsTab from '@/components/admin/BrandingSettings';
import AgentSettingsTab from '@/components/admin/AgentSettings';
import TokenLimitsSettingsTab from '@/components/admin/tokens/TokenLimitsSettings';
import TokenUsageDashboard from '@/components/admin/TokenUsageDashboard';

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

// New menu structure types - matching AdminSidebarMenu
type TabType = 'branding' | 'dashboard' | 'categories' | 'documents' | 'users' | 'prompts' | 'tools' | 'skills' | 'agents' | 'tokens' | 'usage' | 'workspaces' | 'settings';
type DocumentsSection = 'documents' | 'acronyms';
type UsersSection = 'management' | 'superuser' | 'credentials-auth';
type PromptsSection = 'system-prompt' | 'category-prompts';
type AgentsSection = 'config' | 'bots';
type TokensSection = 'memory' | 'summarization' | 'limits';
type SettingsSection = 'api-keys' | 'routes' | 'llm' | 'rag' | 'reranker' | 'ocr' | 'speech' | 'cache' | 'backup';

// Legacy types for backward compatibility during migration
type ToolsSection = 'management' | 'dependencies' | 'routing' | 'conflicts';

interface RerankerSettings {
  enabled: boolean;
  provider: 'cohere' | 'jina' | 'local';
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

interface ModelTokenLimitsState {
  limits: Record<string, number | 'default'>;
  updatedAt?: string;
  updatedBy?: string;
}

type OcrProvider = 'mistral' | 'azure-di' | 'pdf-parse';

interface OcrProviderConfig {
  provider: OcrProvider;
  enabled: boolean;
}

interface OcrSettings {
  providers: OcrProviderConfig[];
  updatedAt?: string;
  updatedBy?: string;
  providerAvailability?: Record<string, boolean>;
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

interface SystemStats {
  database: {
    users: { total: number; admins: number; superUsers: number; regularUsers: number };
    categories: { total: number; withDocuments: number; totalSubscriptions: number };
    threads: { total: number; totalMessages: number; totalUploads: number };
    documents: { total: number; globalDocuments: number; categoryDocuments: number; totalChunks: number; byStatus: { processing: number; ready: number; error: number } };
  };
  vectorStore: {
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

const VALID_SETTINGS_SECTIONS: SettingsSection[] = ['api-keys', 'routes', 'llm', 'rag', 'reranker', 'ocr', 'speech', 'cache', 'backup'];
const VALID_AGENTS_SECTIONS: AgentsSection[] = ['config', 'bots'];

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const sectionParam = searchParams.get('section');
  const agentSectionParam = searchParams.get('agentSection');
  const [activeTab, setActiveTab] = useState<TabType>(tabParam || 'dashboard');
  const [userRole, setUserRole] = useState<'admin' | 'superuser' | 'user'>('admin');

  // RAG/LLM settings state
  // Section state for expandable menus
  const [documentsSection, setDocumentsSection] = useState<DocumentsSection>('documents');
  const [usersSection, setUsersSection] = useState<UsersSection>('management');
  const [promptsSection, setPromptsSection] = useState<PromptsSection>('system-prompt');
  const [agentsSection, setAgentsSection] = useState<AgentsSection>(
    VALID_AGENTS_SECTIONS.includes(agentSectionParam as AgentsSection)
      ? (agentSectionParam as AgentsSection)
      : 'config'
  );
  const [tokensSection, setTokensSection] = useState<TokensSection>('memory');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    VALID_SETTINGS_SECTIONS.includes(sectionParam as SettingsSection)
      ? (sectionParam as SettingsSection)
      : 'api-keys'
  );

  // Agent Bots state - track selected bot for detail view
  const [selectedAgentBotId, setSelectedAgentBotId] = useState<string | null>(null);

  // Legacy tools section for backward compatibility
  const [toolsSection, setToolsSection] = useState<ToolsSection>('management');

  // Accordion expanded states for flattened menu items
  const [expandedUsersSections, setExpandedUsersSections] = useState<Set<UsersSection>>(new Set(['management']));
  const [expandedPromptsSections, setExpandedPromptsSections] = useState<Set<PromptsSection>>(new Set(['system-prompt']));
  const [expandedTokensSections, setExpandedTokensSections] = useState<Set<TokensSection>>(new Set(['memory']));

  // Handle tab change - updates both state and URL
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    router.push(`/admin?tab=${tab}`, { scroll: false });
  }, [router]);

  // Handle settings section change - updates both state and URL so section survives remounts
  const handleSettingsChange = useCallback((section: SettingsSection) => {
    setActiveTab('settings');
    setSettingsSection(section);
    router.push(`/admin?tab=settings&section=${section}`, { scroll: false });
  }, [router]);

  // Handle agents section change - updates both state and URL so section survives remounts
  const handleAgentsChange = useCallback((section: AgentsSection) => {
    setActiveTab('agents');
    setAgentsSection(section);
    router.push(`/admin?tab=agents&agentSection=${section}`, { scroll: false });
  }, [router]);

  const toggleUsersSection = (section: UsersSection) => {
    setExpandedUsersSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) newSet.delete(section);
      else newSet.add(section);
      return newSet;
    });
  };

  const togglePromptsSection = (section: PromptsSection) => {
    setExpandedPromptsSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) newSet.delete(section);
      else newSet.add(section);
      return newSet;
    });
  };

  const toggleTokensSection = (section: TokensSection) => {
    setExpandedTokensSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) newSet.delete(section);
      else newSet.add(section);
      return newSet;
    });
  };

  // LLM collapse state
  const [llmSettingsExpanded, setLlmSettingsExpanded] = useState(true);
  const [llmTokenLimitsExpanded, setLlmTokenLimitsExpanded] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);
  const [editedLlm, setEditedLlm] = useState<Omit<LLMSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [rerankerSettings, setRerankerSettings] = useState<RerankerSettings | null>(null);
  const [editedReranker, setEditedReranker] = useState<Omit<RerankerSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [editedMemory, setEditedMemory] = useState<Omit<MemorySettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [summarizationSettings, setSummarizationSettings] = useState<SummarizationSettings | null>(null);
  const [editedSummarization, setEditedSummarization] = useState<Omit<SummarizationSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [limitsSettings, setLimitsSettingsState] = useState<LimitsSettings | null>(null);
  const [editedLimits, setEditedLimits] = useState<Omit<LimitsSettings, 'updatedAt' | 'updatedBy'> | null>(null);
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

  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [llmModified, setLlmModified] = useState(false);
  const [rerankerModified, setRerankerModified] = useState(false);
  const [memoryModified, setMemoryModified] = useState(false);
  const [summarizationModified, setSummarizationModified] = useState(false);
  const [limitsModified, setLimitsModified] = useState(false);
  const [uploadModified, setUploadModified] = useState(false);
  const [ocrSettings, setOcrSettingsState] = useState<OcrSettings | null>(null);
  const [editedOcr, setEditedOcr] = useState<OcrProviderConfig[] | null>(null);
  const [ocrModified, setOcrModified] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Stats state
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);


  // Load user role
  const loadUserRole = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const data = await response.json();
        setUserRole(data.role || 'user');
        // If user is not admin or superuser, redirect to home
        if (data.role !== 'admin' && data.role !== 'superuser') {
          router.push('/chat');
          return false;
        }
        return true;
      } else if (response.status === 401) {
        router.push('/chat');
        return false;
      }
    } catch (error) {
      console.error('Failed to load user role:', error);
    }
    return true;
  }, [router]);

  // Load RAG/LLM settings
  const loadSettings = useCallback(async () => {
    try {
      // First check user role
      const hasAccess = await loadUserRole();
      if (!hasAccess) return;

      const response = await fetch('/api/admin/settings');

      if (response.status === 403) {
        router.push('/chat');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load settings');
      }

      const data = await response.json();
      if (data.llm) {
        setLlmSettings(data.llm);
        setEditedLlm({
          model: data.llm.model,
          temperature: data.llm.temperature,
          maxTokens: data.llm.maxTokens,
          promptOptimizationMaxTokens: data.llm.promptOptimizationMaxTokens,
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
      if (data.embedding) {
        setEmbeddingSettings(data.embedding);
      }
      if (data.ocr) {
        setOcrSettingsState(data.ocr);
        setEditedOcr(data.ocr.providers.map((p: OcrProviderConfig) => ({ ...p })));
      }
      if (data.models?.transcription) {
        setTranscriptionModel(data.models.transcription);
      }
      setAvailableModels((data.availableModels || []).filter(Boolean));
      setLlmModified(false);
      setRerankerModified(false);
      setMemoryModified(false);
      setSummarizationModified(false);
      setLimitsModified(false);
      setUploadModified(false);
      setOcrModified(false);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [router, loadUserRole]);

  // Load system stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await fetch('/api/admin/stats');

      if (response.status === 403) {
        router.push('/chat');
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
  // Helper to get provider from model name
  const getModelProvider = useCallback((model: string): 'openai' | 'mistral' | 'ollama' | 'azure' => {
    if (model.startsWith('ollama-')) return 'ollama';
    if (model.startsWith('mistral') || model.startsWith('ministral')) return 'mistral';
    if (model.startsWith('azure-')) return 'azure';
    return 'openai';
  }, []);

  useEffect(() => {
    loadSettings();
    loadStats();
  }, [loadSettings, loadStats]);

  // Sync URL tab parameter to state (with backward compatibility for legacy URLs)
  useEffect(() => {
    const tab = searchParams.get('tab');
    const section = searchParams.get('section');
    const agentSection = searchParams.get('agentSection');
    if (tab) {
      // Handle legacy agent URLs
      if (tab === 'agent') {
        setActiveTab('agents');
        setAgentsSection('config');
        router.replace('/admin?tab=agents&agentSection=config', { scroll: false });
      } else if (tab === 'agent-bots') {
        setActiveTab('agents');
        setAgentsSection('bots');
        router.replace('/admin?tab=agents&agentSection=bots', { scroll: false });
      } else {
        setActiveTab(tab as TabType);
      }
      // Sync settings section from URL
      if (tab === 'settings' && section && VALID_SETTINGS_SECTIONS.includes(section as SettingsSection)) {
        setSettingsSection(section as SettingsSection);
      }
      // Sync agents section from URL
      if (tab === 'agents' && agentSection && VALID_AGENTS_SECTIONS.includes(agentSection as AgentsSection)) {
        setAgentsSection(agentSection as AgentsSection);
      }
    }
  }, [searchParams, router]); // Only depend on searchParams and router

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
      setShowRestoreConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore defaults');
    } finally {
      setRestoringDefaults(false);
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

  // OCR settings handlers
  const handleSaveOcr = async () => {
    if (!editedOcr || !ocrModified) return;

    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ocr', settings: { providers: editedOcr } }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save OCR settings');
      }

      // Refresh settings to get updated metadata
      setOcrSettingsState(prev => prev ? { ...prev, providers: editedOcr } : null);
      setOcrModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save OCR settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetOcr = () => {
    if (ocrSettings) {
      setEditedOcr(ocrSettings.providers.map(p => ({ ...p })));
      setOcrModified(false);
    }
  };

  const handleMoveOcrProvider = (index: number, direction: 'up' | 'down') => {
    if (!editedOcr) return;
    const newProviders = [...editedOcr];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newProviders.length) return;
    [newProviders[index], newProviders[swapIndex]] = [newProviders[swapIndex], newProviders[index]];
    setEditedOcr(newProviders);
    setOcrModified(true);
  };

  const handleToggleOcrProvider = (index: number) => {
    if (!editedOcr) return;
    const newProviders = [...editedOcr];
    newProviders[index] = { ...newProviders[index], enabled: !newProviders[index].enabled };
    setEditedOcr(newProviders);
    setOcrModified(true);
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

  // Utility functions
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };


  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 h-16">
        <div className="h-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/chat')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {userRole === 'superuser' ? 'Dashboard' : 'Admin Dashboard'}
              </h1>
              <p className="text-sm text-gray-500 hidden sm:block">
                {userRole === 'superuser' ? 'View statistics for your assigned categories' : 'Manage documents and users'}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout with Sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <AdminSidebarMenu
          activeTab={activeTab}
          documentsSection={documentsSection}
          usersSection={usersSection}
          promptsSection={promptsSection}
          agentsSection={agentsSection}
          tokensSection={tokensSection}
          settingsSection={settingsSection}
          userRole={userRole}
          onTabChange={handleTabChange}
          onDocumentsChange={setDocumentsSection}
          onUsersChange={setUsersSection}
          onPromptsChange={setPromptsSection}
          onAgentsChange={handleAgentsChange}
          onTokensChange={setTokensSection}
          onSettingsChange={handleSettingsChange}
        />

        {/* Main Content */}
        <main className="flex-1 min-h-0 p-4 md:p-6 overflow-auto">
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
        {activeTab === 'dashboard' && <DashboardPage />}

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <DocumentsManagement documentsSection={documentsSection} />
        )}

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <CategoriesManagement />
        )}

        {/* Users Tab - Accordion UI */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* User Management Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => toggleUsersSection('management')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Users size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">User Management</h2>
                    <p className="text-sm text-gray-500">Manage users and their permissions</p>
                  </div>
                </div>
                {expandedUsersSections.has('management') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedUsersSections.has('management') && (
                <div className="border-t">
                  <UserManagement />
                </div>
              )}
            </div>

            {/* Superuser Settings Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => toggleUsersSection('superuser')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Settings size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Superuser Settings</h2>
                    <p className="text-sm text-gray-500">Configure superuser permissions and categories</p>
                  </div>
                </div>
                {expandedUsersSections.has('superuser') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedUsersSections.has('superuser') && (
                <div className="border-t">
                  <SuperuserSettingsTab />
                </div>
              )}
            </div>

            {/* Credentials Authentication Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => toggleUsersSection('credentials-auth')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Key size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Credentials Authentication</h2>
                    <p className="text-sm text-gray-500">Configure email/password login for dev and offline scenarios</p>
                  </div>
                </div>
                {expandedUsersSections.has('credentials-auth') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedUsersSections.has('credentials-auth') && (
                <div className="border-t">
                  <CredentialsAuthSettingsTab />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <>
              {/* API Keys Section */}
              {settingsSection === 'api-keys' && <ApiKeysSettings />}
              {/* Routes Settings Section */}
              {settingsSection === 'routes' && <RoutesSettingsPanel />}
              {/* LLM Settings Section */}
              {settingsSection === 'llm' && <UnifiedLLMSettings />}

              {/* RAG Settings Section */}
              {settingsSection === 'rag' && <UnifiedRAGSettings />}

              {/* Branding moved to top-level tab */}

              {/* Reranker Section */}
              {settingsSection === 'reranker' && <RerankerSettingsTab />}

              {/* Document Processing (OCR) Section */}
              {settingsSection === 'ocr' && <DocumentProcessingTab />}

              {/* Speech (STT + TTS) Section */}
              {settingsSection === 'speech' && <SpeechSettingsTab />}

              {/* Memory, Summarization, Limits, and Agent sections removed from Settings - content in Tokens and Agent tabs */}

              {/* Cache Section */}
              {settingsSection === 'cache' && (
                <CacheSettingsTab />
              )}
              {/* Branding, Backup, Agent, Memory, Summarization, Limits, and Superuser moved to other tabs */}
          </>
        )}

        {/* Prompts Tab */}
        {/* Prompts Tab - Accordion UI */}
        {activeTab === 'prompts' && (
          <div className="space-y-4">
            {/* System Prompt Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => togglePromptsSection('system-prompt')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">System Prompt</h2>
                    <p className="text-sm text-gray-500">Configure the global system prompt</p>
                  </div>
                </div>
                {expandedPromptsSections.has('system-prompt') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedPromptsSections.has('system-prompt') && (
                <div className="border-t">
                  <SystemPromptSettings />
                </div>
              )}
            </div>

            {/* Category Prompts Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => togglePromptsSection('category-prompts')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Category Prompts</h2>
                    <p className="text-sm text-gray-500">Configure prompts for specific categories</p>
                  </div>
                </div>
                {expandedPromptsSections.has('category-prompts') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedPromptsSections.has('category-prompts') && (
                <div className="border-t">
                  <CategoryPromptsSettings />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tools Tab (level 1 menu item) */}
        {activeTab === 'tools' && (
          <ToolsTab activeSubTab={toolsSection} />
        )}

        {/* Skills Tab (level 1 menu item) */}
        {activeTab === 'skills' && (
          <SkillsTab />
        )}

        {/* Workspaces Tab */}
        {activeTab === 'workspaces' && (
          <WorkspacesTab isAdmin={true} />
        )}

        {/* Agents Tab - expandable with config/bots sections */}
        {activeTab === 'agents' && (
          <>
            {agentsSection === 'config' && (
              <AgentSettingsTab />
            )}
            {agentsSection === 'bots' && (
              selectedAgentBotId ? (
                <AgentBotDetail
                  botId={selectedAgentBotId}
                  onBack={() => setSelectedAgentBotId(null)}
                />
              ) : (
                <AgentBotsManagement
                  onSelectBot={(bot) => setSelectedAgentBotId(bot.id)}
                />
              )
            )}
          </>
        )}

        {/* Backup Tab (now under Settings) */}
        {activeTab === 'settings' && settingsSection === 'backup' && (
          <BackupTab />
        )}

        {/* Branding Tab (promoted from Settings) */}
        {activeTab === 'branding' && (
          <BrandingSettingsTab />
        )}

        {/* Tokens Tab - Memory, Summarization, Limits */}
        {/* Tokens Tab - Accordion UI */}
        {activeTab === 'tokens' && (
          <div className="space-y-4">
            {/* Memory Settings Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => toggleTokensSection('memory')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Coins size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Memory</h2>
                    <p className="text-sm text-gray-500">Configure conversation memory settings</p>
                  </div>
                </div>
                {expandedTokensSections.has('memory') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedTokensSections.has('memory') && (
                <div className="border-t">
                  <MemorySettingsTab />
                </div>
              )}
            </div>

            {/* Summarization Settings Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => toggleTokensSection('summarization')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Coins size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Summarization</h2>
                    <p className="text-sm text-gray-500">Configure summarization behavior</p>
                  </div>
                </div>
                {expandedTokensSections.has('summarization') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedTokensSections.has('summarization') && (
                <div className="border-t">
                  <SummarizationSettingsTab />
                </div>
              )}
            </div>

            {/* Token Limits Accordion */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => toggleTokensSection('limits')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Coins size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Token Limits</h2>
                    <p className="text-sm text-gray-500">Configure token usage limits</p>
                  </div>
                </div>
                {expandedTokensSections.has('limits') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedTokensSections.has('limits') && (
                <div className="border-t">
                  <TokenLimitsSettingsTab />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Usage Tab - Token Usage Dashboard */}
        {activeTab === 'usage' && (
          <TokenUsageDashboard />
        )}
        </main>
      </div>


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

    </div>
  );
}

// Wrap with Suspense for useSearchParams
export default function AdminPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="text-gray-500">Loading...</div></div>}>
      <AdminPageContent />
    </Suspense>
  );
}
