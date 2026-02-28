/**
 * Word Document Builder - Generate branded DOCX documents
 *
 * Handles Word document generation with:
 * - Header/footer with logo and branding
 * - Markdown content rendering
 * - Page numbers
 * - Custom styling
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  ImageRun,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Packer,
  LevelFormat,
} from 'docx';
import {
  type BrandingConfig,
  type ProcessedLogo,
  processLogo,
  getDocxFontFamily,
  processTemplateContent,
} from './branding';
import { type DisclaimerConfig } from '../disclaimer';

// ============ Types ============

export interface DocxOptions {
  title: string;
  content: string;
  branding: BrandingConfig;
  disclaimerConfig?: DisclaimerConfig | null;
  metadata?: {
    author?: string;
    subject?: string;
    keywords?: string[];
    description?: string;
  };
}

export interface DocxResult {
  buffer: Buffer;
  fileSize: number;
}

// ============ Styling Constants ============

const STYLES = {
  title: {
    size: 40, // 20pt in half-points (reduced from 24pt to prevent clipping)
    bold: true,
  },
  heading1: {
    size: 40, // 20pt
    bold: true,
  },
  heading2: {
    size: 32, // 16pt
    bold: true,
  },
  heading3: {
    size: 28, // 14pt
    bold: true,
  },
  body: {
    size: 24, // 12pt
    bold: false,
  },
  code: {
    size: 20, // 10pt
    font: 'Courier New',
  },
};

// ============ DOCX Builder Class ============

export class DocxBuilder {
  private branding: BrandingConfig;
  private logo: ProcessedLogo | null = null;
  private fontFamily: string;
  private primaryColorHex: string;
  private disclaimerConfig: DisclaimerConfig | null = null;

  constructor(private options: DocxOptions) {
    this.branding = options.branding;
    this.fontFamily = getDocxFontFamily(options.branding.fontFamily);
    this.primaryColorHex = options.branding.primaryColor?.replace('#', '') || '003366';
    this.disclaimerConfig = options.disclaimerConfig ?? null;
  }

  /**
   * Initialize the builder (load logo, etc.)
   */
  async initialize(): Promise<void> {
    if (this.branding.enabled && this.branding.logoUrl) {
      this.logo = await processLogo(this.branding.logoUrl, 150, 50);
    }
  }

  /**
   * Generate the Word document
   */
  async generate(): Promise<DocxResult> {
    await this.initialize();

    const sections = this.parseContent(this.options.content, this.options.title);
    const children: (Paragraph | Table)[] = [];

    // Add title
    children.push(this.createTitle(this.options.title));
    children.push(new Paragraph({ spacing: { after: 400 } }));

    // Add page break so content starts on page 2
    children.push(new Paragraph({ pageBreakBefore: true }));

    // Add content sections
    for (const section of sections) {
      children.push(...this.renderSection(section));
    }

    // Create document
    const doc = new Document({
      creator: this.options.metadata?.author || this.branding.organizationName || 'Policy Bot',
      title: this.options.title,
      subject: this.options.metadata?.subject,
      keywords: this.options.metadata?.keywords?.join(', '),
      description: this.options.metadata?.description,
      styles: this.getDocumentStyles(),
      numbering: {
        config: [
          {
            reference: 'default-numbering',
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 },
                  },
                },
              },
            ],
          },
        ],
      },
      sections: [
        {
          headers: this.branding.header?.enabled ? { default: this.createHeader() } : undefined,
          footers: this.branding.footer?.enabled ? { default: this.createFooter() } : undefined,
          children,
        },
      ],
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);

    return {
      buffer,
      fileSize: buffer.length,
    };
  }

  /**
   * Get document styles configuration
   */
  private getDocumentStyles() {
    return {
      default: {
        document: {
          run: {
            font: this.fontFamily,
            size: STYLES.body.size,
          },
          paragraph: {
            spacing: { line: 276 }, // 1.15 line spacing
          },
        },
        heading1: {
          run: {
            font: this.fontFamily,
            size: STYLES.heading1.size,
            bold: true,
            color: this.primaryColorHex,
          },
          paragraph: {
            spacing: { before: 400, after: 200 },
          },
        },
        heading2: {
          run: {
            font: this.fontFamily,
            size: STYLES.heading2.size,
            bold: true,
            color: this.primaryColorHex,
          },
          paragraph: {
            spacing: { before: 300, after: 150 },
          },
        },
        heading3: {
          run: {
            font: this.fontFamily,
            size: STYLES.heading3.size,
            bold: true,
            color: this.primaryColorHex,
          },
          paragraph: {
            spacing: { before: 240, after: 120 },
          },
        },
      },
    };
  }

  /**
   * Create document header
   */
  private createHeader(): Header {
    const children: Paragraph[] = [];

    // Create header content row
    const headerRuns: (TextRun | ImageRun)[] = [];

    // Add logo if available
    if (this.logo && this.branding.enabled) {
      headerRuns.push(
        new ImageRun({
          data: this.logo.buffer,
          transformation: {
            width: this.logo.width,
            height: this.logo.height,
          },
          type: 'png',
        })
      );
      headerRuns.push(new TextRun({ text: '    ' })); // Spacer
    }

    // Add organization name or header content
    const headerText = processTemplateContent(
      this.branding.header?.content || this.branding.organizationName || '',
      { organization: this.branding.organizationName }
    );

    if (headerText) {
      headerRuns.push(
        new TextRun({
          text: headerText,
          bold: true,
          color: this.primaryColorHex,
          size: 20,
        })
      );
    }

    if (headerRuns.length > 0) {
      children.push(
        new Paragraph({
          children: headerRuns,
          alignment: this.logo ? AlignmentType.LEFT : AlignmentType.CENTER,
          border: {
            bottom: {
              color: this.primaryColorHex,
              space: 4,
              style: BorderStyle.SINGLE,
              size: 8,
            },
          },
          spacing: { after: 200 },
        })
      );
    }

    return new Header({ children });
  }

  /**
   * Create document footer
   */
  private createFooter(): Footer {
    const children: Paragraph[] = [];

    // Add separator line
    children.push(
      new Paragraph({
        border: {
          top: {
            color: this.primaryColorHex,
            space: 4,
            style: BorderStyle.SINGLE,
            size: 8,
          },
        },
        spacing: { before: 200 },
      })
    );

    // Add footer content
    const footerText = processTemplateContent(this.branding.footer?.content || '', {
      organization: this.branding.organizationName,
    });

    if (footerText) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: footerText,
              size: 18,
              color: '666666',
            }),
          ],
          alignment: AlignmentType.CENTER,
        })
      );
    }

    // Add page numbers
    if (this.branding.footer?.includePageNumber) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Page ',
              size: 18,
              color: '666666',
            }),
            new TextRun({
              children: [PageNumber.CURRENT],
              size: 18,
              color: '666666',
            }),
            new TextRun({
              text: ' of ',
              size: 18,
              color: '666666',
            }),
            new TextRun({
              children: [PageNumber.TOTAL_PAGES],
              size: 18,
              color: '666666',
            }),
          ],
          alignment: AlignmentType.RIGHT,
        })
      );
    }

    // Add AI disclaimer if enabled
    if (this.disclaimerConfig?.enabled) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: this.disclaimerConfig.fullText,
              size: this.disclaimerConfig.fontSize * 2, // docx uses half-points
              color: this.disclaimerConfig.color.replace('#', ''),
              italics: true,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 100 },
        })
      );
    }

    return new Footer({ children });
  }

  /**
   * Create the document title
   */
  private createTitle(title: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: STYLES.title.size,
          color: this.primaryColorHex,
          font: this.fontFamily,
        }),
      ],
      alignment: AlignmentType.CENTER,
      border: {
        bottom: {
          color: this.primaryColorHex,
          space: 8,
          style: BorderStyle.SINGLE,
          size: 16,
        },
      },
      spacing: { before: 200, after: 400 }, // Added before spacing to prevent title clipping
    });
  }

  /**
   * Check if a line is a table separator
   */
  private isTableSeparator(line: string): boolean {
    return /^\|?[\s\-:|]+\|?$/.test(line.trim()) && line.includes('-');
  }

  /**
   * Check if a line looks like a table row
   */
  private isTableRow(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length > 2;
  }

  /**
   * Parse a table row into cells
   */
  private parseTableRow(line: string): string[] {
    return line
      .split('|')
      .slice(1, -1) // Remove empty first and last elements
      .map(cell => cell.trim());
  }

  /**
   * Check if a line looks like an ASCII diagram line
   * Detects 4-space indented lines with box/arrow characters
   */
  private isAsciiDiagramLine(line: string): boolean {
    // Must start with 4+ spaces (diagram indent convention per skills)
    if (!line.startsWith('    ')) return false;

    const content = line.trim();
    if (!content) return true; // Empty indented line is part of diagram

    // Check for box borders (+---+, |...|)
    if (/^\+[-+]+\+$/.test(content)) return true;
    if (/^\|.*\|$/.test(content)) return true;
    if (/^[|+]/.test(content) && /[|+]$/.test(content)) return true;

    // Check for arrows and connectors
    if (/^[|v^<>]+$/.test(content)) return true;
    if (/^[|+\s]+$/.test(content)) return true;
    if (/^[-+]+$/.test(content)) return true;

    // Check for decision diamonds
    if (/^[/\\].*[/\\]$/.test(content)) return true;
    if (/^[/\\]/.test(content) || /[/\\]$/.test(content)) return true;

    // Check for Gantt bars |====|
    if (/\|[=]+\|/.test(content)) return true;

    // Check for wireframe elements with box chars
    if (/[+|]/.test(content) && (/\[.*\]/.test(content) || /\(.*\)/.test(content))) return true;

    // Check for labeled arrows (Yes/No branch labels)
    if (/^(Yes|No)\s+[|v^]/.test(content) || /[|v^]\s+(Yes|No)$/.test(content)) return true;
    if (/^\s*(Yes|No)\s*$/.test(content)) return true;

    // Lines with multiple box chars likely part of diagram
    const boxChars = (content.match(/[+|]/g) || []).length;
    if (boxChars >= 2) return true;

    return false;
  }

  /**
   * Create an ASCII diagram block (monospace, preserved whitespace)
   */
  private createAsciiDiagram(lines: string[]): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: lines.map(
                (line) =>
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: line || ' ',
                        font: 'Courier New',
                        size: 18, // 9pt - slightly smaller for diagrams
                      }),
                    ],
                  })
              ),
              shading: { fill: 'fafafa' },
              margins: {
                top: 100,
                bottom: 100,
                left: 100,
                right: 100,
              },
            }),
          ],
        }),
      ],
    });
  }

  /**
   * Parse content into sections
   * @param content - The markdown content to parse
   * @param documentTitle - Optional document title to skip if found as first heading
   */
  private parseContent(content: string, documentTitle?: string): ContentSection[] {
    const sections: ContentSection[] = [];
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    let currentSection: ContentSection = { type: 'paragraph', content: [] };
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inAsciiDiagram = false;
    let asciiDiagramLines: string[] = [];
    let skipFirstH1 = !!documentTitle; // Flag to skip first matching H1 heading

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block handling
      if (line.startsWith('```')) {
        // Flush any pending table
        if (inTable && tableRows.length > 0) {
          sections.push({ type: 'table', content: tableRows });
          tableRows = [];
          inTable = false;
        }
        // Flush any pending ASCII diagram
        if (inAsciiDiagram && asciiDiagramLines.length > 0) {
          sections.push({ type: 'diagram', content: asciiDiagramLines });
          asciiDiagramLines = [];
          inAsciiDiagram = false;
        }

        if (inCodeBlock) {
          sections.push({ type: 'code', content: codeBlockLines.join('\n') });
          codeBlockLines = [];
          inCodeBlock = false;
        } else {
          if (currentSection.content.length > 0) {
            sections.push(currentSection);
            currentSection = { type: 'paragraph', content: [] };
          }
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // ASCII diagram detection (4-space indented with box/arrow chars)
      if (this.isAsciiDiagramLine(line)) {
        // Flush any pending table
        if (inTable && tableRows.length > 0) {
          sections.push({ type: 'table', content: tableRows });
          tableRows = [];
          inTable = false;
        }
        // Flush current section
        if (currentSection.content.length > 0) {
          sections.push(currentSection);
          currentSection = { type: 'paragraph', content: [] };
        }

        if (!inAsciiDiagram) {
          inAsciiDiagram = true;
          asciiDiagramLines = [line];
        } else {
          asciiDiagramLines.push(line);
        }
        continue;
      }

      // If we were in ASCII diagram and hit a non-diagram line, flush it
      if (inAsciiDiagram && asciiDiagramLines.length > 0) {
        sections.push({ type: 'diagram', content: asciiDiagramLines });
        asciiDiagramLines = [];
        inAsciiDiagram = false;
      }

      // Table detection
      if (this.isTableRow(line)) {
        // Flush current section if not already in table
        if (!inTable) {
          if (currentSection.content.length > 0) {
            sections.push(currentSection);
            currentSection = { type: 'paragraph', content: [] };
          }
          inTable = true;
          tableRows = [this.parseTableRow(line)];

          // Skip separator line if present
          const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
          if (this.isTableSeparator(nextLine)) {
            i++; // Skip the separator
          }
        } else {
          // Continue existing table
          if (!this.isTableSeparator(line)) {
            tableRows.push(this.parseTableRow(line));
          }
        }
        continue;
      }

      // If we were in a table and hit a non-table line, flush the table
      if (inTable && tableRows.length > 0) {
        sections.push({ type: 'table', content: tableRows });
        tableRows = [];
        inTable = false;
      }

      // Headings
      if (line.startsWith('### ')) {
        if (currentSection.content.length > 0) {
          sections.push(currentSection);
          currentSection = { type: 'paragraph', content: [] };
        }
        sections.push({ type: 'heading3', content: line.substring(4) });
      } else if (line.startsWith('## ')) {
        if (currentSection.content.length > 0) {
          sections.push(currentSection);
          currentSection = { type: 'paragraph', content: [] };
        }
        sections.push({ type: 'heading2', content: line.substring(3) });
      } else if (line.startsWith('# ')) {
        const headingText = line.substring(2).trim();
        // Skip first H1 if it matches the document title (already rendered on page 1)
        if (skipFirstH1 && documentTitle && headingText.toLowerCase() === documentTitle.toLowerCase()) {
          skipFirstH1 = false;
          continue;
        }
        if (currentSection.content.length > 0) {
          sections.push(currentSection);
          currentSection = { type: 'paragraph', content: [] };
        }
        sections.push({ type: 'heading1', content: headingText });
      }
      // Bullet points
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        if (currentSection.type !== 'bullet') {
          if (currentSection.content.length > 0) {
            sections.push(currentSection);
          }
          currentSection = { type: 'bullet', content: [] };
        }
        (currentSection.content as string[]).push(line.substring(2));
      }
      // Numbered lists
      else if (/^\d+\.\s/.test(line)) {
        if (currentSection.type !== 'numbered') {
          if (currentSection.content.length > 0) {
            sections.push(currentSection);
          }
          currentSection = { type: 'numbered', content: [] };
        }
        const match = line.match(/^\d+\.\s(.*)$/);
        if (match) {
          (currentSection.content as string[]).push(match[1]);
        }
      }
      // Regular text
      else if (line.trim()) {
        if (currentSection.type !== 'paragraph') {
          if (currentSection.content.length > 0) {
            sections.push(currentSection);
          }
          currentSection = { type: 'paragraph', content: [] };
        }
        (currentSection.content as string[]).push(line);
      }
      // Empty line
      else if (currentSection.content.length > 0) {
        sections.push(currentSection);
        currentSection = { type: 'paragraph', content: [] };
      }
    }

    // Flush any remaining ASCII diagram
    if (inAsciiDiagram && asciiDiagramLines.length > 0) {
      sections.push({ type: 'diagram', content: asciiDiagramLines });
    }

    // Flush any remaining table
    if (inTable && tableRows.length > 0) {
      sections.push({ type: 'table', content: tableRows });
    }

    // Push remaining content
    if (currentSection.content.length > 0) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Render a content section to Paragraphs
   */
  private renderSection(section: ContentSection): (Paragraph | Table)[] {
    switch (section.type) {
      case 'heading1':
        return [
          new Paragraph({
            text: section.content as string,
            heading: HeadingLevel.HEADING_1,
          }),
        ];

      case 'heading2':
        return [
          new Paragraph({
            text: section.content as string,
            heading: HeadingLevel.HEADING_2,
          }),
        ];

      case 'heading3':
        return [
          new Paragraph({
            text: section.content as string,
            heading: HeadingLevel.HEADING_3,
          }),
        ];

      case 'bullet':
        return (section.content as string[]).map(
          (item) =>
            new Paragraph({
              children: this.parseInlineFormatting(item),
              bullet: { level: 0 },
            })
        );

      case 'numbered':
        return (section.content as string[]).map(
          (item) =>
            new Paragraph({
              children: this.parseInlineFormatting(item),
              numbering: { reference: 'default-numbering', level: 0 },
            })
        );

      case 'code':
        return [this.createCodeBlock(section.content as string)];

      case 'table':
        return [this.createDataTable(section.content as string[][])];

      case 'diagram':
        return [this.createAsciiDiagram(section.content as string[])];

      case 'paragraph':
      default:
        return (section.content as string[]).map(
          (text) =>
            new Paragraph({
              children: this.parseInlineFormatting(text),
              spacing: { after: 200 },
            })
        );
    }
  }

  /**
   * Create a data table from parsed rows
   */
  private createDataTable(rows: string[][]): Table | Paragraph {
    if (rows.length === 0) {
      return new Paragraph({ text: '' });
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map((row, rowIndex) => {
        const isHeader = rowIndex === 0;
        return new TableRow({
          children: row.map(
            (cellText) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: isHeader
                      ? [
                          new TextRun({
                            text: cellText,
                            bold: true,
                            color: 'FFFFFF', // White text on colored header
                            font: this.fontFamily,
                            size: STYLES.body.size,
                          }),
                        ]
                      : this.parseInlineFormatting(cellText),
                    alignment: AlignmentType.LEFT,
                  }),
                ],
                shading: isHeader ? { fill: this.primaryColorHex } : undefined,
                margins: {
                  top: 50,
                  bottom: 50,
                  left: 100,
                  right: 100,
                },
              })
          ),
        });
      }),
    });
  }

  /**
   * Parse inline formatting (bold, italic, links)
   */
  private parseInlineFormatting(text: string): TextRun[] {
    const runs: TextRun[] = [];

    // For simplicity, just handle bold for now and strip other formatting
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let match;
    let lastIndex = 0;

    while ((match = boldRegex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        runs.push(
          new TextRun({
            text: text.substring(lastIndex, match.index),
            font: this.fontFamily,
            size: STYLES.body.size,
          })
        );
      }

      // Add bold text
      runs.push(
        new TextRun({
          text: match[1],
          bold: true,
          font: this.fontFamily,
          size: STYLES.body.size,
        })
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      // Clean up other markdown
      const cleanText = text
        .substring(lastIndex)
        .replace(/\*([^*]+)\*/g, '$1') // Italic
        .replace(/`([^`]+)`/g, '$1') // Code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Links

      runs.push(
        new TextRun({
          text: cleanText,
          font: this.fontFamily,
          size: STYLES.body.size,
        })
      );
    }

    // If no formatting was found, return the original text
    if (runs.length === 0) {
      const cleanText = text
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

      runs.push(
        new TextRun({
          text: cleanText,
          font: this.fontFamily,
          size: STYLES.body.size,
        })
      );
    }

    return runs;
  }

  /**
   * Create a code block as a table with background
   */
  private createCodeBlock(code: string): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: code.split('\n').map(
                (line) =>
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: line || ' ',
                        font: 'Courier New',
                        size: STYLES.code.size,
                      }),
                    ],
                  })
              ),
              shading: { fill: 'f5f5f5' },
              margins: {
                top: 100,
                bottom: 100,
                left: 200,
                right: 200,
              },
            }),
          ],
        }),
      ],
    });
  }
}

// ============ Types ============

interface ContentSection {
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'code' | 'table' | 'diagram';
  content: string | string[] | string[][];
}

// ============ Convenience Function ============

/**
 * Generate a Word document
 */
export async function generateDocx(options: DocxOptions): Promise<DocxResult> {
  const builder = new DocxBuilder(options);
  return builder.generate();
}
