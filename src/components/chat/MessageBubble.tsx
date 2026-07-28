'use client';

import { useState, useMemo, memo, useRef, useLayoutEffect } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import type { Message, MessageMetadata } from '@/types';
import SourceCard from './SourceCard';
import FeedbackButtons from './FeedbackButtons';
import { MarkdownComponents, MarkdownComponentsWithCodeCopy } from '@/components/markdown/MarkdownRenderers';
import MessageActions from './MessageActions';
import CitationTrajectoryCard from './CitationTrajectoryCard';
import AgentResponseCard from './AgentResponseCard';
import CollapsibleArtifactCard from './CollapsibleArtifactCard';

// Shared remark plugins — defined at module level so the reference is stable
// and accessible by FrozenBlock / StreamingMarkdown before the main export.
const REMARK_PLUGINS = [remarkGfm];
// Applied only on the completed final render — zero per-frame cost during streaming.
// Adds .hljs-* token classes; styled by the GitHub Light theme in globals.css.
const REHYPE_PLUGINS = [rehypeHighlight];

// ---------------------------------------------------------------------------
// StreamingMarkdown — block-level live markdown renderer
//
// Strategy (matches Claude / ChatGPT):
//   • Split the growing content on double-newline boundaries into "blocks".
//   • All blocks except the last are COMPLETE — they never change again once
//     a new \n\n appears. Each is rendered in its own memoized component so
//     React skips re-rendering them on subsequent frames.
//   • Only the LAST (active) block is re-parsed each RAF frame. Because it is
//     small (a single paragraph/code fence in progress), the parse is cheap.
//   • On completion (isStreaming=false) the full content is rendered once as a
//     single ReactMarkdown pass so edge-cases (lists crossing paragraph breaks,
//     trailing fences) are handled correctly.
// ---------------------------------------------------------------------------

/** A single frozen block — content never changes so the memo always bails out */
const FrozenBlock = memo(function FrozenBlock({ content, isUser }: { content: string; isUser: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={isUser ? MarkdownComponents : MarkdownComponentsWithCodeCopy}
    >
      {content}
    </ReactMarkdown>
  );
});

/**
 * Find the safe split point for block-level freezing.
 *
 * A naïve \n\n split breaks fenced code blocks that contain blank lines
 * (the first frozen chunk gets an unterminated ``` and renders garbled).
 * This function walks lines, tracks open/closed fence state, and returns
 * the last \n\n boundary that falls OUTSIDE an open code fence as the
 * split point.  Everything before it can be frozen; everything from that
 * point on is the actively-growing live tail.
 *
 * Returns [frozenContent, liveTail].  If no safe split point exists
 * (e.g. a fence opened right at the start), the whole content is the
 * live tail.
 */
function splitAtSafeBoundary(content: string): [string, string] {
  const lines = content.split('\n');
  let fenceOpen = false;
  let lastSafeEnd = -1; // character index of the last safe double-newline
  let charIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Toggle fence state on lines starting with ``` (three or more backticks)
    if (/^`{3,}/.test(trimmed)) {
      fenceOpen = !fenceOpen;
    }

    // A double-newline boundary occurs between line[i] and line[i+1] when
    // line[i] is empty — i.e. this line IS the blank separator.
    // We only mark it safe if we are not currently inside a fence.
    if (line === '' && !fenceOpen && i < lines.length - 1) {
      // charIndex currently points to the start of this blank line.
      // The double-newline ends at charIndex + 1 (the \n of this line).
      lastSafeEnd = charIndex + 1;
    }

    charIndex += line.length + 1; // +1 for the \n
  }

  if (lastSafeEnd === -1) {
    // No safe split point found — treat everything as the live tail
    return ['', content];
  }

  return [content.slice(0, lastSafeEnd), content.slice(lastSafeEnd)];
}

