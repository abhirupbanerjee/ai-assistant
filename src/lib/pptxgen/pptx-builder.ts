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
  ColorScheme,
  ImageStyle,
} from '@/types/pptx-gen';
import type { ImageGenToolArgs } from '@/types/image-gen';
import { getTheme, buildCustomTheme } from './themes';
import { generateImage, isImageGenEnabled } from '../image-gen/provider-factory';
import { type DisclaimerConfig } from '../disclaimer';

// ============ Builder Options ============

export interface PptxOptions {
  title: string;
  slides: SlideDefinition[];
  theme?: ThemeName;
  colorScheme?: ColorScheme;
  organizationName?: string;
  disclaimerConfig?: DisclaimerConfig | null;
}

// ============ Text Props Type ============

interface TextProps {
  text: string;
  options?: { breakLine?: boolean };
}

// ============ PPTX Builder Class ============

export class PptxBuilder {
  private pptx: PptxGenJS;
  private theme: ThemeConfig;
  private options: PptxOptions;
  private imageSlideCount: number = 0;
  private failedImageCount: number = 0;
  private imageGenAvailable: boolean = false;

  constructor(options: PptxOptions) {
    this.options = options;
    this.theme = options.colorScheme
      ? buildCustomTheme(options.colorScheme)
      : getTheme(options.theme || 'corporate');

    this.pptx = new PptxGenJS();
    this.initializePresentation();
  }

  private initializePresentation(): void {
    this.pptx.author = this.options.organizationName || 'Policy Bot';
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
      default:
        this.buildContentSlide(pptxSlide, slide);
    }

    // Add AI disclaimer footer if enabled
    if (this.options.disclaimerConfig?.enabled) {
      pptxSlide.addText(this.options.disclaimerConfig.fullText, {
        x: 0.5,
        y: 5.1, // Near bottom of 16:9 slide (5.625" height)
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

  // ============ Slide Builders ============

  private buildTitleSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { primary, secondary, headerFont, bodyFont } = this.theme;

    if (this.theme.darkTitleSlide) {
      pptxSlide.background = { color: primary };
    }

    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 2.5,
      w: '90%',
      h: 1.5,
      fontSize: 44,
      fontFace: headerFont,
      color: this.theme.darkTitleSlide ? 'FFFFFF' : primary,
      bold: true,
      align: 'center',
    });

    if (slide.content) {
      pptxSlide.addText(slide.content, {
        x: 0.5,
        y: 4.2,
        w: '90%',
        h: 0.8,
        fontSize: 20,
        fontFace: bodyFont,
        color: this.theme.darkTitleSlide ? secondary : '666666',
        align: 'center',
      });
    }
  }

  private buildContentSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { primary, headerFont, bodyFont } = this.theme;

