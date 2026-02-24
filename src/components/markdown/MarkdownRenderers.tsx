'use client';

import React, { Suspense, lazy } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Components } from 'react-markdown';

// Lazy load MermaidDiagram to avoid loading Mermaid.js until needed
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

/**
 * Extract text content from React children (handles nested elements)
 */
function getTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(getTextContent).join('');
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    if (props.children) {
      return getTextContent(props.children);
    }
  }
  return '';
}

/**
 * Base markdown components (shared between all modes)
 */
const BaseMarkdownComponents: Partial<Components> = {
  // Table wrapper for responsive scrolling
  table: ({ children }) => (
    <div className="overflow-x-auto touch-pan-x my-4 rounded-md border border-gray-200">
      <table className="w-max min-w-full">{children}</table>
    </div>
  ),

  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,

  th: ({ children, style }) => {
    const align = style?.textAlign;
    return (
      <th
        className="bg-gray-50 px-3 py-2 sm:px-4 sm:py-3 text-left font-semibold text-gray-900 border-b border-gray-200 text-sm sm:text-base whitespace-nowrap"
        style={align ? { textAlign: align } : undefined}
      >
        {children}
      </th>
    );
  },

  td: ({ children, style }) => {
    const align = style?.textAlign;
    return (
      <td
        className="px-3 py-2 sm:px-4 sm:py-3 border-b border-gray-200 text-sm sm:text-base"
        style={align ? { textAlign: align } : undefined}
      >
        {children}
      </td>
    );
  },

  // Link renderer with external link icon and URL sanitization
  a: ({ href, children, title }) => {
    let sanitizedHref = href;

    // Sanitize URLs: If an internal API path has an external domain prefix, strip it
    // This prevents LLM-hallucinated absolute URLs from redirecting to external domains
    if (href) {
      const internalPaths = ['/api/documents/', '/api/workspace-documents/', '/api/agent-bots/'];
      const matchingPath = internalPaths.find(path => href.includes(path));

      if (matchingPath) {
        const pathIndex = href.indexOf(matchingPath);
        if (pathIndex > 0) {
          // Has domain prefix - strip it and use relative path
          sanitizedHref = href.substring(pathIndex);
          console.warn(`[URL Sanitization] Stripped external domain from internal URL: ${href} -> ${sanitizedHref}`);
        }
      }
    }

    const isExternal = sanitizedHref && !sanitizedHref.startsWith('/') && !sanitizedHref.startsWith('#');
    return (
      <a
        href={sanitizedHref}
        title={title}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1"
      >
        {children}
        {isExternal && (
          <ExternalLink
            size={14}
            className="inline flex-shrink-0 ml-0.5"
            aria-label="opens in new tab"
          />
        )}
      </a>
    );
  },

  // Headings with responsive sizing
  h1: ({ children }) => (
    <h1 className="text-xl sm:text-2xl font-bold mt-4 sm:mt-6 mb-2 sm:mb-3">
      {children}
    </h1>
  ),

  h2: ({ children }) => (
    <h2 className="text-lg sm:text-xl font-bold mt-4 sm:mt-6 mb-2 sm:mb-3 pb-2 border-b border-gray-200">
      {children}
    </h2>
  ),

  h3: ({ children }) => (
    <h3 className="text-base sm:text-lg font-bold mt-3 sm:mt-5 mb-2">
      {children}
    </h3>
  ),

  h4: ({ children }) => (
    <h4 className="text-base font-bold mt-4 mb-2">{children}</h4>
  ),

  h5: ({ children }) => (
    <h5 className="font-bold mt-3 mb-2">{children}</h5>
  ),

  h6: ({ children }) => (
    <h6 className="font-bold text-sm mt-3 mb-2">{children}</h6>
  ),

  // Blockquote with blue styling
  blockquote: ({ children }) => (
    <blockquote className="border-l-3 sm:border-l-4 border-blue-500 bg-blue-50 px-3 sm:px-4 py-2 my-3 text-sm sm:text-base text-gray-700 italic rounded-r">
      {children}
    </blockquote>
  ),

  // Lists with responsive indentation
  ul: ({ children }) => (
    <ul className="list-disc list-inside my-2 pl-4 sm:pl-6 text-sm sm:text-base">
      {children}
    </ul>
  ),

  ol: ({ children }) => (
    <ol className="list-decimal list-inside my-2 pl-4 sm:pl-6 text-sm sm:text-base">
      {children}
    </ol>
  ),

  li: ({ children }) => (
    <li className="my-1">{children}</li>
  ),

  // Code components
  code: ({ children, className }) => {
    // Check if it's a code block (has language class) vs inline code
    const isInline = !className;

    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded font-mono text-xs sm:text-sm">
          {children}
        </code>
      );
    }

    return (
      <code className="text-gray-800 font-mono text-xs sm:text-sm">
        {children}
      </code>
    );
  },

  pre: ({ children }) => (
    <pre className="bg-gray-100 text-gray-800 p-4 rounded-md overflow-x-auto whitespace-pre my-3 border border-gray-300 max-w-full touch-pan-x font-mono text-sm leading-relaxed">
      {children}
    </pre>
  ),

  // Paragraphs
  p: ({ children }) => (
    <p className="mb-3">{children}</p>
  ),

  // Horizontal rule
  hr: ({ }) => (
    <hr className="my-4 border-gray-300" />
  ),

  // Strong/bold
  strong: ({ children }) => (
    <strong className="font-bold">{children}</strong>
  ),

  // Emphasis/italic
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),

  // Image renderer for generated images
  img: ({ src, alt }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt || 'Generated image'}
        className="max-w-full h-auto rounded-lg my-3 border border-gray-200"
        loading="lazy"
        onError={(e) => {
          const target = e.currentTarget;
          // Hide broken images or show placeholder
          target.style.display = 'none';
          console.warn('Failed to load image:', src);
        }}
      />
    );
  },
};

