/**
 * XLSX Builder - Generate Excel spreadsheets using ExcelJS
 *
 * Creates professional spreadsheets with data, formulas, and formatting.
 */

import ExcelJS from 'exceljs';
import type {
  SheetDefinition,
  XlsxResult,
  FormulaDefinition,
} from '@/types/xlsx-gen';
import { type DisclaimerConfig } from '../disclaimer';

// ============ Color Scheme ============

const COLORS = {
  headerBg: '1E3A5F',
  headerText: 'FFFFFF',
  alternateBg: 'F5F7FA',
  borderColor: 'D1D5DB',
};

// ============ Builder Options ============

export interface XlsxOptions {
  filename: string;
  sheets: SheetDefinition[];
  organizationName?: string;
  disclaimerConfig?: DisclaimerConfig | null;
}

// ============ XLSX Builder Class ============

export class XlsxBuilder {
  private workbook: ExcelJS.Workbook;
  private options: XlsxOptions;

  constructor(options: XlsxOptions) {
    this.options = options;
    this.workbook = new ExcelJS.Workbook();
    this.initializeWorkbook();
  }

  private initializeWorkbook(): void {
    this.workbook.creator = this.options.organizationName || 'Policy Bot';
    this.workbook.created = new Date();
    this.workbook.modified = new Date();
  }

  async generate(): Promise<XlsxResult> {
    for (const sheet of this.options.sheets) {
      this.addSheet(sheet);
    }

    const buffer = (await this.workbook.xlsx.writeBuffer()) as unknown as Buffer;

    return {
      buffer,
      sheetCount: this.options.sheets.length,
      fileSize: buffer.length,
    };
  }

  private addSheet(sheet: SheetDefinition): void {
    // Truncate sheet name to 31 characters (Excel limitation)
    const sheetName = sheet.name.substring(0, 31);
    const worksheet = this.workbook.addWorksheet(sheetName);

    // Set column widths
    this.setColumnWidths(worksheet, sheet);

    // Add AI disclaimer row if enabled
    if (this.options.disclaimerConfig?.enabled) {
      const disclaimerRow = worksheet.addRow([this.options.disclaimerConfig.fullText]);
      disclaimerRow.getCell(1).font = {
        italic: true,
        color: { argb: (this.options.disclaimerConfig.color || '#808080').replace('#', '') },
        size: this.options.disclaimerConfig.fontSize,
      };
      // Merge cells across the header width
      if (sheet.headers.length > 1) {
        worksheet.mergeCells(1, 1, 1, sheet.headers.length);
      }
      // Add empty row as separator
      worksheet.addRow([]);
    }

    // Add headers
    this.addHeaders(worksheet, sheet);

    // Add data rows
    this.addDataRows(worksheet, sheet);

    // Add formulas
    if (sheet.formulas && sheet.formulas.length > 0) {
      this.addFormulas(worksheet, sheet.formulas);
    }

    // Apply formatting
    this.applyFormatting(worksheet, sheet);
  }

  private setColumnWidths(worksheet: ExcelJS.Worksheet, sheet: SheetDefinition): void {
    const widths = sheet.columnWidths || {};

    sheet.headers.forEach((header, index) => {
      const colLetter = this.getColumnLetter(index);
      // Use custom width or calculate based on header length
      const width = widths[colLetter] || Math.max(header.length + 2, 12);
      worksheet.getColumn(index + 1).width = width;
    });
  }

  private addHeaders(worksheet: ExcelJS.Worksheet, sheet: SheetDefinition): void {
    const headerRow = worksheet.addRow(sheet.headers);
    const style = sheet.formatting?.headerStyle || 'highlighted';

    headerRow.eachCell((cell) => {
      // Always bold headers
      cell.font = { bold: true, color: { argb: COLORS.headerText } };

      // Background color for highlighted/bordered styles
      if (style === 'highlighted' || style === 'bordered') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: COLORS.headerBg },
        };
      }

      // Center alignment
      cell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Add borders for bordered style
      if (style === 'bordered') {
        cell.border = {
          top: { style: 'thin', color: { argb: COLORS.borderColor } },
          bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
          left: { style: 'thin', color: { argb: COLORS.borderColor } },
          right: { style: 'thin', color: { argb: COLORS.borderColor } },
        };
      }
    });

    // Freeze header row by default
    if (sheet.formatting?.freezeHeader !== false) {
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
  }

  private addDataRows(worksheet: ExcelJS.Worksheet, sheet: SheetDefinition): void {
    sheet.rows.forEach((rowData, rowIndex) => {
      const row = worksheet.addRow(rowData);

      // Alternate row coloring
      if (sheet.formatting?.alternateRows && rowIndex % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLORS.alternateBg },
          };
        });
      }
    });
  }

  private addFormulas(worksheet: ExcelJS.Worksheet, formulas: FormulaDefinition[]): void {
    formulas.forEach(({ cell, formula }) => {
      // Validate formula starts with =
      const safeFormula = formula.startsWith('=') ? formula : `=${formula}`;
      worksheet.getCell(cell).value = { formula: safeFormula.substring(1) };
    });
  }

  private applyFormatting(worksheet: ExcelJS.Worksheet, sheet: SheetDefinition): void {
    // Auto-filter on headers if there's data
    if (sheet.rows.length > 0) {
      const lastCol = this.getColumnLetter(sheet.headers.length - 1);
      worksheet.autoFilter = {
        from: 'A1',
        to: `${lastCol}1`,
      };
    }

    // Number formatting
    if (sheet.formatting?.numberFormat) {
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.eachCell((cell) => {
            if (typeof cell.value === 'number') {
              cell.numFmt = sheet.formatting!.numberFormat!;
            }
          });
        }
      });
    }
  }

  private getColumnLetter(index: number): string {
    let letter = '';
    let temp = index;
    while (temp >= 0) {
      letter = String.fromCharCode(65 + (temp % 26)) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  }
}

// ============ Convenience Function ============

export async function generateXlsx(options: XlsxOptions): Promise<XlsxResult> {
  const builder = new XlsxBuilder(options);
  return builder.generate();
}
