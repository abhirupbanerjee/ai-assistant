/**
 * PDF Builder - Generate branded PDF documents using PDFKit
 *
 * Handles PDF generation with:
 * - Header/footer with logo and branding
 * - Markdown content rendering
 * - Page numbers
 * - Custom styling
 */

import PDFDocument from 'pdfkit';
import {
  type BrandingConfig,
  type ProcessedLogo,
  processLogo,
  mapFontFamily,
  hexToRgb,
  processTemplateContent,
} from './branding';
import { type DisclaimerConfig } from '../disclaimer';

// ============ Types ============

export interface PdfOptions {
  title: string;
  content: string;
  branding: BrandingConfig;
  disclaimerConfig?: DisclaimerConfig | null;
  metadata?: {
    author?: string;
    subject?: string;
    keywords?: string[];
  };
}

export interface PdfResult {
  buffer: Buffer;
  pageCount: number;
  fileSize: number;
}

// ============ Page Layout Constants ============

const PAGE = {
  width: 612, // Letter size (8.5 x 11 inches in points)
  height: 792,
  margin: {
    top: 72, // 1 inch
    bottom: 72,
    left: 72,
    right: 72,
  },
  headerHeight: 50,
  footerHeight: 40,
};

const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
};

// Unicode character substitutions (Helvetica doesn't support these)
const UNICODE_SUBSTITUTIONS: Record<string, string> = {
  // Checkmarks and crosses
  '\u2713': 'Yes',  // ✓ check mark
  '\u2714': 'Yes',  // ✔ heavy check mark
  '\u2705': 'Yes',  // ✅ white heavy check mark (emoji)
  '\u2611': 'Yes',  // ☑ ballot box with check
  '\u2717': 'No',   // ✗ ballot x
  '\u2718': 'No',   // ✘ heavy ballot x
  '\u2715': 'No',   // ✕ multiplication x
  '\u274C': 'No',   // ❌ cross mark (emoji)
  '\u274E': 'No',   // ❎ negative squared cross mark
  '\u2610': '[ ]',  // ☐ ballot box (empty)
  '\u00D7': 'x',    // × multiplication sign
  // Bullets and dashes
  '\u2022': '-',    // • bullet
  '\u2014': '-',    // — em dash
  '\u2013': '-',    // – en dash
  '\u2212': '-',    // − minus sign
  // Quotes
  '\u201C': '"',    // " left double quote
  '\u201D': '"',    // " right double quote
  '\u2018': "'",    // ' left single quote
  '\u2019': "'",    // ' right single quote
  '\u0027': "'",    // ' apostrophe (straight)
  // Other
  '\u2026': '...',  // … ellipsis
  '\u00A0': ' ',    // non-breaking space
  '\u2192': '->',   // → right arrow
  '\u2190': '<-',   // ← left arrow
  '\u2191': '^',    // ↑ up arrow
  '\u2193': 'v',    // ↓ down arrow
};

// ============ PDF Builder Class ============

export class PdfBuilder {
  private doc: PDFKit.PDFDocument;
  private branding: BrandingConfig;
  private logo: ProcessedLogo | null = null;
  private pageCount: number = 0;
  private fontFamily: string;
  private primaryColor: { r: number; g: number; b: number };
  private disclaimerConfig: DisclaimerConfig | null = null;

  constructor(options: PdfOptions) {
    this.branding = options.branding;
    this.disclaimerConfig = options.disclaimerConfig ?? null;
    this.fontFamily = mapFontFamily(options.branding.fontFamily);
    this.primaryColor = hexToRgb(options.branding.primaryColor || '#003366');

    this.doc = new PDFDocument({
      size: 'LETTER',
      bufferPages: true, // Keep all pages in memory for header/footer insertion
      margins: {
        top: PAGE.margin.top + (this.branding.header?.enabled ? PAGE.headerHeight : 0),
        bottom: PAGE.margin.bottom + (this.branding.footer?.enabled ? PAGE.footerHeight : 0),
        left: PAGE.margin.left,
        right: PAGE.margin.right,
      },
      info: {
        Title: options.title,
        Author: options.metadata?.author || options.branding.organizationName || 'Policy Bot',
        Subject: options.metadata?.subject || '',
        Keywords: options.metadata?.keywords?.join(', ') || '',
        Creator: 'Policy Bot Document Generator',
      },
      autoFirstPage: false,
    });

    // Track page additions for headers/footers
    this.doc.on('pageAdded', () => {
      this.pageCount++;
    });
  }

