'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Users, User, FolderOpen, Tag, Plus, FileText, Trash2, Edit2, Save, RefreshCw, CheckCircle, Wand2, ChevronUp, ChevronDown, MessageSquare, Download, Loader2, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import SkillsTab from '@/components/admin/SkillsTab';
import ToolsTab from '@/components/admin/ToolsTab';
import StarterPromptsEditor from '@/components/admin/StarterPromptsEditor';
import SuperuserSidebarMenu from '@/components/superuser/SuperuserSidebarMenu';
import UnifiedLLMSettings from '@/components/admin/settings/UnifiedLLMSettings';
import UnifiedRAGSettings from '@/components/admin/settings/UnifiedRAGSettings';
import RerankerSettingsTab from '@/components/admin/settings/RerankerSettings';
import DocumentProcessingTab from '@/components/admin/settings/DocumentProcessing';
import SpeechSettingsTab from '@/components/admin/settings/SpeechSettings';
import CacheSettingsTab from '@/components/admin/CacheSettingsTab';
import WorkspacesTab from '@/components/admin/WorkspacesTab';
import DocumentsManagement from '@/components/superuser/DocumentsManagement';
import SuperuserDashboard from '@/components/superuser/SuperuserDashboard';
import SuperuserAgentBotsList from '@/components/superuser/SuperuserAgentBotsList';

interface StarterPrompt {
  label: string;
  prompt: string;
}

interface AssignedCategory {
  categoryId: number;
  categoryName: string;
  createdBy?: string;
}

interface UserSubscription {
  categoryId: number;
  categoryName: string;
  isActive: boolean;
}

interface ManagedUser {
  id: number;
  email: string;
  name: string | null;
  subscriptions: UserSubscription[];
}

interface DocumentCategory {
  categoryId: number;
  categoryName: string;
}

interface ManagedDocument {
  id: number;
  filename: string;
  size: number;
  status: string;
  uploadedBy: string;
  uploadedAt: string;
  categories: DocumentCategory[];
}

interface CategoryStats {
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  documentCount: number;
  readyDocuments: number;
  processingDocuments: number;
  errorDocuments: number;
  totalChunks: number;
  subscriberCount: number;
  activeSubscribers: number;
  hasCustomPrompt: boolean;
}

interface SuperUserStats {
  timestamp: string;
  assignedCategories: number;
  totalDocuments: number;
  totalSubscribers: number;
  categories: CategoryStats[];
  recentDocuments: {
    id: number;
    filename: string;
    categoryName: string;
    status: string;
    uploadedBy: string;
    uploadedAt: string;
  }[];
  recentSubscriptions: {
    userEmail: string;
    categoryName: string;
    subscribedAt: string;
    isActive: boolean;
  }[];
}

interface OptimizationResult {
  original: string;
  optimized: string;
  changes: string[];
  tokensUsed: number;
}

// Subscribed category interface (for read-only access)
interface SubscribedCategory {
  id: number;
  name: string;
  slug: string;
}

// Valid tab types for URL parameter validation
type SuperuserTabType = 'dashboard' | 'categories' | 'users' | 'documents' | 'prompts' | 'tools' | 'skills' | 'workspaces' | 'agent-bots' | 'settings';
const VALID_TABS: SuperuserTabType[] = ['dashboard', 'categories', 'users', 'documents', 'prompts', 'tools', 'skills', 'workspaces', 'agent-bots', 'settings'];

function SuperUserPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignedCategories, setAssignedCategories] = useState<AssignedCategory[]>([]);
  const [subscribedCategories, setSubscribedCategories] = useState<SubscribedCategory[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);

  // Add subscription modal state
  const [showAddSub, setShowAddSub] = useState(false);
  const [newSubEmail, setNewSubEmail] = useState('');
  const [newSubCategory, setNewSubCategory] = useState<number | null>(null);
  const [addingSub, setAddingSub] = useState(false);

  // Remove subscription state
  const [removingSub, setRemovingSub] = useState<{ email: string; categoryId: number } | null>(null);

  // New user name field for subscription modal
  const [newSubName, setNewSubName] = useState('');

  // Category management state
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryQuota, setCategoryQuota] = useState<{ used: number; limit: number } | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);
  const [showDeleteCategory, setShowDeleteCategory] = useState<{ id: number; name: string; documentCount: number } | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Documents state (data loaded from API)
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);

  // Active tab state - initialize from URL parameter
  const tabParam = searchParams.get('tab');
  const initialTab = tabParam && VALID_TABS.includes(tabParam as SuperuserTabType) ? tabParam as SuperuserTabType : 'dashboard';
  const [activeTab, setActiveTab] = useState<SuperuserTabType>(initialTab);

  // Sync URL tab parameter to state
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && VALID_TABS.includes(tab as SuperuserTabType)) {
      setActiveTab(tab as SuperuserTabType);
    }
  }, [searchParams]);

  // Prompts accordion section type
  type PromptsSection = 'global-prompt' | 'category-prompts';

  // Accordion state for Prompts sections
  const [expandedPromptsSections, setExpandedPromptsSections] = useState<Set<PromptsSection>>(new Set(['category-prompts']));
  const togglePromptsSection = (section: PromptsSection) => {
    setExpandedPromptsSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) newSet.delete(section);
      else newSet.add(section);
      return newSet;
    });
  };

  // Settings sidebar section state
  type SettingsSection = 'llm' | 'rag' | 'reranker' | 'ocr' | 'speech' | 'cache' | 'backup';
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('llm');
  const [exportingHistory, setExportingHistory] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportHistory = async () => {
    setExportingHistory(true);
    setExportError(null);
    try {
      const response = await fetch('/api/user/export/threads', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to export chat history');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-history-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export chat history');
    } finally {
      setExportingHistory(false);
    }
  };

  // Stats state
  const [stats, setStats] = useState<SuperUserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Global prompt state (for read-only display)
  const [globalPrompt, setGlobalPrompt] = useState<string | null>(null);
  const [globalPromptLoading, setGlobalPromptLoading] = useState(false);

  // Category prompt state
  const [editingCategoryPrompt, setEditingCategoryPrompt] = useState<number | null>(null);
  const [categoryPromptLoading, setCategoryPromptLoading] = useState(false);
  const [categoryPromptData, setCategoryPromptData] = useState<{
    category: { id: number; name: string; slug: string };
    globalPrompt: string;
    categoryAddendum: string;
    starterPrompts: StarterPrompt[];
    starterLimits?: {
      maxStarters: number;
      maxLabelLength: number;
      maxPromptLength: number;
    };
    combinedPrompt: string;
    charInfo: {
      globalLength: number;
      categoryLength: number;
      combinedLength: number;
      availableForCategory: number;
      maxCombined: number;
    };
    metadata: { updatedAt: string; updatedBy: string } | null;
  } | null>(null);
  const [editedCategoryAddendum, setEditedCategoryAddendum] = useState('');
  const [editedStarterPrompts, setEditedStarterPrompts] = useState<StarterPrompt[]>([]);
  const [savingCategoryPrompt, setSavingCategoryPrompt] = useState(false);
  const [categoryPromptModified, setCategoryPromptModified] = useState(false);
  const [starterPromptsModified, setStarterPromptsModified] = useState(false);

  // Prompt optimization state
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [showOptimizationDiff, setShowOptimizationDiff] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const response = await fetch('/api/superuser/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Load users, documents, categories, and session in parallel
      const [usersResponse, docsResponse, sessionResponse, categoriesResponse] = await Promise.all([
        fetch('/api/superuser/users'),
        fetch('/api/superuser/documents'),
        fetch('/api/auth/session'),
        fetch('/api/user/categories'),
      ]);

      if (usersResponse.status === 403 || docsResponse.status === 403) {
        router.push('/chat');
        return;
      }

      if (!usersResponse.ok) {
        throw new Error('Failed to load user data');
      }

      const userData = await usersResponse.json();
      setAssignedCategories(userData.assignedCategories || []);
      setUsers(userData.users || []);

      if (docsResponse.ok) {
        const docsData = await docsResponse.json();
        setDocuments(docsData.documents || []);
      }

      // Get current user email for category ownership check
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        setCurrentUserEmail(sessionData.user?.email || null);
      }

      // Get all accessible categories (assigned + subscribed)
      // Filter to only subscribed (not assigned) for display purposes
      if (categoriesResponse.ok) {
        const categoriesData = await categoriesResponse.json();
        const allCategories: SubscribedCategory[] = categoriesData.categories || [];
        const assignedIds = new Set(userData.assignedCategories?.map((c: AssignedCategory) => c.categoryId) || []);
        // Only keep categories that are NOT in assigned list (these are subscribed-only)
        const subscribed = allCategories.filter(c => !assignedIds.has(c.id));
        setSubscribedCategories(subscribed);
      }

      // Load stats separately
      loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [router, loadStats]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load global prompt when on Prompts tab and categories are available
  useEffect(() => {
    const loadGlobalPrompt = async () => {
      if (activeTab !== 'prompts' || assignedCategories.length === 0 || globalPrompt !== null) {
        return;
      }

      setGlobalPromptLoading(true);
      try {
        // Use the first category to fetch the global prompt
        const response = await fetch(`/api/categories/${assignedCategories[0].categoryId}/prompt`);
        if (response.ok) {
          const data = await response.json();
          setGlobalPrompt(data.globalPrompt || '');
        }
      } catch (err) {
        console.error('Failed to load global prompt:', err);
      } finally {
        setGlobalPromptLoading(false);
      }
    };

    loadGlobalPrompt();
  }, [activeTab, assignedCategories, globalPrompt]);

  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubEmail.trim() || !newSubCategory) return;

    setAddingSub(true);
    setError(null);

    try {
      const response = await fetch('/api/superuser/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: newSubEmail.trim(),
          userName: newSubName.trim() || undefined,
          categoryId: newSubCategory,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add subscription');
      }

      await loadData();
      setShowAddSub(false);
      setNewSubEmail('');
      setNewSubName('');
      setNewSubCategory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add subscription');
    } finally {
      setAddingSub(false);
    }
  };

  // Category management handlers
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setCreatingCategory(true);
    setError(null);

    try {
      const response = await fetch('/api/superuser/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          description: newCategoryDescription.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create category');
      }

      // Update quota from response
      if (data.quota) {
        setCategoryQuota(data.quota);
      }

      await loadData();
      setShowCreateCategory(false);
      setNewCategoryName('');
      setNewCategoryDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!showDeleteCategory) return;

    setDeletingCategoryId(showDeleteCategory.id);
    setError(null);

    try {
      const response = await fetch(
        `/api/superuser/categories?categoryId=${showDeleteCategory.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete category');
      }

      await loadData();
      setShowDeleteCategory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const handleRemoveSubscription = async () => {
    if (!removingSub) return;

    try {
      const response = await fetch(
        `/api/superuser/users?userEmail=${encodeURIComponent(removingSub.email)}&categoryId=${removingSub.categoryId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove subscription');
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove subscription');
    } finally {
      setRemovingSub(null);
    }
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
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
      setCategoryPromptModified(false);
      setStarterPromptsModified(false);
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
    setCategoryPromptModified(false);
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
        combinedPrompt: data.combinedPrompt,
        charInfo: data.charInfo,
        metadata: data.metadata,
      } : null);
      setCategoryPromptModified(false);
      setStarterPromptsModified(false);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 h-16">
        <div className="h-full px-4 flex items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/chat')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Super User Dashboard</h1>
              <p className="text-sm text-gray-500 hidden sm:block">Manage documents and user subscriptions for your categories</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout with Sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <SuperuserSidebarMenu
          activeTab={activeTab}
          settingsSection={settingsSection}
          onTabChange={setActiveTab}
          onSettingsChange={setSettingsSection}
        />

        {/* Main Content */}
        <main className="flex-1 min-h-0 p-4 md:p-6 overflow-auto">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
              <p className="text-red-600">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600"
              >
                &times;
              </button>
            </div>
          )}

          {/* Categories Section */}
          {activeTab === 'categories' && (
            <div className="space-y-6">
              {/* Header with Create Button */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Your Categories</h2>
                  <p className="text-sm text-gray-500">
                    Manage your assigned categories and view subscribed categories
                  </p>
                </div>
                <Button onClick={() => setShowCreateCategory(true)}>
                  <Plus size={18} className="mr-2" />
                  Create Category
                </Button>
              </div>

              {/* Managed Categories */}
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b">
                  <h3 className="font-semibold text-gray-900">Managed Categories</h3>
                  <p className="text-sm text-gray-500">
                    You can upload documents and manage users for these categories
                  </p>
                </div>
                <div className="px-6 py-4">
                  {assignedCategories.length === 0 ? (
                    <p className="text-gray-500 text-sm">No categories assigned to you yet. Create one to get started.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {assignedCategories.map(cat => (
                        <span
                          key={cat.categoryId}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full text-sm font-medium group"
                        >
                          <FolderOpen size={14} />
                          {cat.categoryName}
                          {cat.createdBy === currentUserEmail && (
                            <button
                              onClick={() => {
                                const docCount = stats?.categories.find(c => c.categoryId === cat.categoryId)?.documentCount || 0;
                                setShowDeleteCategory({ id: cat.categoryId, name: cat.categoryName, documentCount: docCount });
                              }}
                              className="ml-1 p-0.5 hover:bg-orange-200 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete category"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Subscribed Categories */}
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b">
                  <h3 className="font-semibold text-gray-900">Subscribed Categories</h3>
                  <p className="text-sm text-gray-500">
                    You have read-only access to chat with documents in these categories
                  </p>
                </div>
                <div className="px-6 py-4">
                  {subscribedCategories.length === 0 ? (
                    <p className="text-gray-500 text-sm">No additional subscriptions. Ask an admin to subscribe you to more categories.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {subscribedCategories.map(cat => (
                        <span
                          key={cat.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                        >
                          <Tag size={14} />
                          {cat.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Category Quota Info */}
              {categoryQuota && (
                <div className="bg-gray-50 rounded-lg border p-4">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Category Quota:</span> {categoryQuota.used} / {categoryQuota.limit} categories created
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Dashboard Section */}
        {activeTab === 'dashboard' && (
          <SuperuserDashboard
            stats={stats}
            statsLoading={statsLoading}
            loadStats={loadStats}
          />
        )}

        {/* Documents Section */}
        {activeTab === 'documents' && (
          <DocumentsManagement
            documents={documents}
            assignedCategories={assignedCategories}
            loadData={loadData}
            setError={setError}
          />
        )}

        {/* Users Section */}
        {activeTab === 'users' && (
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="px-6 py-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Managed Users</h2>
                <p className="text-sm text-gray-500">
                  {users.length} users subscribed to your categories
                </p>
              </div>
              <Button
                onClick={() => setShowAddSub(true)}
                disabled={assignedCategories.length === 0}
              >
                <Plus size={18} className="mr-2" />
                Add Subscription
              </Button>
            </div>
          </div>

          {users.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No users yet</h3>
              <p className="text-gray-500 mb-4">
                Add subscriptions to give users access to your categories
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 text-left text-sm text-gray-600">
                  <tr>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-6 py-3 font-medium">Subscriptions</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                            <User size={16} className="text-gray-600" />
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
                        <div className="flex flex-wrap gap-1">
                          {user.subscriptions.map(sub => (
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
                              <button
                                onClick={() => setRemovingSub({ email: user.email, categoryId: sub.categoryId })}
                                className="ml-1 hover:bg-blue-200 rounded-full p-0.5"
                                title="Remove subscription"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setNewSubEmail(user.email);
                              setShowAddSub(true);
                            }}
                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                            title="Add subscription"
                          >
                            <Plus size={16} />
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

        {/* Prompts Section */}
        {/* Prompts Tab - Accordion UI */}
        {activeTab === 'prompts' && (
          <div className="space-y-4">
            {/* Global System Prompt Accordion (Read-only) */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <button
                onClick={() => togglePromptsSection('global-prompt')}
                className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-gray-600" />
                  <div className="text-left">
                    <h2 className="font-semibold text-gray-900">Global System Prompt</h2>
                    <p className="text-sm text-gray-500">View the system prompt (read-only)</p>
                  </div>
                </div>
                {expandedPromptsSections.has('global-prompt') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedPromptsSections.has('global-prompt') && (
                <div className="border-t p-6">
                  {globalPromptLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Spinner size="sm" />
                      <span className="ml-2 text-gray-500 text-sm">Loading prompt...</span>
                    </div>
                  ) : globalPrompt ? (
                    <div className="bg-gray-50 border rounded-lg p-4 max-h-96 overflow-y-auto">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                        {globalPrompt}
                      </pre>
                    </div>
                  ) : assignedCategories.length === 0 ? (
                    <p className="text-gray-500 text-sm">
                      No categories assigned. Contact admin to view system prompt.
                    </p>
                  ) : (
                    <p className="text-gray-500 text-sm">
                      Unable to load global system prompt.
                    </p>
                  )}
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
                    <p className="text-sm text-gray-500">Custom prompt guidance for your categories</p>
                  </div>
                </div>
                {expandedPromptsSections.has('category-prompts') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
              </button>
              {expandedPromptsSections.has('category-prompts') && (
                <div className="border-t p-6">
                  {assignedCategories.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                      No categories assigned to you.
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
                          {assignedCategories.map((cat) => (
                            <tr key={cat.categoryId} className="hover:bg-gray-50">
                              <td className="py-3">
                                <span className="font-medium text-gray-900">{cat.categoryName}</span>
                              </td>
                              <td className="py-3">
                                <span className="text-gray-500 text-xs">Click Edit to configure</span>
                              </td>
                              <td className="py-3 text-right">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleOpenCategoryPromptModal(cat.categoryId)}
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
              )}
            </div>
          </div>
        )}

        {/* Skills Tab (Skill Library) */}
        {/* Tools Tab (level 1 menu item) */}
        {activeTab === 'tools' && (
          <ToolsTab readOnly isSuperuser />
        )}

        {/* Skills Tab (level 1 menu item) */}
        {activeTab === 'skills' && (
          <SkillsTab readOnly isSuperuser />
        )}

        {/* Workspaces Section */}
        {activeTab === 'workspaces' && (
          <WorkspacesTab isAdmin={false} />
        )}

        {/* Agent Bots Section */}
        {activeTab === 'agent-bots' && (
          <SuperuserAgentBotsList />
        )}

        {/* Settings Section (view only) */}
        {activeTab === 'settings' && (
          <>
            <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 mb-4 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <p className="text-sm text-blue-700">These settings are view only. Only users with the Admin role can make changes.</p>
            </div>
            {settingsSection === 'llm' && <UnifiedLLMSettings readOnly />}
            {settingsSection === 'rag' && <UnifiedRAGSettings readOnly />}
            {settingsSection === 'reranker' && <RerankerSettingsTab readOnly />}
            {settingsSection === 'ocr' && <DocumentProcessingTab readOnly />}
            {settingsSection === 'speech' && <SpeechSettingsTab readOnly />}
            {settingsSection === 'cache' && <CacheSettingsTab readOnly />}
            {settingsSection === 'backup' && (
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b">
                  <div className="flex items-center gap-3">
                    <Download className="text-blue-600" size={24} />
                    <div>
                      <h2 className="font-semibold text-gray-900">Backup</h2>
                      <p className="text-sm text-gray-500">Download all your conversations as a ZIP of Markdown files</p>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4">
                  {exportError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800 text-sm">
                      <AlertTriangle size={16} />
                      <span>{exportError}</span>
                    </div>
                  )}
                  <Button
                    variant="secondary"
                    onClick={handleExportHistory}
                    disabled={exportingHistory}
                  >
                    {exportingHistory ? (
                      <>
                        <Loader2 className="animate-spin mr-2" size={16} />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download size={16} className="mr-2" />
                        Download Chat History
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        </main>
      </div>

      {/* Add Subscription Modal */}
      <Modal
        isOpen={showAddSub}
        onClose={() => {
          setShowAddSub(false);
          setNewSubEmail('');
          setNewSubName('');
          setNewSubCategory(null);
        }}
        title="Add User Subscription"
      >
        <form onSubmit={handleAddSubscription}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User Email *
              </label>
              <input
                type="email"
                value={newSubEmail}
                onChange={(e) => setNewSubEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                If user doesn&apos;t exist, they will be created automatically
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User Name
              </label>
              <input
                type="text"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="John Doe (optional, for new users)"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Only used when creating a new user
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category *
              </label>
              <select
                value={newSubCategory || ''}
                onChange={(e) => setNewSubCategory(parseInt(e.target.value, 10) || null)}
                required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select category...</option>
                {assignedCategories.map(cat => (
                  <option key={cat.categoryId} value={cat.categoryId}>
                    {cat.categoryName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAddSub(false);
                setNewSubEmail('');
                setNewSubName('');
                setNewSubCategory(null);
              }}
              disabled={addingSub}
            >
              Cancel
            </Button>
            <Button type="submit" loading={addingSub}>
              Add Subscription
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Category Modal */}
      <Modal
        isOpen={showCreateCategory}
        onClose={() => {
          setShowCreateCategory(false);
          setNewCategoryName('');
          setNewCategoryDescription('');
        }}
        title="Create New Category"
      >
        <form onSubmit={handleCreateCategory}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category Name *
              </label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g., HR Policies"
                required
                maxLength={100}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={newCategoryDescription}
                onChange={(e) => setNewCategoryDescription(e.target.value)}
                placeholder="Optional description for this category"
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {categoryQuota && (
              <p className="text-sm text-gray-500">
                Category quota: {categoryQuota.used} of {categoryQuota.limit} used
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowCreateCategory(false);
                setNewCategoryName('');
                setNewCategoryDescription('');
              }}
              disabled={creatingCategory}
            >
              Cancel
            </Button>
            <Button type="submit" loading={creatingCategory}>
              Create Category
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Category Confirmation Modal */}
      <Modal
        isOpen={!!showDeleteCategory}
        onClose={() => setShowDeleteCategory(null)}
        title="Delete Category"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to delete the category <strong>{showDeleteCategory?.name}</strong>?
          </p>
          {showDeleteCategory && showDeleteCategory.documentCount > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">
                <strong>Warning:</strong> This will permanently delete {showDeleteCategory.documentCount} document(s)
                associated with this category, including their files and embeddings.
              </p>
            </div>
          )}
          <p className="text-sm text-gray-500">
            All user subscriptions to this category will also be removed.
          </p>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => setShowDeleteCategory(null)}
            disabled={deletingCategoryId !== null}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteCategory}
            loading={deletingCategoryId === showDeleteCategory?.id}
          >
            Delete Category
          </Button>
        </div>
      </Modal>

      {/* Remove Subscription Confirmation */}
      <Modal
        isOpen={!!removingSub}
        onClose={() => setRemovingSub(null)}
        title="Remove Subscription?"
      >
        <p className="text-gray-600 mb-4">
          Are you sure you want to remove this subscription?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          The user will lose access to documents in this category.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRemovingSub(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRemoveSubscription}>
            Remove
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
                maxStarters={categoryPromptData?.starterLimits?.maxStarters}
                maxLabelLength={categoryPromptData?.starterLimits?.maxLabelLength}
                maxPromptLength={categoryPromptData?.starterLimits?.maxPromptLength}
              />
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
                Last updated: {new Date(categoryPromptData.metadata.updatedAt).toLocaleString()} by {categoryPromptData.metadata.updatedBy}
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
                    (!categoryPromptModified && !starterPromptsModified) ||
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

// Wrap in Suspense for useSearchParams support
export default function SuperUserPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    }>
      <SuperUserPageContent />
    </Suspense>
  );
}
