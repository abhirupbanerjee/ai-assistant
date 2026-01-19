# Bot Configuration Architecture

This document describes the key configuration components that control how the AI assistant behaves and responds to users. It provides an architectural overview of how prompts, skills, tools, and memory work together.

**Related Documentation:**
- [Tools.md](Tools.md) - Detailed tool configuration, OpenAI schemas, and usage examples
- [DATABASE.md](DATABASE.md) - Complete database schema reference

---

## Table of Contents

1. [System Prompt (Global Prompt)](#1-system-prompt-global-prompt)
2. [Starter Prompts](#2-starter-prompts)
3. [Category Prompts](#3-category-prompts)
4. [Skills](#4-skills)
5. [Tools](#5-tools) - Overview of all 9 tools with references to Tools.md
6. [Data Sources](#6-data-sources)
7. [Function APIs](#7-function-apis)
8. [Memory](#8-memory) - Memory extraction and thread summarization
9. [Prompt Assembly Flow](#9-prompt-assembly-flow)
10. [Comparison Table](#10-comparison-table)

---

## 1. System Prompt (Global Prompt)

**What it is:** The foundational instructions sent to the AI for every conversation. Defines core behavior, constraints, and response guidelines.

### Storage
- **Primary:** SQLite `settings` table with key `'system-prompt'`
- **Fallback:** `config/system-prompt.md` file (loaded if SQLite value is missing/outdated)

### Key Features
- Auto-sync: When `system-prompt.md` file changes (detected via hash), SQLite entry is cleared and new file content is used
- Maximum combined length with category addendum: **8,000 characters**
- Admin-only access via `/api/admin/system-prompt`

### Example
```markdown
You are an AI assistant for government policy guidance.
Always cite sources when referencing policies.
Maintain a professional, helpful tone.
```

---

## 2. Starter Prompts

**What it is:** Quick-start buttons displayed in the UI for category-specific conversations. Pre-written prompt templates users can click to initiate conversations quickly.

### Storage
- **Table:** `category_prompts.starter_prompts` (JSON stored as TEXT)
- Linked to specific categories

### Structure
```typescript
interface StarterPrompt {
  label: string;   // Button text (max 30 chars)
  prompt: string;  // Full message to send (max 500 chars)
}
```

### Constraints
| Constraint | Value |
|------------|-------|
| Max starters per category | 6 |
| Max label length | 30 characters |
| Max prompt length | 500 characters |

### Example
| Label | Prompt |
|-------|--------|
| "Leave Policy" | "What is the annual leave entitlement for permanent employees?" |
| "Travel Allowance" | "Explain the travel allowance policy for interstate travel" |

---

## 3. Category Prompts

**What it is:** Category-specific addendum to the global system prompt. Fine-tunes AI behavior for different domains (e.g., Finance, HR, Operations).

### Storage
- **Table:** `category_prompts.prompt_addendum` (TEXT)
- One-to-one relationship with categories

### How It Combines
```
Final System Prompt = Global System Prompt
                    + "\n\n--- Category-Specific Guidelines ---\n\n"
                    + Category Addendum
```

### Character Budget
- Maximum combined length: **8,000 characters**
- Available for category = `8000 - global_prompt_length - separator_length`

### Security
Forbidden phrases are blocked to prevent prompt injection:
- `ignore previous`, `disregard`, `system:`, `assistant:`
- `ignore above`, `forget all`, `new instructions`, `override`

### Permissions
| Role | Access |
|------|--------|
| Admin | Edit all categories |
| Superuser | Edit assigned categories only |
| Regular user | No access |

---

## 4. Skills

**What it is:** Modular, reusable prompt components dynamically injected into the system prompt based on context. Skills encapsulate domain expertise that can be selectively applied.

### Storage
- **Table:** `skills` - Main skill definitions
- **Table:** `category_skills` - Many-to-many linking skills to categories
- **Settings:** `settings['skills-settings']` - Global enable flag and token budget

### Skill Types (by Trigger)

#### Type 1: Always Skills (`trigger_type = 'always'`)
- Activated for **every conversation**
- No additional context needed
- Example: Legal compliance guidelines, core formatting rules

#### Type 2: Category Skills (`trigger_type = 'category'`)
- Activated when **specific categories are selected**
- Linked via `category_skills` table
- Can be marked as **index skills** (`is_index = true`) for broader domain expertise
- Example: Financial reporting rules for Finance category

#### Type 3: Keyword Skills (`trigger_type = 'keyword'`)
- Activated when **user message contains specific keywords**
- `trigger_value` stores comma-separated keywords (e.g., `"budget,spending,cost"`)
- Optional `category_restricted` flag:
  - `true` = Only applies if user's selected category is linked
  - `false` = Applies globally when keywords match
- Example: Accounting guidance triggered by "accounting" keyword

### Skill Structure
```typescript
interface Skill {
  id: number;
  name: string;
  description: string | null;
  prompt_content: string;        // The actual skill prompt text
  trigger_type: 'always' | 'category' | 'keyword';
  trigger_value: string | null;  // Keywords for keyword-type skills
  category_restricted: boolean;  // Restrict to linked categories
  is_index: boolean;             // Broader domain expertise flag
  priority: number;              // Lower = higher priority
  is_active: boolean;
  is_core: boolean;              // Core skills cannot be deleted
  token_estimate: number;        // ~1 token per 4 chars
}
```

### Skill Resolution Process
```
1. Get all "always" skills → Add to activated list
2. Get category index skills for selected categories → Add to activated
3. For each keyword skill:
   - Check if keywords match user message
   - If category_restricted, verify category is linked
   - If matches, add to activated
4. Sort by priority (lower = higher)
5. Add skills respecting token budget
6. Combine all activated skill prompts
```

### Configuration
```typescript
interface SkillsSettings {
  enabled: boolean;        // Master on/off
  maxTotalTokens: number;  // Budget for all skills (default: 3000)
  debugMode: boolean;      // Logs activation details
}
```

### Core Skills
- Loaded from `config/skills.json` manifest and `config/skills/*.md` files
- Seeded on startup, marked with `is_core = true`
- Cannot be deleted, but can be reset to defaults

---

## 5. Tools

**What it is:** Capabilities that extend the AI beyond text generation. Tools can perform web searches, generate documents, create visualizations, query data, and more.

> **Full Documentation:** See [Tools.md](Tools.md) for complete configuration details, OpenAI schemas, and usage examples.

### Tool Categories

| Category | Description | Execution |
|----------|-------------|-----------|
| **Autonomous** | LLM-triggered via OpenAI function calling | LLM decides when to call |
| **Processor** | Post-response output processors | Triggered by response content |

### Available Tools Overview

| Tool | Type | Purpose | Prerequisites |
|------|------|---------|---------------|
| **web_search** | Autonomous | Search the web via Tavily API | Tavily API key |
| **doc_gen** | Processor | Generate PDF, DOCX, Markdown documents | None |
| **data_source** | Autonomous | Query APIs and CSV files with filtering/aggregation | None |
| **chart_gen** | Autonomous | Create visualizations from LLM-constructed data | data_source enabled |
| **function_api** | Autonomous | Dynamic function calling with OpenAI schemas | None |
| **task_planner** | Autonomous | Multi-step task plans with progress tracking | None |
| **youtube** | Autonomous | Extract YouTube video transcripts | Supadata API key (optional) |
| **share_thread** | UI | Share conversation threads via secure links | None |
| **send_email** | Internal | Send email notifications via SendGrid | SendGrid API key |

### Storage
- **Table:** `tool_configs` - Global tool configurations
- **Table:** `category_tool_configs` - Category-level overrides
- **Table:** `tool_config_audit` - Audit trail of changes
- **Table:** `tool_routing_rules` - Keyword/regex rules for forcing tool calls

### Category Overrides
- Tools can have category-specific configurations
- Category override takes precedence if set
- Falls back to global config if category override is null
- Useful for custom branding, templates, or domain filters per category

### Tool Execution Flow
```
1. User message received
2. Tool Routing checks for keyword/regex matches → may force tool_choice
3. OpenAI receives enabled tool definitions
4. LLM decides to call tool → returns tool_call with args
5. Backend executes tool
6. Tool result returned to LLM
7. LLM generates final response using tool results
```

### Tool Routing

Automatic forcing of specific tools based on keyword or regex patterns in user messages.

| Force Mode | Effect |
|------------|--------|
| `required` | Force this specific tool to be called |
| `preferred` | Force some tool call (LLM picks which) |
| `suggested` | Hint but don't force |

> See [Tools.md § Tool Routing](Tools.md#tool-routing) for rule configuration.

### Tool Dependencies

Some tools require API keys or other tools to be enabled:

| Tool | Requires |
|------|----------|
| `web_search` | TAVILY_API_KEY |
| `chart_gen` | `data_source` enabled |
| `send_email` | SENDGRID_API_KEY |
| `youtube` | SUPADATA_API_KEY (optional) |

> See [Tools.md § Tool Dependencies](Tools.md#tool-dependencies) for the full dependency panel.

---

## 6. Data Sources

**What it is:** External data connections (APIs and CSV files) that the AI can query to retrieve structured information. Data sources are linked to categories for access control.

> **Full Documentation:** See [Tools.md § Data Source Tool](Tools.md#data-source-tool) for complete query capabilities, visualization options, and examples.

### Storage
- **Table:** `data_api_configs` - API data source configurations
- **Table:** `data_csv_configs` - CSV data source configurations
- **Table:** `data_api_categories` - Links APIs to categories
- **Table:** `data_csv_categories` - Links CSVs to categories
- **Table:** `data_source_audit` - Audit trail of changes

### Data Source Types

| Type | Description |
|------|-------------|
| **API Data Sources** | External REST APIs with authentication and response mapping |
| **CSV Data Sources** | Uploaded CSV files with automatic column inference |

### Key Features

| Feature | Description |
|---------|-------------|
| **Filtering** | Field-based filters: eq, ne, gt, lt, gte, lte, contains, in |
| **Sorting** | Sort by any field, ascending or descending |
| **Pagination** | Limit and offset for large datasets |
| **Aggregation** | Server-side group_by with count/sum/avg/min/max |
| **Visualization** | Auto-selected charts: bar, line, pie, area, scatter, radar, table |

### API Data Source Structure

```typescript
interface DataAPIConfig {
  id: string;
  name: string;
  description: string;
  endpoint: string;                          // Full API URL
  method: 'GET' | 'POST';
  responseFormat: 'json' | 'csv';
  authentication: {
    type: 'none' | 'bearer' | 'api_key' | 'basic';
    credentials?: { /* encrypted */ };
  };
  parameters: DataAPIParameter[];            // Parameter definitions
  responseStructure: {
    jsonPath: string;                        // Path to data array
    fields: ResponseField[];                 // Field type definitions
  };
  categoryIds: number[];                     // Linked categories
  status: 'active' | 'inactive' | 'error' | 'untested';
}
```

#### CSV Data Sources
Uploaded CSV files stored on the server with automatic column inference.

```typescript
interface DataCSVConfig {
  id: string;
  name: string;
  description: string;
  filePath: string;                          // Server storage path
  columns: CSVColumn[];                      // Column definitions
  rowCount: number;
  categoryIds: number[];                     // Linked categories
}
```

### Query Capabilities

| Feature | Description |
|---------|-------------|
| **Filtering** | Field-based filters: eq, ne, gt, lt, gte, lte, contains, in |
| **Sorting** | Sort by any field, ascending or descending |
| **Pagination** | Limit and offset for large datasets |
| **Aggregation** | Server-side group_by with count/sum/avg/min/max |
| **Multi-dimensional grouping** | Group by multiple fields for cross-tabulation |

### Visualization

Data source responses include automatic visualization hints:
- **bar** - Default for categorical data
- **line** - Time series data
- **pie** - Part-to-whole (2-8 categories)
- **scatter** - Correlation analysis
- **radar** - Multi-metric comparison
- **table** - Raw data or single records

### Access Control
- Data sources are linked to categories
- Users can only query sources linked to their accessible categories
- Source availability is injected into the system prompt context

### Administration
```
Admin → Create API/CSV configs → Link to categories → Test connection → Activate
```

---

## 7. Function APIs

**What it is:** Dynamic function calling capability using OpenAI-format tool schemas. Administrators configure external APIs with explicit function definitions that the LLM can invoke directly.

> **Full Documentation:** See [Tools.md § Function API Tool](Tools.md#function-api-tool) for complete configuration, endpoint mapping, and examples.

### Key Difference from Data Sources
- **Data Sources**: Focus on data retrieval with querying/filtering
- **Function APIs**: Support arbitrary API operations (GET/POST/PUT/DELETE) with structured schemas

### Storage
- **Table:** `function_api_configs` - Function API configurations
- **Table:** `function_api_categories` - Links Function APIs to categories

### Configuration Structure

```typescript
interface FunctionAPIConfig {
  id: string;
  name: string;                              // Display name
  description: string;
  baseUrl: string;                           // e.g., "https://api.example.com"
  authType: 'api_key' | 'bearer' | 'basic' | 'none';
  toolsSchema: OpenAI.Chat.ChatCompletionTool[];
  endpointMappings: Record<string, { method: string; path: string; }>;
  categoryIds: number[];
  status: 'active' | 'inactive' | 'error' | 'untested';
}
```

### OpenAI Tool Schema Format

Functions are defined using standard OpenAI tool format:

```json
{
  "type": "function",
  "function": {
    "name": "get_user_stats",
    "description": "Retrieve user statistics for a given time period",
    "parameters": {
      "type": "object",
      "properties": {
        "user_id": { "type": "string" },
        "start_date": { "type": "string", "format": "date" },
        "end_date": { "type": "string", "format": "date" }
      },
      "required": ["user_id"]
    }
  }
}
```

### Dynamic Injection Flow

```
1. User selects category or starts conversation
2. System fetches Function APIs linked to that category
3. Tool definitions are added to LLM's available functions
4. LLM decides when to call functions based on user intent
5. System maps function name → endpoint, executes HTTP request
6. Response returned to LLM for final answer generation
```

### Response Format

```typescript
interface FunctionExecutionResult {
  success: boolean;
  data?: unknown;                            // API response
  metadata?: {
    source: string;                          // Config name
    functionName: string;
    executionTimeMs: number;
    cached: boolean;
  };
  error?: { code: string; message: string; };
}
```

### Use Cases
- Submit feedback to external systems
- Retrieve analytics from business APIs
- Trigger workflows in external services
- Query specialized databases

---

## 8. Memory

**What it is:** Persistent conversation context that allows follow-up questions and maintains continuity within threads. Includes extracted facts that persist across sessions.

### Storage
- **Table:** `messages` - Per-thread conversation history
- **Table:** `user_memories` - Extracted facts per user/category
- **Table:** `thread_summaries` - Summarized long threads
- **Table:** `archived_messages` - Original messages preserved after summarization

### Memory Extraction

The system automatically extracts important facts from conversations and stores them for future reference.

```typescript
interface MemorySettings {
  enabled: boolean;
  extractionThreshold: number;      // Min messages before extraction
  maxFactsPerCategory: number;      // Max facts stored per category
  autoExtractOnThreadEnd: boolean;  // Extract when thread ends
  extractionMaxTokens: number;      // Token budget for extraction
}
```

**How it works:**
1. After N messages, system analyzes conversation for key facts
2. Facts are extracted using LLM (e.g., "User prefers PDF format")
3. Facts stored in `user_memories` table by category
4. Injected into future prompts for personalization

**API:**
- `GET /api/user/memory` - View extracted memories
- `DELETE /api/user/memory` - Clear memories
- `GET /api/admin/memory/stats` - Memory extraction statistics

### Thread Summarization

Long threads are automatically summarized to reduce token usage while preserving context.

```typescript
interface SummarizationSettings {
  enabled: boolean;
  tokenThreshold: number;           // Trigger at this token count
  keepRecentMessages: number;       // Messages to keep unsummarized
  summaryMaxTokens: number;         // Max tokens for summary
  archiveOriginalMessages: boolean; // Preserve originals in archive
}
```

**How it works:**
1. When thread token count exceeds threshold
2. Older messages are summarized by LLM
3. Original messages moved to `archived_messages`
4. Summary stored in `thread_summaries`
5. Summary injected into context instead of full history

**API:**
- `GET /api/threads/{id}/summary` - Get thread summary
- `GET /api/threads/{id}/archived` - Get archived messages
- `GET /api/admin/summarization/stats` - Summarization statistics

### Conversation History

```typescript
interface LimitsSettings {
  conversationHistoryMessages: number;  // Messages included in context (default: 10)
}
```

### Example
```
User: "What is our leave policy?"
Bot: [responds with leave policy details]
User: "What about section 3?"  ← Bot understands from thread context

[Later session, different thread]
Bot: "I recall you previously asked about leave policy..." ← From extracted memory
```

---

## 9. Prompt Assembly Flow

When a user sends a message, the complete prompt is assembled in this order:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Global System Prompt                                      │
│    (from settings or config/system-prompt.md)               │
├─────────────────────────────────────────────────────────────┤
│ 2. + Category Addendum (if category selected)               │
│    "--- Category-Specific Guidelines ---"                   │
├─────────────────────────────────────────────────────────────┤
│ 3. + Resolved Skills                                        │
│    - Always skills                                          │
│    - Category index skills                                  │
│    - Matching keyword skills                                │
├─────────────────────────────────────────────────────────────┤
│ 4. + Memory Context (if enabled)                            │
├─────────────────────────────────────────────────────────────┤
│ 5. + Thread Summary (if available)                          │
├─────────────────────────────────────────────────────────────┤
│ 6. + RAG Context (knowledge base documents)                 │
├─────────────────────────────────────────────────────────────┤
│ 7. + Available Data Sources (injected for LLM awareness)    │
├─────────────────────────────────────────────────────────────┤
│ 8. + Available Function APIs (injected as tool definitions) │
├─────────────────────────────────────────────────────────────┤
│ 9. → Sent to OpenAI with Tool Definitions                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Comparison Table

| Aspect | System Prompt | Category Prompt | Starter Prompts | Skills | Tools | Data Sources | Function APIs | Memory |
|--------|--------------|-----------------|-----------------|--------|-------|--------------|---------------|--------|
| **Purpose** | Global AI behavior | Category-specific tuning | Quick conversation starters | Modular expertise injection | Extended capabilities | External data querying | Dynamic function calling | Conversation context |
| **Scope** | All conversations | Per-category | Per-category | Per-trigger (always/category/keyword) | Global + per-category | Per-category | Per-category | Per-thread |
| **User-facing?** | No | No | Yes (buttons) | No | Visible (outputs) | Visible (charts/data) | Visible (results) | No |
| **Configured by** | Admin | Admin/Superuser | Admin/Superuser | Admin | Admin | Admin | Admin | System |
| **Storage** | `settings` table | `category_prompts` | `category_prompts` | `skills` table | `tool_configs` | `data_*_configs` | `function_api_configs` | `messages` table |
| **Max length** | ~8000 chars (combined) | Remaining budget | 500 chars/prompt | Token budget | N/A | Record limits | N/A | Message window |

---

## Database Schema Overview

```sql
-- Global settings (system prompt, skills config, etc.)
settings (key, value, updated_at, updated_by)

-- Category-specific prompts and starters
category_prompts (category_id, prompt_addendum, starter_prompts, ...)

-- Skills definitions
skills (id, name, prompt_content, trigger_type, trigger_value, ...)

-- Skills linked to categories
category_skills (category_id, skill_id)

-- Tool configurations
tool_configs (tool_name, is_enabled, config_json, ...)

-- Category-specific tool overrides
category_tool_configs (category_id, tool_name, is_enabled, branding_json, ...)

-- API Data Sources
data_api_configs (id, name, endpoint, authentication, parameters, response_structure, ...)

-- CSV Data Sources
data_csv_configs (id, name, file_path, columns, row_count, ...)

-- Data source to category mappings
data_api_categories (api_id, category_id)
data_csv_categories (csv_id, category_id)

-- Data source audit trail
data_source_audit (source_type, source_id, action, changed_by, ...)

-- Function API configurations
function_api_configs (id, name, base_url, auth_type, tools_schema, endpoint_mappings, ...)

-- Function API to category mappings
function_api_categories (api_id, category_id)
```

---

## Key Settings Table Entries

| Key | Purpose |
|-----|---------|
| `system-prompt` | Global AI instructions |
| `skills-settings` | Master enable + token budget |
| `llm-settings` | Model, temperature, max tokens |
| `rag-settings` | Retrieval parameters |
| `memory-settings` | User memory extraction |
| `summarization-settings` | Thread summarization |
