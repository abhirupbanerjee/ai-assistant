import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';

export function getDataDir(): string {
  return DATA_DIR;
}

export function getThreadsDir(): string {
  return path.join(DATA_DIR, 'threads');
}

export function getGlobalDocsDir(): string {
  return path.join(DATA_DIR, 'global-docs');
}

export function getUserThreadsDir(userId: string): string {
  // Sanitize userId to prevent path traversal
  const safeUserId = userId.replace(/[^a-zA-Z0-9@._-]/g, '_');
  return path.join(getThreadsDir(), safeUserId);
}

export function getThreadDir(userId: string, threadId: string): string {
  // Sanitize threadId to prevent path traversal
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(getUserThreadsDir(userId), safeThreadId);
}

export function getThreadUploadsDir(userId: string, threadId: string): string {
  return path.join(getThreadDir(userId, threadId), 'uploads');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function deleteDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Directory might not exist, ignore
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File might not exist, ignore
  }
}

export async function listDirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch {
    return [];
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

export async function readFileBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

export async function writeFileBuffer(filePath: string, buffer: Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, buffer);
}

// System prompt storage
export function getConfigDir(): string {
  return path.join(DATA_DIR, 'config');
}

export interface SystemPromptConfig {
  prompt: string;
  updatedAt: string;
  updatedBy: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant for government staff. Your role is to analyze, interpret, and compare organizational documents (policies, design docs, guidelines, standards, procedures) using ONLY the provided context.

# HOW YOU WORK

## Knowledge Base Search
When a user asks a question:
1. The system automatically searches the organizational knowledge base (vector database)
2. Relevant document chunks are retrieved based on semantic similarity
3. These chunks are provided to you as "Organizational Knowledge Base" context
4. Each chunk includes source information: [Source: Document Name, Page X]
5. You MUST answer using ONLY this provided context - never use external knowledge

**Context Format Example:**
=== KNOWLEDGE BASE DOCUMENTS ===

[Source: Document Name, Page X]
[Chunk text content here...]

[Source: Another Doc, Page Y]
[More chunk text...]

## Available Tools
You have access to the following tools:

**web_search**: Search the web for current information when:
- The knowledge base doesn't contain the answer
- User asks about recent events, current data, or real-time information
- User explicitly requests web search
- The query is clearly outside organizational documents scope

**When to use web_search:**
- "What's the current weather?" → Use web_search ✅
- "What are the latest news about AI?" → Use web_search ✅
- "What's our leave policy?" → Use knowledge base context ❌

**Important**: Always prioritize knowledge base content. Only use web_search when knowledge base is insufficient.

## When Knowledge Base Has No Results
If you receive: "No relevant documents found in the knowledge base." as context:
1. Acknowledge that organizational documents don't contain this information
2. Consider if web_search is appropriate for the query
3. If not appropriate for web search, clearly state the limitation
4. Suggest alternative actions (contact specific department, check other resources)

**Example Response for No Results:**

## Context
You asked about [topic].

❌ **Not Found in Knowledge Base**

The organizational knowledge base does not contain information about this topic.

**Next Steps:**
• Contact [relevant department] for assistance
• Check [alternative resource] if available
• Consider submitting a request to add this information to the knowledge base

# CRITICAL FORMATTING RULES

## Markdown Structure (MANDATORY)
- Use \`##\` for ALL major sections (Context, Analysis, Findings, Gaps, Recommendations, Sources)
- Leave a BLANK LINE after every section header
- Leave a BLANK LINE between all sections
- Use \`**bold**\` for labels and key terms
- Use \`inline code blocks\` for ALL document citations
- Use bullet points (•) for lists
- Use numbered lists (1., 2., 3.) for sequential steps or recommendations
- Use horizontal rules (\`---\`) to separate major topic changes

## Visual Indicators (USE CONSISTENTLY)
- ✅ for alignments, confirmations, completed items
- ⚠️ for partial matches, concerns, things needing attention
- ❌ for gaps, non-compliance, missing items
- 🔍 for areas needing review or investigation
- 📋 for document references or evidence

## Citation Format (STRICT)
- ALWAYS use inline code blocks: \`[Document Name, Page X]\`
- Place citations immediately after the relevant statement
- Example: "Leave policy allows 20 days annually \`[HR Policy Manual, Page 15]\`"

## Readability Rules (MANDATORY)
- Maximum 3 lines per paragraph
- Maximum 2-3 sentences per paragraph
- Use short, scannable sentences
- Break long explanations into multiple paragraphs with blank lines
- Start new paragraphs for different points

## Response Template

Your responses MUST follow this structure:

\`\`\`
## Context
[1-2 sentence summary of the query and available documents]

## Key Findings
• **Finding Label**: Brief explanation with citation \`[Doc, Page X]\`
• **Finding Label**: Brief explanation with citation \`[Doc, Page X]\`

## Detailed Analysis
[Break into subsections if needed using ### for sub-headers]

✅ **Aligned Areas**
Brief finding with evidence \`[Doc, Page X]\`

⚠️ **Partial Matches**
Brief finding with evidence \`[Doc, Page X]\`

❌ **Gaps Identified**
Brief finding with evidence \`[Doc, Page X]\`

## Recommendations
1. **Action**: Brief explanation
2. **Action**: Brief explanation

## Sources Referenced
• \`[Document Name, Page X]\`
• \`[Document Name, Page Y]\`
\`\`\`

# CONTENT RULES

1. **Use ONLY provided context** - Never use external knowledge
2. **Consider ALL document types** - Don't assume everything is a "policy"
3. **Always cite sources** - Use inline code blocks for every claim
4. **Be explicit about limitations** - If context insufficient, state clearly
5. **Comparison requests** - Identify alignments, gaps, and provide evidence
6. **Professional tone** - Clear, concise, government-appropriate language

# READABILITY CHECKLIST (Self-Check Before Responding)

Before sending your response, verify:
- [ ] Each paragraph is ≤ 3 lines
- [ ] Blank lines exist between ALL sections
- [ ] ALL section headers use \`##\` or \`###\`
- [ ] ALL citations use \`inline code blocks\`
- [ ] Visual indicators (✅⚠️❌) are used where appropriate
- [ ] Response follows the standard template structure
- [ ] Lists use consistent formatting (• or 1., 2., 3.)

# WHEN CONTEXT IS INSUFFICIENT

If you cannot answer from the provided context:

\`\`\`
## Context
[Brief summary of the query]

❌ **Insufficient Information**

The provided knowledge base does not contain sufficient information to answer this query.

**What's Missing:**
• Specific information needed
• Type of document that might contain this

**Suggestion:**
Consider checking [relevant document types] or consult [relevant team/department].
\`\`\`

Remember: Formatting is as important as content. Poor formatting reduces readability and user trust.`;

export async function getSystemPrompt(): Promise<SystemPromptConfig> {
  const configPath = path.join(getConfigDir(), 'system-prompt.json');
  const config = await readJson<SystemPromptConfig>(configPath);

  if (!config) {
    return {
      prompt: DEFAULT_SYSTEM_PROMPT,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    };
  }

  return config;
}

export async function saveSystemPrompt(prompt: string, updatedBy: string): Promise<SystemPromptConfig> {
  const configPath = path.join(getConfigDir(), 'system-prompt.json');
  const config: SystemPromptConfig = {
    prompt,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeJson(configPath, config);
  return config;
}

// RAG Settings
export interface RAGSettings {
  // Retrieval settings
  topKChunks: number;           // Number of chunks to retrieve per query
  maxContextChunks: number;     // Maximum chunks to include in final context
  similarityThreshold: number;  // Minimum similarity score (0-1)

  // Chunking settings
  chunkSize: number;            // Characters per chunk
  chunkOverlap: number;         // Overlap between chunks

  // Query settings
  queryExpansionEnabled: boolean;

  // Cache settings
  cacheEnabled: boolean;
  cacheTTLSeconds: number;

  // Metadata
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_RAG_SETTINGS: Omit<RAGSettings, 'updatedAt' | 'updatedBy'> = {
  topKChunks: 20,              // Increased from 15 - retrieve more candidates
  maxContextChunks: 15,        // Increased from 12 - send more context to LLM
  similarityThreshold: 0.5,    // Increased from 0.3 - higher quality matches
  chunkSize: 800,              // Increased from 500 - preserve more context
  chunkOverlap: 150,           // Increased from 50 - better continuity
  queryExpansionEnabled: true,
  cacheEnabled: true,
  cacheTTLSeconds: 3600,
};

export async function getRAGSettings(): Promise<RAGSettings> {
  const configPath = path.join(getConfigDir(), 'rag-settings.json');
  const config = await readJson<RAGSettings>(configPath);

  if (!config) {
    return {
      ...DEFAULT_RAG_SETTINGS,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    };
  }

  return config;
}

export async function saveRAGSettings(settings: Omit<RAGSettings, 'updatedAt' | 'updatedBy'>, updatedBy: string): Promise<RAGSettings> {
  const configPath = path.join(getConfigDir(), 'rag-settings.json');
  const config: RAGSettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeJson(configPath, config);
  return config;
}

// LLM Settings
export interface LLMSettings {
  model: string;
  temperature: number;
  maxTokens: number;

  // Metadata
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_LLM_SETTINGS: Omit<LLMSettings, 'updatedAt' | 'updatedBy'> = {
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  maxTokens: 2000,
};

// Note: Available models are now loaded from getAvailableModels() in db/config.ts

export async function getLLMSettings(): Promise<LLMSettings> {
  const configPath = path.join(getConfigDir(), 'llm-settings.json');
  const config = await readJson<LLMSettings>(configPath);

  if (!config) {
    return {
      ...DEFAULT_LLM_SETTINGS,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    };
  }

  return config;
}

export async function saveLLMSettings(settings: Omit<LLMSettings, 'updatedAt' | 'updatedBy'>, updatedBy: string): Promise<LLMSettings> {
  const configPath = path.join(getConfigDir(), 'llm-settings.json');
  const config: LLMSettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeJson(configPath, config);
  return config;
}

// Acronym Mappings
export interface AcronymMappings {
  mappings: Record<string, string>;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_ACRONYM_MAPPINGS: Record<string, string> = {
  'ea': 'enterprise architecture',
  'dta': 'digital transformation agency',
  'it': 'information technology',
  'ict': 'information and communication technology',
  'hr': 'human resources',
  'kpi': 'key performance indicator',
  'sla': 'service level agreement',
};

export async function getAcronymMappings(): Promise<AcronymMappings> {
  const configPath = path.join(getConfigDir(), 'acronym-mappings.json');
  const config = await readJson<AcronymMappings>(configPath);

  if (!config) {
    return {
      mappings: DEFAULT_ACRONYM_MAPPINGS,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    };
  }

  return config;
}

export async function saveAcronymMappings(mappings: Record<string, string>, updatedBy: string): Promise<AcronymMappings> {
  const configPath = path.join(getConfigDir(), 'acronym-mappings.json');
  const config: AcronymMappings = {
    mappings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeJson(configPath, config);
  return config;
}

// Tavily Settings
export interface TavilySettings {
  apiKey: string;
  enabled: boolean;
  defaultTopic: 'general' | 'news' | 'finance';
  defaultSearchDepth: 'basic' | 'advanced';
  maxResults: number;
  includeDomains: string[];
  excludeDomains: string[];
  cacheTTLSeconds: number;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_TAVILY_SETTINGS: Omit<TavilySettings, 'updatedAt' | 'updatedBy'> = {
  apiKey: '',
  enabled: false,  // Disabled by default
  defaultTopic: 'general',
  defaultSearchDepth: 'basic',
  maxResults: 5,
  includeDomains: [],
  excludeDomains: [],
  cacheTTLSeconds: 1800, // 30 minutes (web results more time-sensitive than RAG)
};

export async function getTavilySettings(): Promise<TavilySettings> {
  const configPath = path.join(getConfigDir(), 'tavily-settings.json');
  const config = await readJson<TavilySettings>(configPath);

  if (!config) {
    return {
      ...DEFAULT_TAVILY_SETTINGS,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    };
  }

  return config;
}

export async function saveTavilySettings(settings: Omit<TavilySettings, 'updatedAt' | 'updatedBy'>, updatedBy: string): Promise<TavilySettings> {
  const configPath = path.join(getConfigDir(), 'tavily-settings.json');
  const config: TavilySettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeJson(configPath, config);
  return config;
}

// Helper function to ensure directory exists (used by write operations)
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  await ensureDir(dirPath);
}
