'use client';

/**
 * Workspace File Upload Component
 *
 * Simplified file upload for workspace sessions.
 * Uses the workspace upload API with sessionId.
 */

import { useState, useRef, useCallback } from 'react';
import { Paperclip, X, Loader2, FileText, ImageIcon } from 'lucide-react';

// Allowed file types
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_EXTENSIONS = '.pdf,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp,.docx';

interface UploadedFile {
  filename: string;
  originalName: string;
  isImage: boolean;
}

interface WorkspaceFileUploadProps {
  workspaceSlug: string;
  sessionId: string | null;
  maxFileSizeMb: number;
  disabled?: boolean;
  onFileUploaded: (file: UploadedFile) => void;
  primaryColor?: string;
}

export function WorkspaceFileUpload({
  workspaceSlug,
  sessionId,
  maxFileSizeMb,
  disabled = false,
  onFileUploaded,
  primaryColor = '#2563eb',
}: WorkspaceFileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Validate file type
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('Invalid file type. Allowed: PDF, TXT, MD, JSON, PNG, JPG, GIF, WEBP, DOCX');
      return;
    }

    // Validate file size
    if (file.size > maxFileSizeBytes) {
      setError(`File too large (max ${maxFileSizeMb}MB)`);
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionId', sessionId);

      const response = await fetch(`/api/w/${workspaceSlug}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await response.json();

      const isImage = file.type.startsWith('image/');
      onFileUploaded({
        filename: data.filename,
        originalName: file.name,
        isImage,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [sessionId, workspaceSlug, maxFileSizeBytes, maxFileSizeMb, onFileUploaded]);

  const handleClick = () => {
    if (!disabled && !isUploading && sessionId) {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isUploading || !sessionId}
        className="p-2 text-gray-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
        title="Attach file"
        style={{
          color: isUploading ? primaryColor : undefined,
        }}
      >
        {isUploading ? (
          <Loader2 size={20} className="animate-spin" />
        ) : (
          <Paperclip size={20} />
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS}
        onChange={handleFileSelect}
        className="hidden"
      />

      {error && (
        <div className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-red-100 text-red-700 text-xs rounded-lg whitespace-nowrap">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Attachment chip to display uploaded files
 */
interface AttachmentChipProps {
  file: UploadedFile;
  onRemove: () => void;
  disabled?: boolean;
}

export function AttachmentChip({ file, onRemove, disabled }: AttachmentChipProps) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded-lg text-sm text-gray-700">
      {file.isImage ? (
        <ImageIcon size={14} className="text-blue-500" />
      ) : (
        <FileText size={14} className="text-gray-500" />
      )}
      <span className="max-w-[120px] truncate">{file.originalName}</span>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
