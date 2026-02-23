/**
 * XLSX Generation Tool Types
 *
 * Type definitions for the Excel spreadsheet generation tool.
 */

// ============ Tool Arguments ============

export interface XlsxGenToolArgs {
  /** Output filename (without .xlsx extension) */
  filename: string;
  /** Array of sheet definitions */
  sheets: SheetDefinition[];
}

// ============ Sheet Definition ============

export interface SheetDefinition {
  /** Sheet name (max 31 characters, Excel limitation) */
  name: string;
  /** Sheet type hint */
  type?: 'data' | 'summary' | 'template';
  /** Column headers */
  headers: string[];
  /** Data rows (array of arrays) */
  rows: CellValue[][];
  /** Formulas to add after data */
  formulas?: FormulaDefinition[];
  /** Column widths by letter, e.g., {"A": 20, "B": 15} */
  columnWidths?: Record<string, number>;
  /** Sheet formatting options */
  formatting?: SheetFormatting;
}

export type CellValue = string | number | boolean | null;

// ============ Formula Definition ============

export interface FormulaDefinition {
  /** Target cell address, e.g., "D2" */
  cell: string;
  /** Excel formula, e.g., "=SUM(A2:C2)" */
  formula: string;
}

// ============ Formatting Options ============

export interface SheetFormatting {
  /** Header row style */
  headerStyle?: 'bold' | 'highlighted' | 'bordered';
  /** Number format for numeric cells */
  numberFormat?: string;
  /** Alternate row background coloring */
  alternateRows?: boolean;
  /** Freeze the header row */
  freezeHeader?: boolean;
}

// ============ Tool Configuration ============

export interface XlsxGenConfig {
  /** Maximum sheets per workbook */
  maxSheets: number;
  /** Maximum rows per sheet */
  maxRowsPerSheet: number;
  /** Maximum columns per sheet */
  maxColumnsPerSheet: number;
  /** Default header style */
  defaultHeaderStyle: 'bold' | 'highlighted' | 'bordered';
  /** Branding settings */
  branding: {
    enabled: boolean;
    organizationName?: string;
    primaryColor?: string;
  };
}

// ============ Generation Result ============

export interface XlsxResult {
  /** Generated file buffer */
  buffer: Buffer;
  /** Number of sheets in the workbook */
  sheetCount: number;
  /** File size in bytes */
  fileSize: number;
}

// ============ Tool Response ============

export interface XlsxGenResponse {
  success: boolean;
  document?: {
    filename: string;
    fileSize: number;
    sheetCount: number;
    downloadUrl: string;
  };
  error?: string;
  errorCode?: string;
  suggestion?: string;
}
