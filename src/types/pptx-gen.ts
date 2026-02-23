/**
 * PPTX Generation Tool Types
 *
 * Type definitions for the PowerPoint presentation generation tool.
 */

// ============ Tool Arguments ============

export interface PptxGenToolArgs {
  /** Presentation title */
  title: string;
  /** Array of slide definitions */
  slides: SlideDefinition[];
  /** Visual theme */
  theme?: ThemeName;
  /** Custom color scheme (overrides theme) */
  colorScheme?: ColorScheme;
}

// ============ Slide Types ============

export type SlideType =
  | 'title'
  | 'content'
  | 'two-column'
  | 'comparison'
  | 'stats'
  | 'image'
  | 'closing';

export interface SlideDefinition {
  /** Slide layout type */
  type: SlideType;
  /** Slide title */
  title: string;
  /** Main content (for content/closing slides) */
  content?: string;
  /** Left column content (for two-column/comparison) */
  leftContent?: string;
  /** Right column content (for two-column/comparison) */
  rightContent?: string;
  /** Stats for stats slide */
  stats?: StatItem[];
  /** Prompt for AI image generation (for image slides) */
  imagePrompt?: string;
  /** Style hint for image generation */
  imageStyle?: ImageStyle;
  /** Speaker notes */
  speakerNotes?: string;
}

export interface StatItem {
  /** Large value/number display */
  value: string;
  /** Description label */
  label: string;
}

// ============ Themes & Colors ============

export type ThemeName = 'corporate' | 'modern' | 'minimal' | 'bold';

export type ImageStyle = 'infographic' | 'photo' | 'illustration' | 'diagram';

export interface ColorScheme {
  /** Primary color (hex) */
  primary: string;
  /** Secondary color (hex) */
  secondary: string;
  /** Accent color (hex) */
  accent: string;
}

export interface ThemeConfig {
  /** Primary color (without #) */
  primary: string;
  /** Secondary color (without #) */
  secondary: string;
  /** Accent color (without #) */
  accent: string;
  /** Header font family */
  headerFont: string;
  /** Body font family */
  bodyFont: string;
  /** Whether title slide has dark background */
  darkTitleSlide: boolean;
}

// ============ Tool Configuration ============

export interface PptxGenConfig {
  /** Default theme */
  defaultTheme: ThemeName;
  /** Maximum slides per presentation */
  maxSlides: number;
  /** Maximum image slides per presentation */
  maxImageSlides: number;
  /** Enable AI image generation for image slides */
  enableImageGeneration: boolean;
  /** Branding settings */
  branding: {
    enabled: boolean;
    logoUrl?: string;
    organizationName?: string;
  };
}

// ============ Generation Result ============

export interface PptxResult {
  /** Generated file buffer */
  buffer: Buffer;
  /** Number of slides */
  slideCount: number;
  /** File size in bytes */
  fileSize: number;
  /** Number of successfully generated image slides */
  imageSlides: number;
  /** Number of failed image generations (fell back to text) */
  failedImages: number;
}

// ============ Tool Response ============

export interface PptxGenResponse {
  success: boolean;
  document?: {
    filename: string;
    fileSize: number;
    slideCount: number;
    downloadUrl: string;
  };
  imageGeneration?: {
    attempted: number;
    successful: number;
    failed: number;
  };
  imageGenDisabled?: boolean;
  imagesFallbackToText?: number;
  error?: string;
  errorCode?: string;
  suggestion?: string;
}
