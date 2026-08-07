'use client';

import { useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Paperclip,
  FileText,
  ImageIcon,
  Link as LinkIcon,
  Youtube,
  Sparkles,
  X,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import type { GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, PodcastHint, MessageVisualization, ArtifactCanvasItem, DiagramHint } from '@/types';
import PodcastPlayer from './PodcastPlayer';

/**
 * Calculate days remaining until expiration.
 * Returns null if no expiration, negative if expired.
 */
function getDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const now = new Date();
  const exp = new Date(expiresAt);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Get expiration badge props for an artifact.
 */
function getExpirationBadge(expiresAt: string | null): { show: boolean; text: string; variant: 'expired' | 'warning' | 'none' } {
  const daysLeft = getDaysUntilExpiry(expiresAt);
  if (daysLeft === null) return { show: false, text: '', variant: 'none' };
  if (daysLeft <= 0) return { show: true, text: 'Deleted', variant: 'expired' };
  if (daysLeft <= 10) return { show: true, text: `${daysLeft}d left`, variant: 'warning' };
  return { show: false, text: '', variant: 'none' };
}

interface ArtifactsPanelProps {
  threadId: string | null;
  uploads: string[];
  generatedDocs: GeneratedDocumentInfo[];
  generatedImages: GeneratedImageInfo[];
  generatedPodcasts: PodcastHint[];
  urlSources: UrlSource[];
  generatedDiagrams?: DiagramHint[];
  visualizations?: MessageVisualization[];
  messageId?: string;
  onRemoveUpload?: (filename: string) => void;
  onRemoveUrlSource?: (filename: string) => void;
  onArtifactClick?: (item: ArtifactCanvasItem) => void;
  hidden?: boolean; // For mobile: hide when input is focused
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

function buildDocCanvasItem(doc: GeneratedDocumentInfo): ArtifactCanvasItem {
  return {
    artifactId: doc.id,
    artifactType: doc.fileType as ArtifactCanvasItem['artifactType'],
    title: doc.filename,
    downloadUrl: doc.downloadUrl,
  };
}

function buildImageCanvasItem(img: GeneratedImageInfo): ArtifactCanvasItem {
  return {
    artifactId: img.id,
    artifactType: 'image',
    title: img.alt || 'Generated image',
    downloadUrl: img.url,
  };
}

function buildPodcastCanvasItem(podcast: PodcastHint): ArtifactCanvasItem {
  return {
    artifactId: podcast.id,
    artifactType: 'podcast',
    title: podcast.filename,
    downloadUrl: podcast.downloadUrl,
  };
}

function buildDiagramCanvasItem(diagram: DiagramHint): ArtifactCanvasItem {
  return {
    artifactId: `diagram-${diagram.title || Date.now()}`,
    artifactType: 'diagram',
    title: diagram.title || 'Diagram',
    downloadUrl: '',
    mermaidCode: diagram.code,
  };
}

function buildChartCanvasItem(
  viz: MessageVisualization,
  messageId: string,
  index: number
): ArtifactCanvasItem {
  return {
    artifactId: `chart-${messageId}-${index}`,
    artifactType: 'chart',
    title: viz.title || `Chart ${index + 1}`,
    downloadUrl: '',
    chartData: viz.data,
    chartType: viz.chartType,
  };
}

interface SectionState {
  aiGenerated: boolean;
  userUploads: boolean;
  webSources: boolean;
  youtube: boolean;
}

// Helper to get file icon based on extension
interface ArtifactRowProps {
  icon: React.ReactNode;
  label: string;
  title?: string;
  badge: { show: boolean; text: string; variant: 'expired' | 'warning' | 'none' };
  isExpired: boolean;
  onClick?: () => void;
  downloadUrl?: string;
}

function ArtifactRow({ icon, label, title, badge, isExpired, onClick, downloadUrl }: ArtifactRowProps) {
  const baseClasses = `flex items-center gap-2 p-1.5 rounded group w-full text-left ${isExpired ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`;

  if (isExpired || (!onClick && !downloadUrl)) {
    return (
      <div className={baseClasses} title={title}>
        {icon}
        <span className={`text-xs truncate flex-1 ${isExpired ? 'line-through text-gray-400' : 'text-gray-700'}`}>
          {label}
        </span>
        {badge.show && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
            badge.variant === 'expired' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
          }`}>
            {badge.text}
          </span>
        )}
      </div>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className={baseClasses} title={title}>
        {icon}
        <span className="text-xs truncate flex-1 text-gray-700">{label}</span>
        {badge.show && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
            badge.variant === 'expired' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
          }`}>
            {badge.text}
          </span>
        )}
      </button>
    );
  }

  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={baseClasses}
      title={title}
    >
      {icon}
      <span className="text-xs truncate flex-1 text-gray-700">{label}</span>
      {badge.show && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
          badge.variant === 'expired' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
        }`}>
          {badge.text}
        </span>
      )}
    </a>
  );
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return <FileText size={14} className="text-red-500" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return <ImageIcon size={14} className="text-green-500" />;
  if (ext === 'txt') return <FileText size={14} className="text-gray-500" />;
  return <FileText size={14} className="text-blue-500" />;
}

export default function ArtifactsPanel({
  threadId,
  uploads,
  generatedDocs,
  generatedImages,
  generatedPodcasts,
  urlSources,
  generatedDiagrams = [],
  visualizations = [],
  messageId = '',
  onRemoveUpload,
  onRemoveUrlSource,
  onArtifactClick,
  hidden = false,
  collapsed: collapsedProp = false,
  onCollapseChange,
}: ArtifactsPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(collapsedProp);
  const isCollapsed = onCollapseChange ? collapsedProp : internalCollapsed;
  const setIsCollapsed = useCallback((collapsed: boolean) => {
    if (onCollapseChange) {
      onCollapseChange(collapsed);
    } else {
      setInternalCollapsed(collapsed);
    }
  }, [onCollapseChange]);

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

  // Filter uploads to exclude files that are already shown in URL sources sections
  // (youtube-*.txt and web-*.txt files have their own dedicated sections with more metadata)
  const fileUploads = uploads.filter(filename => !urlSourceFilenames.has(filename));

  // Count totals (use filtered fileUploads to avoid double-counting)
  const aiGeneratedCount = generatedDocs.length + generatedImages.length + generatedPodcasts.length + generatedDiagrams.length + visualizations.length;
  const totalCount = aiGeneratedCount + fileUploads.length + webSources.length + youtubeSources.length;

  const toggleSection = (section: keyof SectionState) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Hidden state (mobile input focused)
  if (hidden) {
    return null;
  }

  // Don't show panel if no thread selected
  if (!threadId) {
    return null;
  }

  // Collapsed view
  if (isCollapsed) {
    return (
      <div className="w-full h-full bg-white border-l border-gray-200 flex flex-col items-center py-4 gap-3">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Expand artifacts panel"
        >
          <PanelRightOpen size={20} />
        </button>
        {totalCount > 0 && (
          <div className="flex flex-col items-center gap-1">
            <Paperclip size={16} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-600">{totalCount}</span>
          </div>
        )}
      </div>
    );
  }

  // Expanded view
  return (
    <div className="w-full h-full bg-white border-l border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip size={18} className="text-gray-500" />
          <span className="font-medium text-gray-900">Artifacts</span>
          {totalCount > 0 && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          title="Collapse panel"
        >
          <PanelRightClose size={18} />
        </button>
      </div>

      {/* Content */}
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
                        <ArtifactRow
                          key={doc.id}
                          icon={<FileText size={14} className="text-purple-500 flex-shrink-0" />}
                          label={doc.filename}
                          title={doc.filename}
                          badge={badge}
                          isExpired={isExpired}
                          onClick={onArtifactClick ? () => onArtifactClick(item) : undefined}
                          downloadUrl={isExpired ? undefined : doc.downloadUrl}
                        />
                      );
                    })}
                    {generatedImages.map((img) => {
                      const badge = getExpirationBadge(img.expiresAt);
                      const isExpired = badge.variant === 'expired';
                      const item = buildImageCanvasItem(img);
                      return (
                        <ArtifactRow
                          key={img.id}
                          icon={<ImageIcon size={14} className="text-purple-500 flex-shrink-0" />}
                          label={img.alt || 'Generated image'}
                          title={img.alt}
                          badge={badge}
                          isExpired={isExpired}
                          onClick={onArtifactClick ? () => onArtifactClick(item) : undefined}
                          downloadUrl={isExpired ? undefined : img.url}
                        />
                      );
                    })}
                    {generatedPodcasts.map((podcast) => {
                      const badge = getExpirationBadge(podcast.expiresAt);
                      const item = buildPodcastCanvasItem(podcast);
                      return (
                        <button
                          key={podcast.id}
                          onClick={() => onArtifactClick?.(item)}
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
                    {generatedDiagrams.map((diagram, idx) => {
                      const item = buildDiagramCanvasItem(diagram);
                      return (
                        <ArtifactRow
                          key={`diagram-${idx}`}
                          icon={<FileText size={14} className="text-purple-500 flex-shrink-0" />}
                          label={diagram.title || 'Diagram'}
                          title={diagram.title}
                          badge={{ show: false, text: '', variant: 'none' }}
                          isExpired={false}
                          onClick={onArtifactClick ? () => onArtifactClick(item) : undefined}
                        />
                      );
                    })}
                    {visualizations.map((viz, idx) => {
                      const item = buildChartCanvasItem(viz, messageId, idx);
                      return (
                        <ArtifactRow
                          key={`chart-${idx}`}
                          icon={<FileText size={14} className="text-purple-500 flex-shrink-0" />}
                          label={viz.title || `Chart ${idx + 1}`}
                          title={viz.title}
                          badge={{ show: false, text: '', variant: 'none' }}
                          isExpired={false}
                          onClick={onArtifactClick ? () => onArtifactClick(item) : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* User Uploads Section (files only, not web/youtube) */}
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
                    {fileUploads.map((filename) => (
                      <div
                        key={filename}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group"
                      >
                        {getFileIcon(filename)}
                        <span className="text-xs text-gray-700 truncate flex-1" title={filename}>
                          {filename}
                        </span>
                        {onRemoveUpload && (
                          <button
                            onClick={() => onRemoveUpload(filename)}
                            className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove file"
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
                      <div
                        key={source.filename}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group"
                      >
                        <LinkIcon size={14} className="text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 truncate block" title={source.title || source.originalUrl}>
                            {source.title || new URL(source.originalUrl).hostname}
                          </span>
                          <span className="text-[10px] text-gray-400 truncate block" title={source.originalUrl}>
                            {source.originalUrl}
                          </span>
                        </div>
                        {onRemoveUrlSource && (
                          <button
                            onClick={() => onRemoveUrlSource(source.filename)}
                            className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove source"
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
                      <div
                        key={source.filename}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group"
                      >
                        <Youtube size={14} className="text-red-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 truncate block" title={source.title || 'YouTube Video'}>
                            {source.title || 'YouTube Video'}
                          </span>
                          <span className="text-[10px] text-gray-400 truncate block" title={source.originalUrl}>
                            {source.originalUrl}
                          </span>
                        </div>
                        {onRemoveUrlSource && (
                          <button
                            onClick={() => onRemoveUrlSource(source.filename)}
                            className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove source"
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
    </div>
  );
}
