'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import type { Message } from '@/types';
import SourceCard from './SourceCard';
import DocumentResultCard from './DocumentResultCard';
import ImageDisplay from './ImageDisplay';
import DataVisualization from './DataVisualization';
import MermaidDiagram from '@/components/markdown/MermaidDiagram';
import { MarkdownComponents } from '@/components/markdown/MarkdownRenderers';

const MAX_SOURCES_DISPLAYED = 5;

interface MessageBubbleProps {
  message: Message;
  /** Whether this message is currently being streamed */
  isStreaming?: boolean;
}

export default function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  // Sort sources by score (highest first) and limit to top sources
  const sortedSources = useMemo(() => {
    if (!message.sources) return [];
    return [...message.sources].sort((a, b) => b.score - a.score);
  }, [message.sources]);

  const displayedSources = showAllSources
    ? sortedSources
    : sortedSources.slice(0, MAX_SOURCES_DISPLAYED);

  const hasMoreSources = sortedSources.length > MAX_SOURCES_DISPLAYED;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'user-message text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
        style={isUser ? { backgroundColor: 'var(--accent-color)' } : undefined}
      >
        <div className={`markdown-content ${isUser ? 'text-white' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MarkdownComponents}
          >
            {message.content}
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
          {!isUser && (
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-gray-200 transition-colors"
              title={copied ? 'Copied!' : 'Copy response'}
            >
              {copied ? (
                <Check size={14} className="text-green-600" />
              ) : (
                <Copy size={14} className="text-gray-400 hover:text-gray-600" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
