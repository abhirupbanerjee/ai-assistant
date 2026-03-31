'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Message, MessageMetadata } from '@/types';
import SourceCard from './SourceCard';
import DocumentResultCard from './DocumentResultCard';
import ImageDisplay from './ImageDisplay';
import PodcastPlayer from './PodcastPlayer';
import DataVisualization from './DataVisualization';
import MermaidDiagram from '@/components/markdown/MermaidDiagram';
import { MarkdownComponents } from '@/components/markdown/MarkdownRenderers';
import MessageActions from './MessageActions';

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
  onRegenerate?: () => void;
}

export default function MessageBubble({ message, isStreaming = false, onRegenerate }: MessageBubbleProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
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

  // Sort sources by score (highest first) and limit to top sources
  const sortedSources = useMemo(() => {
    if (!message.sources) return [];
    return [...message.sources].sort((a, b) => b.score - a.score);
  }, [message.sources]);

  const displayedSources = showAllSources
    ? sortedSources
    : sortedSources.slice(0, MAX_SOURCES_DISPLAYED);

  const hasMoreSources = sortedSources.length > MAX_SOURCES_DISPLAYED;

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}>
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
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              )}
            </button>
            {thinkingExpanded && (
              <div className="px-3 py-2 text-xs text-gray-500 font-mono whitespace-pre-wrap bg-white border-t border-gray-100 max-h-64 overflow-y-auto leading-relaxed">
                {effectiveThinking}
                {isStreaming && !message.content && (
                  <span className="inline-block w-1.5 h-3 bg-purple-300 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        )}

        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MarkdownComponents}
          >
            {displayContent}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        {/* Generated Documents */}
        {message.generatedDocuments && message.generatedDocuments.length > 0 && (
          <div className="mt-2">
            {message.generatedDocuments.map((doc) => (
              <DocumentResultCard key={doc.id} document={doc} />
            ))}
          </div>
        )}

        {/* Generated Images */}
        {message.generatedImages && message.generatedImages.length > 0 && (
          <div className="mt-4 space-y-4">
            {message.generatedImages.map((image) => (
              <ImageDisplay key={image.id} image={image} />
            ))}
          </div>
        )}

        {/* Generated Podcasts */}
        {message.generatedPodcasts && message.generatedPodcasts.length > 0 && (
          <div className="mt-4 space-y-4">
            {message.generatedPodcasts.map((podcast) => (
              <PodcastPlayer key={podcast.id} podcast={podcast} />
            ))}
          </div>
        )}

        {/* Data Visualizations */}
        {message.visualizations && message.visualizations.length > 0 && (
          <div className="mt-4 space-y-4">
            {message.visualizations.map((viz, index) => (
              <DataVisualization
                key={index}
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
            ))}
          </div>
        )}

        {/* Generated Diagrams */}
        {message.generatedDiagrams && message.generatedDiagrams.length > 0 && (
          <div className="mt-4 space-y-4">
            {message.generatedDiagrams.map((diagram, index) => (
              <div key={index} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {diagram.title && (
                  <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                    <span className="text-sm font-medium text-gray-700">{diagram.title}</span>
                  </div>
                )}
                <MermaidDiagram code={diagram.code} />
              </div>
            ))}
          </div>
        )}

        {sortedSources.length > 0 && (
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

        <div className={`flex items-center justify-between gap-2 mt-2 ${isUser ? 'text-white/70' : 'text-gray-500'}`}>
          <span className="text-xs">{formatTime(message.timestamp)}</span>
          {!isUser && !isStreaming && message.metadata && (
            <MetadataFooter metadata={message.metadata} />
          )}
        </div>

        {/* Message action bar — visible on hover, assistant messages only, not while streaming */}
        {!isUser && !isStreaming && (
          <MessageActions
            content={message.content}
            onRegenerate={onRegenerate}
          />
        )}
      </div>
    </div>
  );
}
