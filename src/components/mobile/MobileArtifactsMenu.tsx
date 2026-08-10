'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Paperclip,
  FileText,
  FileArchive,
  ImageIcon,
  Link as LinkIcon,
  Youtube,
  Sparkles,
  X,
} from 'lucide-react';
import type { GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, PodcastHint, ArtifactCanvasItem, ThreadUploadItem } from '@/types';
import { buildDocCanvasItem, buildImageCanvasItem, buildPodcastCanvasItem, buildUploadCanvasItem } from '@/lib/artifact-builders';
import MobileMenuDrawer from '@/components/ui/MobileMenuDrawer';
import { useMobileMenu } from '@/contexts/MobileMenuContext';
import PodcastPlayer from '@/components/chat/PodcastPlayer';

function getDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const now = new Date();
  const exp = new Date(expiresAt);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getExpirationBadge(expiresAt: string | null): { show: boolean; text: string; variant: 'expired' | 'warning' | 'none' } {
  const daysLeft = getDaysUntilExpiry(expiresAt);
  if (daysLeft === null) return { show: false, text: '', variant: 'none' };
  if (daysLeft <= 0) return { show: true, text: 'Deleted', variant: 'expired' };
  if (daysLeft <= 10) return { show: true, text: `${daysLeft}d left`, variant: 'warning' };
  return { show: false, text: '', variant: 'none' };
}

interface MobileArtifactsMenuProps {
  threadId: string | null;
  uploads: ThreadUploadItem[];
  generatedDocs: GeneratedDocumentInfo[];
  generatedImages: GeneratedImageInfo[];
  generatedPodcasts: PodcastHint[];
  urlSources: UrlSource[];
  onRemoveUpload?: (filename: string) => void;
  onRemoveUrlSource?: (filename: string) => void;
  onArtifactClick?: (item: ArtifactCanvasItem, siblings: ArtifactCanvasItem[]) => void;
}

/**
 * Build the ordered list of all canvas-viewable artifacts (non-expired only),
 * in the same order they appear in the menu (docs → images → podcasts).
 */
function buildMobileViewableArtifacts(
  docs: GeneratedDocumentInfo[],
  images: GeneratedImageInfo[],
  podcasts: PodcastHint[],
  uploads: ThreadUploadItem[]
): ArtifactCanvasItem[] {
  const items: ArtifactCanvasItem[] = [];
  for (const doc of docs) {
    if (getExpirationBadge(doc.expiresAt).variant !== 'expired') {
      items.push(buildDocCanvasItem(doc));
    }
  }
  for (const img of images) {
    if (getExpirationBadge(img.expiresAt).variant !== 'expired') {
      items.push(buildImageCanvasItem(img));
    }
  }
  for (const podcast of podcasts) {
    if (getExpirationBadge(podcast.expiresAt).variant !== 'expired') {
      items.push(buildPodcastCanvasItem(podcast));
    }
  }
  for (const upload of uploads) {
    items.push(buildUploadCanvasItem(upload));
  }
  return items;
}

interface SectionState {
  aiGenerated: boolean;
  userUploads: boolean;
  webSources: boolean;
  youtube: boolean;
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return <FileText size={14} className="text-red-500" />;
  if (ext === 'zip') return <FileArchive size={14} className="text-amber-600" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return <ImageIcon size={14} className="text-green-500" />;
  if (ext === 'txt') return <FileText size={14} className="text-gray-500" />;
  return <FileText size={14} className="text-blue-500" />;
}

