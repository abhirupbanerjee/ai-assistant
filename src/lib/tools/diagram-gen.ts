/**
 * Diagram Generation Tool Definition
 *
 * Generates Mermaid diagrams via LLM for deterministic, high-quality output.
 * Uses the system default LLM configuration.
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfig } from '../db/compat/tool-config';
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

export async function isDiagramGenEnabled(): Promise<boolean> {
  const config = await getToolConfig('diagram_gen');
  return config?.isEnabled ?? false;
}

// ===== Tool Execution =====

async function executeDiagramGen(args: DiagramGenToolArgs): Promise<string> {
  const startTime = Date.now();
  const config = await getDiagramGenConfig();

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
      message: result.error?.message ||
        'Diagram generation failed. Describe this using formatted text, a bullet-point outline, or ASCII art instead.',
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
    'Generate interactive diagrams (flowcharts, mindmaps, sequence, architecture, gantt, timeline, block, quadrant, C4, ER, class, state, journey, pie) using Mermaid syntax',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'diagram_gen',
      description: `Generate a Mermaid diagram. Use this tool when the user asks for any visual diagram.

Choose the right type:
- flowchart: process flows, decision trees, workflows, step-by-step logic
- sequence: system interactions over time, API calls, login flows, message exchanges between services
- mindmap: brainstorming, topic breakdowns, hierarchical concepts
- c4-context: high-level system architecture showing users, systems, and external dependencies
- c4-container: internal architecture showing containers (web app, API, DB) inside a system
- c4-component: internal components within a single container (services, modules)
- c4-dynamic: runtime message flow with numbered steps between containers
- c4-deployment: infrastructure deployment topology (cloud nodes, VPCs, servers)
- gantt: project timelines, task schedules, sprint planning
- timeline: chronological event sequences grouped by time period (NOT a gantt — no durations or dependencies)
- block: grid/column layout for architectural overviews and structured visual layouts
- quadrant: 2×2 matrix with named points plotted by x/y values (priority, risk, effort matrices)
- classDiagram: OOP class structures, inheritance hierarchies, software design models
- erDiagram: database schemas, entity relationships, data models
- stateDiagram: state machines, lifecycle flows (e.g. order status, auth states)
- pie: proportional breakdowns, distribution of categories
- journey: user experience flows with satisfaction scores per step
- architecture: physical/logical infrastructure with labeled services, groups, and directional edges

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
              'c4-component',
              'c4-dynamic',
              'c4-deployment',
              'gantt',
              'timeline',
              'block',
              'quadrant',
              'classDiagram',
              'stateDiagram',
              'erDiagram',
              'pie',
              'journey',
              'architecture',
            ],
            description: `Type of Mermaid diagram to generate:
- flowchart: process steps, decisions, branching logic
- sequence: messages/calls between actors/services over time
- mindmap: hierarchical topic or concept breakdown
- c4-context: system-level view (users + systems + external dependencies)
- c4-container: internal containers within a system (web, API, DB layers)
- c4-component: components within a single container (services, modules, libraries)
- c4-dynamic: numbered runtime message flow between containers (experimental)
- c4-deployment: deployment topology (cloud nodes, VPCs, servers, containers) (experimental)
- gantt: project schedule with tasks, durations, and dependencies
- timeline: chronological events grouped by time period — no durations or dependencies
- block: grid/column layout for architectural overviews and structured layouts
- quadrant: 2x2 matrix with named data points plotted by x/y coordinates (0-1 scale)
- classDiagram: OOP classes with attributes, methods, inheritance
- stateDiagram: state machines and lifecycle transitions
- erDiagram: database entities and relationships
- pie: percentage or proportional distribution
- journey: user journey steps with satisfaction scores (1-5) per step
- architecture: physical/logical infrastructure — services, groups, directional edges (beta)`,
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
