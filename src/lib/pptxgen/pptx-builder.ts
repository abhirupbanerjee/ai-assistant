/**
 * PPTX Builder - Generate PowerPoint presentations using PptxGenJS
 *
 * Creates professional presentations with multiple slide types and themes.
 * Supports optional AI image generation for image slides.
 */

import PptxGenJS from 'pptxgenjs';
import * as fs from 'fs';
import * as path from 'path';
import type {
  SlideDefinition,
  PptxResult,
  ThemeName,
  ThemeConfig,
  SlideLayout,
} from '@/types/pptx-gen';
import type { ImageGenToolArgs } from '@/types/image-gen';
import { getTheme, mapLegacyTheme } from './themes';
import { fitTextHeuristic } from './text-fit';
import { generateImage, isImageGenEnabled } from '../image-gen/provider-factory';
import { type DisclaimerConfig } from '../disclaimer';

// ============ Builder Options ============

export interface PptxOptions {
  title: string;
  slides: SlideDefinition[];
  theme?: ThemeName;
  /** Accent color for highlights, chart fills, stat numbers (hex, e.g. "#3B82F6") */
  accentColor?: string;
  organizationName?: string;
  disclaimerConfig?: DisclaimerConfig | null;
}

// ============ Text Props Type ============

interface TextProps {
  text: string;
  options?: { breakLine?: boolean };
}

// ============ Layout Region Type ============

interface LayoutRegions {
  visual: { x: number; y: number; w: number; h: number };
  text: { x: number; y: number; w: number; h: number };
}

// ============ PPTX Builder Class ============

export class PptxBuilder {
  private pptx: PptxGenJS;
  private theme: ThemeConfig;
  private themeName: ThemeName;
  private options: PptxOptions;
  private imageSlideCount: number = 0;
  private failedImageCount: number = 0;
  private imageGenAvailable: boolean = false;

  constructor(options: PptxOptions) {
    this.options = options;

    // Handle legacy theme names via backward-compatible mapping
    const legacyName = options.theme as string;
    const legacyMap = mapLegacyTheme(legacyName);
    this.themeName = legacyMap.theme;

    // Use explicit accentColor, or the mapped legacy accent, or default
    const accentColor = options.accentColor || legacyMap.accentColor;
    this.theme = getTheme(this.themeName, accentColor);

    this.pptx = new PptxGenJS();
    this.initializePresentation();
  }

  private initializePresentation(): void {
    this.pptx.author = this.options.organizationName || 'AI Assistant';
    this.pptx.title = this.options.title;
    this.pptx.subject = this.options.title;
    this.pptx.layout = 'LAYOUT_16x9';
  }

  async generate(): Promise<PptxResult> {
    // Check image_gen availability once at start
    this.imageGenAvailable = await isImageGenEnabled();

    for (const slide of this.options.slides) {
      await this.addSlide(slide);
    }

    const buffer = (await this.pptx.write({ outputType: 'nodebuffer' })) as Buffer;

    return {
      buffer,
      slideCount: this.options.slides.length,
      fileSize: buffer.length,
      imageSlides: this.imageSlideCount,
      failedImages: this.failedImageCount,
    };
  }

  private async addSlide(slide: SlideDefinition): Promise<void> {
    const pptxSlide = this.pptx.addSlide();

    switch (slide.type) {
      case 'title':
        this.buildTitleSlide(pptxSlide, slide);
        break;
      case 'content':
        this.buildContentSlide(pptxSlide, slide);
        break;
      case 'two-column':
        this.buildTwoColumnSlide(pptxSlide, slide);
        break;
      case 'comparison':
        this.buildComparisonSlide(pptxSlide, slide);
        break;
      case 'stats':
        this.buildStatsSlide(pptxSlide, slide);
        break;
      case 'image':
        await this.buildImageSlide(pptxSlide, slide);
        break;
      case 'closing':
        this.buildClosingSlide(pptxSlide, slide);
        break;
      case 'chart':
        this.buildChartSlide(pptxSlide, slide);
        break;
      case 'table':
        this.buildTableSlide(pptxSlide, slide);
        break;
      case 'timeline':
        this.buildTimelineSlide(pptxSlide, slide);
        break;
      case 'metric-cards':
        this.buildMetricCardsSlide(pptxSlide, slide);
        break;
      case 'swot':
        this.buildSwotSlide(pptxSlide, slide);
        break;
      case 'funnel':
        this.buildFunnelSlide(pptxSlide, slide);
        break;
      case 'before-after':
        this.buildBeforeAfterSlide(pptxSlide, slide);
        break;
      case 'process':
        this.buildProcessSlide(pptxSlide, slide);
        break;
      case 'kanban':
        this.buildKanbanSlide(pptxSlide, slide);
        break;
      case 'pyramid':
        this.buildPyramidSlide(pptxSlide, slide);
        break;
      case 'radial-progress':
        this.buildRadialProgressSlide(pptxSlide, slide);
        break;
      case 'icon-grid':
        this.buildIconGridSlide(pptxSlide, slide);
        break;
      case 'comparison-matrix':
        this.buildComparisonMatrixSlide(pptxSlide, slide);
        break;
      case 'quote':
        this.buildQuoteSlide(pptxSlide, slide);
        break;
      case 'agenda':
        this.buildAgendaSlide(pptxSlide, slide);
        break;
      case 'team':
        this.buildTeamSlide(pptxSlide, slide);
        break;
      case 'geo':
        this.buildGeoSlide(pptxSlide, slide);
        break;
      default:
        // Unknown slide type → Tier 3 text fallback; ensure an icon so it is
        // not a bare text wall.
        this.buildContentSlide(pptxSlide, { ...slide, icon: slide.icon || '📌' });
    }

    // Add AI disclaimer footer if enabled
    if (this.options.disclaimerConfig?.enabled) {
      pptxSlide.addText(this.options.disclaimerConfig.fullText, {
        x: 0.5,
        y: 5.1,
        w: '90%',
        h: 0.3,
        fontSize: this.options.disclaimerConfig.fontSize,
        fontFace: this.theme.bodyFont,
        color: this.options.disclaimerConfig.color.replace('#', ''),
        align: 'center',
        italic: true,
      });
    }

    if (slide.speakerNotes) {
      pptxSlide.addNotes(slide.speakerNotes);
    }
  }

  // ============ Description Renderer ============

  /**
   * Render the optional description paragraph below the title.
   * Returns the Y offset consumed (0 if no description).
   */
  private renderDescription(
    pptxSlide: PptxGenJS.Slide,
    description: string | undefined,
    titleY: number,
    titleH: number,
  ): number {
    if (!description) return 0;

    const descY = titleY + titleH + 0.1;
    const descH = 0.5;

    pptxSlide.addText(description, {
      x: 0.5,
      y: descY,
      w: '90%',
      h: descH,
      fontSize: 14,
      fontFace: this.theme.bodyFont,
      color: this.theme.bodyTextColor,
      italic: true,
      valign: 'top',
    });

    return descH + 0.1;
  }

  // ============ Layout Region Calculator ============

  /**
   * Calculate visual and text regions based on the layout mode.
   * Used for split-left, split-right, split-top layouts.
   */
  private getLayoutRegions(
    layout: SlideLayout | undefined,
    contentY: number,
    contentH: number,
  ): LayoutRegions {
    const full: LayoutRegions = {
      visual: { x: 0.5, y: contentY, w: 9.0, h: contentH },
      text: { x: 0, y: 0, w: 0, h: 0 },
    };

    switch (layout) {
      case 'split-left':
        return {
          visual: { x: 0.5, y: contentY, w: 5.0, h: contentH },
          text: { x: 5.8, y: contentY, w: 3.7, h: contentH },
        };
      case 'split-right':
        return {
          visual: { x: 4.8, y: contentY, w: 5.0, h: contentH },
          text: { x: 0.5, y: contentY, w: 3.8, h: contentH },
        };
      case 'split-top':
        return {
          visual: { x: 0.5, y: contentY + 1.8, w: 9.0, h: contentH - 1.8 },
          text: { x: 0.5, y: contentY, w: 9.0, h: 1.6 },
        };
      case 'full':
      default:
        return full;
    }
  }

  // ============ Slide Builders ============

