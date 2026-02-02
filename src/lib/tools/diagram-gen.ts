/**
 * Diagram Generation Tool Definition
 *
 * Generates Mermaid diagrams via LLM for deterministic, high-quality output.
 * Uses the system default LLM configuration.
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfig } from '../db/tool-config';
import { generateMermaidDiagram, getDiagramGenConfig, DIAGRAM_GEN_DEFAULTS } from '../diagram-gen/generator';
import { DIAGRAM_TEMPLATES } from '../diagram-gen/templates';
import type { DiagramGenToolArgs, DiagramGenResponse, MermaidDiagramType } from '@/types/diagram-gen';

// ===== Configuration Schema for Admin UI =====

const diagramGenConfigSchema = {
  type: 'object',
  properties: {
    temperature: {
      type: 'number',
      title: 'Temperature',
      description: 'Lower = more deterministic (0.0 - 1.0)',
      minimum: 0,
      maximum: 1,
      default: 0.3,
    },
    maxTokens: {
      type: 'number',
      title: 'Max Tokens',
      description: 'Maximum tokens for generated diagram',
      minimum: 500,
      maximum: 4000,
      default: 1500,
    },
    validateSyntax: {
      type: 'boolean',
      title: 'Validate Syntax',
      description: 'Validate Mermaid syntax before returning',
      default: true,
    },
    maxRetries: {
      type: 'number',
      title: 'Max Retries',
      description: 'Retry attempts on validation failure',
      minimum: 0,
      maximum: 5,
      default: 2,
    },
    debugMode: {
      type: 'boolean',
      title: 'Debug Mode',
      description: 'Enable detailed logging',
      default: false,
    },
  },
};

// ===== Validation =====

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.temperature !== undefined) {
    const temp = config.temperature as number;
    if (typeof temp !== 'number' || temp < 0 || temp > 1) {
      errors.push('Temperature must be between 0 and 1');
    }
  }

  if (config.maxTokens !== undefined) {
    const tokens = config.maxTokens as number;
    if (typeof tokens !== 'number' || tokens < 500 || tokens > 4000) {
      errors.push('Max tokens must be between 500 and 4000');
    }
  }

  if (config.maxRetries !== undefined) {
    const retries = config.maxRetries as number;
    if (typeof retries !== 'number' || retries < 0 || retries > 5) {
      errors.push('Max retries must be between 0 and 5');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Check if Enabled =====

export function isDiagramGenEnabled(): boolean {
  const config = getToolConfig('diagram_gen');
  return config?.isEnabled ?? false;
}

// ===== Tool Execution =====

async function executeDiagramGen(args: DiagramGenToolArgs): Promise<string> {
  const startTime = Date.now();
  const config = getDiagramGenConfig();

  // Validate diagram type
  const validTypes = Object.keys(DIAGRAM_TEMPLATES) as MermaidDiagramType[];
  if (!validTypes.includes(args.diagram_type)) {
    const response: DiagramGenResponse = {
      success: false,
      error: {
        code: 'INVALID_TYPE',
        message: `Invalid diagram type: ${args.diagram_type}`,
        details: `Valid types: ${validTypes.join(', ')}`,
      },
    };
    return JSON.stringify(response);
  }

  // Check if description provided
  if (!args.description || args.description.trim().length === 0) {
    const response: DiagramGenResponse = {
      success: false,
      error: {
        code: 'MISSING_DESCRIPTION',
        message: 'Description is required to generate a diagram',
      },
    };
    return JSON.stringify(response);
  }

  console.log(
    `[DiagramGen] Generating ${args.diagram_type} diagram: "${args.description.substring(0, 50)}..."`
  );

  // Generate the diagram
  const result = await generateMermaidDiagram(
    args.diagram_type,
    args.description,
    args.direction,
    args.title
  );

  const processingTimeMs = Date.now() - startTime;

  if (!result.success || !result.code) {
    const response: DiagramGenResponse = {
      success: false,
      message: result.error?.message || 'Failed to generate diagram',
      error: result.error,
    };
    return JSON.stringify(response);
  }

  // Success - return with diagramHint for frontend rendering
  const response: DiagramGenResponse = {
    success: true,
    message: `Generated ${args.diagram_type} diagram successfully`,
    diagramHint: {
      code: result.code,
      type: args.diagram_type,
      title: args.title,
    },
    metadata: {
      model: 'system-default', // Model is determined at runtime
      diagramType: args.diagram_type,
      processingTimeMs,
      retryCount: 0,
    },
  };

  console.log(`[DiagramGen] Completed in ${processingTimeMs}ms`);

  return JSON.stringify(response);
}

// ===== Tool Definition =====

export const diagramGenTool: ToolDefinition = {
  name: 'diagram_gen',
  displayName: 'Diagram Generator',
  description:
    'Generate interactive diagrams (flowcharts, mindmaps, sequence, architecture, etc.) using Mermaid syntax',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'diagram_gen',
      description: `Generate a Mermaid diagram. Use this tool when the user asks for:
- Flowcharts, process flows, workflows
- Mind maps, brainstorming diagrams
- Sequence diagrams, interaction flows
- Architecture diagrams (C4 context/container)
- Gantt charts, timelines, schedules
- Class diagrams, ER diagrams
- State diagrams
- Pie charts
- User journey maps

The generated diagram will be rendered interactively in the chat with zoom and download options.

Do NOT use this for:
- Simple ASCII text diagrams (use text formatting instead)
- Infographics or images (use image_gen instead)
- Data charts from actual data (use chart_gen instead)`,
      parameters: {
        type: 'object',
        properties: {
          diagram_type: {
            type: 'string',
            enum: [
              'flowchart',
              'sequence',
              'mindmap',
              'c4-context',
              'c4-container',
              'gantt',
              'classDiagram',
              'stateDiagram',
              'erDiagram',
              'pie',
              'journey',
            ],
            description: 'Type of Mermaid diagram to generate',
          },
          description: {
            type: 'string',
            description:
              'Detailed description of what the diagram should show. Include key elements, relationships, and any specific labels needed.',
          },
          direction: {
            type: 'string',
            enum: ['TD', 'LR', 'BT', 'RL'],
            description:
              'Direction for flowcharts: TD (top-down), LR (left-right), BT (bottom-top), RL (right-left). Default: TD',
          },
          title: {
            type: 'string',
            description: 'Optional title for the diagram',
          },
        },
        required: ['diagram_type', 'description'],
      },
    },
  },

  execute: async (args: DiagramGenToolArgs): Promise<string> => {
    return executeDiagramGen(args);
  },

  validateConfig,

  defaultConfig: DIAGRAM_GEN_DEFAULTS as unknown as Record<string, unknown>,

  configSchema: diagramGenConfigSchema,
};
