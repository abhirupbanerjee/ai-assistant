/**
 * Parse markdown content into typed segments.
 */
import { sanitizeMermaidCode } from '../../../diagram-gen/validator';
import type {
  ChartBlockConfig,
  ContentSegment,
  DataBlockConfig,
  FiltersBlockConfig,
  GanttBlockConfig,
  KpiBlockConfig,
} from '../types';
import { isSupportedMermaidType, detectMermaidType, isBareMermaidStartLine, collectBareMermaidBlock } from './mermaid';

export function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const lines = content.split('\n');
  let i = 0;
  let currentMarkdown: string[] = [];

  function flushMarkdown() {
    if (currentMarkdown.length > 0) {
      segments.push({ type: 'markdown', content: currentMarkdown.join('\n') });
      currentMarkdown = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Detect fenced code blocks
    const fenceMatch = line.match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      flushMarkdown();
      const lang = (fenceMatch[1] || '').toLowerCase();

      // Collect block content until closing fence
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        blockLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence

      const blockContent = blockLines.join('\n');

      if (lang === 'chart') {
        try {
          const config = JSON.parse(blockContent) as ChartBlockConfig;
          if (Array.isArray(config.data) && config.x_field && Array.isArray(config.y_fields) && config.y_fields.length > 0) {
            segments.push({ type: 'chart', config, raw: blockContent });
          } else {
            currentMarkdown.push('```chart\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```chart\n' + blockContent + '\n```');
        }
      } else if (lang === 'mermaid') {
        const sanitized = sanitizeMermaidCode(blockContent);
        if (isSupportedMermaidType(sanitized)) {
          const diagramType = detectMermaidType(sanitized);
          segments.push({ type: 'mermaid', code: sanitized, diagramType });
        } else {
          currentMarkdown.push('```mermaid\n' + blockContent + '\n```');
        }
      } else if (lang === 'kpi') {
        try {
          const config = JSON.parse(blockContent) as KpiBlockConfig;
          if (typeof config.label === 'string' && typeof config.value === 'string') {
            segments.push({ type: 'kpi', config });
          } else {
            currentMarkdown.push('```kpi\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```kpi\n' + blockContent + '\n```');
        }
      } else if (lang === 'filters') {
        try {
          const config = JSON.parse(blockContent) as FiltersBlockConfig;
          if (Array.isArray(config.slicers)) {
            segments.push({ type: 'filters', config });
          } else {
            currentMarkdown.push('```filters\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```filters\n' + blockContent + '\n```');
        }
      } else if (lang === 'data') {
        try {
          const config = JSON.parse(blockContent) as DataBlockConfig;
          if (Array.isArray(config.items) || (config.table && Array.isArray(config.table.headers))) {
            segments.push({ type: 'data', config });
          } else {
            currentMarkdown.push('```data\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```data\n' + blockContent + '\n```');
        }
      } else if (lang === 'gantt' || lang === 'project_plan') {
        try {
          const config = JSON.parse(blockContent) as GanttBlockConfig;
          if (Array.isArray(config.tasks) && config.tasks.length > 0) {
            segments.push({ type: 'gantt', config });
          } else {
            currentMarkdown.push('```' + lang + '\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```' + lang + '\n' + blockContent + '\n```');
        }
      } else {
        // Other code blocks — pass through as markdown
        currentMarkdown.push('```' + (lang || '') + '\n' + blockContent + '\n```');
      }
      continue;
    }

    // Detect bare Mermaid blocks (not inside fences)
    if (isBareMermaidStartLine(line)) {
      flushMarkdown();
      const { block, endIndex } = collectBareMermaidBlock(lines, i);
      const rawCode = block.join('\n');
      const sanitized = sanitizeMermaidCode(rawCode);
      if (isSupportedMermaidType(sanitized)) {
        const diagramType = detectMermaidType(sanitized);
        segments.push({ type: 'mermaid', code: sanitized, diagramType });
      } else {
        currentMarkdown.push('```mermaid\n' + rawCode + '\n```');
      }
      i = endIndex;
      continue;
    }

    currentMarkdown.push(line);
    i++;
  }

  // Flush remaining markdown
  flushMarkdown();

  return segments;
}
