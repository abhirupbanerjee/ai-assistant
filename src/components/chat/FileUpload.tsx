'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Paperclip,
  FileText,
  Upload,
  Loader2,
  ImageIcon,
  Globe,
  Youtube,
  Link as LinkIcon,
  X,
  Plus,
  CheckCircle2,
  AlertCircle,
  Info,
  RotateCcw,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';

// MIME type → extension mapping for building the accept attribute
const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/html': '.html',
  'text/csv': '.csv',
  'application/json': '.json',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

// Friendly labels for the drop-zone hint
const MIME_TO_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.ms-powerpoint': 'PPT',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'text/html': 'HTML',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WebP',
};

// Group labels for the drop-zone hint
const TYPE_GROUP_LABELS: Record<string, string> = {
  'application/pdf': 'Documents',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Documents',
  'application/msword': 'Documents',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Documents',
  'application/vnd.ms-excel': 'Documents',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Documents',
  'application/vnd.ms-powerpoint': 'Documents',
  'text/plain': 'Text',
  'text/markdown': 'Text',
  'text/html': 'Text',
  'text/csv': 'Text',
  'application/json': 'Text',
  'image/png': 'Images',
  'image/jpeg': 'Images',
  'image/webp': 'Images',
};

type UploadTab = 'file' | 'web' | 'youtube';

interface UrlSourceInfo {
  filename: string;
  originalUrl: string;
  sourceType: 'web' | 'youtube';
  title?: string;
}

interface ImageCapabilities {
  canProcessImages: boolean;
  hasVisionSupport: boolean;
  hasOcrSupport: boolean;
  strategy: 'vision-and-ocr' | 'vision-only' | 'ocr-only' | 'none';
  message: string;
  modelId: string;
}

interface FileUploadProps {
  threadId: string | null;
  currentUploads: string[];
  onUploadComplete: (filename: string) => void;
  onUrlSourceAdded?: (source: UrlSourceInfo) => void;
  disabled?: boolean;
}

// Queue item types
type QueueItemType = 'file' | 'web' | 'youtube';
type QueueItemStatus = 'pending' | 'uploading' | 'success' | 'error';

interface QueueItem {
  id: string;
  type: QueueItemType;
  name: string;
  file?: File;
  url?: string;
  status: QueueItemStatus;
  error?: string;
}

// Helper to validate YouTube URL
function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'youtube.com' ||
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtu.be' ||
      parsed.hostname === 'm.youtube.com'
    );
  } catch {
    return false;
  }
}

