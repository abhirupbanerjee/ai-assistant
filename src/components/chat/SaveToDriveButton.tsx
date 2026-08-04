'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Folder, Check, Loader2, AlertCircle, Plus, ChevronDown } from 'lucide-react';
import { useConnectedAccounts } from '@/hooks/useConnectedAccounts';

const LAST_FOLDER_KEY = 'drive:lastFolder';
const DEFAULT_FOLDER = 'AI Assistant';

interface LastFolderChoice {
  type: 'default' | 'folder' | 'new';
  name?: string;
  id?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  createdTime?: string;
}

export interface SaveToDriveButtonProps {
  /** Mode A: numeric output id from thread_outputs / workspace_outputs. */
  outputId?: number;
  /** Mode A context for ownership lookup. */
  context?: 'thread' | 'workspace';
  /** Mode B: explicit filename (with extension). */
  filename?: string;
  /** Mode B: explicit MIME type. */
  mimeType?: string;
  /** Mode B: base64-encoded file content (eager). */
  contentBase64?: string;
  /**
   * Mode B (lazy): async provider invoked at save time to produce the base64
   * content. Preferred over `contentBase64` for artifacts whose bytes are
   * expensive to capture (chart PNG via html2canvas, fetched image/audio),
   * and avoids races where the user clicks before an eager capture finished.
   */
  getContentBase64?: () => Promise<string | null>;
  /** Whether to convert Office formats to native Google formats. */
  convertToGoogleFormat?: boolean;
  /** Optional label next to the icon. */
  label?: string;
  /** Tooltip text. */
  tooltip?: string;
}

function GoogleGIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function loadLastFolder(): LastFolderChoice {
  if (typeof window === 'undefined') return { type: 'default', name: DEFAULT_FOLDER };
  try {
    const raw = window.localStorage.getItem(LAST_FOLDER_KEY);
    if (!raw) return { type: 'default', name: DEFAULT_FOLDER };
    const parsed = JSON.parse(raw) as LastFolderChoice;
    if (parsed.type === 'folder' && parsed.id) return parsed;
    if (parsed.type === 'new' && parsed.name) return parsed;
    return { type: 'default', name: DEFAULT_FOLDER };
  } catch {
    return { type: 'default', name: DEFAULT_FOLDER };
  }
}

function saveLastFolder(choice: LastFolderChoice) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify(choice));
  } catch {
    // Ignore storage errors.
  }
}

export default function SaveToDriveButton({
  outputId,
  context = 'thread',
  filename,
  mimeType,
  contentBase64,
  getContentBase64,
  convertToGoogleFormat,
  label = 'Save to Drive',
  tooltip = 'Save to Google Drive',
}: SaveToDriveButtonProps) {
  const { googleConnected, loading: accountsLoading } = useConnectedAccounts();
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [choice, setChoice] = useState<LastFolderChoice>({ type: 'default', name: DEFAULT_FOLDER });
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setChoice(loadLastFolder());
  }, []);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const loadFolders = useCallback(async () => {
    if (foldersLoaded || foldersLoading) return;
    setFoldersLoading(true);
    try {
      const res = await fetch('/api/drive/folders', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load folders: ${res.status}`);
      const data = (await res.json()) as { folders: DriveFolder[] };
      setFolders(data.folders || []);
      setFoldersLoaded(true);
    } catch (err) {
      setFolders([]);
    } finally {
      setFoldersLoading(false);
    }
  }, [foldersLoaded, foldersLoading]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        loadFolders();
        setError(null);
        setSaved(false);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const body: Record<string, unknown> = {};
      if (outputId !== undefined) {
        body.outputId = outputId;
        body.context = context;
      } else if (filename && mimeType) {
        // Mode B — resolve content: eager prop first, then lazy provider.
        let content = contentBase64 || null;
        if (!content && getContentBase64) {
          content = await getContentBase64();
        }
        if (!content) {
          throw new Error('Could not capture the artifact content. Please try again.');
        }
        body.filename = filename;
        body.mimeType = mimeType;
        body.contentBase64 = content;
      } else {
        throw new Error('Nothing to upload');
      }

      if (choice.type === 'folder' && choice.id) {
        body.folderId = choice.id;
      } else if (choice.type === 'new' && choice.name) {
        body.folderName = choice.name;
      } else {
        body.folderName = DEFAULT_FOLDER;
      }
      if (convertToGoogleFormat !== undefined) body.convertToGoogleFormat = convertToGoogleFormat;

      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        success?: boolean;
        webViewLink?: string;
        fileId?: string;
        error?: string;
        code?: string;
      };

      if (!res.ok || !data.success) {
        if (data.code === 'RECONNECT_REQUIRED' || data.code === 'INSUFFICIENT_SCOPE') {
          throw new Error(
            data.code === 'INSUFFICIENT_SCOPE'
              ? 'Google Drive permission is missing. Please disconnect and reconnect your account in Settings.'
              : 'Google Drive connection expired. Please reconnect in Settings.'
          );
        }
        throw new Error(data.error || `Upload failed: ${res.status}`);
      }

      saveLastFolder(choice);
      setSaved(true);
      if (data.webViewLink) {
        window.open(data.webViewLink, '_blank');
      }
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (accountsLoading) return null;
  if (!googleConnected) return null;

  const buttonContent = saved ? (
    <>
      <Check size={16} className="text-green-600" />
      <span className="hidden sm:inline">Saved</span>
    </>
  ) : (
    <>
      <GoogleGIcon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </>
  );

  const selectedLabel =
    choice.type === 'default'
      ? `${DEFAULT_FOLDER} (default)`
      : choice.type === 'folder'
        ? folders.find((f) => f.id === choice.id)?.name || choice.name || 'Selected folder'
        : choice.type === 'new'
          ? `New: ${choice.name}`
          : DEFAULT_FOLDER;

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={saving}
        title={tooltip}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
          saved
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {buttonContent}
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-lg p-3"
        >
          <div className="text-sm font-medium text-gray-800 mb-2">Save to Google Drive</div>
          <div className="text-xs text-gray-500 mb-3">Folder: {selectedLabel}</div>

          <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
            <button
              type="button"
              onClick={() => {
                setChoice({ type: 'default', name: DEFAULT_FOLDER });
                setShowNewFolderInput(false);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left ${
                choice.type === 'default' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <Folder size={14} />
              {DEFAULT_FOLDER} (default)
            </button>

            {foldersLoading && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-400">
                <Loader2 size={14} className="animate-spin" />
                Loading folders…
              </div>
            )}

            {!foldersLoading && folders.length === 0 && foldersLoaded && (
              <div className="px-2 py-1.5 text-xs text-gray-400">No app-created folders yet.</div>
            )}

            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  setChoice({ type: 'folder', id: folder.id, name: folder.name });
                  setShowNewFolderInput(false);
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left truncate ${
                  choice.type === 'folder' && choice.id === folder.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Folder size={14} />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}

            {showNewFolderInput ? (
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFolderName.trim()) {
                      setChoice({ type: 'new', name: newFolderName.trim() });
                      setShowNewFolderInput(false);
                      setNewFolderName('');
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!newFolderName.trim()}
                  onClick={() => {
                    const name = newFolderName.trim();
                    if (!name) return;
                    setChoice({ type: 'new', name });
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }}
                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-40"
                >
                  <Check size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewFolderInput(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left text-gray-600 hover:bg-gray-50"
              >
                <Plus size={14} />
                Create new folder
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 mb-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (choice.type === 'new' && !choice.name)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save now'}
          </button>
        </div>
      )}
    </div>
  );
}