  /**
   * Initialize the PDF builder (load logo, etc.)
   */
  async initialize(): Promise<void> {
    if (this.branding.enabled && this.branding.logoUrl) {
      this.logo = await processLogo(this.branding.logoUrl, 150, 50);
    }
  }

  /**
   * Generate the PDF document
   */
  async generate(content: string, title: string): Promise<PdfResult> {
    await this.initialize();

    // Add first page
    this.doc.addPage();

    // Render title
    this.renderTitle(title);

    // Add page break so content starts on page 2
    this.doc.addPage();

    // Render content (pass title to skip duplicate heading)
    this.renderContent(content, title);

    // Add headers and footers to all pages
    this.addHeadersAndFooters();

    // Finalize and return buffer
    return this.finalize();
  }

  /**
   * Render the document title
   */
  private renderTitle(title: string): void {
    const { doc, primaryColor } = this;
    const processedTitle = this.substituteUnicode(title);

    doc
      .font(FONTS.bold)
      .fontSize(24)
      .fillColor([primaryColor.r, primaryColor.g, primaryColor.b])
      .text(processedTitle, {
        align: 'center',
      });

    // Add underline
    const titleY = doc.y;
    doc
      .moveTo(PAGE.margin.left, titleY + 10)
      .lineTo(PAGE.width - PAGE.margin.right, titleY + 10)
      .strokeColor([primaryColor.r, primaryColor.g, primaryColor.b])
      .lineWidth(2)
      .stroke();

    doc.moveDown(2);
  }

  /**
   * Render markdown-like content
   * @param content - The markdown content to render
   * @param documentTitle - Optional document title to skip if found as first heading
   */
  private renderContent(content: string, documentTitle?: string): void {
    const { doc } = this;
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inAsciiDiagram = false;
    let asciiDiagramLines: string[] = [];
    let skipFirstH1 = !!documentTitle; // Flag to skip first matching H1 heading

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for code block markers
      if (line.startsWith('```')) {
        // Flush any pending table
        if (inTable && tableRows.length > 0) {
          this.renderTable(tableRows);
          tableRows = [];
          inTable = false;
        }
        // Flush any pending ASCII diagram
        if (inAsciiDiagram && asciiDiagramLines.length > 0) {
          this.renderAsciiDiagram(asciiDiagramLines);
          asciiDiagramLines = [];
          inAsciiDiagram = false;
        }

        if (inCodeBlock) {
          // End code block
          this.renderCodeBlock(codeBlockLines.join('\n'));
          codeBlockLines = [];
          inCodeBlock = false;
        } else {
          // Start code block
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
          this.renderTable(tableRows);
          tableRows = [];
          inTable = false;
        }

        if (!inAsciiDiagram) {
          inAsciiDiagram = true;
          asciiDiagramLines = [line];
        } else {
          asciiDiagramLines.push(line);
        }
        continue;
      }

      // If we were in ASCII diagram and hit a non-diagram line, render it
      if (inAsciiDiagram && asciiDiagramLines.length > 0) {
        this.renderAsciiDiagram(asciiDiagramLines);
        asciiDiagramLines = [];
        inAsciiDiagram = false;
      }

      // Table detection
      if (this.isTableRow(line)) {
        // Check if next line is a separator (markdown table header separator)
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';

        if (!inTable) {
          // Starting a new table
          inTable = true;
          tableRows = [this.parseTableRow(line)];

          // Skip separator line if present
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

      // If we were in a table and hit a non-table line, render the table
      if (inTable && tableRows.length > 0) {
        this.renderTable(tableRows);
        tableRows = [];
        inTable = false;
      }

      // Headings
      if (line.startsWith('### ')) {
        this.renderHeading(line.substring(4), 3);
      } else if (line.startsWith('## ')) {
        this.renderHeading(line.substring(3), 2);
      } else if (line.startsWith('# ')) {
        const headingText = line.substring(2).trim();
        // Skip first H1 if it matches the document title (already rendered on page 1)
        if (skipFirstH1 && documentTitle && headingText.toLowerCase() === documentTitle.toLowerCase()) {
          skipFirstH1 = false;
          continue;
        }
        this.renderHeading(headingText, 1);
      }
      // Bullet points
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        this.renderBullet(line.substring(2));
      }
      // Numbered lists
      else if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^(\d+)\.\s(.*)$/);
        if (match) {
          this.renderNumberedItem(parseInt(match[1]), match[2]);
        }
      }
      // Bold text line
      else if (line.startsWith('**') && line.endsWith('**')) {
        doc.font(FONTS.bold).fontSize(12).fillColor('black');
        doc.text(this.substituteUnicode(line.slice(2, -2)));
        doc.font(FONTS.regular);
        doc.moveDown(0.5);
      }
      // Regular paragraph
      else if (line.trim()) {
        this.renderParagraph(line);
      }
      // Empty line
      else {
        doc.moveDown(0.5);
      }

