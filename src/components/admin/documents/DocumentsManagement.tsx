'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Upload, RefreshCw, Trash2, FileText, Globe, Tag, Search, X, Filter, SortAsc, Download, Edit2, CheckCircle, AlertCircle, Youtube, ChevronUp, ChevronDown, ChevronsUpDown, Save, FolderOpen, Clock, ChevronRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { type SortDirection } from '@/components/ui/SortableTable';
import type { GlobalDocument } from '@/types';

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
}

interface AcronymMappings {
  mappings: Record<string, string>;
  updatedAt: string;
  updatedBy: string;
}

interface UrlIngestionResult {
  url: string;
  success: boolean;
  filename?: string;
  error?: string;
  sourceType: 'youtube' | 'web' | 'crawl' | 'pdf';
}

interface CrawlInfo {
  baseUrl: string;
  totalPagesFound: number;
  pagesIngested: number;
  estimatedCredits: number;
  pdfCount?: number;
  pdfsIngested?: number;
  pdfsFailed?: number;
}

interface WebEntry {
  id: string;
  url: string;
  mode: 'page' | 'crawl';
  crawlLimit: number;
  crawlPathFilter: string;
  crawlExcludeFilter: string;
}

interface WebsitePreviewEntry {
  url: string;
  mode: 'page' | 'crawl';
  estimatedPages: number;
  pdfCount: number;
  estimatedCredits: number;
  siteBlocked: boolean;
}

interface WebsitePreviewResult {
  entries: WebsitePreviewEntry[];
  totals: { estimatedPages: number; pdfCount: number; estimatedCredits: number };
  pdfWarning: boolean;
}

interface FolderSync {
  id: string;
  folderName: string;
  originalPath: string;
  uploadedBy: string;
  categoryIds: number[];
  isGlobal: boolean;
  totalFiles: number;
  syncedFiles: number;
  failedFiles: number;
  status: 'active' | 'syncing' | 'error';
  errorMessage: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FolderUploadFile {
  file: File;
  relativePath: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

interface DocumentsManagementProps {
  documentsSection?: 'documents' | 'acronyms'; // Now optional - component manages its own state
}

export default function DocumentsManagement({ documentsSection: initialSection }: DocumentsManagementProps) {
  // Accordion state for expandable sections
  const [expandedSections, setExpandedSections] = useState<Set<'documents' | 'acronyms'>>(
    new Set([initialSection || 'documents'])
  );

  const toggleSection = (section: 'documents' | 'acronyms') => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };
  // Documents state
  const [documents, setDocuments] = useState<GlobalDocument[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Search and filter state
  const [docSearchTerm, setDocSearchTerm] = useState('');
  const [docCategoryFilter, setDocCategoryFilter] = useState<number | 'all' | 'global' | 'uncategorized'>('all');
  const [docStatusFilter, setDocStatusFilter] = useState<'all' | 'ready' | 'error' | 'processing'>('all');
  const [docSortOption, setDocSortOption] = useState<'newest' | 'oldest' | 'largest' | 'smallest' | 'a-z' | 'z-a'>('newest');
  const [docSortKey, setDocSortKey] = useState<keyof GlobalDocument | null>(null);
  const [docSortDirection, setDocSortDirection] = useState<SortDirection>(null);

  // Action states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [reindexing, setReindexing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingDocChanges, setSavingDocChanges] = useState(false);

  // Multi-select state
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text' | 'websites' | 'youtube' | 'folder'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTextName, setUploadTextName] = useState('');
  const [uploadTextContent, setUploadTextContent] = useState('');
  const [uploadCategoryIds, setUploadCategoryIds] = useState<number[]>([]);
  const [uploadIsGlobal, setUploadIsGlobal] = useState(false);
  const [uploadYoutubeUrl, setUploadYoutubeUrl] = useState('');
  const [uploadUrlName, setUploadUrlName] = useState('');
  const [urlIngestionResults, setUrlIngestionResults] = useState<UrlIngestionResult[] | null>(null);

  // Websites mode state (unified single-page + crawl)
  const [webEntries, setWebEntries] = useState<WebEntry[]>([
    { id: crypto.randomUUID(), url: '', mode: 'page', crawlLimit: 25, crawlPathFilter: '', crawlExcludeFilter: '' },
  ]);
  const [includePdfs, setIncludePdfs] = useState(true);
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);
  const [websitePreview, setWebsitePreview] = useState<WebsitePreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Folder upload state
  const [folderFiles, setFolderFiles] = useState<FolderUploadFile[]>([]);
  const [folderName, setFolderName] = useState('');
  const [folderUploadProgress, setFolderUploadProgress] = useState<{
    current: number;
    total: number;
    currentFile: string;
  } | null>(null);
  const [folderUploadResults, setFolderUploadResults] = useState<{
    synced: number;
    failed: number;
    skipped: number;
  } | null>(null);

  // Synced folders state
  const [folderSyncs, setFolderSyncs] = useState<FolderSync[]>([]);
  const [loadingFolderSyncs, setLoadingFolderSyncs] = useState(false);
  const [showFolderSyncs, setShowFolderSyncs] = useState(false);
  const [resyncingFolder, setResyncingFolder] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);

