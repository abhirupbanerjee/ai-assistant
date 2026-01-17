'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users, User, FolderOpen, Tag, Plus, FileText, Upload, Trash2, X, ChevronUp, ChevronDown, ChevronsUpDown, Search, Edit2, Save, RefreshCw, Database, CheckCircle, AlertCircle, Clock, Wand2, Youtube, Filter, SortAsc, MessageSquare, Globe, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { type SortDirection } from '@/components/ui/SortableTable';
import SkillsTab from '@/components/admin/SkillsTab';
import ToolsTab from '@/components/admin/ToolsTab';
import StarterPromptsEditor from '@/components/admin/StarterPromptsEditor';
import SuperuserSidebarMenu from '@/components/superuser/SuperuserSidebarMenu';
import { RagTuningDashboard } from '@/components/admin/RagTuningDashboard';
import WorkspacesTab from '@/components/admin/WorkspacesTab';

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

export default function SuperUserPage() {
  const router = useRouter();
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

  // Documents state
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text' | 'web' | 'youtube'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTextName, setUploadTextName] = useState('');
  const [uploadTextContent, setUploadTextContent] = useState('');
  const [uploadCategory, setUploadCategory] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<number | null>(null);
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

  // Document search, filter, and sort state
  const [docSearchTerm, setDocSearchTerm] = useState('');
  const [docSortKey, setDocSortKey] = useState<keyof ManagedDocument | null>(null);
  const [docSortDirection, setDocSortDirection] = useState<SortDirection>(null);
  const [docCategoryFilter, setDocCategoryFilter] = useState<number | 'all'>('all');
  const [docSortOption, setDocSortOption] = useState<'newest' | 'oldest' | 'largest' | 'smallest' | 'a-z' | 'z-a'>('newest');

  // Active tab state
  const [activeTab, setActiveTab] = useState<'dashboard' | 'categories' | 'users' | 'documents' | 'prompts' | 'tools' | 'workspaces' | 'settings'>('dashboard');

  // Prompts sidebar section state
  type PromptsSection = 'global-prompt' | 'category-prompts' | 'skills';
  const [promptsSection, setPromptsSection] = useState<PromptsSection>('category-prompts');

  // Settings sidebar section state
  type SettingsSection = 'rag-tuning' | 'backup';
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('rag-tuning');

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
        router.push('/');
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

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadTextName('');
    setUploadTextContent('');
    setUploadCategory(null);
    setUploadMode('file');
    setUploadUrls(['', '', '', '', '']);
    setUploadYoutubeUrl('');
    setUploadUrlName('');
    setUrlIngestionResults(null);
  };

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadCategory) return;
    if (uploadMode === 'file' && !uploadFile) return;
    if (uploadMode === 'text' && (!uploadTextName.trim() || !uploadTextContent.trim())) return;
    if (uploadMode === 'web' && getValidWebUrls().length === 0) return;
    if (uploadMode === 'youtube' && (!uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim()))) return;

    setUploading(true);
    setError(null);
    setUrlIngestionResults(null);

    try {
      let response: Response;

      if (uploadMode === 'file') {
        const formData = new FormData();
        formData.append('file', uploadFile!);
        formData.append('categoryId', uploadCategory.toString());

        response = await fetch('/api/superuser/documents', {
          method: 'POST',
          body: formData,
        });
      } else if (uploadMode === 'text') {
        response = await fetch('/api/superuser/documents/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: uploadTextName.trim(),
            content: uploadTextContent,
            categoryId: uploadCategory,
          }),
        });
      } else if (uploadMode === 'web') {
        // Web URLs mode
        const webUrls = getValidWebUrls();
        response = await fetch('/api/superuser/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: webUrls,
            categoryId: uploadCategory,
          }),
        });
      } else {
        // YouTube mode
        const youtubeUrl = uploadYoutubeUrl.trim();
        response = await fetch('/api/superuser/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl,
            name: uploadUrlName.trim() || undefined,
            categoryId: uploadCategory,
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
            await loadData();
            setShowUploadModal(false);
            resetUploadForm();
          } else {
            // Show results but don't close
            await loadData();
          }
        } else if (!response.ok) {
          throw new Error(data.error || 'URL ingestion failed');
        }
      } else {
        if (!response.ok) {
          throw new Error(data.error || 'Failed to upload document');
        }
        await loadData();
        setShowUploadModal(false);
        resetUploadForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: number) => {
    setDeletingDocId(docId);
    setError(null);

    try {
      const response = await fetch(`/api/superuser/documents/${docId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete document');
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeletingDocId(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
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
      result = result.filter(doc => doc.categories?.some(c => c.categoryId === docCategoryFilter));
    }

    // Apply fuzzy search
    if (docSearchTerm.trim()) {
      result = result
        .map(doc => ({
          doc,
          score: Math.max(
            fuzzyMatch(docSearchTerm, doc.filename),
            fuzzyMatch(docSearchTerm, doc.categories?.map(c => c.categoryName).join(' ') || ''),
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

  // Toggle sort for documents
  const handleDocSort = (key: keyof ManagedDocument) => {
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
  const SortableDocHeader = ({ columnKey, label, className = '' }: { columnKey: keyof ManagedDocument; label: string; className?: string }) => {
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 h-16">
        <div className="h-full px-4 flex items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
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
      <div className="flex">
        {/* Sidebar Navigation */}
        <SuperuserSidebarMenu
          activeTab={activeTab}
          promptsSection={promptsSection}
          settingsSection={settingsSection}
          onTabChange={setActiveTab}
          onPromptsChange={setPromptsSection}
          onSettingsChange={setSettingsSection}
        />

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
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
          <div className="space-y-6">
            {statsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : stats ? (
              <>
                {/* Stats Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg border shadow-sm p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                        <FolderOpen className="text-orange-600" size={20} />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Assigned Categories</p>
                        <p className="text-2xl font-semibold text-gray-900">{stats.assignedCategories}</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border shadow-sm p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Database className="text-blue-600" size={20} />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Total Documents</p>
                        <p className="text-2xl font-semibold text-gray-900">{stats.totalDocuments}</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border shadow-sm p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                        <Users className="text-green-600" size={20} />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Total Subscribers</p>
                        <p className="text-2xl font-semibold text-gray-900">{stats.totalSubscribers}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Category Breakdown */}
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-gray-900">Category Breakdown</h3>
                    <p className="text-sm text-gray-500">Overview of each assigned category</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 text-left text-sm text-gray-600">
                        <tr>
                          <th className="px-6 py-3 font-medium">Category</th>
                          <th className="px-6 py-3 font-medium text-center">Documents</th>
                          <th className="px-6 py-3 font-medium text-center">Status</th>
                          <th className="px-6 py-3 font-medium text-center">Subscribers</th>
                          <th className="px-6 py-3 font-medium text-center">Custom Prompt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {stats.categories.map((cat) => (
                          <tr key={cat.categoryId} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <span className="font-medium text-gray-900">{cat.categoryName}</span>
                              <span className="ml-2 text-xs text-gray-400">{cat.categorySlug}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="font-medium text-gray-900">{cat.documentCount}</span>
                              {cat.totalChunks > 0 && (
                                <span className="ml-1 text-xs text-gray-400">({cat.totalChunks} chunks)</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex justify-center gap-2">
                                {cat.readyDocuments > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                                    <CheckCircle size={12} />
                                    {cat.readyDocuments}
                                  </span>
                                )}
                                {cat.processingDocuments > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded-full">
                                    <Clock size={12} />
                                    {cat.processingDocuments}
                                  </span>
                                )}
                                {cat.errorDocuments > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                                    <AlertCircle size={12} />
                                    {cat.errorDocuments}
                                  </span>
                                )}
                                {cat.documentCount === 0 && (
                                  <span className="text-xs text-gray-400">No documents</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="font-medium text-gray-900">{cat.subscriberCount}</span>
                              {cat.activeSubscribers !== cat.subscriberCount && (
                                <span className="ml-1 text-xs text-gray-400">({cat.activeSubscribers} active)</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {cat.hasCustomPrompt ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                                  <MessageSquare size={12} />
                                  Yes
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">Global only</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Recent Documents */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div className="px-6 py-4 border-b">
                      <h3 className="font-semibold text-gray-900">Recent Documents</h3>
                      <p className="text-sm text-gray-500">Latest documents in your categories</p>
                    </div>
                    <div className="p-4">
                      {stats.recentDocuments.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-4">No documents yet</p>
                      ) : (
                        <ul className="space-y-3">
                          {stats.recentDocuments.map((doc) => (
                            <li key={doc.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                              <FileText size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{doc.filename}</p>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                                    {doc.categoryName}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded ${
                                      doc.status === 'ready'
                                        ? 'bg-green-100 text-green-700'
                                        : doc.status === 'processing'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                                  >
                                    {doc.status}
                                  </span>
                                  <span>{formatDate(doc.uploadedAt)}</span>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Recent Subscriptions */}
                  <div className="bg-white rounded-lg border shadow-sm">
                    <div className="px-6 py-4 border-b">
                      <h3 className="font-semibold text-gray-900">Recent Subscriptions</h3>
                      <p className="text-sm text-gray-500">Latest subscribers to your categories</p>
                    </div>
                    <div className="p-4">
                      {stats.recentSubscriptions.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-4">No subscriptions yet</p>
                      ) : (
                        <ul className="space-y-3">
                          {stats.recentSubscriptions.map((sub, idx) => (
                            <li key={idx} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                              <User size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{sub.userEmail}</p>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                                    {sub.categoryName}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded ${
                                      sub.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {sub.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                  <span>{formatDate(sub.subscribedAt)}</span>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
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
              <div className="bg-white rounded-lg border shadow-sm p-8 text-center">
                <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Unable to load stats</h3>
                <p className="text-gray-500 mb-4">There was a problem loading your dashboard statistics.</p>
                <Button variant="secondary" onClick={loadStats}>
                  <RefreshCw size={16} className="mr-2" />
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Documents Section */}
        {activeTab === 'documents' && (
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Documents</h2>
                  <p className="text-sm text-gray-500">
                    {docSearchTerm ? `${filteredAndSortedDocs.length} of ${documents.length}` : documents.length} documents in your categories
                  </p>
                </div>
                <Button
                  onClick={() => setShowUploadModal(true)}
                  disabled={assignedCategories.length === 0}
                >
                  <Upload size={18} className="mr-2" />
                  Upload Document
                </Button>
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
                      value={docCategoryFilter === 'all' ? 'all' : String(docCategoryFilter)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'all') {
                          setDocCategoryFilter('all');
                        } else {
                          setDocCategoryFilter(parseInt(val, 10));
                        }
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    >
                      <option value="all">All Categories</option>
                      {assignedCategories.map(cat => (
                        <option key={cat.categoryId} value={cat.categoryId}>{cat.categoryName}</option>
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
                  Upload documents to your assigned categories
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
                      <th className="px-6 py-3 font-medium">Category</th>
                      <SortableDocHeader columnKey="size" label="Size" />
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
                            <FileText size={20} className="text-red-500" />
                            <span className="font-medium text-gray-900">{doc.filename}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {doc.categories.map(cat => (
                              <span
                                key={cat.categoryId}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full"
                              >
                                {cat.categoryName}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {formatFileSize(doc.size)}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${
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
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {formatDate(doc.uploadedAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <a
                              href={`/api/superuser/documents/${doc.id}/download`}
                              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                              title="Download"
                              download
                            >
                              <Download size={16} />
                            </a>
                            <button
                              onClick={() => handleDeleteDocument(doc.id)}
                              disabled={deletingDocId === doc.id}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                              title="Delete document"
                            >
                              {deletingDocId === doc.id ? (
                                <Spinner size="sm" />
                              ) : (
                                <Trash2 size={16} />
                              )}
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
        {activeTab === 'prompts' && (
          <>
              {/* Global System Prompt (Read-only) */}
              {promptsSection === 'global-prompt' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <h2 className="font-semibold text-gray-900">Global System Prompt</h2>
                    <p className="text-sm text-gray-500">
                      This prompt applies to all categories (view only - set by administrator)
                    </p>
                  </div>
                  <div className="p-6">
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
                </div>
              )}

              {/* Category Prompts */}
              {promptsSection === 'category-prompts' && (
                <div className="bg-white rounded-lg border shadow-sm">
                  <div className="px-6 py-4 border-b">
                    <h2 className="font-semibold text-gray-900">Category-Specific Prompts</h2>
                    <p className="text-sm text-gray-500">
                      Add custom prompt guidance for your assigned categories
                    </p>
                  </div>
                  <div className="p-6">
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
                </div>
              )}

              {/* Skills Section */}
              {promptsSection === 'skills' && (
                <SkillsTab isSuperuser />
              )}
          </>
        )}

        {/* Tools Section */}
        {activeTab === 'tools' && (
          <ToolsTab isSuperuser />
        )}

        {/* Workspaces Section */}
        {activeTab === 'workspaces' && (
          <WorkspacesTab isAdmin={false} />
        )}

        {/* Settings Section */}
        {activeTab === 'settings' && (
          <>
            {settingsSection === 'rag-tuning' && (
              <RagTuningDashboard />
            )}
            {settingsSection === 'backup' && (
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b">
                  <h2 className="font-semibold text-gray-900">Backup Threads</h2>
                  <p className="text-sm text-gray-500">
                    Export conversation threads from your assigned categories
                  </p>
                </div>
                <div className="p-6">
                  <div className="text-center py-8">
                    <p className="text-gray-500 mb-4">
                      Download threads and messages from categories you manage.
                    </p>
                    <Button
                      onClick={async () => {
                        try {
                          const response = await fetch('/api/superuser/backup', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ includeThreads: true }),
                          });
                          if (!response.ok) throw new Error('Backup failed');
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `threads-backup-${new Date().toISOString().split('T')[0]}.json`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          a.remove();
                        } catch (err) {
                          console.error('Backup error:', err);
                          alert('Failed to create backup. Please try again.');
                        }
                      }}
                    >
                      <FileText size={16} className="mr-2" />
                      Export Threads
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        </main>
      </div>

      {/* Upload Document Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setUploadFile(null);
          setUploadTextName('');
          setUploadTextContent('');
          setUploadCategory(null);
          setUploadMode('file');
        }}
        title="Upload Document"
      >
        {/* Tabs */}
        <div className="flex border-b mb-4">
          <button
            type="button"
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
            type="button"
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
            type="button"
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
            type="button"
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

        <form onSubmit={handleUploadDocument}>
          <div className="space-y-4">
            {/* File Upload Mode */}
            {uploadMode === 'file' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  File *
                </label>
                <div className="border-2 border-dashed rounded-lg p-4">
                  {uploadFile ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={20} className="text-red-500" />
                        <span className="text-sm font-medium">{uploadFile.name}</span>
                        <span className="text-xs text-gray-500">
                          ({formatFileSize(uploadFile.size)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUploadFile(null)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        <X size={16} className="text-gray-500" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center cursor-pointer">
                      <Upload size={24} className="text-gray-400 mb-2" />
                      <span className="text-sm text-gray-600">Click to select a file</span>
                      <span className="text-xs text-gray-400 mt-1">PDF, DOCX, XLSX, PPTX, Images (max 50MB)</span>
                      <input
                        type="file"
                        accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg,image/webp,image/gif"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setUploadFile(file);
                        }}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
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
                Category *
              </label>
              <select
                value={uploadCategory || ''}
                onChange={(e) => setUploadCategory(parseInt(e.target.value, 10) || null)}
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
                setShowUploadModal(false);
                resetUploadForm();
              }}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={uploading}
              disabled={
                !uploadCategory ||
                (uploadMode === 'file'
                  ? !uploadFile
                  : uploadMode === 'text'
                  ? (!uploadTextName.trim() || !uploadTextContent.trim())
                  : uploadMode === 'web'
                  ? getValidWebUrls().length === 0
                  : !uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim()))
              }
            >
              Upload
            </Button>
          </div>
        </form>
      </Modal>

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