export default function MobileArtifactsMenu({
  threadId,
  uploads,
  generatedDocs,
  generatedImages,
  generatedPodcasts,
  urlSources,
  onRemoveUpload,
  onRemoveUrlSource,
  onArtifactClick,
}: MobileArtifactsMenuProps) {
  const { isArtifactsMenuOpen, closeArtifactsMenu } = useMobileMenu();

  const [expandedSections, setExpandedSections] = useState<SectionState>({
    aiGenerated: true,
    userUploads: true,
    webSources: true,
    youtube: true,
  });

  // Separate URL sources by type
  const webSources = urlSources.filter(s => s.sourceType === 'web');
  const youtubeSources = urlSources.filter(s => s.sourceType === 'youtube');

  // Get filenames from URL sources to avoid duplicates
  const urlSourceFilenames = new Set(urlSources.map(s => s.filename));
  const fileUploads = uploads.filter(upload => !urlSourceFilenames.has(upload.filename));

  // Count totals
  const aiGeneratedCount = generatedDocs.length + generatedImages.length + generatedPodcasts.length;
  const totalCount = aiGeneratedCount + fileUploads.length + webSources.length + youtubeSources.length;

  // Ordered list of all canvas-viewable artifacts (non-expired only).
  const viewableArtifacts = useMemo(
    () => buildMobileViewableArtifacts(generatedDocs, generatedImages, generatedPodcasts, fileUploads),
    [generatedDocs, generatedImages, generatedPodcasts, fileUploads]
  );

  const handleArtifactClick = useCallback(
    (item: ArtifactCanvasItem) => {
      onArtifactClick?.(item, viewableArtifacts);
    },
    [onArtifactClick, viewableArtifacts]
  );

  const toggleSection = (section: keyof SectionState) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Don't render if no thread
  if (!threadId) {
    return null;
  }

  return (
    <MobileMenuDrawer
      isOpen={isArtifactsMenuOpen}
      onClose={closeArtifactsMenu}
      title={`Artifacts${totalCount > 0 ? ` (${totalCount})` : ''}`}
      side="right"
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {totalCount === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Paperclip size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No artifacts yet</p>
            <p className="text-xs mt-1">Upload files or extract content from URLs</p>
          </div>
        ) : (
          <>
            {/* AI Generated Section */}
            {aiGeneratedCount > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('aiGenerated')}
                  className="w-full px-3 py-2 flex items-center justify-between bg-purple-50 hover:bg-purple-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-purple-500" />
                    <span className="text-sm font-medium text-purple-700">AI Generated</span>
                    <span className="text-xs text-purple-500">({aiGeneratedCount})</span>
                  </div>
                  {expandedSections.aiGenerated ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedSections.aiGenerated && (
                  <div className="px-3 py-2 space-y-1.5 bg-white">
                    {generatedDocs.map((doc) => {
                      const badge = getExpirationBadge(doc.expiresAt);
                      const isExpired = badge.variant === 'expired';
                      const item = buildDocCanvasItem(doc);
                      return (
                        <button
                          key={doc.id}
                          onClick={() => handleArtifactClick(item)}
                          disabled={isExpired}
                          className={`w-full flex items-center gap-2 p-1.5 rounded text-left ${isExpired ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                        >
                          <FileText size={14} className="text-purple-500 flex-shrink-0" />
                          <span className={`text-xs truncate flex-1 ${isExpired ? 'line-through text-gray-400' : 'text-gray-700'}`}>{doc.filename}</span>
                          {badge.show && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                              badge.variant === 'expired' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {badge.text}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {generatedImages.map((img) => {
                      const badge = getExpirationBadge(img.expiresAt);
                      const isExpired = badge.variant === 'expired';
                      const item = buildImageCanvasItem(img);
                      return (
                        <button
                          key={img.id}
                          onClick={() => handleArtifactClick(item)}
                          disabled={isExpired}
                          className={`w-full flex items-center gap-2 p-1.5 rounded text-left ${isExpired ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                        >
                          <ImageIcon size={14} className="text-purple-500 flex-shrink-0" />
                          <span className={`text-xs truncate flex-1 ${isExpired ? 'line-through text-gray-400' : 'text-gray-700'}`}>{img.alt || 'Generated image'}</span>
                          {badge.show && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                              badge.variant === 'expired' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {badge.text}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {generatedPodcasts.map((podcast) => {
                      const badge = getExpirationBadge(podcast.expiresAt);
                      const item = buildPodcastCanvasItem(podcast);
                      return (
                        <button
                          key={podcast.id}
                          onClick={() => handleArtifactClick(item)}
                          className="w-full flex items-center gap-2"
                        >
                          <div className="flex-1 min-w-0">
                            <PodcastPlayer podcast={podcast} compact />
                          </div>
                          {badge.show && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                              badge.variant === 'expired' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {badge.text}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* User Uploads Section */}
            {fileUploads.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('userUploads')}
                  className="w-full px-3 py-2 flex items-center justify-between bg-blue-50 hover:bg-blue-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-blue-500" />
                    <span className="text-sm font-medium text-blue-700">User Uploads</span>
                    <span className="text-xs text-blue-500">({fileUploads.length})</span>
                  </div>
                  {expandedSections.userUploads ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedSections.userUploads && (
                  <div className="px-3 py-2 space-y-1.5 bg-white">
                    {fileUploads.map((upload) => {
                      const item = buildUploadCanvasItem(upload);
                      return (
                        <div
                          key={upload.filename}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group cursor-pointer"
                          onClick={onArtifactClick ? () => handleArtifactClick(item) : undefined}
                        >
                          {getFileIcon(upload.filename)}
                          <span className="text-xs text-gray-700 truncate flex-1">{upload.filename}</span>
                          {onRemoveUpload && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveUpload(upload.filename);
                              }}
                              className="p-0.5 text-gray-400 hover:text-red-500"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Web Sources Section */}
            {webSources.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('webSources')}
                  className="w-full px-3 py-2 flex items-center justify-between bg-green-50 hover:bg-green-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <LinkIcon size={14} className="text-green-500" />
                    <span className="text-sm font-medium text-green-700">Web Sources</span>
                    <span className="text-xs text-green-500">({webSources.length})</span>
                  </div>
                  {expandedSections.webSources ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedSections.webSources && (
                  <div className="px-3 py-2 space-y-1.5 bg-white">
                    {webSources.map((source) => (
                      <div key={source.filename} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group">
                        <LinkIcon size={14} className="text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 truncate block">
                            {source.title || new URL(source.originalUrl).hostname}
                          </span>
                          <span className="text-[10px] text-gray-400 truncate block">
                            {source.originalUrl}
                          </span>
                        </div>
                        {onRemoveUrlSource && (
                          <button
                            onClick={() => onRemoveUrlSource(source.filename)}
                            className="p-0.5 text-gray-400 hover:text-red-500"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* YouTube Section */}
            {youtubeSources.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('youtube')}
                  className="w-full px-3 py-2 flex items-center justify-between bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Youtube size={14} className="text-red-500" />
                    <span className="text-sm font-medium text-red-700">YouTube</span>
                    <span className="text-xs text-red-500">({youtubeSources.length})</span>
                  </div>
                  {expandedSections.youtube ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedSections.youtube && (
                  <div className="px-3 py-2 space-y-1.5 bg-white">
                    {youtubeSources.map((source) => (
                      <div key={source.filename} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group">
                        <Youtube size={14} className="text-red-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 truncate block">
                            {source.title || 'YouTube Video'}
                          </span>
                          <span className="text-[10px] text-gray-400 truncate block">
                            {source.originalUrl}
                          </span>
                        </div>
                        {onRemoveUrlSource && (
                          <button
                            onClick={() => onRemoveUrlSource(source.filename)}
                            className="p-0.5 text-gray-400 hover:text-red-500"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </MobileMenuDrawer>
  );
}