// Helper to validate URL
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default function FileUpload({
  threadId,
  currentUploads,
  onUploadComplete,
  onUrlSourceAdded,
  disabled,
}: FileUploadProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<UploadTab>('file');
  const [isDragging, setIsDragging] = useState(false);
  const [webUrl, setWebUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [webEnabled, setWebEnabled] = useState(false);
  const [youtubeEnabled, setYoutubeEnabled] = useState(false);
  const [imageCapabilities, setImageCapabilities] = useState<ImageCapabilities | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload settings fetched from admin config (Admin → Settings → File Upload)
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(10);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Check if URL extraction and image processing is available
  useEffect(() => {
    const checkCapabilities = async () => {
      try {
        // Check URL extraction capabilities
        const urlResponse = await fetch('/api/admin/documents/url');
        if (urlResponse.ok) {
          const data = await urlResponse.json();
          setWebEnabled(data.webEnabled || false);
          setYoutubeEnabled(data.youtubeSupadataEnabled || false);
        }

        // Check image processing capabilities
        const imgResponse = await fetch('/api/config/capabilities');
        if (imgResponse.ok) {
          const data = await imgResponse.json();
          setImageCapabilities(data);
        }
      } catch {
        // Silently fail - features just won't be available
      }
    };
    checkCapabilities();
  }, []);

  // Fetch upload limits from admin settings (same source as server-side validation)
  useEffect(() => {
    const fetchUploadLimits = async () => {
      try {
        const res = await fetch('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          const limits = data.uploadLimits;
          if (limits) {
            if (limits.allowedTypes && limits.allowedTypes.length > 0) {
              setAllowedTypes(limits.allowedTypes);
            }
            if (limits.maxFileSizeMB) {
              setMaxFileSizeMB(limits.maxFileSizeMB);
            }
          }
        }
      } catch {
        // Silently fail — fall back to defaults
      } finally {
        setSettingsLoaded(true);
      }
    };
    fetchUploadLimits();
  }, []);

  // Reset queue when modal closes
  useEffect(() => {
    if (!isModalOpen) {
      setQueue([]);
      setWebUrl('');
      setYoutubeUrl('');
      setInputError(null);
    }
  }, [isModalOpen]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Build accept string and allowed labels from the fetched allowedTypes
  const acceptExtensions = allowedTypes
    .map((mime) => MIME_TO_EXT[mime])
    .filter(Boolean)
    .join(',');

  const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

  // Build a human-readable summary of allowed types for the drop zone
  const allowedLabels = (() => {
    const groups: string[] = [];
    const docTypes = allowedTypes.filter((m) => TYPE_GROUP_LABELS[m] === 'Documents');
    const textTypes = allowedTypes.filter((m) => TYPE_GROUP_LABELS[m] === 'Text');
    const imageTypes = allowedTypes.filter((m) => TYPE_GROUP_LABELS[m] === 'Images');
    if (docTypes.length > 0) groups.push(docTypes.map((m) => MIME_TO_LABEL[m]).join(', '));
    if (textTypes.length > 0) groups.push(textTypes.map((m) => MIME_TO_LABEL[m]).join(', '));
    if (imageTypes.length > 0) groups.push(imageTypes.map((m) => MIME_TO_LABEL[m]).join(', '));
    return groups;
  })();

  // Add file to queue
  const addFileToQueue = useCallback((file: File) => {
    setInputError(null);

    if (!allowedTypes.includes(file.type)) {
      const allowedLabelsStr = allowedTypes
        .map((m) => MIME_TO_LABEL[m] || m)
        .join(', ');
      setInputError(`Invalid file type. Allowed: ${allowedLabelsStr}`);
      return;
    }

    if (file.size > maxFileSizeBytes) {
      setInputError(`File too large (max ${maxFileSizeMB}MB)`);
      return;
    }

    // Check for duplicates
    const isDuplicate = queue.some(
      (item) => item.type === 'file' && item.name === file.name
    );
    if (isDuplicate) {
      setInputError('This file is already in the queue');
      return;
    }

    setQueue((prev) => [
      ...prev,
      {
        id: generateId(),
        type: 'file',
        name: file.name,
        file,
        status: 'pending',
      },
    ]);
  }, [queue, allowedTypes, maxFileSizeBytes, maxFileSizeMB]);

  // Add web URL to queue
  const addWebUrlToQueue = useCallback(() => {
    setInputError(null);

    if (!webUrl.trim()) {
      setInputError('Please enter a URL');
      return;
    }

    if (!isValidUrl(webUrl)) {
      setInputError('Please enter a valid URL');
      return;
    }

    // Check for duplicates
    const isDuplicate = queue.some(
      (item) => item.type === 'web' && item.url === webUrl
    );
    if (isDuplicate) {
      setInputError('This URL is already in the queue');
      return;
    }

    try {
      const urlObj = new URL(webUrl);
      setQueue((prev) => [
        ...prev,
        {
          id: generateId(),
          type: 'web',
          name: urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname.slice(0, 30) : ''),
          url: webUrl,
          status: 'pending',
        },
      ]);
      setWebUrl('');
    } catch {
      setInputError('Invalid URL format');
    }
  }, [webUrl, queue]);

  // Add YouTube URL to queue
  const addYoutubeUrlToQueue = useCallback(() => {
    setInputError(null);

    if (!youtubeUrl.trim()) {
      setInputError('Please enter a YouTube URL');
      return;
    }

    if (!isValidUrl(youtubeUrl)) {
      setInputError('Please enter a valid URL');
      return;
    }

    if (!isYouTubeUrl(youtubeUrl)) {
      setInputError('Please enter a valid YouTube URL');
      return;
    }

    // Check for duplicates
    const isDuplicate = queue.some(
      (item) => item.type === 'youtube' && item.url === youtubeUrl
    );
    if (isDuplicate) {
      setInputError('This video is already in the queue');
      return;
    }

    setQueue((prev) => [
      ...prev,
      {
        id: generateId(),
        type: 'youtube',
        name: youtubeUrl.includes('youtu.be')
          ? youtubeUrl.split('/').pop() || 'YouTube Video'
          : new URL(youtubeUrl).searchParams.get('v') || 'YouTube Video',
        url: youtubeUrl,
        status: 'pending',
      },
    ]);
    setYoutubeUrl('');
  }, [youtubeUrl, queue]);

  // Remove item from queue
  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Retry a failed item
  const retryItem = useCallback((id: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: 'pending' as QueueItemStatus, error: undefined } : item
      )
    );
  }, []);

  // Process single upload
  const processUpload = async (item: QueueItem): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> => {
    if (!threadId) {
      return { success: false, error: 'No thread selected' };
    }

    try {
      if (item.type === 'file' && item.file) {
        const formData = new FormData();
        formData.append('file', item.file);

        const response = await fetch(`/api/threads/${threadId}/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          return { success: false, error: data.error || 'Upload failed' };
        }

        const data = await response.json();
        return { success: true, data };
      } else if (item.url) {
        const response = await fetch(`/api/threads/${threadId}/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.url, type: item.type }),
        });

        if (!response.ok) {
          const data = await response.json();
          return { success: false, error: data.error || 'Extraction failed' };
        }

        const data = await response.json();
        return { success: true, data };
      }

      return { success: false, error: 'Invalid queue item' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  };

  // Process all uploads in parallel
  const processAllUploads = useCallback(async () => {
    if (!threadId || queue.length === 0) return;

    setIsProcessing(true);

    // Mark all as uploading
    setQueue((prev) =>
      prev.map((item) =>
        item.status === 'pending' ? { ...item, status: 'uploading' as QueueItemStatus } : item
      )
    );

    // Process all in parallel
    const pendingItems = queue.filter((item) => item.status === 'pending' || item.status === 'uploading');
    const results = await Promise.all(
      pendingItems.map(async (item) => {
        const result = await processUpload(item);
        return { item, result };
      })
    );

    // Update queue with results
    setQueue((prev) =>
      prev.map((item) => {
        const result = results.find((r) => r.item.id === item.id);
        if (result) {
          if (result.result.success) {
            return { ...item, status: 'success' as QueueItemStatus };
          } else {
            return { ...item, status: 'error' as QueueItemStatus, error: result.result.error };
          }
        }
        return item;
      })
    );

    // Notify parent of successful uploads
    for (const { item, result } of results) {
      if (result.success && result.data) {
        onUploadComplete(result.data.filename as string);

        // Notify about URL sources
        if (onUrlSourceAdded && result.data.sourceType) {
          onUrlSourceAdded({
            filename: result.data.filename as string,
            originalUrl: (result.data.originalUrl as string) || item.url || '',
            sourceType: result.data.sourceType as 'web' | 'youtube',
            title: result.data.title as string | undefined,
          });
        }
      }
    }

    setIsProcessing(false);

    // Auto-close if all successful
    const allSuccessful = results.every((r) => r.result.success);
    if (allSuccessful && results.length > 0) {
      setTimeout(() => {
        setIsModalOpen(false);
      }, 500);
    }
  }, [threadId, queue, onUploadComplete, onUrlSourceAdded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => addFileToQueue(file));
  }, [addFileToQueue]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => addFileToQueue(file));
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Tab configuration with disabled state messages
  const tabs: { id: UploadTab; label: string; icon: React.ReactNode; enabled: boolean; disabledMessage?: string }[] = [
    { id: 'file', label: 'File', icon: <FileText size={16} />, enabled: true },
    {
      id: 'web',
      label: 'Web URL',
      icon: <Globe size={16} />,
      enabled: webEnabled,
      disabledMessage: 'Web extraction requires Tavily API key. Contact admin to enable.',
    },
    {
      id: 'youtube',
      label: 'YouTube',
      icon: <Youtube size={16} />,
      enabled: youtubeEnabled,
      disabledMessage: 'YouTube extraction requires Supadata API key. Contact admin to enable.',
    },
  ];

  const pendingCount = queue.filter((item) => item.status === 'pending').length;
  const successCount = queue.filter((item) => item.status === 'success').length;
  const errorCount = queue.filter((item) => item.status === 'error').length;

  // Get icon for queue item
  const getQueueItemIcon = (item: QueueItem) => {
    if (item.status === 'uploading') {
      return <Loader2 size={14} className="animate-spin text-blue-500" />;
    }
    if (item.status === 'success') {
      return <CheckCircle2 size={14} className="text-green-500" />;
    }
    if (item.status === 'error') {
      return <AlertCircle size={14} className="text-red-500" />;
    }

    switch (item.type) {
      case 'file':
        return <FileText size={14} className="text-gray-500" />;
      case 'web':
        return <Globe size={14} className="text-green-500" />;
      case 'youtube':
        return <Youtube size={14} className="text-red-500" />;
    }
  };

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        disabled={disabled || !threadId}
        className="p-2 text-gray-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200"
        title="Attach content (File, Web URL, YouTube)"
        onMouseEnter={(e) => {
          if (!disabled && threadId) {
            e.currentTarget.style.color = 'var(--accent-color)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '';
        }}
      >
        <Paperclip size={20} />
      </button>

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isProcessing && setIsModalOpen(false)}
        title="Add Content"
      >
        {/* Tabs - show all tabs, disabled ones with tooltip */}
        <div className="flex border-b mb-4">
          {tabs.map((tab) => (
            <div key={tab.id} className="relative group">
              <button
                onClick={() => {
                  if (tab.enabled) {
                    setActiveTab(tab.id);
                    setInputError(null);
                  }
                }}
                disabled={!tab.enabled}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  !tab.enabled
                    ? 'border-transparent text-gray-300 cursor-not-allowed'
                    : activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
              {/* Tooltip for disabled tabs - positioned below to avoid modal overflow */}
              {!tab.enabled && tab.disabledMessage && (
                <div className="absolute left-0 top-full mt-1 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-lg max-w-xs">
                  <div className="flex items-start gap-1.5">
                    <Info size={12} className="flex-shrink-0 mt-0.5" />
                    <span>{tab.disabledMessage}</span>
                  </div>
                  <div className="absolute left-4 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* File Tab */}
        {activeTab === 'file' && (
          <>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="border-2 border-dashed rounded-lg p-6 text-center transition-colors"
              style={{
                borderColor: isDragging ? 'var(--accent-color)' : '#d1d5db',
                backgroundColor: isDragging ? 'var(--accent-lighter)' : 'transparent',
              }}
            >
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-600 mb-2 text-sm">
                Drag & drop files here, or{' '}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="hover:underline"
                  style={{ color: 'var(--accent-color)' }}
                >
                  browse
                </button>
              </p>
              <div className="flex items-center justify-center gap-3 text-xs text-gray-500">
                {allowedLabels.length > 0 ? (
                  allowedLabels.map((label, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i === 0 ? <FileText size={12} /> : i === 1 && allowedLabels.length > 2 ? <FileText size={12} /> : <ImageIcon size={12} />}
                      {label}
                    </span>
                  ))
                ) : (
                  <span className="flex items-center gap-1">
                    <FileText size={12} />
                    Loading…
                  </span>
                )}
                <span>Max {maxFileSizeMB}MB</span>
              </div>
            </div>

            {/* Image capability warnings */}
            {imageCapabilities && imageCapabilities.strategy === 'ocr-only' && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Info size={16} className="flex-shrink-0 mt-0.5 text-yellow-600" />
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium">Limited image processing</p>
                    <p className="text-xs mt-0.5">{imageCapabilities.message}</p>
                  </div>
                </div>
              </div>
            )}

            {imageCapabilities && imageCapabilities.strategy === 'none' && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-600" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium">Image uploads unavailable</p>
                    <p className="text-xs mt-0.5">{imageCapabilities.message}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Web URL Tab */}
        {activeTab === 'web' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Web Page URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="url"
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addWebUrlToQueue()}
                    placeholder="https://example.com/article"
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    disabled={isProcessing}
                  />
                </div>
                <button
                  onClick={addWebUrlToQueue}
                  disabled={!webUrl.trim() || isProcessing}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Add to queue"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* YouTube Tab */}
        {activeTab === 'youtube' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                YouTube Video URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Youtube size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addYoutubeUrlToQueue()}
                    placeholder="https://youtube.com/watch?v=..."
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    disabled={isProcessing}
                  />
                </div>
                <button
                  onClick={addYoutubeUrlToQueue}
                  disabled={!youtubeUrl.trim() || isProcessing}
                  className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Add to queue"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Input Error */}
        {inputError && (
          <div className="mt-3 p-2 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={14} />
            {inputError}
          </div>
        )}

        {/* Queue */}
        {queue.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">
                Upload Queue ({queue.length})
              </h4>
              {(successCount > 0 || errorCount > 0) && (
                <div className="flex items-center gap-3 text-xs">
                  {successCount > 0 && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 size={12} />
                      {successCount} done
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertCircle size={12} />
                      {errorCount} failed
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
              {queue.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${
                    item.status === 'error' ? 'bg-red-50' : item.status === 'success' ? 'bg-green-50' : ''
                  }`}
                >
                  {getQueueItemIcon(item)}
                  <span className="flex-1 truncate" title={item.url || item.name}>
                    {item.name}
                  </span>
                  {/* Extraction status message for URL items */}
                  {item.status === 'uploading' && item.type !== 'file' && (
                    <span className="text-xs text-blue-500 animate-pulse">
                      {item.type === 'youtube' ? 'Extracting transcript...' : 'Extracting content...'}
                    </span>
                  )}
                  {item.error && (
                    <span className="text-xs text-red-500 truncate max-w-[150px]" title={item.error}>
                      {item.error}
                    </span>
                  )}
                  {item.status === 'pending' && !isProcessing && (
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  )}
                  {item.status === 'error' && !isProcessing && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => retryItem(item.id)}
                        className="p-1 text-blue-500 hover:text-blue-600 transition-colors"
                        title="Retry"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => removeFromQueue(item.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload Button */}
        {queue.length > 0 && pendingCount > 0 && (
          <button
            onClick={processAllUploads}
            disabled={isProcessing || !threadId}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isProcessing ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Processing {queue.filter((i) => i.status === 'uploading').length} of {queue.length}...
              </>
            ) : (
              <>
                <Upload size={18} />
                Upload All ({pendingCount} item{pendingCount !== 1 ? 's' : ''})
              </>
            )}
          </button>
        )}

        {/* Close button when done */}
        {queue.length > 0 && pendingCount === 0 && !isProcessing && (
          <button
            onClick={() => setIsModalOpen(false)}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
          >
            Close
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={acceptExtensions}
          onChange={handleFileSelect}
          multiple
          className="hidden"
        />
      </Modal>
    </>
  );
}
