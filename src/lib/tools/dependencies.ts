/**
 * Tool Dependency Configuration
 *
 * Visual UI showing admins which tools have prerequisites (API keys, other tools)
 * with validation status.
 */

import { getToolConfig, isToolEnabled } from '../db/tool-config';

// ============ Types ============

export interface DependencyValidation {
  ok: boolean;
  message: string;
  details?: {
    envVars?: Array<{ name: string; set: boolean; source?: string }>;
    tools?: Array<{ name: string; enabled: boolean }>;
  };
}

export interface ToolDependencyStatus {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  validation: DependencyValidation;
  canEnable: boolean;
  missingDependencies: string[];
}

interface ToolDependency {
  name: string;
  displayName: string;
  description: string;
  requires: {
    envVars?: Array<{ name: string; description: string; settingsPath?: string }>;
    tools?: string[];
  };
  validates: () => Promise<DependencyValidation>;
}

// ============ Tool Dependencies Registry ============

export const TOOL_DEPENDENCIES: Record<string, ToolDependency> = {
  web_search: {
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Search the web via Tavily API',
    requires: {
      envVars: [{ name: 'TAVILY_API_KEY', description: 'Tavily API key', settingsPath: 'config.apiKey' }]
    },
    validates: async () => {
      const config = getToolConfig('web_search');
      const hasKey = Boolean(config?.config?.apiKey || process.env.TAVILY_API_KEY);
      return {
        ok: hasKey,
        message: hasKey ? 'API key configured' : 'Tavily API key required',
        details: {
          envVars: [{
            name: 'TAVILY_API_KEY',
            set: hasKey,
            source: config?.config?.apiKey ? 'settings' : (process.env.TAVILY_API_KEY ? 'env' : undefined)
          }]
        }
      };
    }
  },

  doc_gen: {
    name: 'doc_gen',
    displayName: 'Document Generator',
    description: 'Create PDF, DOCX, Markdown files',
    requires: {},
    validates: async () => ({ ok: true, message: 'Ready - no external dependencies' })
  },

  data_source: {
    name: 'data_source',
    displayName: 'Data Source Query',
    description: 'Query APIs and CSV data',
    requires: {},
    validates: async () => ({ ok: true, message: 'Ready - no external dependencies' })
  },

  chart_gen: {
    name: 'chart_gen',
    displayName: 'Chart Generator',
    description: 'Create data visualizations',
    requires: {
      tools: ['data_source']
    },
    validates: async () => {
      const dataEnabled = isToolEnabled('data_source');
      return {
        ok: dataEnabled,
        message: dataEnabled ? 'Ready' : 'Requires Data Source tool to be enabled',
        details: {
          tools: [{ name: 'data_source', enabled: dataEnabled }]
        }
      };
    }
  },

  function_api: {
    name: 'function_api',
    displayName: 'Function APIs',
    description: 'Call external APIs with schemas',
    requires: {},
    validates: async () => ({ ok: true, message: 'Ready - configure individual APIs in settings' })
  },

  youtube: {
    name: 'youtube',
    displayName: 'YouTube Transcript',
    description: 'Extract video transcripts',
    requires: {},
    validates: async () => ({ ok: true, message: 'Ready - uses youtube-transcript npm package' })
  },

  task_planner: {
    name: 'task_planner',
    displayName: 'Task Planner',
    description: 'Multi-step task management',
    requires: {},
    validates: async () => ({ ok: true, message: 'Ready - no external dependencies' })
  },

  image_gen: {
    name: 'image_gen',
    displayName: 'Image Generation',
    description: 'Generate images via OpenAI DALL-E or Google Gemini',
    requires: {
      envVars: [
        { name: 'OPENAI_API_KEY', description: 'OpenAI API key (for DALL-E)' },
        { name: 'GOOGLE_AI_API_KEY', description: 'Google AI API key (for Gemini)' }
      ]
    },
    validates: async () => {
      const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
      const hasGemini = Boolean(process.env.GOOGLE_AI_API_KEY);
      const hasAny = hasOpenAI || hasGemini;

      const providers: string[] = [];
      if (hasOpenAI) providers.push('OpenAI');
      if (hasGemini) providers.push('Gemini');

      return {
        ok: hasAny,
        message: hasAny
          ? `Ready - ${providers.join(' and ')} configured`
          : 'Requires OpenAI or Google AI API key',
        details: {
          envVars: [
            { name: 'OPENAI_API_KEY', set: hasOpenAI, source: hasOpenAI ? 'env' : undefined },
            { name: 'GOOGLE_AI_API_KEY', set: hasGemini, source: hasGemini ? 'env' : undefined }
          ]
        }
      };
    }
  },

  translation: {
    name: 'translation',
    displayName: 'Translation',
    description: 'Translate text between languages (OpenAI, Gemini, or Mistral)',
    requires: {
      envVars: [
        { name: 'OPENAI_API_KEY', description: 'OpenAI API key (for GPT-4.1)' },
        { name: 'GEMINI_API_KEY', description: 'Gemini API key (for Gemini 2.5)' },
        { name: 'MISTRAL_API_KEY', description: 'Mistral API key' }
      ]
    },
    validates: async () => {
      const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
      const hasGemini = Boolean(process.env.GEMINI_API_KEY);
      const hasMistral = Boolean(process.env.MISTRAL_API_KEY);
      const hasAny = hasOpenAI || hasGemini || hasMistral;

      const providers: string[] = [];
      if (hasOpenAI) providers.push('OpenAI');
      if (hasGemini) providers.push('Gemini');
      if (hasMistral) providers.push('Mistral');

      return {
        ok: hasAny,
        message: hasAny
          ? `Ready - ${providers.join(', ')} available`
          : 'Requires at least one provider API key (OpenAI, Gemini, or Mistral)',
        details: {
          envVars: [
            { name: 'OPENAI_API_KEY', set: hasOpenAI, source: hasOpenAI ? 'env' : undefined },
            { name: 'GEMINI_API_KEY', set: hasGemini, source: hasGemini ? 'env' : undefined },
            { name: 'MISTRAL_API_KEY', set: hasMistral, source: hasMistral ? 'env' : undefined }
          ]
        }
      };
    }
  },

  diagram_gen: {
    name: 'diagram_gen',
    displayName: 'Diagram Generator',
    description: 'Generate Mermaid diagrams using the system default LLM',
    requires: {
      envVars: [
        { name: 'OPENAI_API_KEY', description: 'OpenAI API key (or use LiteLLM proxy)' }
      ]
    },
    validates: async () => {
      const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
      const hasLiteLLM = Boolean(process.env.OPENAI_BASE_URL);
      const hasAny = hasOpenAI || hasLiteLLM;

      return {
        ok: hasAny,
        message: hasAny
          ? `Ready - ${hasLiteLLM ? 'LiteLLM proxy' : 'OpenAI'} configured`
          : 'Requires OpenAI API key or LiteLLM proxy',
        details: {
          envVars: [
            { name: 'OPENAI_API_KEY', set: hasOpenAI, source: hasOpenAI ? 'env' : undefined },
            { name: 'OPENAI_BASE_URL', set: hasLiteLLM, source: hasLiteLLM ? 'env' : undefined }
          ]
        }
      };
    }
  }
};