      // Check if we need a new page
      this.checkPageBreak();
    }

    // Flush any remaining ASCII diagram
    if (inAsciiDiagram && asciiDiagramLines.length > 0) {
      this.renderAsciiDiagram(asciiDiagramLines);
    }

    // Flush any remaining table
    if (inTable && tableRows.length > 0) {
      this.renderTable(tableRows);
    }
  }

  /**
   * Render a heading
   */
  private renderHeading(text: string, level: number): void {
    const { doc, primaryColor } = this;
    const sizes = [20, 16, 14];
    const size = sizes[level - 1] || 12;
    const processedText = this.substituteUnicode(text);

    doc.moveDown(0.5);
    doc
      .font(FONTS.bold)
      .fontSize(size)
      .fillColor([primaryColor.r, primaryColor.g, primaryColor.b])
      .text(processedText);
    doc.fillColor('black');
    doc.moveDown(0.5);
  }

  /**
   * Render a bullet point
   */
  private renderBullet(text: string): void {
    const { doc } = this;
    const bulletIndent = 20;
    const processedText = this.processInlineFormatting(text);

    doc.font(FONTS.regular).fontSize(12).fillColor('black');

    // Draw bullet
    const y = doc.y + 4;
    doc.circle(PAGE.margin.left + 5, y, 2).fill('black');

    // Draw text
    doc.text(processedText, PAGE.margin.left + bulletIndent, doc.y, {
      width: PAGE.width - PAGE.margin.left - PAGE.margin.right - bulletIndent,
    });
    doc.moveDown(0.3);
  }

  /**
   * Render a numbered list item
   */
  private renderNumberedItem(number: number, text: string): void {
    const { doc } = this;
    const numberIndent = 25;
    const processedText = this.processInlineFormatting(text);

    doc.font(FONTS.regular).fontSize(12).fillColor('black');

    // Draw number
    doc.text(`${number}.`, PAGE.margin.left, doc.y, { continued: true });

    // Draw text
    doc.text(` ${processedText}`, {
      width: PAGE.width - PAGE.margin.left - PAGE.margin.right - numberIndent,
    });
    doc.moveDown(0.3);
  }

  /**
   * Render a paragraph with inline formatting
   */
  private renderParagraph(text: string): void {
    const { doc } = this;

    doc.font(FONTS.regular).fontSize(12).fillColor('black');

    // Handle inline bold and italic
    const processedText = this.processInlineFormatting(text);

    // Use left alignment to avoid stretching short lines
    doc.text(processedText, {
      align: 'left',
      lineGap: 2,
    });
    doc.moveDown(0.5);
  }

  /**
   * Process inline formatting (simplified - PDFKit doesn't easily support mixed formatting)
   */
  private processInlineFormatting(text: string): string {
    // Remove markdown formatting for now (could be enhanced with RichText)
    const processed = text
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
      .replace(/\*([^*]+)\*/g, '$1') // Italic
      .replace(/`([^`]+)`/g, '$1') // Inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Links (show text only)

    // Substitute Unicode characters that Helvetica doesn't support
    return this.substituteUnicode(processed);
  }

  /**
   * Substitute Unicode characters not supported by Helvetica
   */
  private substituteUnicode(text: string): string {
    let result = text;
    for (const [unicode, replacement] of Object.entries(UNICODE_SUBSTITUTIONS)) {
      result = result.split(unicode).join(replacement);
    }
    return result;
  }

  /**
   * Check if a line is a table separator (contains only |, -, :, and spaces)
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
   * Render an ASCII diagram block (monospace, preserved whitespace)
   */
  private renderAsciiDiagram(lines: string[]): void {
    const { doc } = this;

    doc.moveDown(0.5);

    // Calculate width needed
    const maxLineLength = Math.max(...lines.map(l => l.length));
    const codeWidth = PAGE.width - PAGE.margin.left - PAGE.margin.right;

    // Use smaller font for wider diagrams
    let fontSize = 9;
    if (maxLineLength > 55) fontSize = 8;
    if (maxLineLength > 65) fontSize = 7;

    const lineHeight = fontSize * 1.3;
    const textHeight = lines.length * lineHeight;

    // Check if diagram fits on page
    if (doc.y + textHeight + 20 > PAGE.height - PAGE.margin.bottom - (this.branding.footer?.enabled ? PAGE.footerHeight : 0)) {
      doc.addPage();
    }

    const drawY = doc.y;

    // Draw light background
    doc
      .rect(PAGE.margin.left, drawY, codeWidth, textHeight + 16)
      .fillColor('#fafafa')
      .fill();

    // Draw border
    doc
      .rect(PAGE.margin.left, drawY, codeWidth, textHeight + 16)
      .strokeColor('#e0e0e0')
      .lineWidth(0.5)
      .stroke();

    // Render each line separately to preserve exact whitespace
    doc.font('Courier').fontSize(fontSize).fillColor('#333333');

    let lineY = drawY + 8;
    for (const line of lines) {
      const processedLine = this.substituteUnicode(line);
      doc.text(processedLine, PAGE.margin.left + 8, lineY, {
        lineBreak: false,
      });
      lineY += lineHeight;
    }

    doc.y = drawY + textHeight + 20;
    doc.moveDown(0.5);
    doc.font(FONTS.regular);
  }

  /**
   * Parse a table row into cells
   */
  private parseTableRow(line: string): string[] {
    return line
      .split('|')
      .slice(1, -1) // Remove empty first and last elements
      .map(cell => this.substituteUnicode(cell.trim()));
  }

  /**
   * Render a markdown table
   */
  private renderTable(rows: string[][]): void {
    if (rows.length === 0) return;

    const { doc, primaryColor } = this;
    const contentWidth = PAGE.width - PAGE.margin.left - PAGE.margin.right;
    const numCols = rows[0].length;
    const colWidth = contentWidth / numCols;
    const cellPadding = 6;
    const rowHeight = 24;

    doc.moveDown(0.5);

    // Check if we need a new page for the table
    const tableHeight = rows.length * rowHeight + 10;
    if (doc.y + tableHeight > PAGE.height - PAGE.margin.bottom - (this.branding.footer?.enabled ? PAGE.footerHeight : 0)) {
      doc.addPage();
    }

    const startX = PAGE.margin.left;
    let currentY = doc.y;

    rows.forEach((row, rowIndex) => {
      const isHeader = rowIndex === 0;
      const cellHeight = rowHeight;

      // Draw row background
      if (isHeader) {
        doc
          .rect(startX, currentY, contentWidth, cellHeight)
          .fillColor([primaryColor.r, primaryColor.g, primaryColor.b])
          .fill();
      } else if (rowIndex % 2 === 0) {
        doc
          .rect(startX, currentY, contentWidth, cellHeight)
          .fillColor('#f5f5f5')
          .fill();
      }

      // Draw cell borders
      doc
        .rect(startX, currentY, contentWidth, cellHeight)
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();

      // Draw vertical cell separators
      for (let i = 1; i < numCols; i++) {
        doc
          .moveTo(startX + i * colWidth, currentY)
          .lineTo(startX + i * colWidth, currentY + cellHeight)
          .stroke();
      }

      // Draw cell text
      row.forEach((cellText, colIndex) => {
        const cellX = startX + colIndex * colWidth + cellPadding;
        const textY = currentY + cellPadding;
        const maxWidth = colWidth - cellPadding * 2;

        doc
          .font(isHeader ? FONTS.bold : FONTS.regular)
          .fontSize(10)
          .fillColor(isHeader ? 'white' : 'black')
          .text(cellText, cellX, textY, {
            width: maxWidth,
            height: cellHeight - cellPadding,
            align: 'left',
            lineBreak: false,
          });
      });

      currentY += cellHeight;
    });

    // Move doc position below the table and reset X position
    doc.x = PAGE.margin.left;
    doc.y = currentY;
    doc.moveDown(1);
  }

  /**
   * Render a code block
   */
  private renderCodeBlock(code: string): void {
    const { doc } = this;
    const processedCode = this.substituteUnicode(code);

    doc.moveDown(0.5);

    // Background rectangle
    const startY = doc.y;
    const codeWidth = PAGE.width - PAGE.margin.left - PAGE.margin.right;

    // Set font/size before measuring height
    doc.font('Courier').fontSize(10);

    // Measure text height
    const textHeight = doc.heightOfString(processedCode, {
      width: codeWidth - 20,
    });

    // Draw background
    doc
      .rect(PAGE.margin.left, startY, codeWidth, textHeight + 20)
      .fillColor('#f5f5f5')
      .fill();

    // Draw code text
    doc
      .font('Courier')
      .fontSize(10)
      .fillColor('#333333')
      .text(processedCode, PAGE.margin.left + 10, startY + 10, {
        width: codeWidth - 20,
      });

    doc.moveDown(1);
    doc.font(FONTS.regular);
  }

  /**
   * Check if we need a page break
   */
  private checkPageBreak(): void {
    const { doc } = this;
    const footerSpace = this.branding.footer?.enabled ? PAGE.footerHeight : 0;
    const bottomMargin = PAGE.margin.bottom + footerSpace + 20;

    if (doc.y > PAGE.height - bottomMargin) {
      doc.addPage();
    }
  }

  /**
   * Add headers and footers to all pages
   */
  private addHeadersAndFooters(): void {
    const { doc } = this;
    const pages = (doc as unknown as { _pageBuffer: unknown[] })._pageBuffer || [];
    const totalPages = pages.length || this.pageCount;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      // Use save/restore to completely isolate header/footer rendering
      // This prevents any cursor movement from affecting the document state
      if (this.branding.header?.enabled) {
        doc.save();
        this.renderHeaderDirect(i + 1);
        doc.restore();
      }

      if (this.branding.footer?.enabled) {
        doc.save();
        this.renderFooterDirect(i + 1, totalPages);
        doc.restore();
      }
    }
  }

  /**
   * Render header directly (called within save/restore context)
   */
  private renderHeaderDirect(pageNumber: number): void {
    const { doc, branding, logo, primaryColor } = this;

    const headerY = 20;
    const headerContent = processTemplateContent(branding.header?.content || '', {
      page: pageNumber.toString(),
      organization: branding.organizationName,
    });

    // Draw header line
    doc
      .moveTo(PAGE.margin.left, headerY + PAGE.headerHeight - 5)
      .lineTo(PAGE.width - PAGE.margin.right, headerY + PAGE.headerHeight - 5)
      .strokeColor([primaryColor.r, primaryColor.g, primaryColor.b])
      .lineWidth(1)
      .stroke();

    // Draw logo if available
    if (logo && branding.enabled) {
      doc.image(logo.buffer, PAGE.margin.left, headerY, {
        width: logo.width,
        height: logo.height,
      });
    }

    // Draw organization name or header content
    const textX = logo ? PAGE.margin.left + (logo.width || 0) + 20 : PAGE.margin.left;
    const displayText = headerContent || branding.organizationName;

    if (displayText) {
      doc
        .font(FONTS.bold)
        .fontSize(10)
        .fillColor([primaryColor.r, primaryColor.g, primaryColor.b]);

      // Use _fragment to render text without affecting cursor
      const textWidth = doc.widthOfString(displayText);
      const xPos = logo ? textX : (PAGE.width - textWidth) / 2;
      doc.text(displayText, xPos, headerY + 15, { lineBreak: false });
    }
  }

  /**
   * Render footer directly (called within save/restore context)
   */
  private renderFooterDirect(pageNumber: number, totalPages: number): void {
    const { doc, branding, primaryColor } = this;

    const footerY = PAGE.height - PAGE.margin.bottom + 10;
    const footerContent = processTemplateContent(branding.footer?.content || '', {
      page: pageNumber.toString(),
      total: totalPages.toString(),
      organization: branding.organizationName,
    });

    // Draw footer line
    doc
      .moveTo(PAGE.margin.left, footerY - 5)
      .lineTo(PAGE.width - PAGE.margin.right, footerY - 5)
      .strokeColor([primaryColor.r, primaryColor.g, primaryColor.b])
      .lineWidth(1)
      .stroke();

    // Draw footer content centered
    if (footerContent) {
      doc
        .font(FONTS.regular)
        .fontSize(9)
        .fillColor('#666666');

      const textWidth = doc.widthOfString(footerContent);
      const xPos = (PAGE.width - textWidth) / 2;
      doc.text(footerContent, xPos, footerY + 5, { lineBreak: false });
    }

    // Draw page number on the right
    if (branding.footer?.includePageNumber) {
      const pageText = `Page ${pageNumber} of ${totalPages}`;
      doc
        .font(FONTS.regular)
        .fontSize(9)
        .fillColor('#666666');

      const textWidth = doc.widthOfString(pageText);
      const xPos = PAGE.width - PAGE.margin.right - textWidth;
      doc.text(pageText, xPos, footerY + 15, { lineBreak: false });
    }

    // Draw AI disclaimer if enabled
    if (this.disclaimerConfig?.enabled) {
      const disclaimerText = this.disclaimerConfig.fullText;
      const disclaimerY = footerY + 25;
      doc
        .font(FONTS.italic)
        .fontSize(this.disclaimerConfig.fontSize)
        .fillColor(this.disclaimerConfig.color);

      const disclaimerWidth = doc.widthOfString(disclaimerText);
      const disclaimerX = (PAGE.width - disclaimerWidth) / 2;
      doc.text(disclaimerText, disclaimerX, disclaimerY, { lineBreak: false });
    }
  }

  /**
   * Finalize the document and return buffer
   */
  private finalize(): Promise<PdfResult> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      this.doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      this.doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          buffer,
          pageCount: this.pageCount,
          fileSize: buffer.length,
        });
      });
      this.doc.on('error', reject);

      this.doc.end();
    });
  }
}

// ============ Convenience Function ============

/**
 * Generate a PDF document
 */
export async function generatePdf(options: PdfOptions): Promise<PdfResult> {
  const builder = new PdfBuilder(options);
  return builder.generate(options.content, options.title);
}