  // Delete modal state
  const [deleteDoc, setDeleteDoc] = useState<GlobalDocument | null>(null);

  // Edit modal state
  const [editingDoc, setEditingDoc] = useState<GlobalDocument | null>(null);
  const [editDocCategoryIds, setEditDocCategoryIds] = useState<number[]>([]);
  const [editDocIsGlobal, setEditDocIsGlobal] = useState(false);

  // Acronyms state
  const [acronymMappings, setAcronymMappings] = useState<AcronymMappings | null>(null);
  const [editedAcronyms, setEditedAcronyms] = useState<string>('');
  const [acronymsModified, setAcronymsModified] = useState(false);

  // Mobile detection - folder upload uses webkitdirectory which is not supported on mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      // Check for touch capability and small screen (typical mobile indicators)
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(hasTouchScreen && isSmallScreen);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Helper functions
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

  const getValidWebEntries = (): WebEntry[] => {
    return webEntries.filter(e => e.url.trim() && isValidUrl(e.url.trim()));
  };

  const detectUrlMode = (url: string): 'page' | 'crawl' => {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/+$/, '');
      if (path === '' || (path.split('/').length <= 2 && !/\.[a-z]{2,5}$/i.test(path))) {
        return 'crawl';
      }
    } catch { /* invalid URL */ }
    return 'page';
  };

  const addWebEntry = () => {
    setWebEntries(prev => [
      ...prev,
      { id: crypto.randomUUID(), url: '', mode: 'page', crawlLimit: 25, crawlPathFilter: '', crawlExcludeFilter: '' },
    ]);
  };

  const removeWebEntry = (id: string) => {
    setWebEntries(prev => prev.filter(e => e.id !== id));
  };

  const updateWebEntry = (id: string, updates: Partial<WebEntry>) => {
    setWebEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const handleWebsitePreview = async () => {
    const validEntries = getValidWebEntries();
    if (validEntries.length === 0) return;
    setPreviewing(true);
    setWebsitePreview(null);
    try {
      const res = await fetch('/api/admin/documents/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: validEntries.map(e => ({
            url: e.url.trim(),
            mode: e.mode,
            crawlOptions: e.mode === 'crawl' ? { limit: e.crawlLimit } : undefined,
          })),
          dryRun: true,
          includePdfs,
          categoryIds: uploadCategoryIds,
          isGlobal: uploadIsGlobal,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.preview) setWebsitePreview(data.preview);
      }
    } catch (err) {
      console.error('Preview failed:', err);
    } finally {
      setPreviewing(false);
    }
  };

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

  // Load documents
  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/documents');
      if (!response.ok) throw new Error('Failed to load documents');
      const data = await response.json();
      setDocuments(data.documents.map((d: GlobalDocument) => ({
        ...d,
        uploadedAt: new Date(d.uploadedAt),
      })));
      setTotalChunks(data.totalChunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/categories');
      if (!response.ok) throw new Error('Failed to load categories');
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  // Load acronym mappings
  const loadAcronymMappings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings/acronyms');
      if (!response.ok) throw new Error('Failed to load acronym mappings');
      const data = await response.json();
      setAcronymMappings(data);
      const mappingsText = Object.entries(data.mappings || {})
        .map(([key, value]) => `${key} = ${value}`)
        .join('\n');
      setEditedAcronyms(mappingsText);
    } catch (err) {
      console.error('Failed to load acronym mappings:', err);
    }
  }, []);

  // Load folder syncs
  const loadFolderSyncs = useCallback(async () => {
    try {
      setLoadingFolderSyncs(true);
      const response = await fetch('/api/admin/documents/folders');
      if (!response.ok) throw new Error('Failed to load folder syncs');
      const data = await response.json();
      setFolderSyncs(data.folderSyncs || []);
    } catch (err) {
      console.error('Failed to load folder syncs:', err);
    } finally {
      setLoadingFolderSyncs(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    loadCategories();
    loadAcronymMappings();
    loadFolderSyncs();
  }, [loadDocuments, loadCategories, loadAcronymMappings, loadFolderSyncs]);

  // Poll for processing documents (refresh every 5s while any doc is 'processing')
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/admin/documents');
        if (!response.ok) return;
        const data = await response.json();
        setDocuments(data.documents.map((d: GlobalDocument) => ({
          ...d,
          uploadedAt: new Date(d.uploadedAt),
        })));
        setTotalChunks(data.totalChunks);
      } catch {
        // Silently ignore polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [documents]);

  // Reset upload form
  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadTextName('');
    setUploadTextContent('');
    setUploadCategoryIds([]);
    setUploadIsGlobal(false);
    setUploadMode('file');
    setUploadYoutubeUrl('');
    setUploadUrlName('');
    setUrlIngestionResults(null);
    // Reset websites state
    setWebEntries([{ id: crypto.randomUUID(), url: '', mode: 'page', crawlLimit: 25, crawlPathFilter: '', crawlExcludeFilter: '' }]);
    setIncludePdfs(true);
    setCrawlInfo(null);
    setWebsitePreview(null);
    // Reset folder state
    setFolderFiles([]);
    setFolderName('');
    setFolderUploadProgress(null);
    setFolderUploadResults(null);
  };

  // Upload handler
  const handleUploadConfirm = async () => {
    if (uploadMode === 'file' && !uploadFile) return;
    if (uploadMode === 'text' && (!uploadTextName.trim() || !uploadTextContent.trim())) return;
    if (uploadMode === 'websites' && getValidWebEntries().length === 0) return;
    if (uploadMode === 'youtube' && (!uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim()))) return;
    if (uploadMode === 'folder' && folderFiles.length === 0) return;

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
      } else if (uploadMode === 'websites') {
        const validEntries = getValidWebEntries();
        const hasCrawl = validEntries.some(e => e.mode === 'crawl');
        setUploadProgress(hasCrawl ? 'Crawling websites...' : 'Extracting content...');

        response = await fetch('/api/admin/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: validEntries.map(e => ({
              url: e.url.trim(),
              mode: e.mode,
              crawlOptions: e.mode === 'crawl' ? {
                limit: e.crawlLimit,
                selectPaths: e.crawlPathFilter.split('\n').map(p => p.trim()).filter(Boolean).length > 0
                  ? e.crawlPathFilter.split('\n').map(p => p.trim()).filter(Boolean)
                  : undefined,
                excludePaths: e.crawlExcludeFilter.split('\n').map(p => p.trim()).filter(Boolean).length > 0
                  ? e.crawlExcludeFilter.split('\n').map(p => p.trim()).filter(Boolean)
                  : undefined,
              } : undefined,
            })),
            includePdfs,
            categoryIds: uploadCategoryIds,
            isGlobal: uploadIsGlobal,
          }),
        });
      } else if (uploadMode === 'youtube') {
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
      } else {
        // Folder upload mode
        setUploadProgress('Preparing folder upload...');
        setFolderUploadProgress({ current: 0, total: folderFiles.length, currentFile: '' });

        const formData = new FormData();
        formData.append('folderName', folderName);
        formData.append('categoryIds', JSON.stringify(uploadCategoryIds));
        formData.append('isGlobal', String(uploadIsGlobal));

        // Add all files with their relative paths
        for (const item of folderFiles) {
          formData.append('files', item.file);
          formData.append('paths', item.relativePath);
        }

        response = await fetch('/api/admin/documents/folder', {
          method: 'POST',
          body: formData,
        });
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await response.json();

      if (uploadMode === 'websites' || uploadMode === 'youtube') {
        if (data.results) {
          setUrlIngestionResults(data.results);
        }
        if (data.crawlInfo) {
          setCrawlInfo(data.crawlInfo);
        }
      }

      if (uploadMode === 'folder') {
        // Handle folder upload results
        setFolderUploadProgress(null);
        if (data.summary) {
          setFolderUploadResults({
            synced: data.summary.synced || 0,
            failed: data.summary.failed || 0,
            skipped: data.summary.skipped || 0,
          });
        }
        await loadFolderSyncs();
      }

      await loadDocuments();
      if (uploadMode !== 'websites' && uploadMode !== 'youtube' && uploadMode !== 'folder') {
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

  // Delete handler
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

      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
      setDeleteDoc(null);
    }
  };

  // Edit document
  const handleEditDoc = (doc: GlobalDocument) => {
    setEditingDoc(doc);
    setEditDocCategoryIds(doc.categories?.map(c => c.id) || []);
    setEditDocIsGlobal(doc.isGlobal || false);
  };

  // Save document changes
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

  // Handle folder re-sync (not used in initial upload - for future use via folder management section)
  const handleFolderResync = async (syncId: string, files: File[], relativePaths: string[]) => {
    setResyncingFolder(syncId);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('relativePaths', JSON.stringify(relativePaths));
      for (const file of files) {
        formData.append('files', file);
      }

      const response = await fetch(`/api/admin/documents/folders/${syncId}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Re-sync failed');
      }

      await loadDocuments();
      await loadFolderSyncs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-sync failed');
    } finally {
      setResyncingFolder(null);
    }
  };

  // Delete folder sync
  const handleDeleteFolderSync = async (syncId: string, deleteDocuments: boolean = false) => {
    if (!confirm(deleteDocuments
      ? 'Delete this folder sync AND all associated documents? This cannot be undone.'
      : 'Delete this folder sync record? Documents will be kept.')) {
      return;
    }

    setDeletingFolder(syncId);
    setError(null);

    try {
      const response = await fetch(`/api/admin/documents/folders/${syncId}?deleteDocuments=${deleteDocuments}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }

      await loadDocuments();
      await loadFolderSyncs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingFolder(null);
    }
  };

  // Handle folder file selection
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Extract folder name from first file path
    const firstFile = files[0];
    const pathParts = firstFile.webkitRelativePath.split('/');
    const rootFolderName = pathParts[0] || 'Uploaded Folder';
    setFolderName(rootFolderName);

    // Build file list with relative paths
    const fileList: FolderUploadFile[] = [];
    const supportedExtensions = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = file.webkitRelativePath;
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();

      if (supportedExtensions.includes(extension)) {
        fileList.push({
          file,
          relativePath,
          status: 'pending',
        });
      }
    }

    setFolderFiles(fileList);
    setFolderUploadResults(null);
  };

  // Reindex document
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

  // Refresh all documents
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

  // Document sort handler
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

  // Acronyms handlers
  const handleAcronymsChange = (value: string) => {
    setEditedAcronyms(value);
    const originalText = Object.entries(acronymMappings?.mappings || {})
      .map(([key, val]) => `${key} = ${val}`)
      .join('\n');
    setAcronymsModified(value !== originalText);
  };

  const handleSaveAcronyms = async () => {
    const mappings: Record<string, string> = {};
    const lines = editedAcronyms.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || !trimmedLine.includes('=')) continue;
      const [key, ...valueParts] = trimmedLine.split('=');
      const acronym = key.trim().toUpperCase();
      const expansion = valueParts.join('=').trim();
      if (acronym && expansion) {
        mappings[acronym] = expansion;
      }
    }

    try {
      const response = await fetch('/api/admin/settings/acronyms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save acronym mappings');
      }

      await loadAcronymMappings();
      setAcronymsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save acronym mappings');
    }
  };

  const handleResetAcronyms = () => {
    const originalText = Object.entries(acronymMappings?.mappings || {})
      .map(([key, val]) => `${key} = ${val}`)
      .join('\n');
    setEditedAcronyms(originalText);
    setAcronymsModified(false);
  };

  // Multi-select helpers
  const toggleDocSelection = useCallback((docId: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const handleBulkDownload = useCallback(async () => {
    for (const docId of selectedDocIds) {
      const a = document.createElement('a');
      a.href = `/api/admin/documents/${docId}/download`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Small delay between downloads to prevent browser blocking
      await new Promise(r => setTimeout(r, 300));
    }
  }, [selectedDocIds]);

  const handleBulkDelete = useCallback(async () => {
    setBulkDeleting(true);
    try {
      for (const docId of selectedDocIds) {
        const res = await fetch(`/api/admin/documents/${docId}`, { method: 'DELETE' });
        if (!res.ok) {
          const doc = documents.find(d => d.id === docId);
          console.error(`Failed to delete ${doc?.filename || docId}`);
        }
      }
      setSelectedDocIds(new Set());
      setShowBulkDeleteConfirm(false);
      await loadDocuments();
    } catch (err) {
      console.error('Bulk delete error:', err);
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedDocIds, documents, loadDocuments]);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedDocIds(new Set());
  }, [docCategoryFilter, docStatusFilter, docSearchTerm]);

  // Filtered and sorted documents
  const filteredAndSortedDocs = useMemo(() => {
    let result = [...documents];

    // Apply category filter
    if (docCategoryFilter !== 'all') {
      if (docCategoryFilter === 'global') {
        result = result.filter(doc => doc.isGlobal);
      } else if (docCategoryFilter === 'uncategorized') {
        result = result.filter(doc => !doc.isGlobal && (!doc.categories || doc.categories.length === 0));
      } else {
        result = result.filter(doc => doc.categories?.some(c => c.id === docCategoryFilter));
      }
    }

    // Apply status filter
    if (docStatusFilter !== 'all') {
      result = result.filter(doc => doc.status === docStatusFilter);
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

    // Apply sorting from dropdown
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
  }, [documents, docSearchTerm, docSortKey, docSortDirection, docCategoryFilter, docStatusFilter, docSortOption]);

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
              <ChevronUp size={14} />
            ) : isActive && docSortDirection === 'desc' ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronsUpDown size={14} />
            )}
          </span>
        </button>
      </th>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border shadow-sm px-6 py-12 flex justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {/* Documents Accordion Section */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection('documents')}
          className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-gray-600" />
            <div className="text-left">
              <h2 className="font-semibold text-gray-900">Documents</h2>
              <p className="text-sm text-gray-500">Manage knowledge base documents</p>
            </div>
          </div>
          {expandedSections.has('documents') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
        </button>
        {expandedSections.has('documents') && (
          <div className="border-t">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Knowledge Base Documents</h3>
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

                {/* Status Filter */}
                <div className="flex items-center gap-2">
                  <select
                    value={docStatusFilter}
                    onChange={(e) => setDocStatusFilter(e.target.value as typeof docStatusFilter)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  >
                    <option value="all">All Status</option>
                    <option value="ready">Ready ({documents.filter(d => d.status === 'ready').length})</option>
                    <option value="error">Error ({documents.filter(d => d.status === 'error').length})</option>
                    <option value="processing">Processing ({documents.filter(d => d.status === 'processing').length})</option>
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
                {(docCategoryFilter !== 'all' || docStatusFilter !== 'all' || docSearchTerm) && (
                  <button
                    onClick={() => {
                      setDocCategoryFilter('all');
                      setDocStatusFilter('all');
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
            <>
            {/* Bulk action bar */}
            {selectedDocIds.size > 0 && (
              <div className="mx-6 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-medium text-blue-800">
                  {selectedDocIds.size} document{selectedDocIds.size > 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkDownload}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-lg transition-colors"
                  >
                    <Download size={14} />
                    Download
                  </button>
                  <button
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 text-left text-sm text-gray-600">
                  <tr>
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={filteredAndSortedDocs.length > 0 && filteredAndSortedDocs.every(d => selectedDocIds.has(d.id))}
                        onChange={() => {
                          const allSelected = filteredAndSortedDocs.every(d => selectedDocIds.has(d.id));
                          if (allSelected) {
                            setSelectedDocIds(new Set());
                          } else {
                            setSelectedDocIds(new Set(filteredAndSortedDocs.map(d => d.id)));
                          }
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
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
                    <tr key={doc.id} className={`hover:bg-gray-50 ${selectedDocIds.has(doc.id) ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(doc.id)}
                          onChange={() => toggleDocSelection(doc.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
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
            </>
          )}

          {/* Bulk Delete Confirmation Modal */}
          {showBulkDeleteConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete {selectedDocIds.size} Document{selectedDocIds.size > 1 ? 's' : ''}?</h3>
                <p className="text-sm text-gray-600 mb-3">This will permanently delete the following documents and their embeddings:</p>
                <ul className="text-sm text-gray-700 max-h-40 overflow-y-auto mb-4 space-y-1">
                  {documents.filter(d => selectedDocIds.has(d.id)).map(d => (
                    <li key={d.id} className="flex items-center gap-2">
                      <FileText size={12} className="text-gray-400 shrink-0" />
                      <span className="truncate">{d.filename}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowBulkDeleteConfirm(false)}
                    disabled={bulkDeleting}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {bulkDeleting ? 'Deleting...' : 'Delete All'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Synced Folders Section */}
          {folderSyncs.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <button
                onClick={() => setShowFolderSyncs(!showFolderSyncs)}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                <ChevronRight
                  size={16}
                  className={`transition-transform ${showFolderSyncs ? 'rotate-90' : ''}`}
                />
                <FolderOpen size={16} />
                Synced Folders ({folderSyncs.length})
              </button>

              {showFolderSyncs && (
                <div className="mt-3 space-y-2">
                  {loadingFolderSyncs ? (
                    <div className="flex justify-center py-4">
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    folderSyncs.map((sync) => (
                      <div
                        key={sync.id}
                        className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          <FolderOpen className="w-5 h-5 text-blue-600" />
                          <div>
                            <p className="font-medium text-gray-900">{sync.folderName}</p>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <span className="flex items-center gap-1">
                                <FileText size={12} />
                                {sync.syncedFiles}/{sync.totalFiles} files
                              </span>
                              {sync.failedFiles > 0 && (
                                <span className="text-red-600">
                                  {sync.failedFiles} failed
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {sync.lastSyncedAt ? formatDate(sync.lastSyncedAt) : formatDate(sync.createdAt)}
                              </span>
                              {sync.isGlobal && (
                                <span className="flex items-center gap-1 text-purple-600">
                                  <Globe size={12} />
                                  Global
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full ${
                              sync.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : sync.status === 'syncing'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {sync.status}
                          </span>
                          <button
                            onClick={() => handleDeleteFolderSync(sync.id, false)}
                            disabled={deletingFolder === sync.id}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                            title="Remove sync record (keep documents)"
                          >
                            {deletingFolder === sync.id ? (
                              <Spinner size="sm" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        )}
      </div>

      {/* Acronyms Accordion Section */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection('acronyms')}
          className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Tag size={20} className="text-gray-600" />
            <div className="text-left">
              <h2 className="font-semibold text-gray-900">Acronyms</h2>
              <p className="text-sm text-gray-500">Define acronym expansions for better search</p>
            </div>
          </div>
          {expandedSections.has('acronyms') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
        </button>
        {expandedSections.has('acronyms') && (
          <div className="border-t">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Acronym Mappings</h3>
                  <p className="text-sm text-gray-500">
                    Define acronyms and their expansions for better search and understanding
                </p>
              </div>
              <div className="flex items-center gap-2">
                {acronymsModified && (
                  <Button variant="secondary" onClick={handleResetAcronyms}>
                    Reset
                  </Button>
                )}
                <Button onClick={handleSaveAcronyms} disabled={!acronymsModified} loading={false}>
                  <Save size={18} className="mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </div>
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-4">
              Enter one acronym per line in the format: <code className="bg-gray-100 px-1 rounded">ACRONYM = Expansion</code>
            </p>
            <textarea
              value={editedAcronyms}
              onChange={(e) => handleAcronymsChange(e.target.value)}
              placeholder="EPA = Environmental Protection Agency&#10;FDA = Food and Drug Administration&#10;OSHA = Occupational Safety and Health Administration"
              className="w-full h-96 px-4 py-3 font-mono text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            {acronymMappings?.updatedAt && (
              <p className="mt-3 text-xs text-gray-400">
                Last updated: {formatDate(acronymMappings.updatedAt)}
                {acronymMappings.updatedBy && ` by ${acronymMappings.updatedBy}`}
              </p>
            )}
          </div>
          </div>
        )}
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
          resetUploadForm();
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
            onClick={() => setUploadMode('websites')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'websites'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Globe size={16} className="inline mr-2" />
            Websites
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
          {/* Folder tab hidden on mobile - webkitdirectory API not supported */}
          {!isMobile && (
            <button
              onClick={() => setUploadMode('folder')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                uploadMode === 'folder'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FolderOpen size={16} className="inline mr-2" />
              Folder
            </button>
          )}
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

          {/* URLs Mode - Extract single pages */}
          {/* Websites Mode - unified single page + crawl */}
          {uploadMode === 'websites' && (
            <>
              {/* Results */}
              {urlIngestionResults && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Results</h4>
                  {crawlInfo && (
                    <div className="text-xs text-gray-600 mb-2 p-2 bg-blue-50 rounded">
                      <p>Base URL: {crawlInfo.baseUrl}</p>
                      <p>Pages found: {crawlInfo.totalPagesFound} | Ingested: {crawlInfo.pagesIngested}</p>
                      {crawlInfo.pdfCount && crawlInfo.pdfCount > 0 && (
                        <p>PDFs: {crawlInfo.pdfsIngested || 0} of {crawlInfo.pdfCount} ingested</p>
                      )}
                      <p>Estimated credits used: ~{crawlInfo.estimatedCredits}</p>
                    </div>
                  )}
                  <div className="space-y-2 max-h-48 overflow-y-auto">
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
                    onClick={() => { setUrlIngestionResults(null); setCrawlInfo(null); setWebsitePreview(null); }}
                    className="mt-2 text-xs text-blue-600 hover:underline"
                  >
                    Clear results
                  </button>
                </div>
              )}

              {/* URL Entries */}
              <div className="space-y-3">
                {webEntries.map((entry, index) => (
                  <div key={entry.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="url"
                        value={entry.url}
                        onChange={(e) => {
                          const url = e.target.value;
                          updateWebEntry(entry.id, { url });
                        }}
                        onBlur={(e) => {
                          const url = e.target.value.trim();
                          if (url && isValidUrl(url)) {
                            updateWebEntry(entry.id, { mode: detectUrlMode(url) });
                          }
                        }}
                        placeholder={index === 0 ? 'https://example.com/page or https://example.com/' : '(optional)'}
                        className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
                          entry.url && !isValidUrl(entry.url) ? 'border-red-300' : 'border-gray-300'
                        }`}
                      />
                      {webEntries.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeWebEntry(entry.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Mode toggle */}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`mode-${entry.id}`}
                          checked={entry.mode === 'page'}
                          onChange={() => updateWebEntry(entry.id, { mode: 'page' })}
                          className="text-blue-600"
                        />
                        <span className="text-xs text-gray-700">Single page</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`mode-${entry.id}`}
                          checked={entry.mode === 'crawl'}
                          onChange={() => updateWebEntry(entry.id, { mode: 'crawl' })}
                          className="text-blue-600"
                        />
                        <span className="text-xs text-gray-700">Crawl whole site</span>
                      </label>
                    </div>

                    {/* Crawl options */}
                    {entry.mode === 'crawl' && (
                      <div className="mt-2 pl-2 border-l-2 border-blue-200 space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-600 whitespace-nowrap">Max pages:</label>
                          <select
                            value={entry.crawlLimit}
                            onChange={(e) => updateWebEntry(entry.id, { crawlLimit: Number(e.target.value) })}
                            className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value={10}>10 (~1 credit)</option>
                            <option value={25}>25 (~3 credits)</option>
                            <option value={50}>50 (~5 credits)</option>
                            <option value={100}>100 (~10 credits)</option>
                          </select>
                        </div>
                        <details>
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Path filters (advanced)</summary>
                          <div className="mt-1 space-y-1">
                            <textarea
                              value={entry.crawlPathFilter}
                              onChange={(e) => updateWebEntry(entry.id, { crawlPathFilter: e.target.value })}
                              placeholder={"/docs/.*\n/guide/.*"}
                              rows={2}
                              className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <textarea
                              value={entry.crawlExcludeFilter}
                              onChange={(e) => updateWebEntry(entry.id, { crawlExcludeFilter: e.target.value })}
                              placeholder={"/api/.*\n/admin/.*"}
                              rows={2}
                              className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addWebEntry}
                className="mt-2 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
              >
                <span className="text-lg leading-none">+</span> Add URL
              </button>

              {/* Include PDFs */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="includePdfsWebsites"
                  checked={includePdfs}
                  onChange={(e) => setIncludePdfs(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="includePdfsWebsites" className="text-sm text-gray-700">
                  Include PDF documents found during crawl
                </label>
              </div>

              {/* Preview & Estimate */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleWebsitePreview}
                  disabled={previewing || getValidWebEntries().filter(e => e.mode === 'crawl').length === 0}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {previewing ? <Spinner size="sm" /> : <Globe size={14} />}
                  Preview &amp; Estimate (~1 credit per crawl entry)
                </button>

                {websitePreview && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
                    {websitePreview.entries.filter(e => e.mode === 'crawl').map((e, i) => (
                      <div key={i}>
                        {e.siteBlocked ? (
                          <div className="p-2 bg-orange-50 border border-orange-300 rounded text-orange-800 space-y-1">
                            <p className="font-medium">⚠ {e.url}: site blocked automated discovery</p>
                            <p>The site is blocking the Map API so page count cannot be estimated. Processing will still attempt a direct extraction of the homepage as a fallback.</p>
                            <p className="font-medium mt-1">To extract specific pages individually:</p>
                            <ul className="list-disc list-inside space-y-0.5 ml-1">
                              <li>Switch this entry to <strong>Single page</strong> to fetch only the homepage directly</li>
                              <li>Use <strong>+ Add URL</strong> to add each specific page URL you want, each set to <strong>Single page</strong> mode</li>
                            </ul>
                          </div>
                        ) : (
                          <p>{e.url}: ~{e.estimatedPages} pages, {e.pdfCount} PDFs</p>
                        )}
                      </div>
                    ))}
                    <p className="font-medium pt-1 border-t border-blue-200">
                      {websitePreview.totals.estimatedPages > 0
                        ? `~${websitePreview.totals.estimatedPages} pages, ${websitePreview.totals.pdfCount} PDFs, ~${websitePreview.totals.estimatedCredits} credits`
                        : `~${websitePreview.totals.estimatedCredits} credits used for preview scan`}
                    </p>
                    {websitePreview.pdfWarning && (
                      <div className="mt-1 p-2 bg-yellow-50 border border-yellow-300 rounded text-yellow-800">
                        ⚠ {websitePreview.totals.pdfCount} PDFs detected. Each will be extracted using your configured provider.
                        To skip PDFs, uncheck &quot;Include PDF documents&quot; above.
                      </div>
                    )}
                  </div>
                )}
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

          {/* Folder Upload Mode */}
          {uploadMode === 'folder' && (
            <>
              {/* Folder Upload Results */}
              {folderUploadResults && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Upload Results</h4>
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center gap-2 text-green-700">
                      <CheckCircle size={16} />
                      {folderUploadResults.synced} files synced successfully
                    </p>
                    {folderUploadResults.skipped > 0 && (
                      <p className="flex items-center gap-2 text-yellow-700">
                        <AlertCircle size={16} />
                        {folderUploadResults.skipped} files skipped (unsupported type)
                      </p>
                    )}
                    {folderUploadResults.failed > 0 && (
                      <p className="flex items-center gap-2 text-red-700">
                        <AlertCircle size={16} />
                        {folderUploadResults.failed} files failed
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFolderUploadResults(null);
                      setFolderFiles([]);
                      setFolderName('');
                    }}
                    className="mt-2 text-xs text-blue-600 hover:underline"
                  >
                    Upload another folder
                  </button>
                </div>
              )}

              {/* Folder Selection */}
              {!folderUploadResults && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Select Folder
                    </label>
                    {folderFiles.length > 0 ? (
                      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-5 h-5 text-blue-600" />
                            <span className="font-medium text-gray-900">{folderName}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setFolderFiles([]);
                              setFolderName('');
                            }}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            <X size={14} className="text-gray-500" />
                          </button>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {folderFiles.length} supported files found
                        </p>
                        <div className="max-h-32 overflow-y-auto text-xs text-gray-500 space-y-0.5">
                          {folderFiles.slice(0, 20).map((f, idx) => (
                            <p key={idx} className="truncate">{f.relativePath}</p>
                          ))}
                          {folderFiles.length > 20 && (
                            <p className="text-gray-400 italic">...and {folderFiles.length - 20} more</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-gray-50 transition-colors">
                        <FolderOpen size={32} className="text-gray-400 mb-2" />
                        <span className="text-sm text-gray-500">Click to select a folder</span>
                        <span className="text-xs text-gray-400 mt-1">All files in subfolders will be included</span>
                        <input
                          type="file"
                          // @ts-expect-error webkitdirectory is a valid HTML attribute
                          webkitdirectory=""
                          directory=""
                          multiple
                          onChange={handleFolderSelect}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  {/* Upload Progress */}
                  {folderUploadProgress && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-800">
                          Uploading files...
                        </span>
                        <span className="text-sm text-blue-600">
                          {folderUploadProgress.current} / {folderUploadProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${(folderUploadProgress.current / folderUploadProgress.total) * 100}%` }}
                        />
                      </div>
                      {folderUploadProgress.currentFile && (
                        <p className="mt-1 text-xs text-blue-600 truncate">
                          {folderUploadProgress.currentFile}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Folder Limits Notice */}
                  {folderFiles.length > 0 && folderFiles.length > 500 && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        <strong>Warning:</strong> Maximum 500 files per folder upload.
                        Only the first 500 files will be processed.
                      </p>
                    </div>
                  )}

                  {/* Info */}
                  <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-600">
                      <strong>Supported files:</strong> PDF, DOCX, XLSX, PPTX, TXT, MD, PNG, JPG, WEBP, GIF
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Folder path is preserved in document metadata for re-sync capability.
                    </p>
                  </div>
                </>
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
                          &times;
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
                : uploadMode === 'websites'
                ? getValidWebEntries().length === 0
                : uploadMode === 'youtube'
                ? !uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim())
                : folderFiles.length === 0
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
                          &times;
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
    </div>
  );
}
