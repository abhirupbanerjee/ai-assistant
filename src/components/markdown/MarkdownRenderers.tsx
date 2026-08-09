'use client';

import React, { Suspense, lazy, useRef, useState } from 'react';
import { Copy, Check, ExternalLink, Maximize2 } from 'lucide-react';
import type { Components } from 'react-markdown';
import type { ArtifactCanvasItem } from '@/types';

// Lazy load MermaidDiagram to avoid loading Mermaid.js until needed
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

/**
 * Parse language name from a `language-*` CSS class string.
 * Uses word boundary to avoid false matches when other classes (e.g. `hljs`)
 * are present. Returns null if no language class is found.
 */
function parseLanguage(className?: string): string | null {
  return className?.match(/\blanguage-(\S+)/)?.[1] ?? null;
}

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
  const language = parseLanguage(className);
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
 * Code block component with Mermaid support AND a copy button for Mermaid source.
 * Only used in the main chat assistant responses (via MarkdownComponentsWithCodeCopy).
 * For non-Mermaid blocks, delegates to the standard CodeWithMermaid behavior.
 */
const CodeWithMermaidAndCopy: React.FC<{
  children: React.ReactNode;
  className?: string;
  onOpenCanvas?: (item: ArtifactCanvasItem) => void;
}> = ({ children, className, onOpenCanvas }) => {
  const [copied, setCopied] = useState(false);
  const isInline = !className;
  const language = parseLanguage(className);
  const codeContent = getTextContent(children);
  const isMermaid = language === 'mermaid';

  if (isMermaid) {
    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(codeContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy Mermaid source:', err);
      }
    };

    const handleOpen = () => {
      if (!onOpenCanvas) return;
      const titleMatch = codeContent.match(/^\s*title\s+(.+)$/m);
      const title = titleMatch?.[1]?.trim() || 'Diagram';
      const item: ArtifactCanvasItem = {
        artifactId: `inline-diagram-${codeContent.length}-${Date.now()}`,
        artifactType: 'diagram',
        title,
        downloadUrl: '',
        mermaidCode: codeContent,
      };
      onOpenCanvas(item);
    };

    return (
      <div className="relative group/mermaid my-3">
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          {onOpenCanvas && (
            <button
              onClick={handleOpen}
              className="p-1.5 rounded-md bg-gray-200/80 hover:bg-gray-300 text-gray-500 hover:text-gray-700 transition-colors opacity-0 group-hover/mermaid:opacity-100 focus:opacity-100"
              title="Open in canvas"
              aria-label="Open in canvas"
              type="button"
            >
              <Maximize2 size={14} />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md bg-gray-200/80 hover:bg-gray-300 text-gray-500 hover:text-gray-700 transition-colors opacity-0 group-hover/mermaid:opacity-100 focus:opacity-100"
            title={copied ? 'Copied' : 'Copy source'}
            aria-label={copied ? 'Copied' : 'Copy source'}
            type="button"
          >
            {copied ? (
              <Check size={14} className="text-green-600" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
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
      </div>
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

/**
 * Extract the language name from a fenced code block's children.
 * react-markdown puts the language as a `language-*` class on the <code> child.
 * Returns a display label like "python", "typescript", "bash", or null.
 */
function extractCodeLanguage(children: React.ReactNode): string | null {
  const codeChildren = React.Children.toArray(children);
  for (const child of codeChildren) {
    if (!React.isValidElement(child)) continue;
    const props = child.props as Record<string, unknown>;
    if (typeof props.className === 'string') {
      const lang = parseLanguage(props.className);
      if (lang) return lang;
    }
  }
  return null;
}

/**
 * Pre renderer with a language header bar + per-code-block copy button.
 * Only used in the main chat assistant responses.
 * Skips Mermaid-rendered diagram blocks (no copy button on diagram output).
 */
const CopyablePre: Components['pre'] = ({ children }) => {
  const [copied, setCopied] = useState(false);

  // Detect if this is a Mermaid block — the code renderer replaces those with
  // a <div class="group/mermaid"> containing <Suspense>/<MermaidDiagram>,
  // so the child won't be a plain <code>. We check for a <div> with the
  // group/mermaid class, or a <code> with language-mermaid class (legacy).
  const isMermaidBlock = React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    const props = child.props as Record<string, unknown>;
    // CodeWithMermaidAndCopy returns a <div className="relative group/mermaid ...">
    if (
      child.type === 'div' &&
      typeof props.className === 'string' &&
      props.className.includes('group/mermaid')
    ) {
      return true;
    }
    // Legacy: CodeWithMermaid returns <Suspense> wrapped in <pre> by react-markdown
    if (
      child.type === 'code' &&
      typeof props.className === 'string' &&
      props.className.includes('language-mermaid')
    ) {
      return true;
    }
    return false;
  });

  const language = extractCodeLanguage(children);

  const handleCopy = async () => {
    const rawText = getTextContent(children);
    // Strip exactly one trailing newline added by the markdown renderer
    const copyText = rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  if (isMermaidBlock) {
    // Render without copy button for Mermaid diagram blocks
    return <>{children}</>;
  }

  return (
    <div className="relative group/code my-3 rounded-md border border-gray-300 overflow-hidden">
      {/* Language header bar — shows detected language and copy button */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-200 border-b border-gray-300">
        <span className="text-xs font-mono text-gray-500 select-none">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors py-0.5 px-1.5 rounded hover:bg-gray-300"
          title={copied ? 'Copied' : 'Copy code'}
          aria-label={copied ? 'Copied' : 'Copy code'}
          type="button"
        >
          {copied ? (
            <><Check size={12} className="text-green-600" /><span className="text-green-600">Copied</span></>
          ) : (
            <><Copy size={12} /><span>Copy</span></>
          )}
        </button>
      </div>
      <pre className="bg-gray-100 text-gray-800 p-4 overflow-x-auto whitespace-pre max-w-full touch-pan-x font-mono text-sm leading-relaxed m-0 border-0 rounded-none">
        {children}
      </pre>
    </div>
  );
};

/**
 * Escape HTML-special characters for safe inclusion in an HTML clipboard string.
 * Uses String.fromCharCode to build entity strings at runtime so that
 * auto-formatting cannot decode the entities back to raw characters.
 */
function escapeHtml(s: string): string {
  const amp = String.fromCharCode(38); // ampersand
  return s.replace(/[&<>]/g, (ch) => {
    if (ch === amp) return amp + 'amp;';
    if (ch === '<') return amp + 'lt;';
    if (ch === '>') return amp + 'gt;';
    return ch;
  });
}

/**
 * Build a clean <table> HTML string from a live DOM table element.
 * Reads the rendered DOM (not the React tree) so it works regardless of
 * whether thead/tbody/tr/th/td are rendered by custom components or native
 * elements. Produces markup that Office apps (Word/Excel/PPT) understand.
 */
function buildTableHtml(table: HTMLTableElement): string {
  const rows: string[] = [];
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    const cells: string[] = [];
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      const tag = cell.tagName.toLowerCase(); // 'th' or 'td'
      const align = (cell as HTMLElement).style.textAlign;
      const alignAttr = align ? ` align="${align}"` : '';
      const text = escapeHtml(cell.textContent || '');
      cells.push(`    <${tag}${alignAttr}>${text}</${tag}>`);
    }
    rows.push(`  <tr>\n${cells.join('\n')}\n  </tr>`);
  }
  return `<table>\n${rows.join('\n')}\n</table>`;
}

/**
 * Extract TSV (tab-separated values) from a live DOM table element.
 * Used as the text/plain fallback for clipboard copy.
 */
function buildTableTsv(table: HTMLTableElement): string {
  const lines: string[] = [];
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    const cells: string[] = [];
    for (let c = 0; c < row.cells.length; c++) {
      const text = (row.cells[c].textContent || '').replace(/\n/g, ' ');
      cells.push(text);
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Table renderer with a per-table copy button.
 * Copies the table as HTML (for Word/Excel/PPT) with a plain text TSV fallback.
 * Reads from the live DOM via a ref (the React tree uses custom components for
 * thead/tbody/tr/th/td, so walking React children would yield empty results).
 */
const CopyableTable: Components['table'] = ({ children }) => {
  const [copied, setCopied] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const handleCopy = async () => {
    try {
      const table = tableRef.current;
      if (!table) return;

      const tableHtml = buildTableHtml(table);
      const plainText = buildTableTsv(table);

      // ClipboardItem allows rich HTML paste into Word/Excel/PPT.
      // Fall back to plain-text copy where it's unavailable (e.g. Firefox).
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blobHtml = new Blob([tableHtml], { type: 'text/html' });
        const blobText = new Blob([plainText], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  };

  return (
    <div className="relative group/table my-4">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-gray-200/80 hover:bg-gray-300 text-gray-500 hover:text-gray-700 transition-colors opacity-0 group-hover/table:opacity-100 focus:opacity-100"
        title={copied ? 'Copied' : 'Copy table'}
        aria-label={copied ? 'Copied' : 'Copy table'}
        type="button"
      >
        {copied ? (
          <Check size={14} className="text-green-600" />
        ) : (
          <Copy size={14} />
        )}
      </button>
      <div className="overflow-x-auto touch-pan-x rounded-md border border-gray-200">
        <table ref={tableRef} className="w-max min-w-full">{children}</table>
      </div>
    </div>
  );
};

/**
 * Markdown components WITH Mermaid support AND per-code-block copy buttons.
 * Use this for: Main Chat assistant messages only.
 *
 * The factory form lets callers pass an `onOpenCanvas` handler so inline
 * Mermaid diagrams can be opened in the Artifact Canvas.
 */
export function getMarkdownComponentsWithCodeCopy(options?: {
  onOpenCanvas?: (item: ArtifactCanvasItem) => void;
}): Components {
  const CodeWithOpen: Components['code'] = ({ children, className }) => (
    <CodeWithMermaidAndCopy
      className={className}
      onOpenCanvas={options?.onOpenCanvas}
    >
      {children}
    </CodeWithMermaidAndCopy>
  );

  return {
    ...MarkdownComponents,
    code: CodeWithOpen,
    pre: CopyablePre,
    table: CopyableTable,
  } as Components;
}

/**
 * Default markdown components with Mermaid + copy buttons.
 * Inline diagrams rendered with this object cannot be opened in the canvas;
 * use `getMarkdownComponentsWithCodeCopy` when canvas opening is required.
 */
export const MarkdownComponentsWithCodeCopy: Components = getMarkdownComponentsWithCodeCopy();