    pptxSlide.background = { color: 'FFFFFF' };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: primary,
      bold: true,
    });

    // Content
    if (slide.content) {
      const bullets = this.parseMarkdownToBullets(slide.content);
      pptxSlide.addText(bullets, {
        x: 0.5,
        y: 1.3,
        w: '90%',
        h: 3.8,
        fontSize: 16,
        fontFace: bodyFont,
        color: '333333',
        bullet: { type: 'bullet' },
        lineSpacingMultiple: 1.5,
      });
    }
  }

  private buildTwoColumnSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { primary, headerFont, bodyFont } = this.theme;

    pptxSlide.background = { color: 'FFFFFF' };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: primary,
      bold: true,
    });

    // Left column
    if (slide.leftContent) {
      const leftBullets = this.parseMarkdownToBullets(slide.leftContent);
      pptxSlide.addText(leftBullets, {
        x: 0.5,
        y: 1.3,
        w: 4.5,
        h: 3.8,
        fontSize: 14,
        fontFace: bodyFont,
        color: '333333',
        bullet: { type: 'bullet' },
        lineSpacingMultiple: 1.4,
      });
    }

    // Right column
    if (slide.rightContent) {
      const rightBullets = this.parseMarkdownToBullets(slide.rightContent);
      pptxSlide.addText(rightBullets, {
        x: 5.2,
        y: 1.3,
        w: 4.5,
        h: 3.8,
        fontSize: 14,
        fontFace: bodyFont,
        color: '333333',
        bullet: { type: 'bullet' },
        lineSpacingMultiple: 1.4,
      });
    }
  }

  private buildComparisonSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { primary, secondary, headerFont, bodyFont } = this.theme;

    pptxSlide.background = { color: 'FFFFFF' };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: primary,
      bold: true,
    });

    // Left box
    pptxSlide.addShape('rect', {
      x: 0.5,
      y: 1.3,
      w: 4.5,
      h: 3.5,
      fill: { color: 'F5F5F5' },
      line: { color: primary, width: 2 },
    });

    if (slide.leftContent) {
      const leftBullets = this.parseMarkdownToBullets(slide.leftContent);
      pptxSlide.addText(leftBullets, {
        x: 0.7,
        y: 1.5,
        w: 4.1,
        h: 3.1,
        fontSize: 14,
        fontFace: bodyFont,
        color: '333333',
        bullet: { type: 'bullet' },
      });
    }

    // Right box
    pptxSlide.addShape('rect', {
      x: 5.2,
      y: 1.3,
      w: 4.5,
      h: 3.5,
      fill: { color: secondary },
      line: { color: primary, width: 2 },
    });

    if (slide.rightContent) {
      const rightBullets = this.parseMarkdownToBullets(slide.rightContent);
      pptxSlide.addText(rightBullets, {
        x: 5.4,
        y: 1.5,
        w: 4.1,
        h: 3.1,
        fontSize: 14,
        fontFace: bodyFont,
        color: '333333',
        bullet: { type: 'bullet' },
      });
    }
  }

  private buildStatsSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { primary, headerFont, bodyFont } = this.theme;

    pptxSlide.background = { color: 'FFFFFF' };

    // Title
    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 0.8,
      fontSize: 36,
      fontFace: headerFont,
      color: primary,
      bold: true,
    });

    // Stats grid
    const stats = slide.stats || [];
    const columns = Math.min(stats.length, 4);
    const cardWidth = columns > 0 ? 9.5 / columns - 0.3 : 2;

    stats.forEach((stat, index) => {
      const x = 0.5 + index * (cardWidth + 0.3);

      // Card background
      pptxSlide.addShape('rect', {
        x,
        y: 1.8,
        w: cardWidth,
        h: 2.5,
        fill: { color: 'F5F5F5' },
        line: { color: primary, width: 2 },
      });

      // Large number
      pptxSlide.addText(stat.value, {
        x,
        y: 2.0,
        w: cardWidth,
        h: 1.2,
        fontSize: 48,
        fontFace: headerFont,
        color: primary,
        bold: true,
        align: 'center',
      });

      // Label
      pptxSlide.addText(stat.label, {
        x,
        y: 3.2,
        w: cardWidth,
        h: 0.8,
        fontSize: 14,
        fontFace: bodyFont,
        color: '666666',
        align: 'center',
      });
    });
  }

  /**
   * Build an image slide
   * If image_gen is unavailable, falls back to content slide with narrative
   */
  private async buildImageSlide(
    pptxSlide: PptxGenJS.Slide,
    slide: SlideDefinition
  ): Promise<void> {
    const { primary, headerFont } = this.theme;

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
      // Generate image using image_gen tool
      const imageArgs: ImageGenToolArgs = {
        prompt: slide.imagePrompt,
        style: this.mapImageStyle(slide.imageStyle),
        aspectRatio: '16:9', // Match slide aspect ratio
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

      // Add full-bleed background image
      pptxSlide.addImage({
        data: `image/${extension};base64,${base64Image}`,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
        sizing: { type: 'cover', w: '100%', h: '100%' },
      });

      // Add title overlay with shadow for readability on image background
      pptxSlide.addText(slide.title, {
        x: 0.5,
        y: 4.1,
        w: '90%',
        h: 1.0,
        fontSize: 32,
        fontFace: headerFont,
        color: 'FFFFFF',
        bold: true,
        align: 'center',
        shadow: { type: 'outer', blur: 3, offset: 2, angle: 45, color: '000000', opacity: 0.6 },
      });

      this.imageSlideCount++;
      console.log(`[PptxBuilder] Image slide created with embedded image: "${slide.title}"`);
    } catch (error) {
      console.error(`[PptxBuilder] Image generation failed for slide "${slide.title}":`, error);
      this.failedImageCount++;

      // Fallback to content slide
      const fallbackSlide: SlideDefinition = {
        ...slide,
        type: 'content',
        content: `Visual: ${slide.imagePrompt}`,
      };
      this.buildContentSlide(pptxSlide, fallbackSlide);
    }
  }

  private buildClosingSlide(pptxSlide: PptxGenJS.Slide, slide: SlideDefinition): void {
    const { primary, secondary, headerFont, bodyFont } = this.theme;

    if (this.theme.darkTitleSlide) {
      pptxSlide.background = { color: primary };
    }

    pptxSlide.addText(slide.title, {
      x: 0.5,
      y: 2.2,
      w: '90%',
      h: 1.2,
      fontSize: 40,
      fontFace: headerFont,
      color: this.theme.darkTitleSlide ? 'FFFFFF' : primary,
      bold: true,
      align: 'center',
    });

    if (slide.content) {
      pptxSlide.addText(slide.content, {
        x: 0.5,
        y: 3.5,
        w: '90%',
        h: 1.0,
        fontSize: 18,
        fontFace: bodyFont,
        color: this.theme.darkTitleSlide ? secondary : '666666',
        align: 'center',
      });
    }
  }

  // ============ Helper Methods ============

  /**
   * Map slide imageStyle to image_gen style parameter
   */
  private mapImageStyle(style?: ImageStyle): ImageStyle {
    switch (style) {
      case 'infographic':
        return 'infographic';
      case 'photo':
        return 'photo';
      case 'illustration':
        return 'illustration';
      case 'diagram':
        return 'diagram';
      default:
        return 'infographic'; // Default to infographic for presentations
    }
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
