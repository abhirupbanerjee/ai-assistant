/**
 * Text Fitting Utility for PPTX Slides
 *
 * Prevents text overflow by calculating optimal font sizes based on
 * container dimensions and character count. Uses a heuristic approach
 * with zero external dependencies.
 */

export interface TextFitResult {
  /** Calculated font size in points */
  fontSize: number;
  /** Whether content is too large even at minimum font size */
  needsSplit: boolean;
  /** Recommended number of slides to split content across */
  recommendedSplitCount: number;
  /** Human-readable warning message, if any */
  warning?: string;
}

/**
 * Average character width ratio relative to font size (in points).
 * At 16pt, average char width ≈ 16 × 0.6 / 72 = 0.133 inches.
 */
const AVG_CHAR_WIDTH_RATIO = 0.6;

/**
 * Line height ratio relative to font size.
 * At 16pt, line height ≈ 16 × 1.4 / 72 = 0.311 inches.
 */
const LINE_HEIGHT_RATIO = 1.4;

/**
 * Calculate optimal font size for text in a given container.
 * Uses character-count heuristic — fast, zero dependencies.
 *
 * @param text - The text content to fit
 * @param containerW - Container width in inches
 * @param containerH - Container height in inches
 * @param baseFontSize - Preferred font size in points (default: 16)
 * @param minFontSize - Minimum acceptable font size in points (default: 9)
 * @returns TextFitResult with calculated fontSize and warnings
 */
export function fitTextHeuristic(
  text: string,
  containerW: number,
  containerH: number,
  baseFontSize: number = 16,
  minFontSize: number = 9,
): TextFitResult {
  if (!text || text.trim().length === 0) {
    return { fontSize: baseFontSize, needsSplit: false, recommendedSplitCount: 0 };
  }

  // Points to inches: 1pt = 1/72 inch
  const charWidthInches = (baseFontSize / 72) * AVG_CHAR_WIDTH_RATIO;
  const charsPerLine = Math.max(1, Math.floor(containerW / charWidthInches));
  const lineCount = Math.ceil(text.length / charsPerLine);
  const lineHeightInches = (baseFontSize / 72) * LINE_HEIGHT_RATIO;
  const totalHeight = lineCount * lineHeightInches;

  // Text fits comfortably
  if (totalHeight <= containerH) {
    return { fontSize: baseFontSize, needsSplit: false, recommendedSplitCount: 0 };
  }

  // Calculate required font size to fit
  const requiredFontSize = (containerH / (lineCount * LINE_HEIGHT_RATIO)) * 72;
  const clampedSize = Math.max(minFontSize, Math.floor(requiredFontSize));

  // Check if even minimum font size overflows
  const minCharWidth = (minFontSize / 72) * AVG_CHAR_WIDTH_RATIO;
  const minCharsPerLine = Math.max(1, Math.floor(containerW / minCharWidth));
  const minLineCount = Math.ceil(text.length / minCharsPerLine);
  const minTotalHeight = minLineCount * (minFontSize / 72) * LINE_HEIGHT_RATIO;

  if (minTotalHeight > containerH) {
    // Content fundamentally too large — recommend split
    const maxLines = Math.max(1, Math.floor(containerH / ((minFontSize / 72) * LINE_HEIGHT_RATIO)));
    const maxChars = maxLines * minCharsPerLine;
    const splitCount = Math.ceil(text.length / maxChars);

    return {
      fontSize: minFontSize,
      needsSplit: true,
      recommendedSplitCount: splitCount,
      warning: `Content too long (${text.length} chars, fits ~${maxChars} chars per slide). Consider splitting into ${splitCount} slides.`,
    };
  }

  return { fontSize: clampedSize, needsSplit: false, recommendedSplitCount: 0 };
}
