/**
 * Image Generation Tool Definition
 *
 * Autonomous tool for generating images using AI providers (DALL-E 3, Gemini Nano Banana Pro).
 * LLM-triggered via OpenAI function calling.
 *
 * Best for:
 * - Infographics explaining concepts or data
 * - Diagrams showing processes or relationships
 * - Illustrations for presentations
 * - Charts and data visualizations
 * - Icons and simple graphics
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import {
  generateImage,
  getImageGenConfig,
  isImageGenEnabled,
  IMAGE_GEN_DEFAULTS,
} from '../image-gen/provider-factory';
import { testDalleConnection } from '../image-gen/providers/openai-dalle';
import { testGeminiConnection } from '../image-gen/providers/gemini-imagen';
import type { ImageGenToolArgs } from '@/types/image-gen';

// ===== Configuration Schema for Admin UI =====

const imageGenConfigSchema = {
  type: 'object',
  properties: {
    activeProvider: {
      type: 'string',
      title: 'Active Provider',
      description: 'Default image generation provider',
      enum: ['openai', 'gemini', 'none'],
      default: 'gemini',
    },
    providers: {
      type: 'object',
      title: 'Provider Settings',
      properties: {
        openai: {
          type: 'object',
          title: 'OpenAI DALL-E',
          properties: {
            enabled: { type: 'boolean', title: 'Enable DALL-E', default: true },
            model: {
              type: 'string',
              title: 'Model',
              enum: ['dall-e-3', 'dall-e-2'],
              default: 'dall-e-3',
            },
            size: {
              type: 'string',
              title: 'Default Size',
              enum: ['1024x1024', '1024x1792', '1792x1024'],
              default: '1024x1024',
            },
            quality: {
              type: 'string',
              title: 'Quality',
              enum: ['standard', 'hd'],
              default: 'standard',
            },
            style: {
              type: 'string',
              title: 'Style',
              enum: ['vivid', 'natural'],
              default: 'natural',
            },
          },
        },
        gemini: {
          type: 'object',
          title: 'Google Gemini (Nano Banana Pro)',
          properties: {
            enabled: { type: 'boolean', title: 'Enable Gemini', default: true },
            model: {
              type: 'string',
              title: 'Model',
              enum: ['gemini-3-pro-image-preview', 'imagen-3.0-generate-002'],
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
      },
    },
    defaultStyle: {
      type: 'string',
      title: 'Default Style',
      description: 'Default image style when not specified',
      enum: [
        'infographic',
        'diagram',
        'illustration',
        'photo',
        'icon',
        'chart',
        'process-flow',
      ],
      default: 'infographic',
    },
    infographicProvider: {
      type: 'string',
      title: 'Infographic Provider',
      description:
        'Recommended provider for infographics (Gemini excels at text rendering)',
      enum: ['openai', 'gemini'],
      default: 'gemini',
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

/**
 * Validate image_gen tool configuration
 */
function validateImageGenConfig(
  config: Record<string, unknown>
): ValidationResult {
  const errors: string[] = [];

  // Validate activeProvider
  if (
    config.activeProvider &&
    !['openai', 'gemini', 'none'].includes(config.activeProvider as string)
  ) {
    errors.push('activeProvider must be openai, gemini, or none');
  }

  // Validate defaultStyle
  const validStyles = [
    'infographic',
    'diagram',
    'illustration',
    'photo',
    'icon',
    'chart',
    'process-flow',
  ];
  if (config.defaultStyle && !validStyles.includes(config.defaultStyle as string)) {
    errors.push(`defaultStyle must be one of: ${validStyles.join(', ')}`);
  }

  // Validate imageProcessing
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

/**
 * Image generation tool implementation
 */
export const imageGenTool: ToolDefinition = {
  name: 'image_gen',
  displayName: 'Image Generation',
  description:
    'Generate images, infographics, and diagrams using AI (DALL-E 3 or Gemini Nano Banana Pro)',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'image_gen',
      description: `Generate an image from a text description. Best for:
- Infographics explaining concepts, data, or processes
- Diagrams showing relationships or structures
- Illustrations for presentations and documents
- Charts and data visualizations
- Icons and simple graphics
- Process flows and workflows

The generated image will be displayed in the chat.

Guidelines:
- Be specific about content, layout, colors, and style
- For infographics, describe the data and key points clearly
- For diagrams, specify components and their relationships
- Use "infographic" style for data with text that needs to be readable
- Gemini is preferred for infographics (better text rendering)`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'Detailed description of the image to generate. Be specific about content, style, colors, layout, and any text that should appear.',
          },
          style: {
            type: 'string',
            enum: [
              'infographic',
              'diagram',
              'illustration',
              'photo',
              'icon',
              'chart',
              'process-flow',
            ],
            description:
              'Visual style. Use "infographic" for data/concept visualizations with text, "diagram" for technical drawings, "process-flow" for step-by-step flows, "chart" for data charts.',
          },
          aspectRatio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            description:
              'Aspect ratio. Use "16:9" for presentations/widescreen, "1:1" for social media, "9:16" for mobile/stories, "4:3" for documents.',
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

    // Check if enabled (async - works with both SQLite and PostgreSQL)
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

    // Validate prompt
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

    // Validate style if provided
    const validStyles = [
      'infographic',
      'diagram',
      'illustration',
      'photo',
      'icon',
      'chart',
      'process-flow',
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

    // Validate aspectRatio if provided
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

    // Generate image
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
    openai?: { success: boolean; message: string; latency?: number };
    gemini?: { success: boolean; message: string; latency?: number };
  };
}

/**
 * Test image generation connectivity
 */
export async function testImageGen(): Promise<ImageGenTestResult> {
  const config = await getImageGenConfig();
  const providers: ImageGenTestResult['providers'] = {};

  const startTime = Date.now();

  // Test OpenAI if enabled
  if (config.providers.openai.enabled) {
    providers.openai = await testDalleConnection();
  }

  // Test Gemini if enabled
  if (config.providers.gemini.enabled) {
    providers.gemini = await testGeminiConnection();
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
