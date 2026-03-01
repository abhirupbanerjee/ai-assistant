'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js';
import type { ViewableArtifact } from '@/types';
import { MarkdownComponents } from '@/components/markdown/MarkdownRenderers';
import MermaidDiagram from '@/components/markdown/MermaidDiagram';

// Import highlight.js github theme
import 'highlight.js/styles/github.css';

interface ArtifactRendererProps {
  artifact: ViewableArtifact;
}

/**
 * Detect language from filename extension
 */
function getLanguageFromFilename(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'go': 'go',
    'rs': 'rust',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'sql': 'sql',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'md': 'markdown',
    'markdown': 'markdown',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'toml': 'toml',
    'ini': 'ini',
    'env': 'bash',
    'graphql': 'graphql',
    'gql': 'graphql',
    'vue': 'html',
    'svelte': 'html',
  };
  return ext ? languageMap[ext] : undefined;
}

/**
 * Renders artifact content based on type.
 * - Markdown: ReactMarkdown with GFM and syntax highlighting
 * - Code: highlight.js syntax highlighting
 * - Text: Pre-formatted text
 */
export default function ArtifactRenderer({ artifact }: ArtifactRendererProps) {
  const codeRef = useRef<HTMLElement>(null);

  // Apply highlight.js for code type artifacts
  useEffect(() => {
    if (artifact.type === 'code' && codeRef.current) {
      hljs.highlightElement(codeRef.current);
    }
  }, [artifact.content, artifact.type]);

  // Markdown rendering
  if (artifact.type === 'markdown') {
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={MarkdownComponents}
        >
          {artifact.content}
        </ReactMarkdown>
      </div>
    );
  }

  // Code rendering with syntax highlighting
  if (artifact.type === 'code') {
    const language = artifact.language || getLanguageFromFilename(artifact.filename);

    return (
      <div className="relative">
        {/* Language badge */}
        {language && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-gray-700 text-gray-200 rounded text-xs font-mono">
            {language}
          </div>
        )}
        <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-x-auto">
          <code
            ref={codeRef}
            className={language ? `language-${language}` : ''}
          >
            {artifact.content}
          </code>
        </pre>
      </div>
    );
  }

  // Diagram rendering with MermaidDiagram
  if (artifact.type === 'diagram') {
    return (
      <div className="bg-white rounded-lg">
        <MermaidDiagram code={artifact.content} />
      </div>
    );
  }

  // Plain text rendering
  return (
    <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono text-sm text-gray-800">
      {artifact.content}
    </pre>
  );
}
