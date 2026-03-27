/**
 * PPTX Generation Tool
 *
 * Generates PowerPoint presentations (.pptx) with professional themes and layouts.
 * Supports optional AI image generation for image slides via image_gen integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition, ValidationResult } from '../tools';
import type {
  PptxGenToolArgs,
  PptxGenConfig,
  PptxGenResponse,
  SlideDefinition,
} from '@/types/pptx-gen';
import { getRequestContext } from '../request-context';
import { getToolConfig } from '../db/compat/tool-config';
import { generatePptx } from '../pptxgen/pptx-builder';
import { getOutputDirectory, generateDocumentFilename } from '../docgen/branding';
import { addThreadOutput, addWorkspaceOutput, getThreadContext } from '../db/compat/threads';
import { checkPayloadSize, checkMemoryForPptx } from '../memory-utils';
import { isImageGenEnabled } from '../image-gen/provider-factory';

// ============ Constants ============

/** Absolute maximum slides an admin can configure */
const ABSOLUTE_MAX_SLIDES = 50;

/** Absolute maximum image slides an admin can configure */
const ABSOLUTE_MAX_IMAGE_SLIDES = 50;

/** Maximum payload size in MB */
const MAX_PAYLOAD_MB = 5;

// ============ Default Configuration ============

export const PPTX_GEN_DEFAULTS: PptxGenConfig = {
  defaultTheme: 'corporate',
  maxSlides: 12,
  maxImageSlides: 3,
  enableImageGeneration: true,
  branding: {
    enabled: false,
    logoUrl: '',
    organizationName: '',
  },
};

// ============ Config Schema ============

const pptxGenConfigSchema = {
  type: 'object',
  properties: {
    defaultTheme: {
      type: 'string',
      title: 'Default Theme',
      enum: ['corporate', 'modern', 'minimal', 'bold'],
      default: 'corporate',
    },
    maxSlides: {
      type: 'number',
      title: 'Max Slides',
      description: 'Maximum slides per presentation',
      minimum: 5,
      maximum: 50,
      default: 12,
    },
    maxImageSlides: {
      type: 'number',
      title: 'Max Image Slides',
      description: 'Maximum AI-generated image slides per presentation',
      minimum: 0,
      maximum: 50,
      default: 3,
    },
    enableImageGeneration: {
      type: 'boolean',
      title: 'Enable AI Image Slides',
      description: 'Allow AI-generated full-bleed image slides (requires image_gen tool)',
      default: true,
    },
    branding: {
      type: 'object',
      title: 'Branding',
      properties: {
        enabled: { type: 'boolean', default: false },
        logoUrl: { type: 'string', default: '' },
        organizationName: { type: 'string', default: '' },
      },
    },
  },
};

// ============ Validation ============

function validatePptxGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.maxSlides !== undefined) {
    const max = config.maxSlides as number;
    if (typeof max !== 'number' || max < 5 || max > ABSOLUTE_MAX_SLIDES) {
      errors.push(`maxSlides must be between 5 and ${ABSOLUTE_MAX_SLIDES}`);
    }
  }

  if (config.maxImageSlides !== undefined) {
    const max = config.maxImageSlides as number;
    if (typeof max !== 'number' || max < 0 || max > ABSOLUTE_MAX_IMAGE_SLIDES) {
      errors.push(`maxImageSlides must be between 0 and ${ABSOLUTE_MAX_IMAGE_SLIDES}`);
    }
  }

  const validThemes = ['corporate', 'modern', 'minimal', 'bold'];
  if (config.defaultTheme && !validThemes.includes(config.defaultTheme as string)) {
    errors.push(`defaultTheme must be one of: ${validThemes.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

// ============ Helper Functions ============

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============ Tool Definition ============

export const pptxGenTool: ToolDefinition = {
  name: 'pptx_gen',
  displayName: 'Presentation Generator',
  description:
    'Generate PowerPoint presentations (.pptx) with professional themes, layouts, and AI-generated images',
  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'pptx_gen',
      description: `Generate a PowerPoint presentation (.pptx) with professional styling.

Slide and image limits are configured by the administrator. If the request exceeds limits, you will receive an error with the current configured limits.

Available slide types:
- title: Opening slide with title and subtitle
- content: Title + bullet points
- two-column: Side-by-side content
- comparison: Two boxes for pros/cons or before/after
- stats: Large numbers with labels (2-4 stats)
- image: Visual slide with AI-generated imagery (provide imagePrompt)
- closing: Thank you or contact slide

For image slides, provide an imagePrompt describing the visual.

Available themes: corporate, modern, minimal, bold`,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Presentation title',
          },
          slides: {
            type: 'array',
            description: 'Array of slide definitions',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['title', 'content', 'two-column', 'comparison', 'stats', 'image', 'closing'],
                  description: 'Slide layout type',
                },
                title: {
                  type: 'string',
                  description: 'Slide title',
                },
                content: {
                  type: 'string',
                  description: 'Main content (use newlines for bullet points)',
                },
                leftContent: {
                  type: 'string',
                  description: 'Left column content (for two-column/comparison)',
                },
                rightContent: {
                  type: 'string',
                  description: 'Right column content (for two-column/comparison)',
                },
                stats: {
                  type: 'array',
                  description: 'Stats for stats slide',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string', description: 'Large number or value' },
                      label: { type: 'string', description: 'Description label' },
                    },
                    required: ['value', 'label'],
                  },
                },
                imagePrompt: {
                  type: 'string',
                  description: 'For image slides: detailed prompt for AI image generation',
                },
                imageStyle: {
                  type: 'string',
                  enum: ['infographic', 'photo', 'illustration', 'diagram'],
                  description: 'Style hint for image generation (default: infographic)',
                },
                speakerNotes: {
                  type: 'string',
                  description: 'Speaker notes (optional)',
                },
              },
              required: ['type', 'title'],
            },
          },
          theme: {
            type: 'string',
            enum: ['corporate', 'modern', 'minimal', 'bold'],
            description: 'Visual theme (default: corporate)',
          },
        },
        required: ['title', 'slides'],
      },
    },
  },

  validateConfig: validatePptxGenConfig,
  defaultConfig: PPTX_GEN_DEFAULTS as unknown as Record<string, unknown>,
  configSchema: pptxGenConfigSchema,

  execute: async (args: PptxGenToolArgs): Promise<string> => {
    try {
      // Get context from AsyncLocalStorage
      const context = getRequestContext();
      const { threadId } = context;

      // Validate we have required context
      if (!threadId) {
        console.warn('[PptxGen] No thread context available');
        return JSON.stringify({
          success: false,
          error: 'Presentation generation requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        } as PptxGenResponse);
      }

      // Step 0: Payload size check (first!)
      const payloadCheck = checkPayloadSize(args, MAX_PAYLOAD_MB);
      if (!payloadCheck.pass) {
        return JSON.stringify({
          success: false,
          error: payloadCheck.reason,
          errorCode: 'PAYLOAD_TOO_LARGE',
        } as PptxGenResponse);
      }

      // Step 1: Get tool configuration (needed for limit checks)
      const toolConfig = await getToolConfig('pptx_gen');
      const config = (toolConfig?.config as Partial<PptxGenConfig>) || {};
      const organizationName = config.branding?.organizationName || '';

      // Check if tool is enabled
      if (toolConfig && !toolConfig.isEnabled) {
        return JSON.stringify({
          success: false,
          error: 'Presentation generation is currently disabled',
          errorCode: 'TOOL_DISABLED',
        } as PptxGenResponse);
      }

      // Use admin-configured limits, falling back to defaults
      const maxSlides = config.maxSlides ?? PPTX_GEN_DEFAULTS.maxSlides;
      const maxImageSlides = config.maxImageSlides ?? PPTX_GEN_DEFAULTS.maxImageSlides;

      // Step 2: Validate inputs
      if (!args.slides || args.slides.length === 0) {
        return JSON.stringify({
          success: false,
          error: 'At least one slide is required',
          errorCode: 'INVALID_INPUT',
        } as PptxGenResponse);
      }

      // Validate slide limit
      if (args.slides.length > maxSlides) {
        return JSON.stringify({
          success: false,
          error: `Slide limit exceeded: ${args.slides.length} slides, maximum is ${maxSlides}`,
          errorCode: 'LIMIT_EXCEEDED',
          suggestion: `Reduce the number of slides to ${maxSlides} or fewer`,
        } as PptxGenResponse);
      }

      // Validate image slide limit
      const imageSlides = args.slides.filter((s) => s.type === 'image');
      if (imageSlides.length > maxImageSlides) {
        return JSON.stringify({
          success: false,
          error: `Image slide limit exceeded: ${imageSlides.length} image slides, maximum is ${maxImageSlides}`,
          errorCode: 'LIMIT_EXCEEDED',
          suggestion: `Reduce image slides to ${maxImageSlides} or fewer, or use content slides instead`,
        } as PptxGenResponse);
      }

      // Step 3: Check memory
      const memCheck = checkMemoryForPptx(args.slides);
      if (!memCheck.canProceed) {
        console.warn('[PptxGen] Memory check failed:', memCheck.reason);
        return JSON.stringify({
          success: false,
          error: memCheck.reason,
          errorCode: 'MEMORY_LIMIT',
        } as PptxGenResponse);
      }

      // Step 3: Check image_gen availability and prepare slides
      const imageGenAvailable = await isImageGenEnabled();
      let slidesToProcess = args.slides;
      let imagesFallbackToText = 0;

      if (!imageGenAvailable && imageSlides.length > 0) {
        console.log(
          `[PptxGen] image_gen disabled, converting ${imageSlides.length} image slides to content slides`
        );
        // Convert image slides to content slides with narrative
        slidesToProcess = args.slides.map((slide) => {
          if (slide.type === 'image') {
            imagesFallbackToText++;
            return {
              ...slide,
              type: 'content' as const,
              content: slide.imagePrompt || slide.content || 'Visual content placeholder',
            };
          }
          return slide;
        });
      }

      // Step 4: Generate presentation
      console.log(
        `[PptxGen] Generating presentation: "${args.title}" with ${slidesToProcess.length} slide(s)`
      );

      const result = await generatePptx({
        title: args.title,
        slides: slidesToProcess as SlideDefinition[],
        theme: args.theme,
        colorScheme: args.colorScheme,
        organizationName,
      });

      // Step 5: Save file
      const outputDir = getOutputDirectory();
      const filename = generateDocumentFilename(args.title, 'pptx', threadId);
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, result.buffer);

      // Step 6: Determine context and save to database
      const threadContext = await getThreadContext(threadId);

      if (!threadContext.exists) {
        console.error('[PptxGen] Thread not found in database:', threadId);
        return JSON.stringify({
          success: true,
          document: {
            filename,
            fileSize: result.fileSize,
            slideCount: result.slideCount,
            downloadUrl: '',
          },
        } as PptxGenResponse);
      }

      let docId: number;
      let downloadUrlPrefix: string;

      if (threadContext.isWorkspace) {
        // Workspace context
        const wsResult = await addWorkspaceOutput(
          threadContext.workspaceId!,
          threadContext.sessionId!,
          threadContext.actualThreadId ?? null,
          filename,
          filepath,
          'pptx',
          result.fileSize
        );
        docId = wsResult.id;
        downloadUrlPrefix = '/api/workspace-documents';
      } else {
        // Main chat context
        const outputResult = await addThreadOutput(
          threadId,
          null, // messageId not available yet
          filename,
          filepath,
          'pptx',
          result.fileSize
        );
        docId = outputResult.id;
        downloadUrlPrefix = '/api/documents';
      }

      console.log(`[PptxGen] Presentation generated: ${filename} (${formatFileSize(result.fileSize)})`);

      // Build response
      const response: PptxGenResponse = {
        success: true,
        document: {
          filename,
          fileSize: result.fileSize,
          slideCount: result.slideCount,
          downloadUrl: `${downloadUrlPrefix}/${docId}/download`,
        },
      };

      // Add image generation stats if applicable
      if (result.imageSlides > 0 || result.failedImages > 0) {
        response.imageGeneration = {
          attempted: result.imageSlides + result.failedImages,
          successful: result.imageSlides,
          failed: result.failedImages,
        };
      }

      // Add fallback info if image_gen was disabled
      if (imagesFallbackToText > 0) {
        response.imageGenDisabled = true;
        response.imagesFallbackToText = imagesFallbackToText;
      }

      return JSON.stringify(response);
    } catch (error) {
      console.error('[PptxGen] Generation error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during presentation generation',
        errorCode: 'GENERATION_ERROR',
      } as PptxGenResponse);
    }
  },
};
