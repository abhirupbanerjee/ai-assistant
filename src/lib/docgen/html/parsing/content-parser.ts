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
  RoadmapBlockConfig,
  PlaybookBlockConfig,
  BookBlockConfig,
  ReportBlockConfig,
  InsightsBlockConfig,
} from '../types';
import { isSupportedMermaidType, detectMermaidType, isBareMermaidStartLine, collectBareMermaidBlock } from './mermaid';
import { normalizeGanttConfig } from './gantt-normalizer';

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

    // Detect fenced code blocks.
    // CommonMark requires >=3 backticks, but lenient models (MiniMax, Kimi, etc.) emit 2.
    // Accept 2+ backticks; closing fence must match or exceed the opening count.
    const fenceMatch = line.match(/^(`{2,})(\w+)?\s*$/);
    if (fenceMatch) {
      flushMarkdown();
      const fenceLen = fenceMatch[1].length;
      const closingPattern = new RegExp('^`{' + fenceLen + ',}\\s*$');
      const lang = (fenceMatch[2] || '').toLowerCase();

      // Collect block content until closing fence
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(closingPattern)) {
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
          const parsed = JSON.parse(blockContent);
          // Accept either a single object or an array of KPI items (some models emit arrays).
          const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
          let anyValid = false;
          for (const item of items) {
            const cfg = item as KpiBlockConfig;
            if (cfg && typeof cfg.label === 'string' && typeof cfg.value === 'string') {
              segments.push({ type: 'kpi', config: cfg });
              anyValid = true;
            }
          }
          if (!anyValid) currentMarkdown.push('```kpi\n' + blockContent + '\n```');
        } catch {
          currentMarkdown.push('```kpi\n' + blockContent + '\n```');
        }
      } else if (lang === 'filters') {
        try {
          const parsed = JSON.parse(blockContent);
          // Accept either {slicers: [...]} wrapper or a flat array of slicer objects.
          const rawSlicers: unknown[] = Array.isArray(parsed)
            ? parsed
            : Array.isArray((parsed as FiltersBlockConfig)?.slicers)
              ? (parsed as FiltersBlockConfig).slicers
              : [];
          const slicers = rawSlicers
            .map((s) => {
              const sl = s as Record<string, unknown>;
              const id = String(sl.id ?? sl.name ?? '');
              const rawType = (sl.type as string) ?? 'multiselect';
              // Alias 'select' → 'multiselect' so the existing renderer handles it
              const type = (rawType === 'select' ? 'multiselect' : rawType) as
                FiltersBlockConfig['slicers'][number]['type'];
              return {
                id,
                label: String(sl.label ?? id),
                type,
                options: Array.isArray(sl.options) ? (sl.options as string[]) : [],
                tag_prefix: String(sl.tag_prefix ?? id),
              };
            })
            .filter((s) => s.id.length > 0);
          if (slicers.length > 0) {
            const title = !Array.isArray(parsed)
              ? (parsed as FiltersBlockConfig).title
              : undefined;
            segments.push({ type: 'filters', config: { title, slicers } });
          } else {
            currentMarkdown.push('```filters\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```filters\n' + blockContent + '\n```');
        }
      } else if (lang === 'data') {
        try {
          const parsed = JSON.parse(blockContent) as Record<string, unknown>;
          let config: DataBlockConfig | null = null;
          // Legacy shape: { items, table: { headers, rows: [[...]] } }
          if (
            Array.isArray(parsed.items) ||
            (parsed.table && Array.isArray((parsed.table as { headers?: unknown }).headers))
          ) {
            config = parsed as unknown as DataBlockConfig;
          }
          // Power BI shape: { columns: [{key,label}], rows: [{key:value}] }
          else if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
            const cols = parsed.columns as Array<{ key: string; label?: string }>;
            const headers = cols.map((c) => c.label ?? c.key);
            const keys = cols.map((c) => c.key);
            const rows = (parsed.rows as Array<Record<string, unknown>>).map((r) =>
              keys.map((k) => String(r[k] ?? ''))
            );
            config = {
              title: typeof parsed.title === 'string' ? parsed.title : undefined,
              items: [],
              table: { headers, rows },
            };
          }
          if (config) {
            segments.push({ type: 'data', config });
          } else {
            currentMarkdown.push('```data\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```data\n' + blockContent + '\n```');
        }
      } else if (lang === 'insights') {
        try {
          const config = JSON.parse(blockContent) as InsightsBlockConfig;
          if (
            typeof config.summary === 'string' ||
            (Array.isArray(config.bullets) && config.bullets.length > 0)
          ) {
            segments.push({ type: 'insights', config });
          } else {
            currentMarkdown.push('```insights\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```insights\n' + blockContent + '\n```');
        }
      } else if (lang === 'gantt' || lang === 'project_plan') {
        try {
          const rawConfig = JSON.parse(blockContent) as GanttBlockConfig;
          if (Array.isArray(rawConfig.tasks) && rawConfig.tasks.length > 0) {
            // Normalize at parse time: infer milestones, validate fields, auto-select axis
            const { config } = normalizeGanttConfig(rawConfig);
            segments.push({ type: 'gantt', config });
          } else {
            currentMarkdown.push('```' + lang + '\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```' + lang + '\n' + blockContent + '\n```');
        }
      } else if (lang === 'roadmap') {
        try {
          const config = JSON.parse(blockContent) as RoadmapBlockConfig;
          if ((Array.isArray(config.phases) && config.phases.length > 0) ||
              (Array.isArray(config.bands) && config.bands.length > 0) ||
              (Array.isArray(config.rays) && config.rays.length > 0)) {
            segments.push({ type: 'roadmap', config });
          } else {
            currentMarkdown.push('```roadmap\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```roadmap\n' + blockContent + '\n```');
        }
      } else if (lang === 'playbook') {
        try {
          const config = JSON.parse(blockContent) as PlaybookBlockConfig;
          if (Array.isArray(config.parts) && config.parts.length > 0) {
            segments.push({ type: 'playbook', config });
          } else {
            currentMarkdown.push('```playbook\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```playbook\n' + blockContent + '\n```');
        }
      } else if (lang === 'book') {
        try {
          const config = JSON.parse(blockContent) as BookBlockConfig;
          if (Array.isArray(config.chapters) && config.chapters.length > 0) {
            segments.push({ type: 'book', config });
          } else {
            currentMarkdown.push('```book\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```book\n' + blockContent + '\n```');
        }
      } else if (lang === 'report') {
        try {
          const config = JSON.parse(blockContent) as ReportBlockConfig;
          if (Array.isArray(config.sections) && config.sections.length > 0) {
            segments.push({ type: 'report', config });
          } else {
            currentMarkdown.push('```report\n' + blockContent + '\n```');
          }
        } catch {
          currentMarkdown.push('```report\n' + blockContent + '\n```');
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
