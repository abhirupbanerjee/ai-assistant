/**
 * Image Generation Tool Definition
 *
 * Autonomous tool for generating images using Google AI models.
 * LLM-triggered via OpenAI function calling.
 *
 * Best for:
 * - Infographics explaining concepts or data
 * - Diagrams showing processes or relationships
 * - Illustrations for presentations
 * - Charts and data visualizations
 * - Icons and simple graphics
 * - Posters and social media graphics
 * - Product mockups and photorealistic images
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import {
  generateImage,
  getImageGenConfig,
  isImageGenEnabled,
  IMAGE_GEN_DEFAULTS,
} from '../image-gen/provider-factory';
import { testGeminiConnection, testImagenConnection } from '../image-gen/providers/gemini-imagen';
import type { ImageGenToolArgs } from '@/types/image-gen';

// ===== Configuration Schema for Admin UI =====

const imageGenConfigSchema = {
  type: 'object',
  properties: {
    activeProvider: {
      type: 'string',
      title: 'Active Provider',
      description: 'Default image generation provider ecosystem',
      enum: ['gemini', 'imagen', 'none'],
      default: 'gemini',
    },
    providers: {
      type: 'object',
      title: 'Provider Settings',
      properties: {
        gemini: {
          type: 'object',
          title: 'Google Gemini (Nano Banana)',
          properties: {
            enabled: { type: 'boolean', title: 'Enable Gemini', default: true },
            defaultModel: {
              type: 'string',
              title: 'Default Model (speed)',
              enum: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'],
              default: 'gemini-3.1-flash-image-preview',
            },
            proModel: {
              type: 'string',
              title: 'Pro Model (text-heavy)',
              enum: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'],
              default: 'gemini-3-pro-image-preview',
            },
            aspectRatio: {
              type: 'string',
              title: 'Default Aspect Ratio',
              enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
              default: '16:9',
            },
          },
        },
        imagen: {
          type: 'object',
          title: 'Google Imagen 4',
          properties: {
            enabled: { type: 'boolean', title: 'Enable Imagen 4', default: true },
            fastModel: {
              type: 'string',
              title: 'Fast Model',
              enum: ['imagen-4.0-fast-generate-001'],
              default: 'imagen-4.0-fast-generate-001',
            },
            standardModel: {
              type: 'string',
              title: 'Standard Model',
              enum: ['imagen-4.0-generate-001'],
              default: 'imagen-4.0-generate-001',
            },
            ultraModel: {
              type: 'string',
              title: 'Ultra Model (max quality)',
              enum: ['imagen-4.0-ultra-generate-001'],
              default: 'imagen-4.0-ultra-generate-001',
            },
            aspectRatio: {
              type: 'string',
              title: 'Default Aspect Ratio',
              enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
              default: '16:9',
            },
          },
        },
      },
    },
    defaultStyle: {
      type: 'string',
      title: 'Default Style',
      description: 'Default image style when not specified',
      enum: [
        'auto',
        'infographic',
        'diagram',
        'chart',
        'process-flow',
        'poster',
        'illustration',
        'photo',
        'product-mockup',
        'icon',
        'social-media',
      ],
      default: 'infographic',
    },
    defaultResolution: {
      type: 'string',
      title: 'Default Resolution',
      description: 'Default output resolution for cost control',
      enum: ['512', '1K', '2K', '4K'],
      default: '1K',
    },
    enhancePrompts: {
      type: 'boolean',
      title: 'Enhance Prompts',
      description: 'Automatically enhance prompts with style-specific instructions',
      default: true,
    },
    addSafetyPrefixes: {
      type: 'boolean',
      title: 'Add Safety Prefixes',
      description: 'Add workplace-appropriate prefixes to all prompts',
      default: true,
    },
    imageProcessing: {
      type: 'object',
      title: 'Image Processing',
      properties: {
        maxDimension: {
          type: 'number',
          title: 'Max Dimension',
          description: 'Maximum width/height for output images (1024-4096)',
          minimum: 1024,
          maximum: 4096,
          default: 2048,
        },
        format: {
          type: 'string',
          title: 'Output Format',
          enum: ['webp', 'png', 'jpeg'],
          default: 'webp',
        },
        quality: {
          type: 'number',
          title: 'Quality',
          description: 'Quality setting for WebP/JPEG (0-100)',
          minimum: 0,
          maximum: 100,
          default: 85,
        },
        generateThumbnail: {
          type: 'boolean',
          title: 'Generate Thumbnails',
          description: 'Create small preview images for chat',
          default: true,
        },
        thumbnailSize: {
          type: 'number',
          title: 'Thumbnail Size',
          description: 'Thumbnail dimension in pixels',
          minimum: 100,
          maximum: 800,
          default: 400,
        },
      },
    },
  },
};

// ===== Validation Function =====

function validateImageGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (
    config.activeProvider &&
    !['gemini', 'imagen', 'none'].includes(config.activeProvider as string)
  ) {
    errors.push('activeProvider must be gemini, imagen, or none');
  }

  const validStyles = [
    'auto',
    'infographic',
    'poster',
    'illustration',
    'photo',
    'product-mockup',
    'icon',
    'social-media',
  ];
  if (config.defaultStyle && !validStyles.includes(config.defaultStyle as string)) {
    errors.push(`defaultStyle must be one of: ${validStyles.join(', ')}`);
  }

  const validResolutions = ['512', '1K', '2K', '4K'];
  if (config.defaultResolution && !validResolutions.includes(config.defaultResolution as string)) {
    errors.push(`defaultResolution must be one of: ${validResolutions.join(', ')}`);
  }

  if (config.imageProcessing) {
    const ip = config.imageProcessing as Record<string, unknown>;

    if (ip.maxDimension !== undefined) {
      const max = ip.maxDimension as number;
      if (typeof max !== 'number' || max < 1024 || max > 4096) {
        errors.push('maxDimension must be between 1024 and 4096');
      }
    }

    if (ip.quality !== undefined) {
      const quality = ip.quality as number;
      if (typeof quality !== 'number' || quality < 0 || quality > 100) {
        errors.push('quality must be between 0 and 100');
      }
    }

    if (ip.thumbnailSize !== undefined) {
      const size = ip.thumbnailSize as number;
      if (typeof size !== 'number' || size < 100 || size > 800) {
        errors.push('thumbnailSize must be between 100 and 800');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Tool Definition =====

export const imageGenTool: ToolDefinition = {
  name: 'image_gen',
  displayName: 'Image Generation',
  description:
    'Generate images, infographics, diagrams, and photos using Google AI (Gemini Nano Banana or Imagen 4)',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'image_gen',
      description: `Generate an artistic image from a text description. Best for:
- Infographics combining text, icons, and visual hierarchy (use "infographic")
- Posters and promotional graphics with typography (use "poster")
- Illustrations for presentations and documents (use "illustration")
- Photorealistic images and editorial photography (use "photo")
- Product mockups and commercial photography (use "product-mockup")
- Icons and simple graphics (use "icon")
- Social media graphics and banners (use "social-media")

IMPORTANT: This tool produces artistic/presentational raster images. It is NOT for data-accurate charts or editable technical diagrams.
- For data-driven interactive charts from real datasets, use chart_gen instead.
- For editable technical diagrams (flowcharts, architecture, ER diagrams), use diagram_gen instead.

The generated image will be displayed in the chat.

Guidelines:
- Be specific about content, layout, colors, and style
- For infographics, describe the data and key points clearly
- For text that should appear in the image, enclose it in quotes (e.g., "Q3 Revenue")
- Specify typography when text is important (e.g., "bold sans-serif font")
- Use "infographic" or "poster" style for designs with text that needs to be readable
- Use "photo" or "product-mockup" for photorealistic commercial imagery`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'Detailed description of the image to generate. Be specific about content, style, colors, layout, and any text that should appear. Enclose desired text in quotes and specify typography style.',
          },
          style: {
            type: 'string',
            enum: [
              'auto',
              'infographic',
              'poster',
              'illustration',
              'photo',
              'product-mockup',
              'icon',
              'social-media',
            ],
            description:
              'Visual style. Use "auto" to let the system intelligently select the best style based on your prompt. Or specify directly: "infographic" for data/concept visualizations with text, "poster" for text-heavy promotional graphics, "illustration" for artistic drawings, "photo" for photorealistic images, "product-mockup" for commercial product shots, "icon" for simple icons, "social-media" for digital graphics. NOTE: For real data charts use chart_gen. For editable technical diagrams use diagram_gen.',
          },
          aspectRatio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            description:
              'Aspect ratio. Use "16:9" for presentations/widescreen, "1:1" for social media, "9:16" for mobile/stories, "4:3" for documents, "3:4" for posters.',
          },
          resolution: {
            type: 'string',
            enum: ['512', '1K', '2K', '4K'],
            description:
              'Output resolution. Use "512" for quick previews, "1K" for standard production work (default), "2K" for high-fidelity display, "4K" for print-quality output.',
          },
        },
        required: ['prompt'],
      },
    },
  },

  configSchema: imageGenConfigSchema,

  defaultConfig: IMAGE_GEN_DEFAULTS as unknown as Record<string, unknown>,

  validateConfig: validateImageGenConfig,

  execute: async (args: Record<string, unknown>): Promise<string> => {
    const typedArgs = args as unknown as ImageGenToolArgs;

    if (!(await isImageGenEnabled())) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'DISABLED',
          message:
            'Image generation is currently disabled. Contact your administrator to enable it.',
        },
      });
    }

    if (!typedArgs.prompt || typeof typedArgs.prompt !== 'string') {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_PROMPT',
          message: 'A prompt is required to generate an image',
        },
      });
    }

    if (typedArgs.prompt.length > 4000) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'PROMPT_TOO_LONG',
          message: 'Prompt must be less than 4000 characters',
        },
      });
    }

    const validStyles = [
      'auto',
      'infographic',
      'poster',
      'illustration',
      'photo',
      'product-mockup',
      'icon',
      'social-media',
    ];
    if (typedArgs.style && !validStyles.includes(typedArgs.style)) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_STYLE',
          message: `Style must be one of: ${validStyles.join(', ')}`,
        },
      });
    }

    const validRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    if (typedArgs.aspectRatio && !validRatios.includes(typedArgs.aspectRatio)) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_ASPECT_RATIO',
          message: `Aspect ratio must be one of: ${validRatios.join(', ')}`,
        },
      });
    }

    const validResolutions = ['512', '1K', '2K', '4K'];
    if (typedArgs.resolution && !validResolutions.includes(typedArgs.resolution)) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_RESOLUTION',
          message: `Resolution must be one of: ${validResolutions.join(', ')}`,
        },
      });
    }

    const result = await generateImage(typedArgs);

    return JSON.stringify(result);
  },
};

// ===== Test Function =====

export interface ImageGenTestResult {
  success: boolean;
  message: string;
  latency?: number;
  providers?: {
    gemini?: { success: boolean; message: string; latency?: number };
    imagen?: { success: boolean; message: string; latency?: number };
  };
}

export async function testImageGen(): Promise<ImageGenTestResult> {
  const config = await getImageGenConfig();
  const providers: ImageGenTestResult['providers'] = {};

  const startTime = Date.now();

  if (config.providers.gemini.enabled) {
    providers.gemini = await testGeminiConnection();
  }

  if (config.providers.imagen.enabled) {
    providers.imagen = await testImagenConnection();
  }

  const latency = Date.now() - startTime;

  const anySuccess = Object.values(providers).some((p) => p?.success);
  const allTested = Object.keys(providers).length;

  if (allTested === 0) {
    return {
      success: false,
      message: 'No image providers are enabled',
      latency,
      providers,
    };
  }

  return {
    success: anySuccess,
    message: anySuccess
      ? `Image generation available (${latency}ms)`
      : 'No image providers could connect',
    latency,
    providers,
  };
}

export default imageGenTool;
