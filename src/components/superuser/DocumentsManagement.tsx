'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { FileText, Upload, Trash2, X, ChevronUp, ChevronDown, ChevronsUpDown, Search, CheckCircle, AlertCircle, Youtube, Filter, SortAsc, Globe, Download, Link2, FolderOpen, Clock, ChevronRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { type SortDirection } from '@/components/ui/SortableTable';

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

interface AssignedCategory {
  categoryId: number;
  categoryName: string;
  createdBy?: string;
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
  documents: ManagedDocument[];
  assignedCategories: AssignedCategory[];
  loadData: () => Promise<void>;
  setError: (error: string | null) => void;
}

export default function DocumentsManagement({
  documents,
  assignedCategories,
  loadData,
  setError,
}: DocumentsManagementProps) {
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text' | 'urls' | 'crawl' | 'youtube' | 'folder'>('file');
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
  const [urlIngestionResults, setUrlIngestionResults] = useState<UrlIngestionResult[] | null>(null);

  // Crawl state (for Crawl Site tab)
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlLimit, setCrawlLimit] = useState<number>(25);
  const [crawlPathFilter, setCrawlPathFilter] = useState('');
  const [crawlExcludeFilter, setCrawlExcludeFilter] = useState('');
  const [crawlInfo, setCrawlInfo] = useState<CrawlInfo | null>(null);
  const [includePdfs, setIncludePdfs] = useState(true);  // Include PDF files in crawl

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
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);

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

  // Document search, filter, and sort state
  const [docSearchTerm, setDocSearchTerm] = useState('');
  const [docSortKey, setDocSortKey] = useState<keyof ManagedDocument | null>(null);
  const [docSortDirection, setDocSortDirection] = useState<SortDirection>(null);
  const [docCategoryFilter, setDocCategoryFilter] = useState<number | 'all'>('all');
  const [docSortOption, setDocSortOption] = useState<'newest' | 'oldest' | 'largest' | 'smallest' | 'a-z' | 'z-a'>('newest');

  // URL validation helpers
  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const isYouTubeUrl = (url: string): boolean => {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(url);
  };

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
    // Reset crawl state
    setCrawlUrl('');
    setCrawlLimit(25);
    setCrawlPathFilter('');
    setCrawlExcludeFilter('');
    setCrawlInfo(null);
    setIncludePdfs(true);
    // Reset folder state
    setFolderFiles([]);
    setFolderName('');
    setFolderUploadProgress(null);
    setFolderUploadResults(null);
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

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadCategory) return;
    if (uploadMode === 'file' && !uploadFile) return;
    if (uploadMode === 'text' && (!uploadTextName.trim() || !uploadTextContent.trim())) return;
    if (uploadMode === 'urls' && getValidWebUrls().length === 0) return;
    if (uploadMode === 'crawl' && !crawlUrl.trim()) return;
    if (uploadMode === 'youtube' && (!uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim()))) return;
    if (uploadMode === 'folder' && folderFiles.length === 0) return;

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
      } else if (uploadMode === 'urls') {
        // Extract mode (single pages)
        const webUrls = getValidWebUrls();
        response = await fetch('/api/superuser/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: webUrls,
            categoryId: uploadCategory,
          }),
        });
      } else if (uploadMode === 'crawl') {
        // Crawl mode
        // Parse path filters
        const selectPaths = crawlPathFilter
          .split('\n')
          .map(p => p.trim())
          .filter(p => p.length > 0);
        const excludePaths = crawlExcludeFilter
          .split('\n')
          .map(p => p.trim())
          .filter(p => p.length > 0);

        response = await fetch('/api/superuser/documents/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            crawlUrl: crawlUrl.trim(),
            crawlOptions: {
              limit: crawlLimit,
              selectPaths: selectPaths.length > 0 ? selectPaths : undefined,
              excludePaths: excludePaths.length > 0 ? excludePaths : undefined,
            },
            categoryId: uploadCategory,
            includePdfs,
          }),
        });
      } else if (uploadMode === 'youtube') {
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
      } else {
        // Folder upload mode
        setFolderUploadProgress({ current: 0, total: folderFiles.length, currentFile: '' });

        const formData = new FormData();
        formData.append('folderName', folderName);
        formData.append('categoryId', uploadCategory!.toString());

        // Add all files with their relative paths
        for (const item of folderFiles) {
          formData.append('files', item.file);
          formData.append('paths', item.relativePath);
        }

        response = await fetch('/api/superuser/documents/folder', {
          method: 'POST',
          body: formData,
        });
      }

      const data = await response.json();

      if (uploadMode === 'urls' || uploadMode === 'crawl' || uploadMode === 'youtube') {
        // Handle URL ingestion results
        if (data.results) {
          setUrlIngestionResults(data.results);
          if (data.crawlInfo) {
            setCrawlInfo(data.crawlInfo);
          }
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
      } else if (uploadMode === 'folder') {
        // Handle folder upload results
        setFolderUploadProgress(null);
        if (!response.ok) {
          throw new Error(data.error || 'Folder upload failed');
        }
        if (data.summary) {
          setFolderUploadResults({
            synced: data.summary.synced || 0,
            failed: data.summary.failed || 0,
            skipped: data.summary.skipped || 0,
          });
        }
        await loadFolderSyncs();
        await loadData();
        // Don't close modal - show results
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

  // Load folder syncs
  const loadFolderSyncs = async () => {
    try {
      setLoadingFolderSyncs(true);
      const response = await fetch('/api/superuser/documents/folders');
      if (!response.ok) throw new Error('Failed to load folder syncs');
      const data = await response.json();
      setFolderSyncs(data.folderSyncs || []);
    } catch (err) {
      console.error('Failed to load folder syncs:', err);
    } finally {
      setLoadingFolderSyncs(false);
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
      const response = await fetch(`/api/superuser/documents/folders/${syncId}?deleteDocuments=${deleteDocuments}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }

      await loadData();
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

  // Load folder syncs on mount
  useEffect(() => {
    loadFolderSyncs();
  }, []);

  return (
    <>
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

        {/* Synced Folders Section */}
        {folderSyncs.length > 0 && (
          <div className="border-t pt-4 px-6 pb-4">
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
            onClick={() => setUploadMode('urls')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'urls'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Link2 size={16} className="inline mr-2" />
            URLs
          </button>
          <button
            type="button"
            onClick={() => setUploadMode('crawl')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              uploadMode === 'crawl'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Globe size={16} className="inline mr-2" />
            Crawl Site
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
          {/* Folder tab hidden on mobile - webkitdirectory API not supported */}
          {!isMobile && (
            <button
              type="button"
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

            {/* URLs Mode (single page extraction) */}
            {uploadMode === 'urls' && (
              <>
                {/* URL Ingestion Results */}
                {urlIngestionResults && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Ingestion Results</h4>
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
                      onClick={() => setUrlIngestionResults(null)}
                      className="mt-2 text-xs text-blue-600 hover:underline"
                    >
                      Clear results
                    </button>
                  </div>
                )}

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

            {/* Crawl Site Mode (full website crawl) */}
            {uploadMode === 'crawl' && (
              <>
                {/* Crawl Results */}
                {urlIngestionResults && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Crawl Results</h4>
                    {crawlInfo && (
                      <div className="text-xs text-gray-600 mb-2 p-2 bg-blue-50 rounded">
                        <p>Base URL: {crawlInfo.baseUrl}</p>
                        <p>Pages found: {crawlInfo.totalPagesFound} | Ingested: {crawlInfo.pagesIngested}</p>
                        {crawlInfo.pdfCount !== undefined && crawlInfo.pdfCount > 0 && (
                          <p>PDFs found: {crawlInfo.pdfCount} | Ingested: {crawlInfo.pdfsIngested || 0} | Failed: {crawlInfo.pdfsFailed || 0}</p>
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
                          <div className="min-w-0 flex items-center gap-2">
                            <p className="truncate">{result.url}</p>
                            {result.sourceType === 'pdf' && (
                              <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">PDF</span>
                            )}
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
                      onClick={() => {
                        setUrlIngestionResults(null);
                        setCrawlInfo(null);
                      }}
                      className="mt-2 text-xs text-blue-600 hover:underline"
                    >
                      Clear results
                    </button>
                  </div>
                )}

                {/* Base URL input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Base URL to Crawl
                  </label>
                  <input
                    type="url"
                    value={crawlUrl}
                    onChange={(e) => setCrawlUrl(e.target.value)}
                    placeholder="https://example.com/docs"
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
                      crawlUrl && !isValidUrl(crawlUrl) ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
                </div>

                {/* Max Pages Selector */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Maximum Pages
                  </label>
                  <select
                    value={crawlLimit}
                    onChange={(e) => setCrawlLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value={10}>10 pages (~1 credit)</option>
                    <option value={25}>25 pages (~3 credits)</option>
                    <option value={50}>50 pages (~5 credits)</option>
                    <option value={100}>100 pages (~10 credits)</option>
                  </select>
                </div>

                {/* Optional Path Filters */}
                <details className="mt-4">
                  <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                    Advanced: Path Filters
                  </summary>
                  <div className="mt-2 space-y-3 pl-2 border-l-2 border-gray-200">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Include paths (regex, one per line)
                      </label>
                      <textarea
                        value={crawlPathFilter}
                        onChange={(e) => setCrawlPathFilter(e.target.value)}
                        placeholder={"/docs/.*\n/guide/.*"}
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Exclude paths (regex, one per line)
                      </label>
                      <textarea
                        value={crawlExcludeFilter}
                        onChange={(e) => setCrawlExcludeFilter(e.target.value)}
                        placeholder={"/api/.*\n/admin/.*"}
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </details>

                {/* PDF Option */}
                <div className="mt-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includePdfs"
                    checked={includePdfs}
                    onChange={(e) => setIncludePdfs(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="includePdfs" className="text-sm font-medium text-gray-700">
                    Include PDF documents
                  </label>
                  <span className="text-xs text-gray-500">
                    (discovers and downloads PDFs)
                  </span>
                </div>

                {/* Credit Usage Warning */}
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    <strong>Credit Usage:</strong> Crawling uses ~1 Tavily credit per 10 pages.
                    With {crawlLimit} pages limit, expect up to {Math.ceil(crawlLimit / 10)} credits.
                    {includePdfs && ' Additional credits used for PDF discovery.'}
                  </p>
                </div>

                {/* Note about crawl limitations */}
                <div className="mt-3 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-600">
                    <strong>Note:</strong> Web crawl extracts HTML content only.
                    {includePdfs
                      ? ' PDFs found on the site will be downloaded and processed separately.'
                      : ' Enable "Include PDF documents" to capture PDFs from the site.'}
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
                  : uploadMode === 'urls'
                  ? getValidWebUrls().length === 0
                  : uploadMode === 'crawl'
                  ? !crawlUrl.trim() || !isValidUrl(crawlUrl)
                  : uploadMode === 'youtube'
                  ? !uploadYoutubeUrl.trim() || !isYouTubeUrl(uploadYoutubeUrl.trim())
                  : folderFiles.length === 0)
              }
            >
              Upload
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
