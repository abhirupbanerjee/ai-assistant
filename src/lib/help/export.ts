import {
  HELP_SCHEMA_VERSION,
  type HelpBlock,
  type HelpTab,
} from './content';

export type HelpExportScope = 'current' | 'complete';
export type HelpExportFormat = 'md' | 'json';

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function blockToMarkdown(block: HelpBlock): string[] {
  switch (block.type) {
    case 'paragraph':
      return [block.text, ''];
    case 'list':
      return [...block.items.map((item) => `- ${item}`), ''];
    case 'steps':
      return [
        ...block.items.map(
          (item, index) => `${index + 1}. **${item.title}** — ${item.description}`
        ),
        '',
      ];
    case 'table':
      return [
        `| ${block.headers.map(escapeTableCell).join(' | ')} |`,
        `| ${block.headers.map(() => '---').join(' | ')} |`,
        ...block.rows.map(
          (row) => `| ${row.map(escapeTableCell).join(' | ')} |`
        ),
        '',
      ];
    case 'callout':
      return [
        `> **${block.title}**`,
        `> ${block.text.replace(/\n/g, '\n> ')}`,
        '',
      ];
    case 'code':
      return [
        `**${block.label}**`,
        '',
        `\`\`\`${block.language}`,
        block.code,
        '\`\`\`',
        '',
      ];
    case 'cards':
      return [
        ...block.items.flatMap((item) => [
          `### ${item.title}`,
          '',
          item.description,
          '',
        ]),
      ];
  }
}

export function buildHelpMarkdown(tabs: HelpTab[], generatedAt: string): string {
  const lines: string[] = [
    '# AI Assistant Help Center',
    '',
    `Generated: ${generatedAt}`,
    '',
    'This guide shows the same documentation for every role. Availability labels identify which roles can perform role-dependent options.',
    '',
  ];

  tabs.forEach((tab) => {
    lines.push(`# ${tab.label}`, '', tab.description, '');

    tab.sections.forEach((section) => {
      lines.push(`## ${section.title}`, '');
      lines.push(`**Available to / audience:** ${section.audiences.join(', ')}`, '');
      lines.push(section.summary, '');
      section.blocks.forEach((block) => lines.push(...blockToMarkdown(block)));

      if (section.action) {
        lines.push(
          `**Action:** [${section.action.label}](${section.action.href})`,
          '',
          `**Requirement:** ${section.action.requirement}`,
          ''
        );
      }
    });
  });

  return lines.join('\n').trimEnd() + '\n';
}

export function buildHelpJson(tabs: HelpTab[], generatedAt: string): string {
  return JSON.stringify(
    {
      schemaVersion: HELP_SCHEMA_VERSION,
      title: 'AI Assistant Help Center',
      generatedAt,
      roleVisibility: 'identical-content-for-all-roles',
      tabs,
    },
    null,
    2
  );
}

export function getHelpExportFilename(
  tabs: HelpTab[],
  format: HelpExportFormat
): string {
  const scope = tabs.length === 1 ? tabs[0].id : 'complete';
  return `ai-assistant-help-${scope}.${format}`;
}