// ============ Helper Functions ============

/**
 * Get nested value from object using dot notation path
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  return path.split('.').reduce((o: Record<string, unknown>, k: string) => {
    if (o && typeof o === 'object' && k in o) {
      return o[k] as Record<string, unknown>;
    }
    return undefined as unknown as Record<string, unknown>;
  }, obj as Record<string, unknown>);
}

/**
 * Get all tool dependency statuses
 */
export async function getAllToolDependencyStatuses(): Promise<ToolDependencyStatus[]> {
  const results: ToolDependencyStatus[] = [];

  for (const [name, dep] of Object.entries(TOOL_DEPENDENCIES)) {
    const enabled = isToolEnabled(name);
    const validation = await dep.validates();
    const missingDeps: string[] = [];

    // Check environment variables
    if (dep.requires.envVars) {
      for (const env of dep.requires.envVars) {
        const config = getToolConfig(name);
        const hasValue = Boolean(
          (env.settingsPath && getNestedValue(config, env.settingsPath)) ||
          process.env[env.name]
        );
        if (!hasValue) {
          missingDeps.push(`Environment: ${env.name}`);
        }
      }
    }

    // Check tool dependencies
    if (dep.requires.tools) {
      for (const tool of dep.requires.tools) {
        if (!isToolEnabled(tool)) {
          const depInfo = TOOL_DEPENDENCIES[tool];
          missingDeps.push(`Tool: ${depInfo?.displayName || tool}`);
        }
      }
    }

    results.push({
      name,
      displayName: dep.displayName,
      description: dep.description,
      enabled,
      validation,
      canEnable: validation.ok,
      missingDependencies: missingDeps
    });
  }

  // Sort by displayName
  results.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return results;
}

/**
 * Get dependency status for a single tool
 */
export async function getToolDependencyStatus(toolName: string): Promise<ToolDependencyStatus | null> {
  const dep = TOOL_DEPENDENCIES[toolName];
  if (!dep) return null;

  const enabled = isToolEnabled(toolName);
  const validation = await dep.validates();
  const missingDeps: string[] = [];

  if (dep.requires.envVars) {
    for (const env of dep.requires.envVars) {
      const config = getToolConfig(toolName);
      const hasValue = Boolean(
        (env.settingsPath && getNestedValue(config, env.settingsPath)) ||
        process.env[env.name]
      );
      if (!hasValue) {
        missingDeps.push(`Environment: ${env.name}`);
      }
    }
  }

  if (dep.requires.tools) {
    for (const tool of dep.requires.tools) {
      if (!isToolEnabled(tool)) {
        const depInfo = TOOL_DEPENDENCIES[tool];
        missingDeps.push(`Tool: ${depInfo?.displayName || tool}`);
      }
    }
  }

  return {
    name: toolName,
    displayName: dep.displayName,
    description: dep.description,
    enabled,
    validation,
    canEnable: validation.ok,
    missingDependencies: missingDeps
  };
}

/**
 * Get summary statistics
 */
export async function getToolDependencySummary(): Promise<{
  ready: number;
  available: number;
  needsConfig: number;
  total: number;
}> {
  const tools = await getAllToolDependencyStatuses();
  return {
    ready: tools.filter(t => t.enabled && t.validation.ok).length,
    available: tools.filter(t => t.canEnable && !t.enabled).length,
    needsConfig: tools.filter(t => !t.canEnable).length,
    total: tools.length
  };
}