function StreamingMarkdown({ content, isStreaming, isUser }: { content: string; isStreaming: boolean; isUser: boolean }) {
  if (!isStreaming) {
    // Final pass — full parse once with syntax highlighting on code blocks
    return (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={isUser ? [] : REHYPE_PLUGINS}
        components={isUser ? MarkdownComponents : MarkdownComponentsWithCodeCopy}
      >
        {content}
      </ReactMarkdown>
    );
  }

  // Find the last safe freeze boundary (respects open code fences)
  const [frozenContent, liveTail] = splitAtSafeBoundary(content);

  // Phase 6.3 — detect an UNCLOSED ```mermaid fence in the live tail. If the
  // fence is still open, ReactMarkdown would pass the partial code to
  // MermaidDiagram, causing flicker / re-render churn as bytes arrive. Instead
  // render a lightweight "Writing diagram…" placeholder until the closing fence
  // arrives (at which point splitAtSafeBoundary freezes it and the full render
  // kicks in). We strip the open fence so any prose before it still renders.
  let renderLiveTail = liveTail;
  let writingDiagram = false;
  if (liveTail && !isUser) {
    const fenceStart = liveTail.search(/```mermaid\s*\n/i);
    if (fenceStart !== -1) {
      // Count opening ```mermaid fences vs closing ``` fences from the first
      // opener onward. If opens > closes the fence is still open and bytes are
      // still arriving — show the placeholder instead of a partial render.
      const afterStart = liveTail.slice(fenceStart);
      const opens = (afterStart.match(/```mermaid\s*\n/gi) || []).length;
      const closes = (afterStart.match(/```\s*$/gi) || []).length;
      if (opens > closes) {
        writingDiagram = true;
        renderLiveTail = liveTail.slice(0, fenceStart).trimEnd();
      }
    }
  }

  return (
    <>
      {/* Frozen completed content — never re-renders */}
      {frozenContent && (
        <FrozenBlock content={frozenContent} isUser={isUser} />
      )}
      {/* Active tail: small, cheap single-block re-parse each frame */}
      {renderLiveTail && (
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={isUser ? MarkdownComponents : MarkdownComponentsWithCodeCopy}
        >
          {renderLiveTail}
        </ReactMarkdown>
      )}
      {/* Phase 6.3 — placeholder for an in-progress mermaid fence */}
      {writingDiagram && (
        <div className="my-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
          <span className="inline-block w-3 h-3 mr-2 rounded-full bg-blue-400 animate-pulse align-middle" />
          Writing diagram…
        </div>
      )}
      {/* Claude-style blinking block cursor at the streaming edge */}
      <span
        className="inline-block w-[2px] h-[1em] bg-current align-middle ml-[1px] streaming-cursor"
        aria-hidden="true"
      />
    </>
  );
}

// Lazy-load heavy message children that only appear conditionally
const DocumentResultCard = dynamic(() => import('./DocumentResultCard'), { ssr: false, loading: () => <div className="h-16 animate-pulse bg-gray-200 rounded-lg" /> });
const ImageDisplay = dynamic(() => import('./ImageDisplay'), { ssr: false, loading: () => <div className="h-48 animate-pulse bg-gray-200 rounded-lg" /> });
const PodcastPlayer = dynamic(() => import('./PodcastPlayer'), { ssr: false, loading: () => <div className="h-16 animate-pulse bg-gray-200 rounded-lg" /> });
const DataVisualization = dynamic(() => import('./DataVisualization'), { ssr: false, loading: () => <div className="h-64 animate-pulse bg-gray-200 rounded-lg" /> });
const MermaidDiagram = dynamic(() => import('@/components/markdown/MermaidDiagram'), { ssr: false, loading: () => <div className="h-48 animate-pulse bg-gray-200 rounded-lg" /> });

const MAX_SOURCES_DISPLAYED = 5;

function MetadataFooter({ metadata }: { metadata: MessageMetadata }) {
  const [expanded, setExpanded] = useState(false);

  const modelLabel = metadata.model
    ? metadata.model.replace(/^(gpt-|claude-|gemini-|ollama-)/i, '').replace(/-(\d)/g, ' $1').replace(/-/g, ' ').trim()
    : null;
  const totalSec = metadata.totalMs ? (metadata.totalMs / 1000).toFixed(1) + 's' : null;

  return (
    <div className="text-xs text-gray-400 flex items-center gap-2">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 hover:text-gray-600 transition-colors"
        title="Response details"
      >
        {modelLabel && <span>{modelLabel}</span>}
        {totalSec && <span>{totalSec}</span>}
        {metadata.completionTokens && <span>{metadata.tokensEstimated ? '~' : ''}{metadata.completionTokens} tok</span>}
      </button>

      {expanded && (metadata.llmMs || metadata.ragMs) && (
        <span className="text-gray-300">
          {metadata.llmMs ? `LLM ${(metadata.llmMs / 1000).toFixed(1)}s` : ''}
          {metadata.llmMs && metadata.ragMs ? ' · ' : ''}
          {metadata.ragMs ? `RAG ${(metadata.ragMs / 1000).toFixed(1)}s` : ''}
        </span>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  /** Whether this message is currently being streamed */
  isStreaming?: boolean;
  /** Callback to regenerate the assistant response (assistant messages only) */
  onRegenerate?: (messageId: string) => void;
  /** Callback to edit a user message and re-run from that point */
  onEdit?: (messageId: string, newContent: string) => void;
  /** Thread ID for citation trajectory card */
  threadId?: string | null;
  /** Whether to show source documents */
  showSources?: boolean;
  /** Whether to show citation trajectory card */
  showCitationTrajectory?: boolean;
  /** The original user query that prompted this assistant answer */
  query?: string;
  /** Workspace ID for feedback scoping */
  workspaceId?: string | null;
}

const MessageBubble = memo(function MessageBubble({ message, isStreaming = false, onRegenerate, onEdit, threadId, showSources = true, showCitationTrajectory = true, query, workspaceId }: MessageBubbleProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [needsClamp, setNeedsClamp] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const isUser = message.role === 'user';

  // Extract <think>…</think> blocks from content as fallback for historical messages
  // (thinkingContent is session-only and not persisted to DB)
  const { displayContent, effectiveThinking } = useMemo(() => {
    if (message.thinkingContent) {
      return { displayContent: message.content, effectiveThinking: message.thinkingContent };
    }
    const thinkRegex = /<think>([\s\S]*?)<\/think>\n?/g;
    let extracted = '';
    const cleaned = message.content.replace(thinkRegex, (_, inner: string) => {
      extracted += (extracted ? '\n\n' : '') + inner;
      return '';
    });
    return {
      displayContent: extracted ? cleaned.trimStart() : message.content,
      effectiveThinking: extracted || undefined,
    };
  }, [message.content, message.thinkingContent]);

  // Measure user-message content height to decide if collapse toggle is needed
  useLayoutEffect(() => {
    if (!isUser || isStreaming || !contentRef.current) return;
    const el = contentRef.current;
    const fullHeight = el.scrollHeight;
    const computedLineHeight = parseFloat(getComputedStyle(el).lineHeight);
    // Fallback when line-height is "normal" (parseFloat returns NaN)
    const lineHeight = computedLineHeight || parseFloat(getComputedStyle(el).fontSize) * 1.5;
    const clampHeight = Math.round(lineHeight * 3);
    setNeedsClamp(fullHeight > clampHeight + 4);
  }, [displayContent, isUser, isStreaming]);

  // Sort sources by score (highest first) and limit to top sources
  const sortedSources = useMemo(() => {
    if (!message.sources) return [];
    return [...message.sources].sort((a, b) => b.score - a.score);
  }, [message.sources]);

  const displayedSources = showAllSources
    ? sortedSources
    : sortedSources.slice(0, MAX_SOURCES_DISPLAYED);

  const hasMoreSources = sortedSources.length > MAX_SOURCES_DISPLAYED;

  // Pure-artifact assistant turn: no prose text, only generated artifacts.
  // The backend streams a one-line status marker into content for these turns,
  // so displayContent is normally non-empty. This guard handles any legacy
  // or edge case where content is truly empty — we avoid rendering an empty
  // markdown bubble and let the artifact cards below carry the turn.
  const hasArtifacts = Boolean(
    (message.generatedDocuments && message.generatedDocuments.length > 0) ||
    (message.generatedImages && message.generatedImages.length > 0) ||
    (message.generatedPodcasts && message.generatedPodcasts.length > 0) ||
    (message.generatedDiagrams && message.generatedDiagrams.length > 0) ||
    (message.visualizations && message.visualizations.length > 0) ||
    (message.agentResponses && message.agentResponses.length > 0)
  );
  const suppressEmptyProse = !isUser && !displayContent.trim() && hasArtifacts;

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group message-enter`}>
      <div
        className={`max-w-full sm:max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-white text-gray-900 border border-gray-200'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        {/* Thinking/reasoning block from think-tag models (Qwen3, QwQ, DeepSeek-R1) */}
        {effectiveThinking && (
          <div className="mb-3 rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setThinkingExpanded(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <span className="text-purple-400 leading-none">✦</span>
              <span className="font-medium">Thinking</span>
              <span className="ml-auto">
                {thinkingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              {isStreaming && !message.content && (
                <div className="streaming-dots inline-flex ml-auto">
                  <span className="streaming-dot" />
                  <span className="streaming-dot" />
                  <span className="streaming-dot" />
                </div>
              )}
            </button>
            {thinkingExpanded && (
              <div className="px-3 py-2 text-xs text-gray-500 font-mono whitespace-pre-wrap bg-white border-t border-gray-100 max-h-64 overflow-y-auto leading-relaxed">
                {effectiveThinking}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-3 bg-purple-300 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        )}

        {/* User message edit UI — inline textarea that replaces content on edit */}
        {isUser && editMode ? (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  const trimmed = editValue.trim();
                  if (trimmed && onEdit) {
                    onEdit(message.id, trimmed);
                    setEditMode(false);
                  }
                }
                if (e.key === 'Escape') {
                  setEditMode(false);
                }
              }}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px] max-h-[200px]"
              rows={Math.min(editValue.split('\n').length + 1, 8)}
            />
            <div className="flex items-center gap-2 justify-end">
              <span className="text-xs text-gray-400">⌘↵ to submit</span>
              <button
                onClick={() => setEditMode(false)}
                className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const trimmed = editValue.trim();
                  if (trimmed && onEdit) {
                    onEdit(message.id, trimmed);
                    setEditMode(false);
                  }
                }}
                disabled={!editValue.trim()}
                className="px-3 py-1 text-xs text-white rounded-md transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent-color)' }}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="markdown-content relative">
            {!suppressEmptyProse && (
            <div
              ref={isUser ? contentRef : undefined}
              className={isUser && needsClamp && collapsed ? 'user-bubble-collapsed' : ''}
              style={isUser && needsClamp && collapsed ? { maxHeight: '4.5em', overflow: 'hidden' } : undefined}
            >
              <StreamingMarkdown
                content={displayContent}
                isStreaming={isStreaming}
                isUser={isUser}
              />
            </div>
            )}
            {/* Show more / Show less toggle — user messages only, when content overflows 3 lines */}
            {isUser && needsClamp && (
              <button
                onClick={() => setCollapsed(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mt-1 transition-colors"
              >
                {collapsed ? (
                  <>
                    <ChevronDown size={14} />
                    Show more
                  </>
                ) : (
                  <>
                    <ChevronUp size={14} />
                    Show less
                  </>
                )}
              </button>
            )}
            {/* Edit pencil — user messages only, appears on hover */}
            {isUser && !isStreaming && onEdit && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex justify-end">
                <button
                  onClick={() => {
                    setEditValue(message.content);
                    setEditMode(true);
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
                  title="Edit message"
                  aria-label="Edit this message"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/>
                  </svg>
                  Edit
                </button>
              </div>
            )}
          </div>
        )}

        {/* Terminal-tool artifacts — each wrapped in a CollapsibleArtifactCard.
            When 2+ artifacts share the turn, cards start collapsed so the user
            sees a compact list (the streamed status line "Tool run completed —
            N artifacts generated below." stands in for the deleted LLM summary).
            A single artifact expands immediately. Expanding reveals the full
            artifact + metadata with no extra LLM call. */}
        {/* Generated Documents */}
        {message.generatedDocuments && message.generatedDocuments.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.generatedDocuments.map((doc, i) => (
              <CollapsibleArtifactCard
                key={doc.id}
                kind="document"
                title={doc.filename}
                subtitle={`${doc.fileType.toUpperCase()} · ${doc.fileSizeFormatted}`}
                index={i}
                total={message.generatedDocuments!.length}
                defaultCollapsed={message.generatedDocuments!.length > 1}
              >
                <DocumentResultCard document={doc} />
              </CollapsibleArtifactCard>
            ))}
          </div>
        )}

        {/* Generated Images */}
        {message.generatedImages && message.generatedImages.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.generatedImages.map((image, i) => (
              <CollapsibleArtifactCard
                key={image.id}
                kind="image"
                title={image.alt || 'Generated image'}
                subtitle={`${image.width}×${image.height}${image.provider ? ` · ${image.provider}` : ''}`}
                index={i}
                total={message.generatedImages!.length}
                defaultCollapsed={message.generatedImages!.length > 1}
              >
                <ImageDisplay image={image} />
              </CollapsibleArtifactCard>
            ))}
          </div>
        )}

        {/* Generated Podcasts */}
        {message.generatedPodcasts && message.generatedPodcasts.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.generatedPodcasts.map((podcast, i) => (
              <CollapsibleArtifactCard
                key={podcast.id}
                kind="podcast"
                title={podcast.filename}
                subtitle={`${Math.round(podcast.duration)}s · ${podcast.format.toUpperCase()}`}
                index={i}
                total={message.generatedPodcasts!.length}
                defaultCollapsed={message.generatedPodcasts!.length > 1}
              >
                <PodcastPlayer podcast={podcast} />
              </CollapsibleArtifactCard>
            ))}
          </div>
        )}

        {/* Agent Responses (Phase 2.2 return-result routing) — collapsible cards */}
        {message.agentResponses && message.agentResponses.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.agentResponses.map((resp, idx) => (
              <AgentResponseCard
                key={`${resp.agentId}-${idx}`}
                response={resp}
              />
            ))}
          </div>
        )}

        {/* Data Visualizations */}
        {message.visualizations && message.visualizations.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.visualizations.map((viz, index) => (
              <CollapsibleArtifactCard
                key={index}
                kind="visualization"
                title={viz.title || `${viz.chartType} chart`}
                subtitle={`${viz.chartType}${viz.sourceName ? ` · ${viz.sourceName}` : ''}`}
                index={index}
                total={message.visualizations!.length}
                defaultCollapsed={message.visualizations!.length > 1}
              >
                <DataVisualization
                  chartType={viz.chartType}
                  data={viz.data}
                  xField={viz.xField}
                  yField={viz.yField}
                  yFields={viz.yFields}
                  groupBy={viz.groupBy}
                  sourceName={viz.sourceName}
                  cached={viz.cached}
                  fields={viz.fields}
                  title={viz.title}
                  notes={viz.notes}
                  seriesMode={viz.seriesMode}
                />
              </CollapsibleArtifactCard>
            ))}
          </div>
        )}

        {/* Generated Diagrams */}
        {message.generatedDiagrams && message.generatedDiagrams.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.generatedDiagrams.map((diagram, index) => (
              <CollapsibleArtifactCard
                key={index}
                kind="diagram"
                title={diagram.title || `${diagram.type} diagram`}
                subtitle={diagram.type}
                index={index}
                total={message.generatedDiagrams!.length}
              >
                <MermaidDiagram code={diagram.code} />
              </CollapsibleArtifactCard>
            ))}
          </div>
        )}

        {sortedSources.length > 0 && showSources && (
          <div
            className={`mt-3 pt-3 border-t ${isUser ? '' : 'border-gray-300'}`}
            style={isUser ? { borderColor: 'rgba(255, 255, 255, 0.3)' } : undefined}
          >
            <button
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              className={`flex items-center gap-1 text-sm font-medium ${
                isUser ? 'text-white/70 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {sourcesExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Sources ({sortedSources.length})
            </button>

            {sourcesExpanded && (
              <div className="mt-2 space-y-2">
                {displayedSources.map((source, i) => (
                  <SourceCard key={i} source={source} />
                ))}
                {hasMoreSources && (
                  <button
                    onClick={() => setShowAllSources(!showAllSources)}
                    className="w-full text-center py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    {showAllSources
                      ? 'Show less'
                      : `Show ${sortedSources.length - MAX_SOURCES_DISPLAYED} more sources`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Citation Trajectory Card — shown for assistant messages with sources */}
        {!isUser && !isStreaming && threadId && sortedSources.length > 0 && showCitationTrajectory && (
          <CitationTrajectoryCard
            messageId={message.id}
            threadId={threadId}
          />
        )}

        <div className={`flex items-center justify-between gap-2 mt-2 ${isUser ? 'text-white/70' : 'text-gray-500'}`}>
          <span className="text-xs">{formatTime(message.timestamp)}</span>
          {!isUser && !isStreaming && message.metadata && (
            <MetadataFooter metadata={message.metadata} />
          )}
        </div>

        {/* Message action bar — visible on hover, assistant messages only, not while streaming */}
        {!isUser && !isStreaming && onRegenerate && (
          <MessageActions
            content={message.content}
            onRegenerate={() => onRegenerate(message.id)}
          />
        )}

        {/* Feedback buttons — assistant messages only, not while streaming, requires messageId */}
        {!isUser && !isStreaming && message.id && message.id !== 'streaming' && (
          <FeedbackButtons
            query={query || ''}
            answer={message.content}
            messageId={message.id}
            model={message.metadata?.model}
            threadId={threadId || undefined}
            workspaceId={workspaceId || undefined}
          />
        )}
      </div>
    </div>
  );
}, areMessageBubblePropsEqual);

export default MessageBubble;

/**
 * Custom comparator for React.memo on MessageBubble.
 * Only re-renders when props that affect the visual output actually change.
 * Avoids re-rendering on identity-changing object references when content is the same.
 */
function areMessageBubblePropsEqual(
  prev: MessageBubbleProps,
  next: MessageBubbleProps
): boolean {
  // Scalar props — cheap comparison first
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.threadId !== next.threadId) return false;
  if (prev.showSources !== next.showSources) return false;
  if (prev.showCitationTrajectory !== next.showCitationTrajectory) return false;
  // Callback identity — only compare by reference (parent should useCallback)
  if (prev.onRegenerate !== next.onRegenerate) return false;
  if (prev.onEdit !== next.onEdit) return false;

  const pm = prev.message;
  const nm = next.message;

  // Core fields that drive re-renders
  if (pm.id !== nm.id) return false;
  if (pm.role !== nm.role) return false;
  if (pm.content !== nm.content) return false;
  if (pm.thinkingContent !== nm.thinkingContent) return false;

  // Timestamp
  if (pm.timestamp instanceof Date && nm.timestamp instanceof Date) {
    if (pm.timestamp.getTime() !== nm.timestamp.getTime()) return false;
  } else if (pm.timestamp !== nm.timestamp) {
    return false;
  }

  // Metadata (shallow compare keys that matter for the footer)
  if (!shallowEqual(pm.metadata, nm.metadata)) return false;

  // Nested arrays — shallow compare by length + reference identity of first items
  if (!arrayRefsEqual(pm.sources, nm.sources)) return false;
  if (!arrayRefsEqual(pm.visualizations, nm.visualizations)) return false;
  if (!arrayRefsEqual(pm.generatedDocuments, nm.generatedDocuments)) return false;
  if (!arrayRefsEqual(pm.generatedImages, nm.generatedImages)) return false;
  if (!arrayRefsEqual(pm.generatedPodcasts, nm.generatedPodcasts)) return false;
  if (!arrayRefsEqual(pm.generatedDiagrams, nm.generatedDiagrams)) return false;
  if (!arrayRefsEqual(pm.agentResponses, nm.agentResponses)) return false;

  return true;
}

function shallowEqual(
  a: object | null | undefined,
  b: object | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(k => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

function arrayRefsEqual<T>(
  a: T[] | null | undefined,
  b: T[] | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  // Compare reference identity of ALL items;
  // if the array reference is new but items are the same objects,
  // it's typically a spread operation that doesn't change content.
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
