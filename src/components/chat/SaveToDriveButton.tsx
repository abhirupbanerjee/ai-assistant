'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Folder, Check, Loader2, AlertCircle, Plus, ChevronDown, ExternalLink } from 'lucide-react';
import { useConnectedAccounts } from '@/hooks/useConnectedAccounts';

type Provider = 'google' | 'microsoft';

const LAST_FOLDER_KEY_PREFIX = 'drive:lastFolder:';
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
  /** Cloud provider target. Defaults to 'google' for backward compatibility. */
  provider?: Provider;
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
  /** Whether to convert Office formats to native Google formats (Google only). */
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

/** Microsoft / OneDrive four-square icon (brand blue #0078D4). */
function MicrosoftIcon({ size = 16 }: { size?: number }) {
  const half = size / 2;
  const gap = 0.5;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <rect x="0" y="0" width={half - gap} height={half - gap} fill="#F25022" />
      <rect x={half + gap} y="0" width={half - gap} height={half - gap} fill="#7FBA00" />
      <rect x="0" y={half + gap} width={half - gap} height={half - gap} fill="#00A4EF" />
      <rect x={half + gap} y={half + gap} width={half - gap} height={half - gap} fill="#FFB900" />
    </svg>
  );
}

const PROVIDER_CONFIG: Record<
  Provider,
  {
    label: string;
    tooltip: string;
    popoverTitle: string;
    foldersEndpoint: string;
    uploadEndpoint: string;
    connectHint: string;
    lastFolderKey: string;
  }
> = {
  google: {
    label: 'Save to Drive',
    tooltip: 'Save to Google Drive',
    popoverTitle: 'Save to Google Drive',
    foldersEndpoint: '/api/drive/folders',
    uploadEndpoint: '/api/drive/upload',
    connectHint: 'Google Drive',
    lastFolderKey: `${LAST_FOLDER_KEY_PREFIX}google`,
  },
  microsoft: {
    label: 'Save to OneDrive',
    tooltip: 'Save to OneDrive',
    popoverTitle: 'Save to OneDrive',
    foldersEndpoint: '/api/onedrive/folders',
    uploadEndpoint: '/api/onedrive/upload',
    connectHint: 'OneDrive',
    lastFolderKey: `${LAST_FOLDER_KEY_PREFIX}microsoft`,
  },
};

function loadLastFolder(key: string): LastFolderChoice {
  if (typeof window === 'undefined') return { type: 'default', name: DEFAULT_FOLDER };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { type: 'default', name: DEFAULT_FOLDER };
    const parsed = JSON.parse(raw) as LastFolderChoice;
    if (parsed.type === 'folder' && parsed.id) return parsed;
    if (parsed.type === 'new' && parsed.name) return parsed;
    return { type: 'default', name: DEFAULT_FOLDER };
  } catch {
    return { type: 'default', name: DEFAULT_FOLDER };
  }
}

function saveLastFolder(key: string, choice: LastFolderChoice) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(choice));
  } catch {
    // Ignore storage errors.
  }
}

/** Popover width in px (Tailwind w-72 = 18rem). */
const POPOVER_WIDTH = 288;
/** Estimated popover height used for flip-up decisions (title + list + footer). */
const POPOVER_EST_HEIGHT = 340;
/** Minimum gap between popover and viewport edges. */
const VIEWPORT_MARGIN = 8;

interface PopoverPosition {
  left: number;
  top: number;
  flipUp: boolean;
}

/**
 * Compute the fixed-position coordinates for the popover from the button's
 * bounding rect. Right-aligns to the button, flips above the button when
 * there isn't enough room below, and clamps to the viewport horizontally.
 */
function computePopoverPosition(rect: DOMRect): PopoverPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(
    Math.max(rect.right - POPOVER_WIDTH, VIEWPORT_MARGIN),
    Math.max(vw - POPOVER_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN)
  );
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  const flipUp = spaceBelow < POPOVER_EST_HEIGHT && spaceAbove > spaceBelow;
  const top = flipUp ? rect.top - 6 : rect.bottom + 6;
  return { left, top, flipUp };
}