  private buildTitleSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, bodyTextColor, accentColor, headerFont, bodyFont } = this.theme;

    // Dark theme: full dark background; Light theme: white background with accent strip
    pptxSlide.background = { color: background };

    // Accent bar at top for light theme
    if (this.themeName === 'light') {
      pptxSlide.addShape('rect', {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.08,
        fill: { color: accentColor },
      });
    }

    const titleY = this.themeName === 'dark' ? 2.2 : 2.5;

    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: titleY,
      w: '90%',
      h: 1.5,
      fontSize: 44,
      fontFace: headerFont,
      color: textColor,
      bold: true,
      align: 'center',
    });

    if (slide.description) {
      pptxSlide.addText(slide.description, {
        x: 0.5,
        y: titleY + 1.5 + 0.2,
        w: '90%',
        h: 0.6,
        fontSize: 18,
        fontFace: bodyFont,
        color: bodyTextColor,
        align: 'center',
        italic: true,
      });
    } else if (slide.content) {
      pptxSlide.addText(slide.content, {
        x: 0.5,
        y: titleY + 1.5 + 0.2,
        w: '90%',
        h: 0.8,
        fontSize: 20,
        fontFace: bodyFont,
        color: bodyTextColor,
        align: 'center',
      });
    }
  }

  private buildContentSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;

    pptxSlide.background = { color: background };

    // Optional icon rendered to the left of the title (Tier 3 fallback enhancement)
    const icon = slide.icon;
    const titleX = icon ? 1.5 : 0.5;
    const titleW = icon ? '78%' : '90%';

    if (icon) {
      pptxSlide.addText(icon, {
        x: 0.5,
        y: 0.28,
        w: 0.9,
        h: 0.85,
        fontSize: 32,
        fontFace: bodyFont,
        align: 'center',
        valign: 'middle',
      });
    }

    // Title
    pptxSlide.addText(slide.title, {
      x: titleX,
      y: 0.3,
      w: titleW,
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: textColor,
      bold: true,
    });

    // Accent underline below title
    pptxSlide.addShape('rect', {
      x: 0.5,
      y: 1.05,
      w: 1.5,
      h: 0.04,
      fill: { color: accentColor },
    });

    // Description (rendered below title only in full mode; split mode renders it in the text region)
    const isSplitLayout = slide.layout && slide.layout !== 'full';
    const descOffset = isSplitLayout ? 0 : this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    // Layout regions for split mode
    const regions = this.getLayoutRegions(slide.layout, contentY, contentH);
    const hasSplit = regions.text.w > 0;

    // Content bullets (in visual region if split, or full width)
    if (slide.content) {
      const textW = hasSplit ? regions.visual.w : 9.0;
      const textX = hasSplit ? regions.visual.x : 0.5;

      const { fontSize, warning } = fitTextHeuristic(
        slide.content,
        textW,
        contentH,
        16,
      );

      if (warning) {
        console.warn(`[PptxBuilder] ${warning}`);
      }

      const bullets = this.parseMarkdownToBullets(slide.content);
      pptxSlide.addText(bullets, {
        x: textX,
        y: contentY,
        w: textW,
        h: contentH,
        fontSize,
        fontFace: bodyFont,
        color: bodyTextColor,
        bullet: { type: 'bullet' },
        lineSpacingMultiple: 1.5,
      });
    }

    // Description text in split text region
    if (hasSplit && slide.description) {
      pptxSlide.addText(slide.description, {
        x: regions.text.x,
        y: regions.text.y,
        w: regions.text.w,
        h: regions.text.h,
        fontSize: 14,
        fontFace: bodyFont,
        color: bodyTextColor,
        valign: 'top',
      });
    }
  }

  private buildTwoColumnSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: textColor,
      bold: true,
    });

    // Accent underline
    pptxSlide.addShape('rect', {
      x: 0.5,
      y: 1.05,
      w: 1.5,
      h: 0.04,
      fill: { color: accentColor },
    });

    // Description
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    // Left column
    if (slide.leftContent) {
      const { fontSize, warning } = fitTextHeuristic(
        slide.leftContent,
        4.5,
        contentH,
        14,
      );
      if (warning) console.warn(`[PptxBuilder] Left column: ${warning}`);

      const leftBullets = this.parseMarkdownToBullets(slide.leftContent);
      pptxSlide.addText(leftBullets, {
        x: 0.5,
        y: contentY,
        w: 4.5,
        h: contentH,
        fontSize,
        fontFace: bodyFont,
        color: bodyTextColor,
        bullet: { type: 'bullet' },
        lineSpacingMultiple: 1.4,
      });
    }

    // Right column
    if (slide.rightContent) {
      const { fontSize, warning } = fitTextHeuristic(
        slide.rightContent,
        4.5,
        contentH,
        14,
      );
      if (warning) console.warn(`[PptxBuilder] Right column: ${warning}`);

      const rightBullets = this.parseMarkdownToBullets(slide.rightContent);
      pptxSlide.addText(rightBullets, {
        x: 5.2,
        y: contentY,
        w: 4.5,
        h: contentH,
        fontSize,
        fontFace: bodyFont,
        color: bodyTextColor,
        bullet: { type: 'bullet' },
        lineSpacingMultiple: 1.4,
      });
    }
  }

  private buildComparisonSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: textColor,
      bold: true,
    });

    // Accent underline
    pptxSlide.addShape('rect', {
      x: 0.5,
      y: 1.05,
      w: 1.5,
      h: 0.04,
      fill: { color: accentColor },
    });

    // Description
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    // Left box background
    const leftBg = this.themeName === 'dark' ? '1A1A1A' : 'F5F5F5';
    pptxSlide.addShape('rect', {
      x: 0.5,
      y: contentY,
      w: 4.5,
      h: contentH,
      fill: { color: leftBg },
      line: { color: borderColor, width: 1 },
    });

    // Right box background (uses accent with low opacity via lighter shade, or accent border)
    const rightBg = this.themeName === 'dark' ? '1A1A1A' : 'F5F5F5';
    pptxSlide.addShape('rect', {
      x: 5.2,
      y: contentY,
      w: 4.5,
      h: contentH,
      fill: { color: rightBg },
      line: { color: accentColor, width: 2 },
    });

    // Left content with text fit
    if (slide.leftContent) {
      const { fontSize, warning } = fitTextHeuristic(
        slide.leftContent,
        4.1,
        contentH - 0.4,
        14,
      );
      if (warning) console.warn(`[PptxBuilder] Comparison left: ${warning}`);

      const leftBullets = this.parseMarkdownToBullets(slide.leftContent);
      pptxSlide.addText(leftBullets, {
        x: 0.7,
        y: contentY + 0.2,
        w: 4.1,
        h: contentH - 0.4,
        fontSize,
        fontFace: bodyFont,
        color: bodyTextColor,
        bullet: { type: 'bullet' },
      });
    }

    // Right content with text fit
    if (slide.rightContent) {
      const { fontSize, warning } = fitTextHeuristic(
        slide.rightContent,
        4.1,
        contentH - 0.4,
        14,
      );
      if (warning) console.warn(`[PptxBuilder] Comparison right: ${warning}`);

      const rightBullets = this.parseMarkdownToBullets(slide.rightContent);
      pptxSlide.addText(rightBullets, {
        x: 5.4,
        y: contentY + 0.2,
        w: 4.1,
        h: contentH - 0.4,
        fontSize,
        fontFace: bodyFont,
        color: bodyTextColor,
        bullet: { type: 'bullet' },
      });
    }
  }

  private buildStatsSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: textColor,
      bold: true,
    });

    // Accent underline
    pptxSlide.addShape('rect', {
      x: 0.5,
      y: 1.05,
      w: 1.5,
      h: 0.04,
      fill: { color: accentColor },
    });

    // Description (rendered below title only in full mode; split mode renders it in the text region)
    const isSplitLayout = slide.layout && slide.layout !== 'full';
    const descOffset = isSplitLayout ? 0 : this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    // Layout regions for split mode
    const regions = this.getLayoutRegions(slide.layout, contentY, contentH);
    const hasSplit = regions.text.w > 0;

    const stats = slide.stats || [];
    const columns = Math.min(stats.length, 4);
    const cardW = hasSplit ? regions.visual.w / columns - 0.2 : 9.5 / columns - 0.3;

    stats.forEach((stat, index) => {
      const x = hasSplit
        ? regions.visual.x + index * (cardW + 0.2)
        : 0.5 + index * (cardW + 0.3);

      const cardH = hasSplit ? contentH : 2.5;
      const cardY = hasSplit ? contentY : contentY + 0.5;

      // Card background
      const cardBg = this.themeName === 'dark' ? '1A1A1A' : 'F5F5F5';
      pptxSlide.addShape('rect', {
        x,
        y: cardY,
        w: cardW,
        h: cardH,
        fill: { color: cardBg },
        line: { color: borderColor, width: 1 },
      });

      // Large value
      pptxSlide.addText(stat.value, {
        x,
        y: cardY + 0.15,
        w: cardW,
        h: cardH * 0.5,
        fontSize: hasSplit ? 36 : 48,
        fontFace: headerFont,
        color: accentColor,
        bold: true,
        align: 'center',
      });

      // Label
      pptxSlide.addText(stat.label, {
        x,
        y: cardY + cardH * 0.5,
        w: cardW,
        h: cardH * 0.3,
        fontSize: hasSplit ? 12 : 14,
        fontFace: bodyFont,
        color: bodyTextColor,
        align: 'center',
      });

      // Caption (small italic below label)
      if (stat.caption) {
        pptxSlide.addText(stat.caption, {
          x,
          y: cardY + cardH * 0.75,
          w: cardW,
          h: cardH * 0.2,
          fontSize: 10,
          fontFace: bodyFont,
          color: bodyTextColor,
          align: 'center',
          italic: true,
        });
      }
    });

    // Description text in split text region
    if (hasSplit && slide.description) {
      pptxSlide.addText(slide.description, {
        x: regions.text.x,
        y: regions.text.y,
        w: regions.text.w,
        h: regions.text.h,
        fontSize: 14,
        fontFace: bodyFont,
        color: bodyTextColor,
        valign: 'top',
      });
    }
  }

  /**
   * Build an image slide
   * If image_gen is unavailable, falls back to content slide with narrative
   */
  private async buildImageSlide(
    pptxSlide: PptxGenJS.Slide,
    slide: SlideDefinition
  ): Promise<void> {
    // Full-bleed image slides intentionally avoid text overlays so the generated
    // visual is unobstructed. Split mode still needs full theme for title/text.
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;

    // If image_gen is not available, fall back to content slide
    if (!this.imageGenAvailable || !slide.imagePrompt) {
      console.log(
        `[PptxBuilder] Image generation disabled or no prompt, falling back to content slide: "${slide.title}"`
      );
      const fallbackSlide: SlideDefinition = {
        ...slide,
        type: 'content',
        content: slide.imagePrompt || slide.content || 'Visual content placeholder',
      };
      this.buildContentSlide(pptxSlide, fallbackSlide);
      this.failedImageCount++;
      return;
    }

    try {
      // Generate image using image_gen tool.
      // Append a strict "no page furniture" instruction so the image is a
      // clean standalone visual suitable for full-bleed 16:9 slides.
      const noFurnitureInstruction =
        "\n\nCRITICAL: Do NOT include any headers, footers, slide numbers, page titles, " +
        "logos, watermarks, captions, UI chrome, or border frames. Output only the clean " +
        "standalone visual content suitable for full-bleed use on a 16:9 presentation slide.";
      const imageArgs: ImageGenToolArgs = {
        prompt: `${slide.imagePrompt}${noFurnitureInstruction}`,
        style: (slide.imageStyle as ImageGenToolArgs['style']) || 'infographic',
        aspectRatio: '16:9',
        resolution: (slide.imageResolution as ImageGenToolArgs['resolution']) || '1K',
      };

      console.log(`[PptxBuilder] Generating image for slide: "${slide.title}"`);
      const imageResult = await generateImage(imageArgs);

      if (!imageResult.success || !imageResult.imageHint?.filepath) {
        throw new Error(imageResult.error?.message || 'Image generation failed');
      }

      const imageFilepath = imageResult.imageHint.filepath;
      console.log(`[PptxBuilder] Image generated successfully, filepath: ${imageFilepath}`);

      // Read the actual image file and convert to base64
      const imageBuffer = fs.readFileSync(imageFilepath);
      const base64Image = imageBuffer.toString('base64');
      const extension = path.extname(imageFilepath).slice(1) || 'webp';

      // Layout regions for split mode
      const regions = this.getLayoutRegions(slide.layout, 1.2, 3.8);
      const hasSplit = regions.text.w > 0;

      if (hasSplit) {
        // Split mode: image in visual region, description in text region
        pptxSlide.background = { color: background };

        // Title
        pptxSlide.addText(slide.title, {
          x: 0.5,
          y: 0.3,
          w: '90%',
          h: 0.8,
          fontSize: 36,
          fontFace: headerFont,
          color: textColor,
          bold: true,
        });

        // Accent underline
        pptxSlide.addShape('rect', {
          x: 0.5,
          y: 1.05,
          w: 1.5,
          h: 0.04,
          fill: { color: accentColor },
        });

        // Image in visual region
        pptxSlide.addImage({
          data: `image/${extension};base64,${base64Image}`,
          x: regions.visual.x,
          y: regions.visual.y,
          w: regions.visual.w,
          h: regions.visual.h,
          sizing: { type: 'contain', w: regions.visual.w, h: regions.visual.h },
        });

        // Description in text region
        const descText = slide.description || slide.content || '';
        if (descText) {
          pptxSlide.addText(descText, {
            x: regions.text.x,
            y: regions.text.y,
            w: regions.text.w,
            h: regions.text.h,
            fontSize: 14,
            fontFace: bodyFont,
            color: bodyTextColor,
            valign: 'top',
          });
        }
      } else {
        // Full mode: full-bleed image only. Avoid title/description overlays
        // because they obscure the generated image and compress the usable visual
        // area on 16:9 slides.
        pptxSlide.addImage({
          data: `image/${extension};base64,${base64Image}`,
          x: 0,
          y: 0,
          w: '100%',
          h: '100%',
          sizing: { type: 'cover', w: '100%', h: '100%' },
        });
      }

      this.imageSlideCount++;
      console.log(`[PptxBuilder] Image slide created with embedded image: "${slide.title}"`);
    } catch (error) {
      console.error(`[PptxBuilder] Image generation failed for slide "${slide.title}":`, error);
      this.failedImageCount++;

      const fallbackSlide: SlideDefinition = {
        ...slide,
        type: 'content',
        content: `Visual: ${slide.imagePrompt}`,
      };
      this.buildContentSlide(pptxSlide, fallbackSlide);
    }
  }

  private buildClosingSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;

    pptxSlide.background = { color: background };

    // Accent bar at top for light theme
    if (this.themeName === 'light') {
      pptxSlide.addShape('rect', {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.08,
        fill: { color: accentColor },
      });
    }

    const titleY = this.themeName === 'dark' ? 2.0 : 2.2;

    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: titleY,
      w: '90%',
      h: 1.2,
      fontSize: 40,
      fontFace: headerFont,
      color: textColor,
      bold: true,
      align: 'center',
    });

    if (slide.description) {
      pptxSlide.addText(slide.description, {
        x: 0.5,
        y: titleY + 1.2 + 0.2,
        w: '90%',
        h: 0.8,
        fontSize: 16,
        fontFace: bodyFont,
        color: bodyTextColor,
        align: 'center',
        italic: true,
      });
    } else if (slide.content) {
      pptxSlide.addText(slide.content, {
        x: 0.5,
        y: titleY + 1.2 + 0.2,
        w: '90%',
        h: 1.0,
        fontSize: 18,
        fontFace: bodyFont,
        color: bodyTextColor,
        align: 'center',
      });
    }
  }

  // ============ Phase 1: New Slide Builders ============

  private buildChartSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.chartData;
    if (!data) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Chart data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    // Description (rendered below title only in full mode; split mode renders it in the text region)
    const isSplitLayout = slide.layout && slide.layout !== 'full';
    const descOffset = isSplitLayout ? 0 : this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    const regions = this.getLayoutRegions(slide.layout, contentY, contentH);
    const hasSplit = regions.text.w > 0;

    // Build chart data in PptxGenJS format
    const chartData = data.series.map((s) => ({
      name: s.name,
      labels: data.categories,
      values: s.values,
    }));

    // Generate palette from accent color for multi-series charts
    const palette = this.generateColorPalette(accentColor, data.series.length);

    const chartOpts: Record<string, unknown> = {
      x: regions.visual.x,
      y: regions.visual.y,
      w: regions.visual.w,
      h: regions.visual.h,
      showLegend: data.showLegend !== false && data.series.length > 1,
      showValue: data.showValues || false,
      showTitle: false,
      chartColors: palette,
      catAxisLabelColor: bodyTextColor,
      valAxisLabelColor: bodyTextColor,
      lineSize: 2,
      dataBorder: { color: borderColor },
    };

    if (data.yAxisLabel) {
      chartOpts.valAxisTitle = data.yAxisLabel;
      chartOpts.valAxisTitleColor = bodyTextColor;
    }

    // Map our chartType to PptxGenJS chart enum via the pptx instance
    const chartEnumMap: Record<string, string> = {
      bar: 'BAR', line: 'LINE', pie: 'PIE', doughnut: 'DOUGHNUT', area: 'AREA',
    };
    const chartEnum = chartEnumMap[data.chartType] || 'BAR';

    try {
      pptxSlide.addChart((this.pptx as any).charts[chartEnum] || (this.pptx as any).ChartType?.[chartEnum], chartData, chartOpts);
    } catch {
      // Fallback: render as text if chart fails
      pptxSlide.addText(`[Chart: ${data.chartType}] ${data.series.map(s => s.name).join(', ')}`, {
        x: regions.visual.x, y: regions.visual.y, w: regions.visual.w, h: 1,
        fontSize: 14, color: bodyTextColor, align: 'center',
      });
    }

    // Description in split text region
    if (hasSplit && slide.description) {
      pptxSlide.addText(slide.description, {
        x: regions.text.x, y: regions.text.y, w: regions.text.w, h: regions.text.h,
        fontSize: 14, fontFace: bodyFont, color: bodyTextColor, valign: 'top',
      });
    }
  }

  private buildTableSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.tableData;
    if (!data || !data.headers.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Table data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    // Description (rendered below title only in full mode; split mode renders it in the text region)
    const isSplitLayout = slide.layout && slide.layout !== 'full';
    const descOffset = isSplitLayout ? 0 : this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    const regions = this.getLayoutRegions(slide.layout, contentY, contentH);
    const hasSplit = regions.text.w > 0;

    // Build rows with header formatting
    const headerColor = data.headerColor || accentColor;
    const headerBg = this.themeName === 'dark' ? '1A1A1A' : headerColor;
    const altRowBg = this.themeName === 'dark' ? '1A1A1A' : 'F5F5F5';
    const striped = data.striped !== false;

    const allRows: any[] = [];

    // Header row
    const headerCells = data.headers.map((h) => ({
      text: h,
      options: {
        bold: true,
        color: 'FFFFFF',
        fill: { color: headerBg },
        align: 'center' as const,
        fontSize: 13,
      },
    }));
    allRows.push(headerCells);

    // Data rows
    data.rows.forEach((row, rowIdx) => {
      const cells = row.map((cell) => ({
        text: cell,
        options: {
          fontSize: 12,
          color: bodyTextColor,
          fill: striped && rowIdx % 2 === 1 ? { color: altRowBg } : undefined,
        },
      }));
      allRows.push(cells);
    });

    const tableW = regions.visual.w;
    const colCount = data.headers.length;
    let colW: number[];
    if (data.columnWidths && data.columnWidths.length === colCount) {
      // Treat provided values as relative weights; normalize to absolute inches summing to tableW
      const totalWeight = data.columnWidths.reduce((sum, w) => sum + (w > 0 ? w : 1), 0);
      colW = data.columnWidths.map((w) => (tableW * (w > 0 ? w : 1)) / totalWeight);
    } else {
      colW = data.headers.map(() => tableW / colCount);
    }

    pptxSlide.addTable(allRows, {
      x: regions.visual.x,
      y: regions.visual.y,
      w: regions.visual.w,
      colW,
      border: { type: 'solid' as const, color: borderColor, pt: 0.5 },
      rowH: 0.4,
      autoPage: false,
    });

    // Description in split text region
    if (hasSplit && slide.description) {
      pptxSlide.addText(slide.description, {
        x: regions.text.x, y: regions.text.y, w: regions.text.w, h: regions.text.h,
        fontSize: 14, fontFace: bodyFont, color: bodyTextColor, valign: 'top',
      });
    }
  }

  private buildTimelineSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.timelineData;
    if (!data || !data.events.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Timeline data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    // Description
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.4 + descOffset;

    const events = data.events;
    const orientation = data.orientation || 'horizontal';

    if (orientation === 'vertical') {
      // Vertical timeline: line on left, events to the right
      const lineX = 1.2;
      const startY = contentY;
      const spacing = 3.6 / Math.max(events.length, 1);

      // Vertical connector line
      pptxSlide.addShape('rect', {
        x: lineX, y: startY, w: 0.03, h: spacing * (events.length - 1) + 0.3,
        fill: { color: accentColor },
      });

      events.forEach((event, i) => {
        const ey = startY + i * spacing;

        // Circle marker
        pptxSlide.addShape('ellipse', {
          x: lineX - 0.12, y: ey + 0.05, w: 0.27, h: 0.27,
          fill: { color: accentColor },
        });

        // Date
        pptxSlide.addText(event.date, {
          x: lineX + 0.3, y: ey - 0.1, w: 2.0, h: 0.3,
          fontSize: 12, fontFace: headerFont, color: accentColor, bold: true,
        });

        // Title
        pptxSlide.addText(event.title, {
          x: lineX + 0.3, y: ey + 0.2, w: 7.0, h: 0.3,
          fontSize: 14, fontFace: bodyFont, color: textColor, bold: true,
        });

        // Description
        if (event.description) {
          pptxSlide.addText(event.description, {
            x: lineX + 0.3, y: ey + 0.5, w: 7.0, h: 0.4,
            fontSize: 11, fontFace: bodyFont, color: bodyTextColor,
          });
        }
      });
    } else {
      // Horizontal timeline
      const lineY = contentY + 0.5;
      const spacing = 8.5 / Math.max(events.length - 1, 1);
      const startX = 0.75;
      const lineW = spacing * (events.length - 1);

      // Main connector line with rounded caps
      pptxSlide.addShape('roundRect', {
        x: startX, y: lineY - 0.02, w: lineW + 0.3, h: 0.04,
        fill: { color: accentColor }, rectRadius: 0.02,
      });

      // Arrowhead at end
      pptxSlide.addText('▶', {
        x: startX + lineW + 0.15, y: lineY - 0.2, w: 0.4, h: 0.4,
        fontSize: 10, fontFace: bodyFont, color: accentColor, align: 'center', valign: 'middle',
      });

      events.forEach((event, i) => {
        const ex = startX + i * spacing;
        const isAlt = i % 2 === 1;

        // Circle marker with white fill + accent border
        pptxSlide.addShape('ellipse', {
          x: ex - 0.16, y: lineY - 0.16, w: 0.32, h: 0.32,
          fill: { color: background },
          line: { color: accentColor, width: 2.5 },
        });

        // Inner dot
        pptxSlide.addShape('ellipse', {
          x: ex - 0.08, y: lineY - 0.08, w: 0.16, h: 0.16,
          fill: { color: accentColor },
        });

        // Date above (or below for alternating)
        const dateY = isAlt ? lineY + 0.45 : lineY - 0.8;
        pptxSlide.addText(event.date, {
          x: ex - 0.9, y: dateY, w: 2.1, h: 0.35,
          fontSize: 12, fontFace: headerFont, color: accentColor, bold: true, align: 'center',
        });

        // Title
        const titleY = isAlt ? lineY - 0.8 : lineY + 0.45;
        pptxSlide.addText(event.title, {
          x: ex - 0.9, y: titleY + (isAlt ? 0.3 : 0), w: 2.1, h: 0.35,
          fontSize: 12, fontFace: bodyFont, color: textColor, bold: true, align: 'center',
        });

        // Description
        if (event.description) {
          const descY = isAlt ? lineY - 0.4 : lineY + 0.8;
          pptxSlide.addText(event.description, {
            x: ex - 0.9, y: descY, w: 2.1, h: 0.4,
            fontSize: 10, fontFace: bodyFont, color: bodyTextColor, align: 'center',
          });
        }
      });
    }
  }

  private buildMetricCardsSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.metricCardsData;
    if (!data || !data.cards.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Metric cards data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    // Description (rendered below title only in full mode; split mode renders it in the text region)
    const isSplitLayout = slide.layout && slide.layout !== 'full';
    const descOffset = isSplitLayout ? 0 : this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    const regions = this.getLayoutRegions(slide.layout, contentY, contentH);
    const hasSplit = regions.text.w > 0;

    const cards = data.cards;
    const columns = data.columns || (cards.length <= 2 ? 2 : cards.length <= 4 ? cards.length : 4);
    const rows = Math.ceil(cards.length / columns);
    const cardW = (hasSplit ? regions.visual.w : 9.0) / columns - 0.3;
    const cardH = (hasSplit ? contentH : contentH) / rows - 0.2;

    // Trend arrow characters
    const getTrendArrow = (trend?: string): string => {
      switch (trend) { case 'up': return '▲'; case 'down': return '▼'; case 'flat': return '─'; default: return ''; }
    };

    const getTrendColor = (trend?: string, cardColor?: string): string => {
      if (cardColor) return cardColor.replace('#', '');
      switch (trend) { case 'up': return '10B981'; case 'down': return 'EF4444'; case 'flat': return '94A3B8'; default: return accentColor; }
    };

    cards.forEach((card, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const cx = (hasSplit ? regions.visual.x : 0.5) + col * (cardW + 0.3);
      const cy = contentY + row * (cardH + 0.2);
      const trendColor = getTrendColor(card.trend, card.color);

      // Card background
      const cardBg = this.themeName === 'dark' ? '1A1A1A' : 'FFFFFF';
      pptxSlide.addShape('roundRect', {
        x: cx, y: cy, w: cardW, h: cardH,
        fill: { color: cardBg },
        line: { color: borderColor, width: 1 },
        rectRadius: 0.08,
      });

      // Top accent bar
      pptxSlide.addShape('rect', {
        x: cx, y: cy, w: cardW, h: 0.05,
        fill: { color: trendColor },
      });

      // Value (large)
      pptxSlide.addText(card.value, {
        x: cx, y: cy + 0.15, w: cardW, h: cardH * 0.35,
        fontSize: cards.length > 4 ? 28 : 36,
        fontFace: headerFont, color: trendColor, bold: true, align: 'center',
      });

      // Trend arrow + trendValue
      if (card.trend) {
        const arrow = getTrendArrow(card.trend);
        const trendText = card.trendValue ? `${arrow} ${card.trendValue}` : arrow;
        pptxSlide.addText(trendText, {
          x: cx, y: cy + cardH * 0.48, w: cardW, h: cardH * 0.2,
          fontSize: 14, fontFace: bodyFont, color: trendColor, align: 'center',
        });
      }

      // Label
      pptxSlide.addText(card.label, {
        x: cx, y: cy + cardH * 0.68, w: cardW, h: cardH * 0.28,
        fontSize: 13, fontFace: bodyFont, color: bodyTextColor, align: 'center',
      });
    });

    // Description in split text region
    if (hasSplit && slide.description) {
      pptxSlide.addText(slide.description, {
        x: regions.text.x, y: regions.text.y, w: regions.text.w, h: regions.text.h,
        fontSize: 14, fontFace: bodyFont, color: bodyTextColor, valign: 'top',
      });
    }
  }

  // ============ Phase 2: Strategic Slide Builders ============

  private buildSwotSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.swotData;
    if (!data) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'SWOT data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const contentH = 5.0 - contentY;

    const quadrants = [
      { key: 'S', emoji: '💪', label: 'STRENGTHS', items: data.strengths, color: '10B981', x: 0.5, y: contentY, w: 4.5, h: contentH / 2 },
      { key: 'W', emoji: '⚠️', label: 'WEAKNESSES', items: data.weaknesses, color: 'EF4444', x: 0.5, y: contentY + contentH / 2, w: 4.5, h: contentH / 2 },
      { key: 'O', emoji: '🚀', label: 'OPPORTUNITIES', items: data.opportunities, color: '3B82F6', x: 5.2, y: contentY, w: 4.5, h: contentH / 2 },
      { key: 'T', emoji: '🔥', label: 'THREATS', items: data.threats, color: 'F59E0B', x: 5.2, y: contentY + contentH / 2, w: 4.5, h: contentH / 2 },
    ];

    const quadBg = this.themeName === 'dark' ? '1A1A1A' : 'F8F8F8';

    quadrants.forEach((q) => {
      pptxSlide.addShape('roundRect', {
        x: q.x, y: q.y, w: q.w, h: q.h,
        fill: { color: quadBg }, line: { color: q.color, width: 1.5 },
        rectRadius: 0.12,
        shadow: { type: 'outer', blur: 3, offset: 1, angle: 90, color: '000000', opacity: 0.08 },
      });
      pptxSlide.addShape('roundRect', {
        x: q.x, y: q.y, w: q.w, h: 0.45, fill: { color: q.color },
        rectRadius: 0.12,
      });
      // Cover bottom corners of header to match roundRect
      pptxSlide.addShape('rect', {
        x: q.x, y: q.y + 0.33, w: q.w, h: 0.12, fill: { color: q.color },
      });
      pptxSlide.addText(`${q.emoji}  ${q.label}`, {
        x: q.x + 0.2, y: q.y + 0.02, w: q.w - 0.4, h: 0.41,
        fontSize: 13, fontFace: headerFont, color: 'FFFFFF', bold: true, valign: 'middle',
      });
      const itemText = q.items.map((item) => ({ text: item, options: { breakLine: true, bullet: true } }));
      pptxSlide.addText(itemText, {
        x: q.x + 0.25, y: q.y + 0.55, w: q.w - 0.5, h: q.h - 0.65,
        fontSize: 12, fontFace: bodyFont, color: bodyTextColor, valign: 'top',
      });
    });
  }

  private buildFunnelSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.funnelData;
    if (!data || !data.stages.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Funnel data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const stages = data.stages;
    const totalValue = stages[0]?.value || 1;
    const prefix = data.valuePrefix || '';
    const suffix = data.valueSuffix || '';
    const maxWidth = 8.0;
    const minWidth = 2.5;
    const stageH = 0.65;
    const gap = 0.12;
    const totalH = stages.reduce((sum, _, i) => sum + (i === 0 ? stageH * 1.2 : stageH) + gap, 0);
    const startY = contentY + (4.2 - totalH) / 2;

    // Generate gradient colors from accent if no custom colors
    const defaultColors = stages.map((_, i) => {
      const t = i / Math.max(stages.length - 1, 1);
      const r = parseInt(accentColor.slice(0, 2), 16);
      const g = parseInt(accentColor.slice(2, 4), 16);
      const b = parseInt(accentColor.slice(4, 6), 16);
      const nr = Math.round(r + (255 - r) * t * 0.4).toString(16).padStart(2, '0');
      const ng = Math.round(g + (255 - g) * t * 0.4).toString(16).padStart(2, '0');
      const nb = Math.round(b + (255 - b) * t * 0.4).toString(16).padStart(2, '0');
      return nr + ng + nb;
    });

    let currentY = startY;
    stages.forEach((stage, i) => {
      const ratio = stage.value / totalValue;
      const width = minWidth + (maxWidth - minWidth) * Math.pow(ratio, 0.7);
      const x = (10 - width) / 2;
      const thisStageH = i === 0 ? stageH * 1.2 : stageH;
      const stageColor = stage.color ? stage.color.replace('#', '') : defaultColors[i];

      pptxSlide.addShape('roundRect', {
        x, y: currentY, w: width, h: thisStageH,
        fill: { color: stageColor }, rectRadius: 0.08,
        shadow: { type: 'outer', blur: 4, offset: 2, angle: 90, color: '000000', opacity: 0.15 },
      });

      const displayValue = prefix || suffix
        ? `${prefix}${stage.value.toLocaleString()}${suffix}`
        : stage.value.toLocaleString();

      pptxSlide.addText(`${stage.label}: ${displayValue}`, {
        x: x + 0.3, y: currentY, w: width - 0.6, h: thisStageH,
        fontSize: i === 0 ? 14 : 13, fontFace: bodyFont, color: 'FFFFFF', bold: true, valign: 'middle', align: 'center',
      });

      const overallPct = ((stage.value / totalValue) * 100).toFixed(1);
      pptxSlide.addText(`${overallPct}%`, {
        x: x + width + 0.15, y: currentY, w: 1.2, h: thisStageH,
        fontSize: 11, fontFace: bodyFont, color: bodyTextColor, bold: true, valign: 'middle',
      });

      if (data.showPercentages && i > 0) {
        const prevValue = stages[i - 1].value;
        const pct = prevValue > 0 ? ((stage.value / prevValue) * 100).toFixed(1) : '0.0';
        const arrowY = currentY - gap;
        pptxSlide.addText('▼', {
          x: 0, y: arrowY - 0.05, w: 10, h: gap,
          fontSize: 12, fontFace: bodyFont, color: accentColor, align: 'center',
        });
        pptxSlide.addText(`${pct}% conversion`, {
          x: 0, y: arrowY + 0.1, w: 10, h: 0.18,
          fontSize: 10, fontFace: bodyFont, color: bodyTextColor, align: 'center',
        });
      }

      currentY += thisStageH + gap;
    });
  }

  private buildBeforeAfterSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.beforeAfterData;
    if (!data) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Before/after data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const panelW = 4.3;
    const panelH = 4.8 - descOffset;

    const leftColor = data.left.color ? data.left.color.replace('#', '') : 'EF4444';
    const rightColor = data.right.color ? data.right.color.replace('#', '') : '10B981';

    const panels = [
      { panelData: data.left, color: leftColor, x: 0.5 },
      { panelData: data.right, color: rightColor, x: 5.2 },
    ];

    panels.forEach((panel) => {
      pptxSlide.addShape('rect', {
        x: panel.x, y: contentY, w: panelW, h: panelH,
        fill: { color: this.themeName === 'dark' ? '1A1A1A' : 'F5F5F5' },
        line: { color: panel.color, width: 2 },
      });
      pptxSlide.addShape('rect', {
        x: panel.x, y: contentY, w: panelW, h: 0.45, fill: { color: panel.color },
      });
      pptxSlide.addText(panel.panelData.label.toUpperCase(), {
        x: panel.x + 0.2, y: contentY + 0.02, w: panelW - 0.4, h: 0.41,
        fontSize: 14, fontFace: headerFont, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle',
      });
      const lines = panel.panelData.content.split('\n').filter((l: string) => l.trim());
      const bulletItems = lines.map((line: string) => ({ text: line, options: { breakLine: true, bullet: true } }));
      pptxSlide.addText(bulletItems, {
        x: panel.x + 0.25, y: contentY + 0.55, w: panelW - 0.5, h: panelH - 0.65,
        fontSize: 12, fontFace: bodyFont, color: bodyTextColor, valign: 'top',
      });
    });

    pptxSlide.addText('→', {
      x: 4.55, y: contentY + panelH / 2 - 0.3, w: 0.9, h: 0.6,
      fontSize: 28, fontFace: bodyFont, color: accentColor, bold: true, align: 'center', valign: 'middle',
    });
  }

  private buildProcessSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.processData;
    if (!data || !data.steps.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Process data missing' });
      return;
    }

    pptxSlide.background = { color: background };

    pptxSlide.addText(slide.title, {
      x: 0.5, y: 0.3, w: '90%', h: 0.8,
      fontSize: 36, fontFace: headerFont, color: textColor, bold: true,
    });
    pptxSlide.addShape('rect', {
      x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor },
    });

    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.3 + descOffset;
    const steps = data.steps;
    const orientation = data.orientation || 'horizontal';
    const showNumbers = data.showNumbers !== false;
    const showArrows = data.showArrows !== false;

    if (orientation === 'vertical' || steps.length > 5) {
      const lineX = 1.2;
      const spacing = 3.6 / Math.max(steps.length, 1);

      pptxSlide.addShape('rect', {
        x: lineX, y: contentY, w: 0.03, h: spacing * (steps.length - 1) + 0.3,
        fill: { color: accentColor },
      });

      steps.forEach((step, i) => {
        const sy = contentY + i * spacing;
        pptxSlide.addShape('ellipse', {
          x: lineX - 0.12, y: sy + 0.05, w: 0.27, h: 0.27, fill: { color: accentColor },
        });
        if (showNumbers) {
          pptxSlide.addText(String(step.number), {
            x: lineX - 0.12, y: sy + 0.05, w: 0.27, h: 0.27,
            fontSize: 11, fontFace: headerFont, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle',
          });
        }
        pptxSlide.addText(step.title, {
          x: lineX + 0.35, y: sy - 0.05, w: 7.5, h: 0.3,
          fontSize: 14, fontFace: bodyFont, color: textColor, bold: true,
        });
        if (step.description) {
          pptxSlide.addText(step.description, {
            x: lineX + 0.35, y: sy + 0.25, w: 7.5, h: 0.35,
            fontSize: 11, fontFace: bodyFont, color: bodyTextColor,
          });
        }
      });
    } else {
      const cardW = 8.5 / steps.length - 0.25;
      const cardH = 3.5;
      const arrowW = 0.25;

      steps.forEach((step, i) => {
        const cx = 0.75 + i * (cardW + arrowW);
        pptxSlide.addShape('roundRect', {
          x: cx, y: contentY + 0.4, w: cardW, h: cardH,
          fill: { color: this.themeName === 'dark' ? '1A1A1A' : 'FFFFFF' },
          line: { color: accentColor, width: 1.5 }, rectRadius: 0.1,
          shadow: { type: 'outer', blur: 4, offset: 2, angle: 90, color: '000000', opacity: 0.1 },
        });
        if (showNumbers) {
          pptxSlide.addShape('ellipse', {
            x: cx + cardW / 2 - 0.2, y: contentY + 0.15, w: 0.4, h: 0.4, fill: { color: accentColor },
          });
          pptxSlide.addText(String(step.number), {
            x: cx + cardW / 2 - 0.2, y: contentY + 0.15, w: 0.4, h: 0.4,
            fontSize: 14, fontFace: headerFont, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle',
          });
        }
        pptxSlide.addText(step.title, {
          x: cx + 0.15, y: contentY + 0.7, w: cardW - 0.3, h: 0.5,
          fontSize: 14, fontFace: bodyFont, color: textColor, bold: true, align: 'center',
        });
        if (step.description) {
          pptxSlide.addText(step.description, {
            x: cx + 0.15, y: contentY + 1.3, w: cardW - 0.3, h: cardH - 1.4,
            fontSize: 11, fontFace: bodyFont, color: bodyTextColor, align: 'center',
          });
        }
        if (showArrows && i < steps.length - 1) {
          pptxSlide.addText('→', {
            x: cx + cardW, y: contentY + 1.8, w: arrowW, h: 0.5,
            fontSize: 18, fontFace: bodyFont, color: accentColor, bold: true, align: 'center', valign: 'middle',
          });
        }
      });
    }
  }

  // ============ Phase 3: Specialized Slide Builders ============

  private buildKanbanSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, borderColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.kanbanData;
    if (!data || !data.columns.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Kanban data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const cols = data.columns;
    const colW = 8.8 / cols.length - 0.2;
    // Available height for columns (leave room for footer/disclaimer)
    const colAreaH = Math.min(4.0, 5.0 - contentY - 0.1);
    const headerH = 0.4;
    const cardGap = 0.07;
    const maxCardsAcrossCols = Math.max(...cols.map((c) => c.cards.length), 1);
    // Size cards so the tallest column fits within colAreaH below the header
    const cardH = Math.min(0.45, Math.max(0.22, (colAreaH - headerH - 0.1 - cardGap * (maxCardsAcrossCols - 1)) / maxCardsAcrossCols));
    cols.forEach((col, i) => {
      const cx = 0.6 + i * (colW + 0.2);
      const colColor = col.color ? col.color.replace('#', '') : accentColor;
      // Column background tint (sized to available area)
      pptxSlide.addShape('roundRect', { x: cx - 0.05, y: contentY - 0.05, w: colW + 0.1, h: colAreaH, fill: { color: this.themeName === 'dark' ? '111111' : 'F0F0F0' }, rectRadius: 0.08 });
      // Rounded header
      pptxSlide.addShape('roundRect', { x: cx, y: contentY, w: colW, h: headerH, fill: { color: colColor }, rectRadius: 0.06 });
      pptxSlide.addText(`${col.header} (${col.cards.length})`, { x: cx, y: contentY, w: colW, h: headerH, fontSize: 12, fontFace: headerFont, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle' });
      col.cards.forEach((card, ci) => {
        const cy = contentY + headerH + 0.1 + ci * (cardH + cardGap);
        pptxSlide.addShape('roundRect', { x: cx + 0.08, y: cy, w: colW - 0.16, h: cardH, fill: { color: this.themeName === 'dark' ? '1A1A1A' : 'FFFFFF' }, line: { color: borderColor, width: 0.5 }, rectRadius: 0.06, shadow: { type: 'outer', blur: 2, offset: 1, angle: 90, color: '000000', opacity: 0.06 } });
        pptxSlide.addText(card, { x: cx + 0.15, y: cy, w: colW - 0.3, h: cardH, fontSize: 11, fontFace: bodyFont, color: bodyTextColor, valign: 'middle' });
      });
    });
  }

  private buildPyramidSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.pyramidData;
    if (!data || !data.levels.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Pyramid data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.3 + descOffset;
    const reverse = data.orientation === 'bottom-up';
    const levels = reverse ? [...data.levels].reverse() : data.levels;
    const maxW = 8.5;
    const minW = 2.0;
    const levelH = 0.6;
    const descRowH = 0.3; // extra space below each bar for optional description
    const rowPitch = levelH + descRowH;
    const totalH = levels.length * rowPitch - (levels.length > 0 ? descRowH : 0);
    const startY = contentY + (4.2 - totalH) / 2;
    levels.forEach((level, i) => {
      const ratio = (levels.length - i) / levels.length;
      const w = minW + (maxW - minW) * ratio;
      const x = (10 - w) / 2;
      const y = startY + i * rowPitch;
      const color = level.color ? level.color.replace('#', '') : accentColor;
      pptxSlide.addShape('roundRect', { x, y, w, h: levelH, fill: { color }, rectRadius: 0.06,
        shadow: { type: 'outer', blur: 3, offset: 1, angle: 90, color: '000000', opacity: 0.12 } });
      pptxSlide.addText(level.label, { x: x + 0.3, y, w: w - 0.6, h: levelH, fontSize: 14, fontFace: bodyFont, color: 'FFFFFF', bold: true, valign: 'middle', align: 'center' });
      if (level.description) {
        // Render description below the bar, clamped to the bar width (always non-negative)
        pptxSlide.addText(level.description, { x, y: y + levelH + 0.02, w: w, h: descRowH - 0.04, fontSize: 10, fontFace: bodyFont, color: bodyTextColor, align: 'center', valign: 'top' });
      }
    });
  }

  private buildRadialProgressSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor, borderColor } = this.theme;
    const data = slide.radialProgressData;
    if (!data || !data.items.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Radial progress data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const items = data.items;
    const cols = Math.min(items.length, 4);
    const ringD = 1.3; // ring diameter
    const spacing = 9.0 / cols;
    const trackColor = this.themeName === 'dark' ? '333333' : 'E5E5E5';
    items.forEach((item, i) => {
      const cx = 0.75 + i * spacing + spacing / 2;
      const cy = contentY + 1.0;
      const clampedVal = Math.max(0, Math.min(100, item.value));
      const color = item.color ? item.color.replace('#', '') : accentColor;
      // Build a doughnut chart: [progress, remainder]
      const doughnutData = [
        { name: 'Progress', labels: ['Done', 'Remaining'], values: [clampedVal, 100 - clampedVal] },
      ];
      try {
        pptxSlide.addChart((this.pptx as any).charts.DOUGHNUT, doughnutData, {
          x: cx - ringD / 2,
          y: cy,
          w: ringD,
          h: ringD,
          showLegend: false,
          showTitle: false,
          showValue: false,
          showPercent: false,
          chartColors: [color, trackColor],
          dataBorder: { color, pt: 0 },
          holeSize: 60,
        });
      } catch {
        // Fallback: static ellipse rings (non-proportional) if doughnut unsupported
        pptxSlide.addShape('ellipse', { x: cx - ringD / 2, y: cy, w: ringD, h: ringD, fill: { color: trackColor } });
        const fillR = (ringD / 2) * 0.7;
        pptxSlide.addShape('ellipse', { x: cx - fillR, y: cy + (ringD / 2) - fillR, w: fillR * 2, h: fillR * 2, fill: { color } });
      }
      // Center value (overlaid on the doughnut hole)
      pptxSlide.addText(`${Math.round(clampedVal)}%`, { x: cx - ringD / 2, y: cy, w: ringD, h: ringD, fontSize: 18, fontFace: headerFont, color: textColor, bold: true, align: 'center', valign: 'middle' });
      // Label below
      pptxSlide.addText(item.label, { x: cx - spacing / 2 + 0.3, y: cy + ringD + 0.15, w: spacing - 0.6, h: 0.5, fontSize: 12, fontFace: bodyFont, color: bodyTextColor, align: 'center' });
    });
  }

  private buildIconGridSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor, borderColor } = this.theme;
    const data = slide.iconGridData;
    if (!data || !data.items.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Icon grid data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const layout = data.layout || '3x2';
    const cols = parseInt(layout.split('x')[0]) || 3;
    const rows = parseInt(layout.split('x')[1]) || 2;
    const cardW = 9.0 / cols - 0.25;
    const cardH = 3.6 / rows - 0.2;
    data.items.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = 0.5 + col * (cardW + 0.25);
      const cy = contentY + row * (cardH + 0.2);
      pptxSlide.addShape('roundRect', { x: cx, y: cy, w: cardW, h: cardH, fill: { color: this.themeName === 'dark' ? '1A1A1A' : 'FFFFFF' }, line: { color: borderColor, width: 1 }, rectRadius: 0.08 });
      pptxSlide.addText(item.icon, { x: cx, y: cy + 0.15, w: cardW, h: cardH * 0.3, fontSize: 24, align: 'center' });
      pptxSlide.addText(item.title, { x: cx + 0.1, y: cy + cardH * 0.4, w: cardW - 0.2, h: cardH * 0.25, fontSize: 14, fontFace: bodyFont, color: textColor, bold: true, align: 'center' });
      pptxSlide.addText(item.desc, { x: cx + 0.15, y: cy + cardH * 0.65, w: cardW - 0.3, h: cardH * 0.3, fontSize: 11, fontFace: bodyFont, color: bodyTextColor, align: 'center' });
    });
  }

  private buildComparisonMatrixSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.comparisonMatrixData;
    if (!data || !data.headers.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Comparison matrix data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const headers = data.headers;
    const colW = 9.0 / headers.length;
    const allRows: any[] = [];
    // Theme-aware winner styling
    const winnerFg = '10B981'; // emerald green (readable on both themes)
    const winnerBg = this.themeName === 'dark' ? '0F2E1F' : 'F0FDF4'; // dark green tint on dark theme, light green on light
    // Header row
    allRows.push(headers.map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: accentColor }, align: 'center' as const, fontSize: 12 } })));
    // Data rows
    data.rows.forEach((row) => {
      const cells = headers.map((h, hi) => {
        const val = hi === 0 ? row.criteria : (row[headers[hi]] || '');
        const isWinner = data.showWinner && row.winner === headers[hi];
        return {
          text: val,
          options: {
            fontSize: 11,
            color: isWinner ? winnerFg : bodyTextColor,
            bold: isWinner,
            fill: isWinner ? { color: winnerBg } : undefined,
          },
        };
      });
      allRows.push(cells);
    });
    pptxSlide.addTable(allRows, { x: 0.5, y: contentY, w: 9.0, colW: headers.map(() => colW), rowH: 0.38, border: { type: 'solid' as const, color: 'CCCCCC', pt: 0.5 }, autoPage: false });
  }

  private buildQuoteSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.quoteData;
    if (!data) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Quote data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    // Large decorative quote mark
    pptxSlide.addText('"', { x: 0.8, y: 1.2, w: 1.5, h: 1.5, fontSize: 72, fontFace: headerFont, color: accentColor, bold: true });
    pptxSlide.addText(data.quote, { x: 1.5, y: 2.0, w: 7.5, h: 2.0, fontSize: 24, fontFace: bodyFont, color: textColor, italic: true, align: 'center', valign: 'middle' });
    if (data.attribution) {
      pptxSlide.addText(`— ${data.attribution}${data.role ? `, ${data.role}` : ''}`, { x: 0.5, y: 4.0, w: '90%', h: 0.5, fontSize: 16, fontFace: bodyFont, color: bodyTextColor, align: 'center' });
    }
    // Title as context
    if (slide.title) {
      pptxSlide.addText(slide.title, { x: 0.5, y: 4.6, w: '90%', h: 0.4, fontSize: 12, fontFace: bodyFont, color: bodyTextColor, align: 'center', italic: true });
    }
    if (slide.description) {
      pptxSlide.addText(slide.description, { x: 1.0, y: 4.9, w: '80%', h: 0.4, fontSize: 11, fontFace: bodyFont, color: bodyTextColor, align: 'center', italic: true });
    }
  }

  private buildAgendaSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor, borderColor } = this.theme;
    const data = slide.agendaData;
    if (!data || !data.items.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Agenda data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title || 'Agenda', { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const numbered = data.numbered !== false;
    const spacing = 3.8 / Math.max(data.items.length, 1);
    data.items.forEach((item, i) => {
      const iy = contentY + i * spacing;
      const num = item.number || (i + 1);
      if (numbered) {
        pptxSlide.addShape('ellipse', { x: 0.7, y: iy + 0.1, w: 0.45, h: 0.45, fill: { color: accentColor } });
        pptxSlide.addText(String(num), { x: 0.7, y: iy + 0.1, w: 0.45, h: 0.45, fontSize: 16, fontFace: headerFont, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle' });
      }
      pptxSlide.addText(item.title, { x: numbered ? 1.4 : 0.7, y: iy + 0.05, w: 7.5, h: 0.35, fontSize: 18, fontFace: bodyFont, color: textColor, bold: true, valign: 'middle' });
      if (item.description) {
        pptxSlide.addText(item.description, { x: numbered ? 1.4 : 0.7, y: iy + 0.4, w: 7.5, h: 0.3, fontSize: 12, fontFace: bodyFont, color: bodyTextColor, valign: 'top' });
      }
      if (i < data.items.length - 1) {
        pptxSlide.addShape('rect', { x: numbered ? 1.4 : 0.7, y: iy + spacing - 0.05, w: 7.5, h: 0.01, fill: { color: borderColor } });
      }
    });
  }

  private buildTeamSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor, borderColor } = this.theme;
    const data = slide.teamData;
    if (!data || !data.members.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Team data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    const cols = data.columns || Math.min(data.members.length, 4);
    const rows = Math.ceil(data.members.length / cols);
    const cardW = 9.0 / cols - 0.3;
    // Dynamic card height: fit available content area across rows (with gaps), capped at 3.5
    const availableH = 5.0 - contentY;
    const gapV = 0.15;
    const cardH = Math.min(3.5, Math.max(1.8, (availableH - gapV * (rows - 1)) / rows));
    // Scale internal offsets relative to cardH so layout stays proportional
    const avatarD = 0.9;
    const nameY = avatarD + 0.3;
    const roleY = nameY + 0.35;
    const bioY = roleY + 0.4;
    data.members.forEach((member, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = 0.5 + col * (cardW + 0.3);
      const cy = contentY + row * (cardH + gapV);
      pptxSlide.addShape('roundRect', { x: cx, y: cy, w: cardW, h: cardH, fill: { color: this.themeName === 'dark' ? '1A1A1A' : 'FFFFFF' }, line: { color: borderColor, width: 1 }, rectRadius: 0.08 });
      // Avatar placeholder
      const avatarX = cx + cardW / 2 - avatarD / 2;
      const avatarY = cy + 0.15;
      pptxSlide.addShape('ellipse', { x: avatarX, y: avatarY, w: avatarD, h: avatarD, fill: { color: accentColor } });
      pptxSlide.addText(member.name.charAt(0).toUpperCase(), { x: avatarX, y: avatarY, w: avatarD, h: avatarD, fontSize: 28, fontFace: headerFont, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle' });
      pptxSlide.addText(member.name, { x: cx + 0.1, y: cy + nameY, w: cardW - 0.2, h: 0.35, fontSize: 16, fontFace: bodyFont, color: textColor, bold: true, align: 'center' });
      pptxSlide.addText(member.role, { x: cx + 0.1, y: cy + roleY, w: cardW - 0.2, h: 0.3, fontSize: 12, fontFace: bodyFont, color: accentColor, align: 'center' });
      if (member.bio) {
        const bioH = Math.max(0.2, cardH - bioY - 0.1);
        pptxSlide.addText(member.bio, { x: cx + 0.15, y: cy + bioY, w: cardW - 0.3, h: bioH, fontSize: 10, fontFace: bodyFont, color: bodyTextColor, align: 'center' });
      }
    });
  }

  private buildGeoSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { background, textColor, accentColor, headerFont, bodyFont, bodyTextColor } = this.theme;
    const data = slide.geoData;
    if (!data || !data.markers.length) {
      this.buildContentSlide(pptxSlide, { ...slide, type: 'content', content: 'Geo data missing' });
      return;
    }
    pptxSlide.background = { color: background };
    pptxSlide.addText(slide.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 36, fontFace: headerFont, color: textColor, bold: true });
    pptxSlide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.04, fill: { color: accentColor } });
    const descOffset = this.renderDescription(pptxSlide, slide.description, 0.3, 0.8);
    const contentY = 1.2 + descOffset;
    // Simplified map: world rectangle outline
    pptxSlide.addShape('rect', { x: 0.8, y: contentY, w: 8.4, h: 3.6, fill: { color: this.themeName === 'dark' ? '1A1A1A' : 'F5F5F5' }, line: { color: accentColor, width: 1 } });
    pptxSlide.addText('🌍', { x: 3.5, y: contentY + 1.2, w: 3, h: 1, fontSize: 48, align: 'center' });
    // Place markers approximately positioned within the rectangle
    data.markers.forEach((marker) => {
      // Normalize lat/lng to rectangle coordinates (very rough approximation)
      const lngNorm = (marker.lng + 180) / 360;
      const latNorm = 1 - (marker.lat + 90) / 180;
      const mx = 0.8 + lngNorm * 8.4;
      const my = contentY + latNorm * 3.6;
      const dotSize = marker.size === 'large' ? 0.3 : marker.size === 'small' ? 0.16 : 0.22;
      pptxSlide.addShape('ellipse', { x: mx - dotSize / 2, y: my - dotSize / 2, w: dotSize, h: dotSize, fill: { color: accentColor } });
      pptxSlide.addText(marker.label, { x: mx - 1.0, y: my + dotSize / 2 + 0.02, w: 2.0, h: 0.25, fontSize: 9, fontFace: bodyFont, color: bodyTextColor, align: 'center' });
    });
  }

  // ============ Helper Methods ============

  /**
   * Generate a harmonious color palette from a base accent color.
   * Creates different hues by shifting HSL values for multi-series charts.
   */
  private generateColorPalette(baseHex: string, count: number): string[] {
    const hex = baseHex.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    // If single series, just return the accent color
    if (count <= 1) return [hex];

    const palette: string[] = [];
    for (let i = 0; i < count; i++) {
      // Vary hue by 30 degrees per series, keep saturation/value
      const hueShift = i * (360 / count);
      const [h, s, l] = this.rgbToHsl(r, g, b);
      const newHue = (h + hueShift) % 360;
      const [nr, ng, nb] = this.hslToRgb(newHue, s, l);
      palette.push(
        Math.round(nr).toString(16).padStart(2, '0') +
        Math.round(ng).toString(16).padStart(2, '0') +
        Math.round(nb).toString(16).padStart(2, '0')
      );
    }
    return palette;
  }

  private rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const nr = r / 255, ng = g / 255, nb = b / 255;
    const max = Math.max(nr, ng, nb), min = Math.min(nr, ng, nb);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === nr) h = ((ng - nb) / d + (ng < nb ? 6 : 0)) * 60;
    else if (max === ng) h = ((nb - nr) / d + 2) * 60;
    else h = ((nr - ng) / d + 4) * 60;
    return [h, s, l];
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  /**
   * Parse markdown-style content to bullet points
   */
  private parseMarkdownToBullets(content: string): TextProps[] {
    const lines = content.split('\n').filter((l) => l.trim());
    return lines.map((line) => {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      return { text: cleaned, options: { breakLine: true } };
    });
  }
}

// ============ Convenience Function ============

export async function generatePptx(options: PptxOptions): Promise<PptxResult> {
  const builder = new PptxBuilder(options);
  return builder.generate();
}
