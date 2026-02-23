/**
 * Memory Utilities for Document Generation Tools
 *
 * Provides memory estimation and checks to prevent out-of-memory errors
 * when generating large spreadsheets or presentations.
 */

// ============ Types ============

export interface MemoryCheck {
  canProceed: boolean;
  currentUsageMB: number;
  estimatedRequirementMB: number;
  projectedUsageMB: number;
  reason?: string;
}

export interface SheetDefinitionForMemory {
  headers: string[];
  rows: unknown[][];
}

export interface SlideDefinitionForMemory {
  type: string;
}

// ============ Constants ============

/** Maximum heap usage threshold in MB (2GB default) */
const MAX_HEAP_MB = 2000;

/** Estimated bytes per cell in Excel (accounts for overhead) */
const BYTES_PER_CELL = 100;

/** Base overhead for XLSX workbook in MB */
const XLSX_BASE_OVERHEAD_MB = 50;

/** Estimated MB per text slide */
const PPTX_TEXT_SLIDE_MB = 0.5;

/** Estimated MB per image slide (includes image buffer) */
const PPTX_IMAGE_SLIDE_MB = 5;

/** Base overhead for PPTX presentation in MB */
const PPTX_BASE_OVERHEAD_MB = 20;

// ============ Memory Check Functions ============

/**
 * Check if there's enough memory to generate an XLSX file
 *
 * @param sheets - Array of sheet definitions with headers and rows
 * @returns MemoryCheck with proceed status and details
 */
export function checkMemoryForXlsx(sheets: SheetDefinitionForMemory[]): MemoryCheck {
  const currentUsageMB = process.memoryUsage().heapUsed / (1024 * 1024);

  // Calculate total cells
  const totalCells = sheets.reduce(
    (sum, sheet) => sum + sheet.rows.length * sheet.headers.length,
    0
  );

  // Estimate memory requirement
  const estimatedRequirementMB =
    (totalCells * BYTES_PER_CELL) / (1024 * 1024) + XLSX_BASE_OVERHEAD_MB;

  const projectedUsageMB = currentUsageMB + estimatedRequirementMB;
  const canProceed = projectedUsageMB < MAX_HEAP_MB;

  return {
    canProceed,
    currentUsageMB: Math.round(currentUsageMB * 10) / 10,
    estimatedRequirementMB: Math.round(estimatedRequirementMB * 10) / 10,
    projectedUsageMB: Math.round(projectedUsageMB * 10) / 10,
    reason: canProceed
      ? undefined
      : `Projected memory usage (${Math.round(projectedUsageMB)}MB) exceeds limit (${MAX_HEAP_MB}MB). ` +
        `Current usage: ${Math.round(currentUsageMB)}MB, estimated requirement: ${Math.round(estimatedRequirementMB)}MB.`,
  };
}

/**
 * Check if there's enough memory to generate a PPTX file
 *
 * @param slides - Array of slide definitions
 * @returns MemoryCheck with proceed status and details
 */
export function checkMemoryForPptx(slides: SlideDefinitionForMemory[]): MemoryCheck {
  const currentUsageMB = process.memoryUsage().heapUsed / (1024 * 1024);

  // Count slide types
  const imageSlideCount = slides.filter((s) => s.type === 'image').length;
  const textSlideCount = slides.length - imageSlideCount;

  // Estimate memory requirement
  const estimatedRequirementMB =
    textSlideCount * PPTX_TEXT_SLIDE_MB +
    imageSlideCount * PPTX_IMAGE_SLIDE_MB +
    PPTX_BASE_OVERHEAD_MB;

  const projectedUsageMB = currentUsageMB + estimatedRequirementMB;
  const canProceed = projectedUsageMB < MAX_HEAP_MB;

  return {
    canProceed,
    currentUsageMB: Math.round(currentUsageMB * 10) / 10,
    estimatedRequirementMB: Math.round(estimatedRequirementMB * 10) / 10,
    projectedUsageMB: Math.round(projectedUsageMB * 10) / 10,
    reason: canProceed
      ? undefined
      : `Projected memory usage (${Math.round(projectedUsageMB)}MB) exceeds limit (${MAX_HEAP_MB}MB). ` +
        `Current usage: ${Math.round(currentUsageMB)}MB, estimated requirement: ${Math.round(estimatedRequirementMB)}MB.`,
  };
}

/**
 * Check payload size to prevent oversized inputs
 *
 * @param args - Tool arguments to check
 * @param maxSizeMB - Maximum allowed size in MB (default 5MB)
 * @returns Object with pass status and size info
 */
export function checkPayloadSize(
  args: unknown,
  maxSizeMB: number = 5
): { pass: boolean; sizeMB: number; reason?: string } {
  const payloadSize = JSON.stringify(args).length;
  const sizeMB = payloadSize / (1024 * 1024);

  if (sizeMB > maxSizeMB) {
    return {
      pass: false,
      sizeMB: Math.round(sizeMB * 100) / 100,
      reason: `Request payload too large: ${sizeMB.toFixed(2)}MB exceeds limit of ${maxSizeMB}MB`,
    };
  }

  return {
    pass: true,
    sizeMB: Math.round(sizeMB * 100) / 100,
  };
}