export default function SaveToDriveButton({
  provider = 'google',
  outputId,
  context = 'thread',
  filename,
  mimeType,
  contentBase64,
  getContentBase64,
  convertToGoogleFormat,
  label,
  tooltip,
}: SaveToDriveButtonProps) {
  const cfg = PROVIDER_CONFIG[provider];
  const { googleConnected, microsoftConnected, loading: accountsLoading } = useConnectedAccounts();
  const isConnected = provider === 'google' ? googleConnected : microsoftConnected;

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
  const [webViewLink, setWebViewLink] = useState<string | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<PopoverPosition | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setChoice(loadLastFolder(cfg.lastFolderKey));
  }, [cfg.lastFolderKey]);

  // Click-outside closes the popover. Works with the portal because
  // popoverRef points at the portaled DOM node (DOM contains() is
  // portal-agnostic).
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

  // Position the portaled popover from the button rect, and keep it glued to
  // the button while any ancestor scrolls or the window resizes.
  useEffect(() => {
    if (!open) {
      setPopoverPos(null);
      return;
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect) setPopoverPos(computePopoverPosition(rect));
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const loadFolders = useCallback(async () => {
    if (foldersLoaded || foldersLoading) return;
    setFoldersLoading(true);
    setFoldersError(null);
    try {
      const res = await fetch(cfg.foldersEndpoint, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        console.warn('[SaveToDrive] folder list failed', { provider, status: res.status, code: body.code ?? null });
        setFoldersError(
          body.code === 'RECONNECT_REQUIRED' || body.code === 'INSUFFICIENT_SCOPE'
            ? `Couldn't load folders — please reconnect your ${cfg.connectHint} account in Settings.`
            : body.error || "Couldn't load folders. Please try again."
        );
        setFolders([]);
        return; // foldersLoaded stays false → next popover open retries
      }
      const data = (await res.json()) as { folders: DriveFolder[] };
      setFolders(data.folders || []);
      setFoldersLoaded(true);
    } catch (err) {
      console.warn('[SaveToDrive] folder list fetch error', err);
      setFoldersError("Couldn't load folders. Please try again.");
      setFolders([]);
    } finally {
      setFoldersLoading(false);
    }
  }, [cfg.foldersEndpoint, cfg.connectHint, foldersLoaded, foldersLoading, provider]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        loadFolders();
        setError(null);
        setSaved(false);
        setWebViewLink(null);
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
      if (convertToGoogleFormat !== undefined && provider === 'google') {
        body.convertToGoogleFormat = convertToGoogleFormat;
      }

      const res = await fetch(cfg.uploadEndpoint, {
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
              ? `${cfg.connectHint} permission is missing. Please disconnect and reconnect your account in Settings.`
              : `${cfg.connectHint} connection expired. Please reconnect in Settings.`
          );
        }
        throw new Error(data.error || `Upload failed: ${res.status}`);
      }

      saveLastFolder(cfg.lastFolderKey, choice);
      setSaved(true);
      setWebViewLink(data.webViewLink ?? null);
      if (data.webViewLink) {
        const win = window.open(data.webViewLink, '_blank');
        if (!win) {
          // Popup blocked — the user-gesture context can expire across the
          // async upload (Safari is strict about this). The inline "Open in
          // Drive" link rendered below is the reliable fallback.
          console.warn('[SaveToDrive] popup blocked by browser — inline link shown');
        }
      }
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (accountsLoading) return null;
  if (!isConnected) return null;

  const buttonContent = saved ? (
    <>
      <Check size={16} className="text-green-600" />
      <span className="hidden sm:inline">Saved</span>
    </>
  ) : (
    <>
      {provider === 'google' ? <GoogleGIcon size={16} /> : <MicrosoftIcon size={16} />}
      <span className="hidden sm:inline">{label ?? cfg.label}</span>
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
        title={tooltip ?? cfg.tooltip}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
          saved
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {buttonContent}
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {open && popoverPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            left: popoverPos.left,
            top: popoverPos.top,
            width: POPOVER_WIDTH,
            maxWidth: 'calc(100vw - 16px)',
            transform: popoverPos.flipUp ? 'translateY(-100%)' : undefined,
          }}
          className="z-[1000] rounded-lg border border-gray-200 bg-white shadow-lg p-3"
        >
          <div className="text-sm font-medium text-gray-800 mb-2">{cfg.popoverTitle}</div>
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

            {foldersError && (
              <div className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-red-600">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{foldersError}</span>
              </div>
            )}

            {!foldersError && !foldersLoading && folders.length === 0 && foldersLoaded && (
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

          {webViewLink && (
            <a
              href={webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
            >
              <ExternalLink size={12} />
              {provider === 'google' ? 'Open in Drive' : 'Open in OneDrive'}
            </a>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Wrapper that renders Save buttons for every connected cloud-drive provider.
 * Use this in artifact viewers when a user may have connected Google Drive
 * and/or OneDrive — each button self-hides when its account isn't connected,
 * so rendering both unconditionally is safe.
 */
export function SaveToCloudButtons(props: Omit<SaveToDriveButtonProps, 'provider'>) {
  return (
    <div className="inline-flex items-center gap-2">
      <SaveToDriveButton {...props} provider="google" />
      <SaveToDriveButton {...props} provider="microsoft" />
    </div>
  );
}