/**
 * Code block component with Mermaid support
 * Detects mermaid code blocks and renders them as diagrams
 */
const CodeWithMermaid: Components['code'] = ({ children, className }) => {
  const isInline = !className;
  const language = className?.replace('language-', '') || '';
  const codeContent = getTextContent(children);

  // Only render as Mermaid if explicitly tagged with ```mermaid
  // Auto-detection removed to prevent false positives on admin/other pages
  const isMermaid = language === 'mermaid';

  if (isMermaid) {
    return (
      <Suspense
        fallback={
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 my-3">
            <div className="flex items-center gap-2 text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-sm">Loading diagram...</span>
            </div>
          </div>
        }
      >
        <MermaidDiagram code={codeContent} />
      </Suspense>
    );
  }

  if (isInline) {
    return (
      <code className="px-1.5 py-0.5 rounded font-mono text-xs sm:text-sm">
        {children}
      </code>
    );
  }

  return (
    <code className="text-gray-800 font-mono text-xs sm:text-sm">
      {children}
    </code>
  );
};

/**
 * Standard code block component (no Mermaid support - for embed mode)
 */
const CodeWithoutMermaid: Components['code'] = ({ children, className }) => {
  const isInline = !className;

  if (isInline) {
    return (
      <code className="px-1.5 py-0.5 rounded font-mono text-xs sm:text-sm">
        {children}
      </code>
    );
  }

  return (
    <code className="text-gray-800 font-mono text-xs sm:text-sm">
      {children}
    </code>
  );
};

/**
 * Markdown components WITH Mermaid diagram support
 * Use this for: Main Chat, Standalone Workspace
 */
export const MarkdownComponents: Components = {
  ...BaseMarkdownComponents,
  code: CodeWithMermaid,
} as Components;

/**
 * Markdown components WITHOUT Mermaid diagram support
 * Use this for: Embed mode (keeps bundle small)
 */
export const MarkdownComponentsLite: Components = {
  ...BaseMarkdownComponents,
  code: CodeWithoutMermaid,
} as Components;
