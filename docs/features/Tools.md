# Tools System

This document describes the AI tools system that extends the bot's capabilities beyond text generation.

---

## Table of Contents

1. [Overview](#overview)
2. [Tool Categories](#tool-categories)
3. [Terminal Tools](#terminal-tools)
4. [Slash Commands](#slash-commands)
5. [Web Search Tool](#web-search-tool)
6. [Document Generator Tool](#document-generator-tool)
7. [PowerPoint Generator Tool](#powerpoint-generator-tool)
8. [Excel Generator Tool](#excel-generator-tool)
9. [Podcast Generator Tool](#podcast-generator-tool)
10. [Image Generator Tool](#image-generator-tool)
11. [Data Source Tool](#data-source-tool)
12. [Aggregate Data Tool](#aggregate-data-tool)
13. [Chart Generator Tool](#chart-generator-tool)
14. [Function API Tool](#function-api-tool)
15. [Task Planner Tool](#task-planner-tool) ⚠️ Deprecated
16. [YouTube Tool](#youtube-tool)
17. [Thread Sharing Tool](#thread-sharing-tool)
18. [Email Tool](#email-tool)
19. [Compliance Checker Tool](#compliance-checker-tool)
20. [Preflight Clarification (Pre-response HITL)](#preflight-clarification-pre-response-hitl)
21. [Diagram Generator Tool](#diagram-generator-tool)
22. [HTML Generator Tool](#html-generator-tool)
23. [File to HTML Tool](#file-to-html-tool)
24. [Website Analysis Tool](#website-analysis-tool)
25. [Code Quality Tool](#code-quality-tool)
26. [Load Test Tool](#load-test-tool)
27. [Tool Routing](#tool-routing)
28. [Tool Configuration](#tool-configuration)
29. [Category-Level Overrides](#category-level-overrides)
30. [Creating a New Tool](#creating-a-new-tool)
31. [API Reference](#api-reference)

---

## Overview

Tools are capabilities that extend the AI assistant beyond basic text generation. The system supports two types of tools:

| Category | Description | Invocation |
|----------|-------------|------------|
| **Autonomous** | LLM-triggered via OpenAI function calling | AI decides when to call |
| **Processor** | Post-response output processors | Applied after AI response |

### Architecture

```
User Message
    ↓
AI receives tool definitions (autonomous tools only)
    ↓
AI decides to call tool → returns tool_call with args
    ↓
Backend executes tool
    ↓
Tool result returned to AI
    ↓
AI generates final response using tool results
```

### Tool Execution Modes

When the LLM returns multiple tool calls in a single response, execution depends on the model's `parallel_tool_capable` flag (set per-model in Admin > Settings > LLM):

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Sequential** | `parallel_tool_capable = false` or single tool call | Tools execute one at a time, each awaiting the previous result |
| **Parallel** | `parallel_tool_capable = true` and 2+ tool calls | Independent tool calls execute concurrently via `Promise.allSettled()` |

**Parallel-capable models:** Claude, Gemini, Mistral Large, GPT-4.1, GPT-5-nano, GPT-5.2+, Fireworks-hosted models

**Sequential-only models:** GPT-5 (base), DeepSeek, Ollama, o1/o3/o4 reasoning models

**Edge cases in parallel mode:**
- `request_clarification` (HITL) calls are partitioned out and handled sequentially first
- Per-tool and total call limits are pre-validated atomically before dispatch
- Results are processed in original array order for message consistency
- Terminal tools (doc_gen, image_gen, etc.) still stop the tool loop on success

---

## Tool Categories

### Autonomous Tools

Autonomous tools are sent to OpenAI as function definitions. The LLM decides when to invoke them based on user queries.

**Current autonomous tools (24 registered in `src/lib/tools.ts`):**
- `web_search` - Search the web for current information (Tavily)
- `web_extract` - Extract content from specific URLs (Tavily)
- `web_crawl` - Crawl and explore websites (Tavily)
- `web_map` - Discover URLs on websites (Tavily)
- `doc_gen` - Generate formatted documents (PDF, DOCX, Markdown)
- `pptx_gen` - Generate PowerPoint presentations with multiple slide types
- `xlsx_gen` - Generate Excel spreadsheets with formulas and styling
- `podcast_gen` - Generate audio podcasts using Text-to-Speech
- `image_gen` - Generate images using Google AI (Gemini Nano Banana or Imagen 4)
- `diagram_gen` - Generate Mermaid diagrams (18 types: flowcharts, sequences, C4, Gantt, etc.)
- `translation` - Translate text using OpenAI, Gemini, or Mistral
- `data_source` - Query external APIs and CSV data with visualization
- `aggregate_data` - Server-side aggregation across data sources (group, count, sum, avg)
- `chart_gen` - Generate charts from LLM-constructed data
- `function_api` - Dynamic function calling with OpenAI-format schemas
- `html_gen` - Generate interactive HTML pages (dashboards, documentation, books)
- `file_to_html` - Convert DOCX/PDF documents to searchable HTML pages
- `website_analysis` - Google PageSpeed Insights, SSL/TLS cert checks, DNS inspection, cookie audits, redirect chain analysis
- `code_analysis` - SonarCloud static code quality analysis
- `load_testing` - k6 Cloud load test execution and reporting

**Processor-only tools (applied after AI response):**
- `youtube` - Extract transcripts from YouTube videos
- `share_thread` - Create shareable links for conversations
- `send_email` - Send emails via SendGrid
- `compliance_checker` - Post-response validation with weighted scoring and HITL

> **⚠️ Deprecated:** `task_planner` is no longer in AVAILABLE_TOOLS. Task planning has been superseded by the [Autonomous Agent](autonomous-mode.md) pipeline.

**Meta-tools (injected by the system, not DB-managed):**
- `request_clarification` - Pre-response HITL; injected when a skill has preflight clarification enabled. The LLM calls this to ask the user a focused question before generating its answer. See [Preflight Clarification](#preflight-clarification-pre-response-hitl).

### Processor Tools

Processor tools are applied to the AI's response after generation. They transform or enhance the output.

---

## Terminal Tools

### Purpose

Terminal tools are a special category of autonomous tools that produce final outputs (images, documents, charts, diagrams). When a terminal tool succeeds, the tool loop stops to prevent redundant re-execution, and the system automatically generates an LLM summary explaining what was created.

### Current Terminal Tools

| Tool | Output Type | Description |
|------|-------------|-------------|
| `image_gen` | Image | AI-generated images (Gemini, Imagen 4) |
| `doc_gen` | Document | PDF, DOCX, Markdown files |
| `pptx_gen` | Presentation | PowerPoint presentations (.pptx) |
| `xlsx_gen` | Spreadsheet | Excel spreadsheets (.xlsx) |
| `podcast_gen` | Audio | AI-generated podcast episodes (MP3/WAV) |
| `chart_gen` | Visualization | Interactive charts from LLM-constructed data |
| `diagram_gen` | Diagram | Mermaid diagrams (18 types: flowcharts, sequence, C4, architecture, timeline, quadrant, etc.) |

### Behavior

When a terminal tool executes successfully:

1. **Tool executes** - Generates the artifact (image, document, etc.)
2. **Artifact sent to client** - Via `onArtifact` callback
3. **Tool loop stops** - Prevents redundant tool calls
4. **LLM generates summary** - Automatically makes one more API call to explain what was created
5. **Summary streams to user** - Via `onChunk` callback alongside the artifact

This ensures users always receive both the artifact AND an explanatory text response.

### Implementation

Terminal tools are defined in `src/lib/openai.ts`:

```typescript
const TERMINAL_TOOLS = new Set(['image_gen', 'doc_gen', 'pptx_gen', 'xlsx_gen', 'podcast_gen', 'chart_gen', 'diagram_gen']);
```

### Adding New Terminal Tools

To add a new terminal tool:

1. **Add to TERMINAL_TOOLS set** in `src/lib/openai.ts`:
   ```typescript
   const TERMINAL_TOOLS = new Set([
     'image_gen', 'doc_gen', 'pptx_gen', 'xlsx_gen', 'podcast_gen',
     'chart_gen', 'diagram_gen',
     'new_tool'  // Add new tool here
   ]);
   ```

2. **Return consistent JSON structure** from the tool:
   ```typescript
   {
     success: true,
     document?: { id, filename, downloadUrl, ... },  // for documents
     imageHint?: { url, width, height, ... },        // for images
     audioHint?: { url, duration, ... },             // for audio
     // Additional metadata as needed
   }
   ```

3. **No other changes needed** - The generic summary prompt automatically handles any terminal tool by converting the tool name to a human-readable label (e.g., `ppt_gen` → "ppt generation").

### Summary Prompt

The system uses a generic prompt that works for any terminal tool:

```
The [tool label] tool has completed successfully. Based on the tool result above,
provide a brief, helpful summary (1-2 sentences) explaining what was created.
Mention key details like the output type/format and how the user can access or
download it. Do not use markdown formatting.
```

This generates natural, context-aware summaries without tool-specific hardcoding.

---

## Slash Commands

> **📖 Moved to dedicated doc:** See [`slash-commands.md`](slash-commands.md) for the complete Slash Commands reference — 16 predefined `/` commands, autocomplete UI, backend injection, admin registry, and database schema.

---

## Tavily Web Services (Web Search, Extract, Crawl, Map)

The Tavily integration provides four LLM-callable tools, all sharing a single API key and admin configuration:

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `web_search` | `POST /search` | Search the web for current information |
| `web_extract` | `POST /extract` | Extract full content from specific URLs (max 5) |
| `web_crawl` | `POST /crawl` | Discover and extract content from entire websites |
| `web_map` | `POST /map` | Discover all URLs on a website without extracting content |

All four tools are `subagentSafe: true` (read-only, no destructive side effects) and grouped under `group: 'tavily'` in the admin UI.

### Provider

**Tavily API** — optimized for AI applications with support for:
- Search depth: `ultra-fast`, `fast`, `basic`, `advanced`
- Topic filtering: `general`, `news`, `finance`
- Domain filtering (include/exclude)
- Recency filtering: `day`, `week`, `month`, `year`
- Date range: `start_date` / `end_date` (YYYY-MM-DD)
- Country boosting
- Image search with descriptions
- AI-generated answer summaries (`basic`/`advanced`)
- Raw content inclusion (`markdown`/`text`)
- Exact phrase matching
- Auto-parameter configuration

### Configuration

```typescript
interface TavilySettings {
  apiKey?: string;
  enabled: boolean;
  // Search defaults
  defaultTopic: 'general' | 'news' | 'finance';
  defaultSearchDepth: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
  maxResults: number;          // 1-20, default: 10
  includeDomains: string[];
  excludeDomains: string[];
  cacheTTLSeconds: number;
  includeAnswer?: 'none' | 'basic' | 'advanced';
  includeRawContent?: 'none' | 'markdown' | 'text';
  includeImages?: boolean;
  includeImageDescriptions?: boolean;
  includeFavicon?: boolean;
  exactMatch?: boolean;
  autoParameters?: boolean;
  timeRange?: 'none' | 'day' | 'week' | 'month' | 'year';
  country?: string;
  // Endpoint toggles
  extractEnabled?: boolean;
  crawlEnabled?: boolean;
  mapEnabled?: boolean;
  // Extract defaults
  extractDepth?: 'basic' | 'advanced';
  extractFormat?: 'markdown' | 'text';
  // Crawl defaults
  crawlLimit?: number;
  crawlMaxDepth?: number;
  crawlMaxBreadth?: number;
  crawlExtractDepth?: 'basic' | 'advanced';
  crawlFormat?: 'markdown' | 'text';
  crawlAllowExternal?: boolean;
  // Map defaults
  mapLimit?: number;
  mapMaxDepth?: number;
  mapMaxBreadth?: number;
  mapAllowExternal?: boolean;
}
```

### LLM Parameter Override

All search parameters follow the resolution chain: **LLM args > admin defaults > hardcoded fallback**. The LLM can override per-request:

| Parameter | Type | Values |
|-----------|------|--------|
| `query` | string | Search query (required) |
| `max_results` | number | 1-20 |
| `search_depth` | string | `basic`, `advanced`, `fast`, `ultra-fast` |
| `include_answer` | string | `none`, `basic`, `advanced` |
| `topic` | string | `general`, `news`, `finance` |
| `time_range` | string | `day`, `week`, `month`, `year` |
| `start_date` / `end_date` | string | `YYYY-MM-DD` |
| `include_raw_content` | string | `none`, `markdown`, `text` |
| `include_images` | boolean | |
| `include_favicon` | boolean | |
| `include_domains` | string[] | |
| `exclude_domains` | string[] | |
| `country` | string | Full country name |
| `auto_parameters` | boolean | |
| `exact_match` | boolean | |
| `chunks_per_source` | number | 1-3 (advanced depth only) |

### Per-Endpoint Tool Schemas

**web_search** — General web search:
```json
{ "name": "web_search", "parameters": { "query": "string (required)", "max_results": "number", "search_depth": "enum", "topic": "enum", ... } }
```

**web_extract** — Extract content from URLs:
```json
{ "name": "web_extract", "parameters": { "urls": "string[] (required, max 5)", "extract_depth": "enum", "query": "string (rerank)", "format": "enum" } }
```

**web_crawl** — Crawl websites:
```json
{ "name": "web_crawl", "parameters": { "url": "string (required)", "instructions": "string", "max_depth": "number (1-5)", "max_breadth": "number (1-500)", "limit": "number", "select_paths": "string[]", "extract_depth": "enum", "format": "enum" } }
```

**web_map** — Discover site URLs:
```json
{ "name": "web_map", "parameters": { "url": "string (required)", "instructions": "string", "max_depth": "number (1-5)", "limit": "number", "select_paths": "string[]" } }
```

### Caching

- Search results cached in Redis with configurable TTL (default: 1 hour)
- Extract/crawl/map results are not cached (content may change)
- Cache invalidated when Tavily configuration changes

### Example Usage

**web_search:** "What are the latest government guidelines on remote work?"
**web_extract:** "Read the full content of https://example.com/policy-doc"
**web_crawl:** "Explore all documentation pages on https://docs.example.com"
**web_map:** "List all pages on https://example.com, especially PDFs"

---

## Document Generator Tool

### Purpose

Enables the AI to generate formatted documents in multiple formats (PDF, DOCX, Markdown) with customizable branding.

### Supported Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| **PDF** | `.pdf` | Official documents, reports |
| **DOCX** | `.docx` | Editable Word documents |
| **Markdown** | `.md` | Technical documentation |

### Configuration

```typescript
interface DocGenConfig {
  defaultFormat: 'pdf' | 'docx' | 'md';
  enabledFormats: ('pdf' | 'docx' | 'md')[];
  branding: {
    enabled: boolean;
    logoUrl?: string;
    organizationName?: string;
    primaryColor?: string;      // Hex color (e.g., "#1E40AF")
    fontFamily?: string;
  };
  header: {
    enabled: boolean;
    content?: string;           // Header text
  };
  footer: {
    enabled: boolean;
    content?: string;           // Footer text
    includePageNumber: boolean;
  };
  expirationDays: number;       // 0 = never expire, default: 30
  maxDocumentSizeMB: number;    // 1-100, default: 50
}
```

### Default Configuration

```json
{
  "enabled": true,
  "config": {
    "defaultFormat": "pdf",
    "enabledFormats": ["pdf", "docx", "md"],
    "branding": {
      "enabled": false,
      "logoUrl": "",
      "organizationName": "",
      "primaryColor": "#1E40AF",
      "fontFamily": "Helvetica"
    },
    "header": {
      "enabled": false,
      "content": ""
    },
    "footer": {
      "enabled": false,
      "content": "",
      "includePageNumber": true
    },
    "expirationDays": 30,
    "maxDocumentSizeMB": 50
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "doc_gen",
  "description": "Generate a formatted document from the conversation content. Use this when the user asks for a report, summary, or document export.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Document title"
      },
      "content": {
        "type": "string",
        "description": "Document content in Markdown format"
      },
      "format": {
        "type": "string",
        "enum": ["pdf", "docx", "md"],
        "description": "Output format"
      }
    },
    "required": ["title", "content", "format"]
  }
}
```

### Document Builders

The document generation system uses specialized builders for each format:

| Builder | File | Technology |
|---------|------|------------|
| PDF Builder | `pdf-builder.ts` | PDFKit |
| DOCX Builder | `docx-builder.ts` | docx library |
| MD Builder | `md-builder.ts` | File writer |

### Storage and Expiration

- Generated documents are stored in `/uploads/outputs/`
- Documents can be set to expire after N days
- Download count is tracked per document
- Expired documents are automatically cleaned up

### Example Usage

**User:** "Create a PDF summary of our leave policy discussion"

**AI Response:**
> I've generated a PDF document summarizing our leave policy discussion.
>
> 📄 [Download Leave Policy Summary (PDF)](link)
>
> The document includes:
> - Annual leave entitlements
> - Application procedures
> - Approval workflow

---

## PowerPoint Generator Tool

### Purpose

Enables the AI to generate professional PowerPoint presentations (.pptx) with multiple slide types, visual themes, and optional AI-generated images.

### Features

- **Multiple Slide Types**: 7 different slide layouts
- **Visual Themes**: 4 pre-configured color themes
- **AI Image Integration**: Optional image generation for image slides
- **Speaker Notes**: Support for presenter notes on each slide
- **Branding Support**: Custom logos and organization names

### Supported Slide Types

| Type | Description | Content |
|------|-------------|---------|
| `title` | Opening slide | Title and subtitle |
| `content` | Standard content | Title with bullet points |
| `two-column` | Side-by-side | Two columns of content |
| `comparison` | Compare/contrast | Two boxes for pros/cons or before/after |
| `stats` | Key statistics | 2-4 large numbers with labels |
| `image` | Visual slide | Full-bleed background with AI-generated imagery |
| `closing` | Final slide | Thank you or contact information |

### Visual Themes

| Theme | Description |
|-------|-------------|
| `corporate` | Professional business look (default) |
| `modern` | Contemporary design |
| `minimal` | Clean, minimalist aesthetic |
| `bold` | Vibrant, eye-catching styling |

### Image Generation

Image slides support optional AI-generated imagery:

| Property | Description |
|----------|-------------|
| `imagePrompt` | Description of the desired image |
| `imageStyle` | Style: `auto`, `infographic`, `poster`, `illustration`, `photo`, `product-mockup`, `icon`, `social-media` |

Images integrate with the `image_gen` tool. If image generation fails or is unavailable, slides fall back to text content.

### Configuration

```typescript
interface PptxGenConfig {
  maxSlides: number;           // 1-20, default: 12
  maxImageSlides: number;      // 0-5, default: 3
  defaultTheme: 'corporate' | 'modern' | 'minimal' | 'bold';
  enableImageGeneration: boolean;  // Allow AI image generation
  branding: {
    enabled: boolean;
    logoUrl?: string;
    organizationName?: string;
  };
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "maxSlides": 12,
    "maxImageSlides": 3,
    "defaultTheme": "corporate",
    "enableImageGeneration": true,
    "branding": {
      "enabled": false,
      "logoUrl": "",
      "organizationName": ""
    }
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "pptx_gen",
  "description": "Generate a PowerPoint presentation with multiple slides and visual themes.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Presentation title"
      },
      "theme": {
        "type": "string",
        "enum": ["corporate", "modern", "minimal", "bold"],
        "description": "Visual theme for the presentation"
      },
      "slides": {
        "type": "array",
        "description": "Array of slide definitions (max 12)",
        "items": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": ["title", "content", "two-column", "comparison", "stats", "image", "closing"]
            },
            "title": { "type": "string" },
            "subtitle": { "type": "string" },
            "bullets": {
              "type": "array",
              "items": { "type": "string" }
            },
            "leftColumn": {
              "type": "object",
              "properties": {
                "title": { "type": "string" },
                "bullets": { "type": "array", "items": { "type": "string" } }
              }
            },
            "rightColumn": {
              "type": "object",
              "properties": {
                "title": { "type": "string" },
                "bullets": { "type": "array", "items": { "type": "string" } }
              }
            },
            "stats": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "value": { "type": "string" },
                  "label": { "type": "string" }
                }
              }
            },
            "imagePrompt": { "type": "string" },
            "imageStyle": {
              "type": "string",
              "enum": ["infographic", "photo", "illustration", "diagram"]
            },
            "speakerNotes": { "type": "string" }
          },
          "required": ["type"]
        }
      }
    },
    "required": ["title", "slides"]
  }
}
```

### Constraints

- Maximum **12 slides** per presentation
- Maximum **3 AI-generated image slides**
- Maximum payload size: **5 MB**
- 16:9 aspect ratio layout

### Example Usage

**User:** "Create a presentation about our Q4 results"

**AI Response:**
> I've generated a PowerPoint presentation summarizing your Q4 results.
>
> 📊 [Download Q4 Results Presentation (PPTX)](link)
>
> The presentation includes 8 slides:
> - Title slide
> - Executive summary
> - Revenue highlights (stats)
> - Regional breakdown (comparison)
> - Key achievements
> - Challenges and learnings
> - 2025 outlook
> - Thank you slide

---

## Excel Generator Tool

### Purpose

Enables the AI to generate Excel spreadsheets (.xlsx) with multiple sheets, formulas, formatting, and automatic styling.

### Features

- **Multiple Sheets**: Up to 10 sheets per workbook
- **Formula Support**: Full Excel formula syntax (=SUM, =AVERAGE, etc.)
- **Auto-Formatting**: Header styling, alternate row colors, auto-filter
- **Column Widths**: Custom or auto-calculated based on content
- **Data Types**: Strings, numbers, booleans, null values

### Configuration

```typescript
interface XlsxGenConfig {
  maxRows: number;              // 1-10000, default: 1000
  maxColumns: number;           // 1-100, default: 25
  maxSheets: number;            // 1-20, default: 10
  defaultHeaderStyle: 'bold' | 'highlighted' | 'bordered';
  enableAlternateRows: boolean;
  enableAutoFilter: boolean;
  enableFreezeHeader: boolean;
  branding: {
    organizationName?: string;  // Added to file creator metadata
  };
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "maxRows": 1000,
    "maxColumns": 25,
    "maxSheets": 10,
    "defaultHeaderStyle": "highlighted",
    "enableAlternateRows": true,
    "enableAutoFilter": true,
    "enableFreezeHeader": true,
    "branding": {
      "organizationName": ""
    }
  }
}
```

### Header Styles

| Style | Description |
|-------|-------------|
| `bold` | Simple bold text |
| `highlighted` | Bold text with blue background (#1E3A5F) |
| `bordered` | Bold text with background and borders |

### OpenAI Function Schema

```json
{
  "name": "xlsx_gen",
  "description": "Generate an Excel spreadsheet with multiple sheets, formulas, and formatting.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Workbook title (used for filename)"
      },
      "sheets": {
        "type": "array",
        "description": "Array of sheet definitions (max 10)",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "description": "Sheet name (max 31 characters)"
            },
            "headers": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Column headers"
            },
            "rows": {
              "type": "array",
              "items": {
                "type": "array",
                "items": {}
              },
              "description": "Data rows (strings, numbers, booleans, formulas)"
            },
            "columnWidths": {
              "type": "array",
              "items": { "type": "number" },
              "description": "Custom column widths (optional)"
            },
            "sheetType": {
              "type": "string",
              "enum": ["data", "summary", "template"],
              "description": "Sheet type hint"
            }
          },
          "required": ["name", "headers", "rows"]
        }
      },
      "headerStyle": {
        "type": "string",
        "enum": ["bold", "highlighted", "bordered"],
        "description": "Header formatting style"
      },
      "alternateRows": {
        "type": "boolean",
        "description": "Enable alternate row coloring"
      },
      "freezeHeader": {
        "type": "boolean",
        "description": "Freeze header row"
      },
      "autoFilter": {
        "type": "boolean",
        "description": "Enable auto-filter on headers"
      }
    },
    "required": ["title", "sheets"]
  }
}
```

### Formula Support

Excel formulas are supported in cell values:

```json
{
  "rows": [
    ["Product A", 100, 50, "=B2+C2"],
    ["Product B", 200, 75, "=B3+C3"],
    ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)", "=SUM(D2:D3)"]
  ]
}
```

### Constraints

- Maximum **1,000 rows** total across all sheets
- Maximum **25 columns** per sheet
- Maximum **10 sheets** per workbook
- Sheet names: **31 character** limit (Excel constraint)
- Maximum payload size: **5 MB**

### Example Usage

**User:** "Create a spreadsheet with our department budgets"

**AI Response:**
> I've generated an Excel spreadsheet with your department budgets.
>
> 📊 [Download Department Budgets (XLSX)](link)
>
> The workbook contains:
> - **Summary** sheet with totals and formulas
> - **Q1-Q4** sheets with quarterly breakdowns
> - Auto-calculated totals using SUM formulas
> - Formatted headers with alternate row colors

---

## Podcast Generator Tool

### Purpose

Enables the AI to convert text content into audio podcasts using Text-to-Speech (TTS). Supports multiple TTS providers, voice options, and a multi-speaker dialogue mode.

### Features

- **Multiple TTS Providers**: OpenAI and Google Gemini
- **Multi-Speaker Mode**: Host/Expert dialogue format (Gemini only)
- **Content Formatting**: Automatic conversion of tables, lists, and data to spoken format
- **Voice Selection**: 13 OpenAI voices, 30 Gemini voices with gender/category metadata
- **LLM Voice Auto-Selection**: Automatic voice selection based on accent descriptions

### TTS Providers

#### OpenAI TTS

| Property | Value |
|----------|-------|
| Model | `gpt-4o-mini-tts` |
| Output Format | MP3 |
| Voices | 13 available |
| Speed Control | 0.25x to 4.0x |

**OpenAI Voices:**
- **Recommended**: `marin`, `cedar` (best quality)
- **Others**: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`

#### Gemini TTS

| Property | Value |
|----------|-------|
| Models | `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts` |
| Output Format | WAV |
| Voices | 30 available |
| Multi-Speaker | ✅ Supported |

**Gemini Voice Categories:**

| Gender | Voices |
|--------|--------|
| Female (14) | Zephyr, Kore, Leda, Aoede, Callirrhoe, Autonoe, Despina, Erinome, Laomedeia, Achernar, Gacrux, Pulcherrima, Vindemiatrix, Sulafat |
| Male (16) | Puck, Charon, Fenrir, Orus, Enceladus, Iapetus, Umbriel, Algieba, Algenib, Rasalgethi, Alnilam, Schedar, Achird, Zubenelgenubi, Sadachbia, Sadaltager |

**Default Multi-Speaker Voices:**
- **Host**: Aoede (Breezy, conversational, female)
- **Expert**: Charon (Informative, male)

### Podcast Styles

| Style | Description | Use Case |
|-------|-------------|----------|
| `formal` | Professional and authoritative | Official communications, policy announcements |
| `conversational` | Friendly and approachable | Internal updates, team communications |
| `news` | Clear and objective | News broadcasts, reports |

### Podcast Length

| Length | Target Words | Duration |
|--------|--------------|----------|
| `short` | ~250 words | 1-2 minutes |
| `medium` | ~600 words | 3-5 minutes (default) |
| `long` | ~1,200 words | 8-10 minutes |

### Configuration

```typescript
interface PodcastGenConfig {
  defaultProvider: 'openai' | 'gemini';
  openai: {
    enabled: boolean;
    defaultVoice: string;
    defaultSpeed: number;      // 0.25-4.0, default: 1.0
  };
  gemini: {
    enabled: boolean;
    defaultModel: string;
    defaultVoice: string;
    enableMultiSpeaker: boolean;
    defaultHostVoice: string;
    defaultExpertVoice: string;
  };
  defaultStyle: 'formal' | 'conversational' | 'news';
  defaultLength: 'short' | 'medium' | 'long';
  expirationDays: number;      // 0-365, default: 30
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "defaultProvider": "openai",
    "openai": {
      "enabled": true,
      "defaultVoice": "marin",
      "defaultSpeed": 1.0
    },
    "gemini": {
      "enabled": false,
      "defaultModel": "gemini-2.5-flash-preview-tts",
      "defaultVoice": "Kore",
      "enableMultiSpeaker": true,
      "defaultHostVoice": "Aoede",
      "defaultExpertVoice": "Charon"
    },
    "defaultStyle": "conversational",
    "defaultLength": "medium",
    "expirationDays": 30
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "podcast_gen",
  "description": "Generate an audio podcast from text content using Text-to-Speech.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Podcast episode title"
      },
      "content": {
        "type": "string",
        "description": "Text content to convert to audio (min 50 characters)"
      },
      "provider": {
        "type": "string",
        "enum": ["openai", "gemini"],
        "description": "TTS provider to use"
      },
      "voice": {
        "type": "string",
        "description": "Voice name (provider-specific)"
      },
      "style": {
        "type": "string",
        "enum": ["formal", "conversational", "news"],
        "description": "Speaking style"
      },
      "length": {
        "type": "string",
        "enum": ["short", "medium", "long"],
        "description": "Target podcast length"
      },
      "speed": {
        "type": "number",
        "description": "Playback speed 0.25-4.0 (OpenAI only)"
      },
      "multiSpeaker": {
        "type": "boolean",
        "description": "Enable host/expert dialogue (Gemini only)"
      },
      "hostVoice": {
        "type": "string",
        "description": "Host voice for multi-speaker (Gemini only)"
      },
      "expertVoice": {
        "type": "string",
        "description": "Expert voice for multi-speaker (Gemini only)"
      },
      "hostAccent": {
        "type": "string",
        "description": "Description of host accent/persona for auto voice selection"
      },
      "expertAccent": {
        "type": "string",
        "description": "Description of expert accent/persona for auto voice selection"
      }
    },
    "required": ["title", "content"]
  }
}
```

### Content Processing

The tool automatically formats content for audio:

| Content Type | Processing |
|--------------|------------|
| Tables | Converted to narrative descriptions |
| Lists | Converted to verbal enumeration |
| Data/Charts | Described verbally with rounded numbers |
| Citations | Referenced naturally in speech |
| Acronyms | Spelled out on first use |
| Code blocks | Skipped with description of purpose |

### Multi-Speaker Mode (Gemini)

When `multiSpeaker: true`, content is formatted as a dialogue between a host and expert:

```
HOST: Welcome to today's episode where we'll discuss the new policy changes.

EXPERT: Thanks for having me. The key changes affect three main areas...

HOST: Can you elaborate on the first area?

EXPERT: Certainly. The first change relates to...
```

### Constraints

- Minimum **50 characters** of input content
- Maximum **4,000 characters** input (auto-truncated)
- Disabled by default (requires admin enablement)
- Provider must be explicitly enabled

### Example Usage

**User:** "Create a podcast summarizing this policy document"

**AI Response:**
> I've generated a podcast episode summarizing the policy document.
>
> 🎙️ [Listen to Policy Summary Podcast (MP3)](link)
>
> Episode details:
> - Duration: 4 minutes 32 seconds
> - Voice: Marin (OpenAI)
> - Style: Conversational
> - Word count: 580 words

**User:** "Create a two-person podcast discussing the Q4 results"

**AI Response:**
> I've generated a multi-speaker podcast discussing the Q4 results.
>
> 🎙️ [Listen to Q4 Discussion (WAV)](link)
>
> Episode details:
> - Duration: 6 minutes 15 seconds
> - Host: Aoede | Expert: Charon (Gemini)
> - Format: Host/Expert dialogue
> - Style: Conversational

---

## Image Generator Tool

### Purpose

Enables the AI to generate artistic raster images from text descriptions using Google AI models. Supports 8 visual styles with smart provider routing, automatic prompt enhancement, and cascading fallback.

### When to Use

- **Infographics**: Data/concept visualizations combining text, icons, and visual hierarchy
- **Posters**: Text-heavy promotional graphics with typography
- **Illustrations**: Artistic drawings for presentations and documents
- **Photos**: Photorealistic images and editorial photography
- **Product Mockups**: Commercial product photography and renders
- **Icons**: Simple graphics and iconography
- **Social Media**: Digital graphics, banners, and story content

### When NOT to Use

| Use Case | Correct Tool | Why |
|----------|-------------|-----|
| Data-accurate charts from real datasets | `chart_gen` | `image_gen` invents data; `chart_gen` plots real values interactively |
| Editable technical diagrams (flowcharts, ER diagrams, architecture) | `diagram_gen` | `image_gen` produces raster images; `diagram_gen` outputs editable Mermaid SVGs |
| Process flow diagrams | `diagram_gen` | Mermaid diagrams are editable and data-verifiable |

### Supported Styles

| Style | Description | Primary Provider |
|-------|-------------|------------------|
| `auto` | Intelligently selects best style based on prompt keywords | Classified dynamically |
| `infographic` | Data/concept visualizations with readable text | Gemini Pro |
| `poster` | Text-heavy promotional graphics with typography | Gemini Pro |
| `illustration` | Artistic drawings, sketches, concept art | Gemini Default |
| `photo` | Photorealistic images, editorial photography | Imagen 4 Ultra/Standard |
| `product-mockup` | Commercial product shots, 3D renders | Imagen 4 Ultra/Standard |
| `icon` | Simple icons, glyphs, minimalist graphics | Gemini Default |
| `social-media` | Digital graphics, banners, story content | Gemini Default |

### Providers and Models

| Provider | Model | Endpoint | Best For |
|----------|-------|----------|----------|
| **Gemini Nano Banana** | `gemini-3.1-flash-image-preview` | `:generateContent` | Speed, general purpose |
| **Gemini Nano Banana Pro** | `gemini-3-pro-image-preview` | `:generateContent` | Text-heavy images (infographics, posters) |
| **Imagen 4 Fast** | `imagen-4.0-fast-generate-001` | `:predict` | Quick photorealistic previews |
| **Imagen 4 Standard** | `imagen-4.0-generate-001` | `:predict` | Balanced photorealistic quality |
| **Imagen 4 Ultra** | `imagen-4.0-ultra-generate-001` | `:predict` | Maximum photorealistic fidelity |

Both provider families use the same Google API key. The unified provider (`src/lib/image-gen/providers/gemini-imagen.ts`) automatically routes to the correct endpoint based on model ID.

### Smart Routing

The system automatically selects the optimal provider based on the requested style:

```
User Request ("create an infographic about...")
    │
    ▼
┌─────────────────┐
│ LLM calls       │
│ image_gen with  │
│ style='infographic'
└─────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│                 IMAGE GENERATION PIPELINE                     │
│                                                              │
│  ┌───────────────┐    ┌───────────────┐    ┌──────────────┐ │
│  │ classifyPrompt│───▶│ selectPrimary │───▶│   enhance    │ │
│  │   (auto)      │    │   Provider    │    │   Prompt     │ │
│  └───────────────┘    └───────────────┘    └──────────────┘ │
│                              │                               │
│                              ▼                               │
│  ┌───────────────┐    ┌───────────────┐    ┌──────────────┐ │
│  │    ASCII      │◄───│   Fallback    │◄───│   Primary    │ │
│  │   Fallback    │    │   Provider    │    │   Provider   │ │
│  │   (sharp)     │    │               │    │              │ │
│  └───────────────┘    └───────────────┘    └──────────────┘ │
│                              │                               │
│                              ▼                               │
│                       ┌───────────────┐                      │
│                       │  processImage │                      │
│                       │  (webp/png)   │                      │
│                       └───────────────┘                      │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
Image displayed in chat + saved to thread artifacts
```

**Fallback Chain:**
1. **Primary Provider** — Determined by style routing table
2. **Cross-Provider Fallback** — If primary fails, try the other provider ecosystem
3. **ASCII Placeholder** — If all providers fail, generate a styled placeholder PNG with the prompt text

### Prompt Enhancement

When `enhancePrompts` is enabled (default), the system rewrites prompts using Google's recommended 5-part structure:

```
[TASK] [STYLE/SUBJECT] [TEXT/LABELS] [FORMAT] [CONSTRAINTS]
```

Example transformation:
- **Raw prompt:** "Q3 revenue infographic"
- **Enhanced prompt:** `[CREATE] [an infographic about Q3 revenue] [with text "Q3 Revenue: $12.4M"] [as a 16:9 widescreen image] [using bold sans-serif typography, high contrast, professional color palette]`

Text enclosed in quotes in the original prompt is preserved and emphasized.

### Configuration

```typescript
interface ImageGenConfig {
  activeProvider: 'gemini' | 'imagen' | 'none';
  providers: {
    gemini: {
      enabled: boolean;
      defaultModel: 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
      proModel: 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
      aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    };
    imagen: {
      enabled: boolean;
      fastModel: 'imagen-4.0-fast-generate-001';
      standardModel: 'imagen-4.0-generate-001';
      ultraModel: 'imagen-4.0-ultra-generate-001';
      aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    };
  };
  defaultStyle: 'auto' | 'infographic' | 'poster' | 'illustration' | 'photo' | 'product-mockup' | 'icon' | 'social-media';
  defaultResolution: '512' | '1K' | '2K' | '4K';
  enhancePrompts: boolean;
  addSafetyPrefixes: boolean;
  imageProcessing: {
    maxDimension: number;      // 1024-4096, default: 2048
    format: 'webp' | 'png' | 'jpeg';
    quality: number;           // 0-100, default: 85
    generateThumbnail: boolean;
    thumbnailSize: number;     // 100-800, default: 400
  };
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "activeProvider": "gemini",
    "providers": {
      "gemini": {
        "enabled": true,
        "defaultModel": "gemini-3.1-flash-image-preview",
        "proModel": "gemini-3-pro-image-preview",
        "aspectRatio": "16:9"
      },
      "imagen": {
        "enabled": true,
        "fastModel": "imagen-4.0-fast-generate-001",
        "standardModel": "imagen-4.0-generate-001",
        "ultraModel": "imagen-4.0-ultra-generate-001",
        "aspectRatio": "16:9"
      }
    },
    "defaultStyle": "infographic",
    "defaultResolution": "1K",
    "enhancePrompts": true,
    "addSafetyPrefixes": true,
    "imageProcessing": {
      "maxDimension": 2048,
      "format": "webp",
      "quality": 85,
      "generateThumbnail": true,
      "thumbnailSize": 400
    }
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "image_gen",
  "description": "Generate an artistic image from a text description. Best for infographics, posters, illustrations, photos, product mockups, icons, and social media graphics. NOT for data-accurate charts (use chart_gen) or editable technical diagrams (use diagram_gen).",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "Detailed description of the image. Be specific about content, style, colors, layout, and text. Enclose desired text in quotes."
      },
      "style": {
        "type": "string",
        "enum": [
          "auto",
          "infographic",
          "poster",
          "illustration",
          "photo",
          "product-mockup",
          "icon",
          "social-media"
        ],
        "description": "Visual style. Use 'auto' for intelligent selection, or specify: infographic (data/concept with text), poster (text-heavy promo), illustration (artistic), photo (photorealistic), product-mockup (commercial shots), icon (simple graphics), social-media (digital banners)."
      },
      "aspectRatio": {
        "type": "string",
        "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"],
        "description": "Aspect ratio. 16:9 for presentations, 1:1 for social media, 9:16 for mobile, 4:3 for documents, 3:4 for posters."
      },
      "resolution": {
        "type": "string",
        "enum": ["512", "1K", "2K", "4K"],
        "description": "Output resolution. 512 for previews, 1K for standard (default), 2K for high-fidelity, 4K for print."
      }
    },
    "required": ["prompt"]
  }
}
```

### Example Usage

**Infographic:**

> 🎨 [View Infographic]
>
> Prompt: "Annual sustainability report showing carbon reduction milestones from 2020-2024"
> - Style: `infographic`
> - Provider: Gemini Pro
> - Resolution: `2K`

**Product Mockup:**

> 🎨 [View Product Image]
>
> Prompt: "Minimalist white coffee mug on marble surface, soft studio lighting"
> - Style: `product-mockup`
> - Provider: Imagen 4 Ultra
> - Resolution: `4K`

---

## Data Source Tool

### Purpose

Enables the AI to query external data sources (APIs and CSV files) configured by administrators. Provides structured data retrieval with filtering, sorting, aggregation, and automatic visualization capabilities. Data sources are linked to categories for access control.

### Features

- **API Data Sources**: Connect to external REST APIs with authentication support
- **CSV Data Sources**: Upload and query CSV files with automatic column type inference
- **Category-Based Access**: Data sources are linked to categories; users only see sources for their accessible categories
- **Server-Side Aggregation**: Group, count, sum, average operations for large datasets
- **Automatic Visualization**: Smart chart type recommendation based on data characteristics
- **Caching**: Redis-based caching for API responses

### Supported Visualization Types

| Chart Type | Best For | Auto-Selection Criteria |
|------------|----------|------------------------|
| **bar** | Category comparisons | Default for categorical data |
| **line** | Time series data | Date/time fields detected |
| **pie** | Part-to-whole relationships | 2-8 categories with numeric values |
| **area** | Cumulative values over time | Similar to line but with volume emphasis |
| **scatter** | Correlation between variables | 2+ numeric fields, 30+ data points |
| **radar** | Multi-dimensional comparison | 3+ numeric fields, ≤10 records |
| **table** | Raw data display | Single records or aggregate results |

### Configuration

```typescript
interface DataSourceConfig {
  cacheTTLSeconds: number;      // 60-86400, default: 3600 (1 hour)
  timeout: number;              // 5-120 seconds, default: 30
  defaultLimit: number;         // 1-200 records, default: 30
  maxLimit: number;             // 1-500 records, default: 200
  defaultChartType: ChartType;  // default: 'bar'
  enabledChartTypes: ChartType[];  // default: all types
}
```

### Default Configuration

```json
{
  "enabled": true,
  "config": {
    "cacheTTLSeconds": 3600,
    "timeout": 30,
    "defaultLimit": 30,
    "maxLimit": 200,
    "defaultChartType": "bar",
    "enabledChartTypes": ["bar", "line", "pie", "area", "scatter", "radar", "table"]
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "data_source",
  "description": "Query external data sources (APIs and CSV files) to retrieve structured data.",
  "parameters": {
    "type": "object",
    "properties": {
      "source_name": {
        "type": "string",
        "description": "Name of the data source to query"
      },
      "parameters": {
        "type": "object",
        "description": "Parameters to pass to API sources"
      },
      "filters": {
        "type": "array",
        "description": "Filter conditions (field, operator, value)",
        "items": {
          "type": "object",
          "properties": {
            "field": { "type": "string" },
            "operator": { "type": "string", "enum": ["eq", "ne", "gt", "lt", "gte", "lte", "contains", "in"] },
            "value": {}
          }
        }
      },
      "sort": {
        "type": "object",
        "properties": {
          "field": { "type": "string" },
          "direction": { "type": "string", "enum": ["asc", "desc"] }
        }
      },
      "limit": { "type": "number" },
      "offset": { "type": "number" },
      "visualization": {
        "type": "object",
        "properties": {
          "chart_type": { "type": "string", "enum": ["bar", "line", "pie", "area", "scatter", "radar", "table"] },
          "x_field": { "type": "string" },
          "y_field": { "type": "string" },
          "group_by": { "type": "string" }
        }
      },
      "aggregation": {
        "type": "object",
        "description": "Server-side aggregation for large datasets",
        "properties": {
          "group_by": {
            "oneOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }],
            "description": "Field(s) to group by. Use array for multi-dimensional grouping."
          },
          "metrics": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "field": { "type": "string" },
                "operation": { "type": "string", "enum": ["count", "sum", "avg", "min", "max"] }
              }
            }
          }
        }
      }
    },
    "required": ["source_name"]
  }
}
```

### Data Source Types

#### API Data Sources

External REST APIs with configurable authentication, parameters, and response mapping.

```typescript
interface DataAPIConfig {
  id: string;
  name: string;                    // Unique display name
  description: string;
  endpoint: string;                // Full API endpoint URL
  method: 'GET' | 'POST';
  responseFormat: 'json' | 'csv';
  authentication: {
    type: 'none' | 'bearer' | 'api_key' | 'basic';
    credentials?: {
      token?: string;              // For bearer auth
      apiKey?: string;             // For api_key auth
      apiKeyHeader?: string;       // Header name (default: X-API-Key)
      apiKeyLocation?: 'header' | 'query';
      username?: string;           // For basic auth
      password?: string;
    };
  };
  headers?: Record<string, string>;
  parameters: DataAPIParameter[];  // Parameter definitions
  responseStructure: {
    jsonPath: string;              // Path to data array (e.g., "data.results")
    dataIsArray: boolean;
    fields: ResponseField[];       // Field definitions with types
    totalCountPath?: string;       // For pagination
  };
  sampleResponse?: object;         // Sample for LLM context
  openApiSpec?: object;            // Original spec if imported
  configMethod: 'manual' | 'openapi';
  categoryIds: number[];           // Categories with access
  status: 'active' | 'inactive' | 'error' | 'untested';
}
```

#### CSV Data Sources

Uploaded CSV files with automatic column inference and in-memory querying.

```typescript
interface DataCSVConfig {
  id: string;
  name: string;                    // Unique display name
  description: string;
  filePath: string;                // Server storage path
  originalFilename: string;
  columns: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date';
    description: string;
    format?: string;               // e.g., 'currency', 'percentage'
  }[];
  sampleData: object[];            // First 5 rows for preview
  rowCount: number;
  fileSize: number;                // In bytes
  categoryIds: number[];           // Categories with access
}
```

### Response Format

```typescript
interface DataQueryResponse {
  success: boolean;
  data: Record<string, unknown>[] | null;
  metadata: {
    source: string;
    sourceType: 'api' | 'csv';
    fetchedAt: string;
    cached: boolean;
    recordCount: number;
    totalRecords?: number;
    fields: string[];
    executionTimeMs: number;
  };
  visualizationHint?: {
    chartType: ChartType;
    xField?: string;
    yField?: string;
    groupBy?: string;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}
```

### Example Usage

**User:** "Show me the survey responses by region"

**AI calls data_source tool:**
```json
{
  "source_name": "Survey Data",
  "aggregation": {
    "group_by": "region",
    "metrics": [{ "field": "id", "operation": "count" }]
  }
}
```

**Response includes:**
- Aggregated data grouped by region with counts
- Auto-selected visualization hint (pie chart for categorical data)
- The frontend automatically renders an interactive chart

---

## Chart Generator Tool

### Purpose

Enables the AI to generate interactive charts from data it constructs itself (from knowledge base, web search results, or reasoning/analysis). Unlike the Data Source tool which queries pre-configured data sources, Chart Generator allows the LLM to build and visualize ad-hoc datasets.

### When to Use

| Use Case | Example |
|----------|---------|
| **Synthesized data** | "Chart the top SOEs in Trinidad by fiscal risk" |
| **Comparative analysis** | "Show a bar chart comparing GDP growth across Caribbean nations" |
| **Aggregated research** | "Visualize the distribution of policy violations by department" |

### When NOT to Use

- When a configured `data_source` can provide the data (use that instead)
- For simple lists or tables (use markdown formatting)
- When data exceeds 500 rows

### Configuration

```typescript
interface ChartGenConfig {
  maxDataRows: number;           // 10-1000, default: 500
  defaultChartType: ChartType;   // Fallback when auto-detection is unclear
  enabledChartTypes: ChartType[]; // Available chart types
}
```

### Default Configuration

```json
{
  "enabled": true,
  "config": {
    "maxDataRows": 500,
    "defaultChartType": "bar",
    "enabledChartTypes": ["bar", "line", "pie", "area", "scatter", "radar", "table"]
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "chart_gen",
  "description": "Generate an interactive chart from structured data you have constructed.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Descriptive chart title (e.g., 'Trinidad & Tobago SOEs - Fiscal Risk Assessment 2024')"
      },
      "data": {
        "type": "array",
        "items": { "type": "object" },
        "description": "Array of data objects with consistent keys. Maximum 500 rows."
      },
      "x_field": {
        "type": "string",
        "description": "Field name for X-axis (categories/labels). Must exist in data objects."
      },
      "y_fields": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Field name(s) for Y-axis values. Multiple fields create grouped/stacked charts."
      },
      "recommended_chart": {
        "type": "string",
        "enum": ["bar", "line", "pie", "area", "scatter", "radar", "table", "auto"],
        "description": "Recommended chart type. Use 'auto' to let system decide."
      },
      "series_mode": {
        "type": "string",
        "enum": ["grouped", "stacked", "auto"],
        "description": "How to display multiple y_fields: grouped (side-by-side) or stacked."
      },
      "notes": {
        "type": "string",
        "description": "Optional notes about data sources, methodology, or caveats."
      }
    },
    "required": ["title", "data", "x_field", "y_fields"]
  }
}
```

### Chart Type Auto-Selection

When `recommended_chart` is set to `auto`, the system selects based on data characteristics:

| Criteria | Selected Chart |
|----------|----------------|
| Multiple y_fields | Bar (grouped/stacked) |
| Date/time x_field | Line |
| 2-8 categories, ≤20 rows | Pie |
| 3+ metrics, ≤10 rows | Radar |
| Categorical x_field | Bar |
| Fallback | Default from config |

### Response Format

```typescript
interface ChartGenResponse {
  success: boolean;
  data: Record<string, unknown>[];
  metadata: {
    source: "LLM Generated";
    sourceType: "chart_gen";
    recordCount: number;
    fields: string[];
    executionTimeMs: number;
    cached: false;
  };
  visualizationHint: {
    chartType: ChartType;
    xField: string;
    yField: string;
  };
  chartTitle: string;
  notes?: string;
  seriesMode?: "grouped" | "stacked" | "auto";
}
```

### Notes Display

Notes are displayed in a collapsible accordion below the chart, allowing users to see data provenance, methodology, or caveats without cluttering the visualization.

### Example Usage

**User:** "Create a chart showing the top 5 Caribbean countries by GDP"

**AI calls chart_gen tool:**
```json
{
  "title": "Top 5 Caribbean Countries by GDP (2024)",
  "data": [
    {"country": "Trinidad & Tobago", "gdp_billions": 28.1},
    {"country": "Jamaica", "gdp_billions": 17.1},
    {"country": "Bahamas", "gdp_billions": 14.3},
    {"country": "Barbados", "gdp_billions": 5.6},
    {"country": "Suriname", "gdp_billions": 3.8}
  ],
  "x_field": "country",
  "y_fields": ["gdp_billions"],
  "recommended_chart": "bar",
  "notes": "Data sourced from IMF World Economic Outlook, October 2024. GDP in current USD billions."
}
```

**Result:** Interactive bar chart with country names on X-axis, GDP values on Y-axis, and collapsible notes section showing data source attribution.

---

## Diagram Generator Tool

### Purpose

Enables the AI to generate interactive Mermaid diagrams rendered directly in the chat with zoom, pan, SVG download, and PNG export. The tool calls a dedicated generator LLM with type-specific templates and sanitizes the output before returning it to the frontend.

### Supported Diagram Types (18)

| Type | Keyword | Best For |
|------|---------|----------|
| `flowchart` | `flowchart TD/LR/BT/RL` | Process flows, decision trees, step-by-step logic |
| `sequence` | `sequenceDiagram` | API calls, message exchanges between actors/services over time |
| `mindmap` | `mindmap` | Brainstorming, topic breakdowns, hierarchical concepts |
| `gantt` | `gantt` | Project schedules with tasks, durations, and dependencies |
| `timeline` | `timeline` | Chronological events grouped by time period (no durations) |
| `classDiagram` | `classDiagram` | OOP class structures, inheritance hierarchies |
| `stateDiagram` | `stateDiagram-v2` | State machines, lifecycle transitions |
| `erDiagram` | `erDiagram` | Database schemas, entity relationships |
| `journey` | `journey` | User experience flows with satisfaction scores (1–5) per step |
| `pie` | `pie` | Proportional distribution, percentage breakdowns |
| `block` | `block-beta` | Grid/column layout for architectural overviews |
| `quadrant` | `quadrantChart` | 2×2 matrix with named data points (effort/value, risk/impact) |
| `architecture` | `architecture-beta` | Infrastructure diagrams with services, groups, directional edges |
| `c4-context` | `C4Context` | High-level: users + systems + external dependencies |
| `c4-container` | `C4Container` | Internal containers (web app, API, DB) within a system |
| `c4-component` | `C4Component` | Components within a single container (experimental) |
| `c4-dynamic` | `C4Dynamic` | Numbered runtime message flow between containers (experimental) |
| `c4-deployment` | `C4Deployment` | Deployment topology — cloud nodes, VPCs, servers (experimental) |

### Configuration

```typescript
interface DiagramGenConfig {
  temperature: number;      // 0.0–1.0, default: 0.3 (lower = more deterministic)
  maxTokens: number;        // 500–4000, default: 1500
  validateSyntax: boolean;  // Validate before returning, default: true
  maxRetries: number;       // 0–5 retry attempts on validation failure, default: 2
  debugMode: boolean;       // Enable detailed logging, default: false
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "temperature": 0.3,
    "maxTokens": 1500,
    "validateSyntax": true,
    "maxRetries": 2,
    "debugMode": false
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "diagram_gen",
  "description": "Generate a Mermaid diagram rendered interactively in the chat.",
  "parameters": {
    "type": "object",
    "properties": {
      "diagram_type": {
        "type": "string",
        "enum": [
          "flowchart", "sequence", "mindmap",
          "c4-context", "c4-container", "c4-component", "c4-dynamic", "c4-deployment",
          "gantt", "timeline", "block", "quadrant",
          "classDiagram", "stateDiagram", "erDiagram",
          "pie", "journey", "architecture"
        ],
        "description": "Type of Mermaid diagram to generate."
      },
      "description": {
        "type": "string",
        "description": "Detailed description of what the diagram should show, including key elements, relationships, and labels."
      },
      "direction": {
        "type": "string",
        "enum": ["TD", "LR", "BT", "RL"],
        "description": "Direction for flowcharts: TD (top-down), LR (left-right), BT (bottom-top), RL (right-left). Default: TD"
      },
      "title": {
        "type": "string",
        "description": "Optional title for the diagram."
      }
    },
    "required": ["diagram_type", "description"]
  }
}
```

### Generation Pipeline

```
Chat LLM selects diagram_type
        ↓
diagram_gen tool called
        ↓
Generator LLM (type-specific template + example)
        ↓
Server-side sanitizer (validator.ts)
  - Normalize smart quotes, arrows, semicolons
  - Type-specific fixes (C4 camelCase, gantt modifiers, etc.)
  - Auto-upgrade stateDiagram v1 → v2
  - Normalize architecture-beta / block-beta / quadrantChart keywords
  - Clamp quadrant point coordinates to [0, 1]
        ↓
Syntax validation (regex, not full parse)
        ↓
Retry on failure (up to maxRetries)
        ↓
diagramHint returned to frontend
        ↓
Client-side sanitizer (MermaidDiagram.tsx) — mirrors server fixes
        ↓
mermaid.default.render() — real parse point
        ↓
SVG rendered in chat
```

### Sanitization Rules (Server + Client)

Both `src/lib/diagram-gen/validator.ts` and `src/components/markdown/MermaidDiagram.tsx` apply the same sanitization. Changes to one **must** be mirrored in the other (noted by comments in each file).

| Fix | Rule |
|-----|------|
| Smart quotes / arrows | `"` `"` → `"`, `→` → `-->`, `–` `—` → `-` |
| Trailing semicolons | Removed globally (Mermaid doesn't use them) |
| `title` directive in flowcharts | Bare `title Text` lines stripped (valid only in YAML frontmatter) |
| Single `->` in flowcharts | Upgraded to `-->` |
| `<` `>` in flowchart labels | Escaped to `&lt;` `&gt;` |
| URL paths in node labels | `[/api/path]` → `["/api/path"]` |
| `critical` in gantt | Renamed to `crit` |
| Inline `<<annotation>>` in classDiagram | Stripped from class definition lines |
| Dots/spaces in erDiagram entity names | Replaced with underscores |
| C4 camelCase names | `SystemExt` → `System_Ext`, `ContainerBoundary` → `Container_Boundary`, etc. |
| C4 Component/Deployment camelCase | `ComponentExt` → `Component_Ext`, `DeploymentNode` → `Deployment_Node` |
| Journey score format | `Task: 5 Actor` → `Task: 5: Actor` |
| `Section` casing in journey | Normalised to lowercase `section` |
| `stateDiagram` v1 | Auto-upgraded to `stateDiagram-v2` |
| `architecture` missing suffix | `architecture` → `architecture-beta` |
| `quadrant` missing suffix | `quadrant` → `quadrantChart` |
| `block` missing suffix | `block` → `block-beta` |
| Sequence activate stack overflow | Drops `deactivate` calls that would underflow the activation stack |
| Comma-separated participants | `participant A, B` expanded to individual lines |

### Response Format

```typescript
interface DiagramGenResponse {
  success: boolean;
  message?: string;
  diagramHint?: {
    code: string;           // Sanitized Mermaid code
    type: MermaidDiagramType;
    title?: string;
  };
  metadata?: {
    model: string;
    diagramType: MermaidDiagramType;
    processingTimeMs: number;
    retryCount: number;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}
```

### Example Usage

**User:** "Create an architecture diagram for the T-Bills portal"

**AI calls diagram_gen:**
```json
{
  "diagram_type": "c4-container",
  "description": "T-Bills portal with web frontend, API layer, PostgreSQL database, and OAuth identity provider",
  "title": "T-Bills Portal — Container Diagram"
}
```

**Result:** Interactive C4 container diagram rendered in chat with zoom controls and SVG/PNG download buttons.

---

**User:** "Show a priority quadrant for our feature backlog"

**AI calls diagram_gen:**
```json
{
  "diagram_type": "quadrant",
  "description": "Feature backlog plotted by implementation effort (x-axis) and business value (y-axis)",
  "title": "Feature Priority Matrix"
}
```

**Result:** 2×2 quadrant chart with labelled data points, rendered interactively in the chat.

---

## Function API Tool

### Purpose

Enables dynamic function calling with OpenAI-format tool schemas. Administrators configure external APIs with explicit function definitions that the LLM can invoke directly. Unlike the Data Source tool which focuses on data retrieval, Function API supports arbitrary API operations (GET, POST, PUT, DELETE) with structured input/output schemas.

### Features

- **OpenAI-Format Schemas**: Use standard OpenAI tool definition format
- **Multiple Functions Per API**: Define multiple operations for a single API
- **Category-Based Access**: Functions are linked to categories
- **Automatic Injection**: Functions are dynamically added to LLM tool list based on category context
- **Authentication Support**: API key, Bearer token, Basic auth
- **Response Caching**: Configurable TTL for repeated queries

### Configuration

Function API configurations store:

```typescript
interface FunctionAPIConfig {
  id: string;
  name: string;                    // Display name (e.g., "GEA Analytics API")
  description: string;

  // API Connection
  baseUrl: string;                 // Base URL (e.g., "https://api.example.com")
  authType: 'api_key' | 'bearer' | 'basic' | 'none';
  authHeader?: string;             // Header name (e.g., "X-API-Key")
  authCredentials?: string;        // Encrypted credentials
  defaultHeaders?: Record<string, string>;

  // Function Definitions (OpenAI format)
  toolsSchema: OpenAI.Chat.ChatCompletionTool[];

  // Endpoint Mappings
  endpointMappings: Record<string, {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;                  // Relative path (e.g., "/feedback")
  }>;

  // Settings
  timeoutSeconds: number;          // Default: 30
  cacheTTLSeconds: number;         // Default: 3600
  isEnabled: boolean;
  status: 'active' | 'inactive' | 'error' | 'untested';

  // Access Control
  categoryIds: number[];
}
```

### OpenAI Tool Schema Format

Each function is defined using the standard OpenAI tool format:

```json
{
  "type": "function",
  "function": {
    "name": "submit_feedback",
    "description": "Submit user feedback to the analytics system",
    "parameters": {
      "type": "object",
      "properties": {
        "user_id": {
          "type": "string",
          "description": "The user's unique identifier"
        },
        "rating": {
          "type": "integer",
          "description": "Rating from 1-5"
        },
        "comment": {
          "type": "string",
          "description": "Optional feedback comment"
        }
      },
      "required": ["user_id", "rating"]
    }
  }
}
```

### Endpoint Mapping

Each function name maps to an HTTP endpoint:

```json
{
  "submit_feedback": {
    "method": "POST",
    "path": "/feedback"
  },
  "get_user_stats": {
    "method": "GET",
    "path": "/users/stats"
  }
}
```

### Response Format

```typescript
interface FunctionExecutionResult {
  success: boolean;
  data?: unknown;                  // API response data
  metadata?: {
    source: string;                // Config name
    functionName: string;          // Function that was called
    executionTimeMs: number;
    cached: boolean;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}
```

### How It Works

1. **Admin Configuration**: Admin creates Function API config with tool schemas and endpoint mappings
2. **Category Assignment**: Functions are linked to specific categories
3. **Dynamic Injection**: When a user queries in a category, associated functions are added to the LLM's available tools
4. **LLM Invocation**: LLM decides when to call functions based on user intent
5. **Execution**: System maps function call to HTTP endpoint, executes, and returns result
6. **Response**: LLM uses the function result to generate the final response

### Example Configuration

```json
{
  "name": "Customer Feedback API",
  "baseUrl": "https://api.feedback.example.com",
  "authType": "api_key",
  "authHeader": "X-API-Key",
  "toolsSchema": [
    {
      "type": "function",
      "function": {
        "name": "get_feedback_summary",
        "description": "Get aggregated feedback statistics for a time period",
        "parameters": {
          "type": "object",
          "properties": {
            "start_date": { "type": "string", "format": "date" },
            "end_date": { "type": "string", "format": "date" },
            "category": { "type": "string" }
          },
          "required": ["start_date", "end_date"]
        }
      }
    }
  ],
  "endpointMappings": {
    "get_feedback_summary": {
      "method": "GET",
      "path": "/summary"
    }
  },
  "categoryIds": [1, 2]
}
```

---

## Task Planner Tool

> **⚠️ Deprecated:** `task_planner` is no longer registered in `AVAILABLE_TOOLS` (see [`src/lib/tools.ts`](../../src/lib/tools.ts)). Multi-step task planning has been superseded by the [Autonomous Agent](autonomous-mode.md) pipeline. This section is retained for reference.

### Purpose

Enables the AI to create and manage multi-step task plans for complex operations that require sequential work, progress tracking, and structured execution. This tool is ideal for assessments, research projects, and any multi-phase workflow.

### When to Use

| Use Case | Example |
|----------|---------|
| **Multi-entity assessments** | "Assess all SOEs in Trinidad" |
| **Sequential operations** | "Evaluate WASA's financial health using the 6-dimension framework" |
| **Complex analysis** | "Conduct a comprehensive policy review for the energy sector" |

### When NOT to Use

- Simple factual questions ("What is the debt of WASA?")
- Single-step lookups that can be answered with one web search
- Questions that don't require progress tracking

### Features

- **Template-based creation**: Use predefined templates configured per category
- **Custom task lists**: Create ad-hoc plans with explicit title and tasks
- **Placeholder substitution**: Templates support `{variable}` placeholders
- **Progress tracking**: Track task status (pending, in_progress, completed, failed, skipped)
- **Database persistence**: Plans are stored and can be resumed

### Configuration

Task Planner has minimal global configuration. Templates are configured per category.

```typescript
interface TaskPlannerConfig {
  // Currently no global settings - templates defined per category
}
```

### Default Configuration

```json
{
  "enabled": true,
  "config": {}
}
```

### Category Templates

Templates are defined in `category_tool_configs.config_json` for each category:

```typescript
interface TaskPlannerCategoryConfig {
  templates?: {
    [templateKey: string]: {
      name: string;             // Display name for LLM
      description: string;      // When to use this template
      active: boolean;          // Whether available for use
      placeholders: string[];   // Variables like ["country", "soe_name"]
      tasks: Array<{
        id: number;
        description: string;    // Can include {placeholders}
      }>;
      createdBy?: string;
      updatedBy?: string;
      updatedAt?: string;
    };
  };
}
```

### Example Template Configuration

```json
{
  "templates": {
    "country_assessment": {
      "name": "Country SOE Assessment",
      "description": "Assess all SOEs in a country",
      "active": true,
      "placeholders": ["country"],
      "tasks": [
        { "id": 1, "description": "Identify major SOEs in {country}" },
        { "id": 2, "description": "Search fiscal impact data (2020-2024)" },
        { "id": 3, "description": "Apply Pareto filter - top 20% by impact" },
        { "id": 4, "description": "Confirm priority SOEs with user" },
        { "id": 5, "description": "Assess SOEs using 6-dimension framework" },
        { "id": 6, "description": "Generate consolidated report" }
      ]
    }
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "task_planner",
  "description": "Create and manage multi-step task plans for complex operations.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["create", "start_task", "complete_task", "fail_task", "skip_task", "get_status", "complete_plan", "cancel_plan"],
        "description": "Action to perform on the task plan"
      },
      "template": {
        "type": "string",
        "description": "Template name from category config (for create action)"
      },
      "template_variables": {
        "type": "object",
        "additionalProperties": { "type": "string" },
        "description": "Placeholder values for template (e.g., {\"country\": \"Jamaica\"})"
      },
      "title": {
        "type": "string",
        "description": "Plan title (required for create if no template)"
      },
      "tasks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "number" },
            "description": { "type": "string" }
          },
          "required": ["id", "description"]
        },
        "description": "List of tasks (required for create if no template)"
      },
      "plan_id": {
        "type": "string",
        "description": "Plan ID (required for all actions except create)"
      },
      "task_id": {
        "type": "number",
        "description": "Task ID to update (for task actions)"
      },
      "result": {
        "type": "string",
        "description": "Result summary (for complete_task)"
      },
      "error": {
        "type": "string",
        "description": "Error description (for fail_task)"
      },
      "reason": {
        "type": "string",
        "description": "Skip reason (for skip_task)"
      },
      "summary": {
        "type": "string",
        "description": "Overall summary (for complete_plan)"
      }
    },
    "required": ["action"]
  }
}
```

### Task States

| State | Description |
|-------|-------------|
| `pending` | Task not yet started |
| `in_progress` | Currently being worked on |
| `completed` | Successfully completed with result |
| `failed` | Failed with error message |
| `skipped` | Skipped with reason |

### Plan States

| State | Description |
|-------|-------------|
| `active` | Plan in progress |
| `completed` | All tasks finished successfully |
| `cancelled` | Plan cancelled by user/LLM |
| `failed` | Plan failed (critical task failed) |

### Admin UI

Templates are managed in the Admin Dashboard under **Tools > Task Planner**:

1. **Select category** - Choose which category to configure
2. **View templates** - List of defined templates with status
3. **Create template** - Define new template with tasks and placeholders
4. **Edit template** - Modify template details, tasks, placeholders
5. **Activate/Deactivate** - Toggle template availability (Admin only can deactivate)
6. **Delete template** - Remove template (Admin only)

### Permission Model

| Role | Capabilities |
|------|-------------|
| **Admin** | Full control: add, edit, deactivate, delete templates for any category |
| **Superuser** | Can add and edit templates for their assigned categories only |

### Example Usage

**User:** "Assess all SOEs in Jamaica"

**AI calls task_planner with template:**
```json
{
  "action": "create",
  "template": "country_assessment",
  "template_variables": { "country": "Jamaica" }
}
```

**AI calls task_planner with custom tasks:**
```json
{
  "action": "create",
  "title": "Jamaica SOE Assessment",
  "tasks": [
    { "id": 1, "description": "Identify major SOEs in Jamaica" },
    { "id": 2, "description": "Research fiscal data for 2020-2024" },
    { "id": 3, "description": "Apply Pareto filter" }
  ]
}
```

**Progress update:**
```json
{
  "action": "complete_task",
  "plan_id": "abc-123",
  "task_id": 1,
  "result": "Identified 15 major SOEs including JUTC, NWC, and Petrojam"
}
```

---

## YouTube Tool

### Purpose

Enables the AI to extract transcripts from YouTube videos for analysis, summarization, or reference.

### Features

- **Transcript extraction**: Get full video transcripts
- **Language support**: Preferred language configurable
- **Fallback mechanism**: Uses youtube-transcript npm package if API unavailable

### Configuration

```typescript
interface YouTubeConfig {
  apiKey: string;              // YouTube Data API key (optional)
  preferredLanguage: string;   // Default: 'en'
  fallbackEnabled: boolean;    // Allow npm fallback, default: true
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "apiKey": "",
    "preferredLanguage": "en",
    "fallbackEnabled": true
  }
}
```

### OpenAI Function Schema

```json
{
  "name": "youtube",
  "description": "Extract transcript from a YouTube video for analysis or summarization.",
  "parameters": {
    "type": "object",
    "properties": {
      "video_url": {
        "type": "string",
        "description": "YouTube video URL or video ID"
      },
      "language": {
        "type": "string",
        "description": "Preferred language code (e.g., 'en', 'es')"
      }
    },
    "required": ["video_url"]
  }
}
```

### Example Usage

**User:** "Summarize this video: https://youtube.com/watch?v=xyz123"

**AI Response:**
> Based on the video transcript, here are the key points:
>
> 1. Introduction to policy framework
> 2. Implementation challenges
> 3. Recommended solutions
>
> Source: YouTube video "Policy Implementation Guide"

---

## HTML Generator Tool

### Purpose

Generates interactive, self-contained HTML pages from chat content using LLM-driven design. Supports 10 page types including dashboards with Chart.js, documentation sites, ebooks, reports, web page mockups, **playbooks**, **roadmaps**, **Gantt charts**, and **project plans**. Embeds Chart.js and Mermaid.js for data visualizations and diagrams.

### Page Types

| Type | Use Case |
|------|----------|
| `auto` | Auto-infer layout from content (default) |
| `dashboard` | Power BI-style analytical dashboard with KPI row, chart canvas, and optional filter/data side rails |
| `documentation` | Structured docs with TOC sidebar and search |
| `book` | Ebook-style chapters with metadata and language options |
| `report` | Formal report layout (executive summary, findings, recommendations) |
| `website` | Frontend webpage mockup (header, hero, sections, footer) |
| `playbook` | Interactive playbook with sticky top bar, hero search bar, accordion section cards derived from ## headings, and playbook footer branding |
| `roadmap` | Visual timeline page with phase cards, milestone markers, and a horizontal progress bar |
| `gantt` | Interactive Gantt chart with category filtering, legend, hover tooltips, today marker, and optional flag strip |
| `project_plan` | Same as `gantt` plus a KPI summary strip (task count, milestones, work streams, categories, timeline span) and a roll-up table grouped by work stream |

### Dashboard Schema

Dashboard pages use a **5-zone layout**: title bar, KPI row, chart canvas (12-column grid), optional left filters rail, and optional right data rail. The LLM produces these zones by embedding fenced JSON blocks inside the `content` string.

| Block | Zone | Description |
|-------|------|-------------|
| ` ```kpi ` | KPI row | 1-6 tiles with label, value, delta, sparkline |
| ` ```chart ` | Canvas | Quantitative panel with optional `size` and `tags` |
| ` ```filters ` | Left rail | Slicers (select, multiselect, search, daterange) |
| ` ```data ` | Right rail | KV stats + optional table |

#### KPI Block (` ```kpi `)
```json
{
  "label": "Total Revenue",
  "value": "$2.4M",
  "delta": "+12.4%",
  "trend_direction": "positive",
  "trend": [10, 12, 14, 15, 18, 20],
  "tags": ["region:north", "category:sales"]
}
```
- `trend_direction`: `"positive" | "negative" | "neutral"` (colours the delta)
- `trend`: optional sparkline array of numbers
- `tags`: optional array for slicer filtering

#### Chart Block (` ```chart `)
Same schema as the general `chart_gen` tool, with two dashboard-specific additions:
```json
{
  "title": "Monthly Revenue",
  "data": [{"month": "Jan", "revenue": 100}],
  "x_field": "month",
  "y_fields": ["revenue"],
  "recommended_chart": "bar",
  "size": "half",
  "tags": ["region:north"]
}
```
- `size`: `"hero" | "half" | "third" | "quarter"` (defaults to `"half"`)
- `tags`: optional array for slicer filtering

#### Filters Block (` ```filters `)
```json
{
  "title": "Filters",
  "slicers": [
    {
      "id": "region",
      "label": "Region",
      "type": "multiselect",
      "options": ["North", "South", "East", "West"],
      "tag_prefix": "region"
    },
    {
      "id": "date",
      "label": "Date Range",
      "type": "daterange"
    },
    {
      "id": "search",
      "label": "Search",
      "type": "search"
    }
  ]
}
```
- `type`: `"select" | "multiselect" | "search" | "daterange"`
- `tag_prefix`: matched against `tags` entries on KPIs and charts (intra-group OR, inter-group AND)
- Side rails are **optional** — only emit when filtering or supporting detail adds value

#### Data Block (` ```data `)
```json
{
  "title": "Details",
  "items": [
    {"label": "Total Records", "value": "1,284", "note": "as of today"},
    {"label": "Last Updated", "value": "14 May 2025"}
  ],
  "table": {
    "headers": ["Metric", "Value"],
    "rows": [["Avg Response Time", "42 ms"], ["Uptime", "99.9%"]]
  }
}
```
- `items`: array of stat items with optional `note`
- `table`: optional simple HTML table

### Playbook Branding Config

The playbook page type supports a `PlaybookBrandingConfig` with the following fields:

```typescript
interface PlaybookBrandingConfig {
  tagline: string;         // Tagline displayed in hero section
  heroSubtitle: string;   // Subtitle under the main title
  heroDate: string;       // Date shown in hero (e.g., "March 2025")
  footerEntity: string;    // Footer organization name
  footerAgency: string;    // Footer agency/department name
  footerDate: string;     // Footer date text
}
```

### Configuration

Configure in **Admin Panel → Tools → HTML Generator**:

| Setting | Default | Description |
|---------|---------|--------------|
| Default Page Type | `auto` | Page layout used when not specified |
| Enable Branding | `false` | Add organization branding to pages |
| Logo URL | — | URL or data URL of organization logo |
| Organization Name | — | Name displayed in page header |
| Primary Color | `#003366` | Primary color for headings and accents |
| Font Family | `Segoe UI, Arial, sans-serif` | Primary font for page text |
| Page Expiration | `30 days` | Days until generated pages expire |
| Max Page Size | `50 MB` | Maximum generated HTML page size |

### Gantt / Project Plan Schema

Gantt and project plan pages use a single ` ```gantt ` fenced JSON block inside the `content` argument.

```json
{
  "title": "Optional chart title",
  "subtitle": "Optional subtitle or date range label",
  "start_date": "2026-05-01",
  "end_date": "2027-02-28",
  "axis": "weeks",
  "flag_colors": ["#CE1126", "#FCD116", "#009E60"],
  "categories": [
    { "id": "onboarding",  "label": "Onboarding",  "color": "#1f4e79" },
    { "id": "training",    "label": "Training",    "color": "#2C5F7A" },
    { "id": "milestones",  "label": "Milestones",  "color": "#8B6914" }
  ],
  "tasks": [
    { "group": "Phase 1", "name": "Orientation",     "sub": "Week 1", "category": "onboarding", "start": "2026-05-04", "end": "2026-05-08" },
    { "group": "Phase 1", "name": "Onboarding session","sub": "Week 3","category": "onboarding", "start": "2026-05-18", "end": "2026-05-22" },
    { "group": "Phase 2", "name": "BA fundamentals", "sub": "Self-paced","category": "training",  "start": "2026-06-01", "end": "2026-06-26" },
    { "group": "Phase 2", "name": "Launch milestone","sub": "Go-live",  "category": "milestones","start": "2026-07-01", "type": "diamond" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `start_date` / `end_date` | ISO date strings (YYYY-MM-DD). Use the actual current year. |
| `axis` | `"weeks"` (default) \| `"months"` \| `"dates"` |
| `flag_colors` | Optional 3-color array for a decorative flag strip (e.g. national flag colors) |
| `categories` | Array of `{ id, label, color? }`. Colors are optional — branding.primaryColor is used as fallback. |
| `tasks[].group` | Section/phase heading that groups rows visually |
| `tasks[].name` | Task label shown in the left column |
| `tasks[].sub` | Optional subtitle shown below the name |
| `tasks[].category` | Must match a category `id` |
| `tasks[].start` / `end` | ISO date, or week token `"W1"`–`"Wn"`, or month token `"M1"`–`"Mn"` |
| `tasks[].type` | `"bar"` (default) \| `"diamond"` (milestone — no end date needed) |
| `tasks[].hatched` | `true` for a hatched/striped bar (indicates uncertainty or overlap) |
| `tasks[].detail` | Hover tooltip text |

The `project_plan` page type renders the same Gantt chart plus:
- **KPI strip**: total tasks, milestones, work streams, categories, timeline span
- **Roll-up table**: grouped by work stream with task counts and activity list

### OpenAI Function Schema

```json
{
  "name": "html_gen",
  "description": "Generate an interactive HTML page from content...",
  "parameters": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Page title" },
      "content": { "type": "string", "description": "Page content in markdown format" },
      "page_type": {
        "type": "string",
        "enum": ["auto", "dashboard", "documentation", "book", "report", "website", "playbook", "roadmap", "gantt", "project_plan"]
      }
    },
    "required": ["title", "content"]
  }
}
```

### Example Usage

**User:** "Create a playbook page for our employee onboarding policy"

**AI Response:**
```
I'll create an interactive playbook page for your employee onboarding policy. I'll structure it with section cards for each key area (preparation, first week, training, etc.) that users can expand and search.
```

**Function Call:**
```
html_gen({
  title: "Employee Onboarding Playbook",
  content: `
# Employee Onboarding Playbook

## Pre-Arrival Preparation
### IT Setup and Access
- Create company email account
- Set up laptop with required software
- Issue access badge and building keys

### Workspace Preparation
- Assign desk location and workspace
- Order welcome kit and equipment
- Set up workstation ergonomically

## First Day
### Welcome Orientation
- Company history and mission overview
- Meet the team and key stakeholders
- Office tour and facilities walkthrough

### HR Paperwork
- Employment contract signing
- Benefits enrollment
- Emergency contact information

## First Week
### Training Schedule
- Compliance and security training
- Role-specific tool training
- Department-specific processes

### Mentorship Program
- Assign onboarding buddy
- Schedule check-in meetings
- 30-60-90 day goal setting

## Compliance & Policy Review
### Required Training Modules
\`\`\`chart
{
  "title": "Training Module Completion",
  "data": [
    {"module": "Security", "progress": 0},
    {"module": "Ethics", "progress": 0},
    {"module": "Privacy", "progress": 0}
  ],
  "x_field": "module",
  "y_fields": ["progress"],
  "recommended_chart": "bar"
}
\`\`\`
`,
  page_type: "playbook"
})
```
**Result:** Interactive playbook HTML page with accordion cards, search bar, and playbook branding.

---

## File to HTML Tool

### Purpose

Converts uploaded DOCX or PDF documents to self-contained HTML pages with TOC sidebar, search, and organization branding. DOCX files retain embedded images as base64 data URIs for full fidelity.

### Supported File Types

| Format | Notes |
|--------|-------|
| `.docx` | **Preferred** — retains all embedded images as base64 |
| `.pdf` | Text extraction only (images not yet supported) |

### Page Types

| Type | Description |
|------|-------------|
| `documentation` | Standard TOC/sidebar page (default) |
| `playbook` | Card-based interactive playbook layout derived from document ## headings |

### Configuration

Configure in **Admin Panel → Tools → File to HTML**:

| Setting | Default | Description |
|---------|---------|--------------|
| Enable File to HTML | `true` | Allow converting documents to HTML |
| Enable Branding | `false` | Add organization branding to HTML pages |
| Logo URL | — | URL or data URL of organization logo |
| Organization Name | — | Name displayed in page header |
| Primary Color | `#003366` | Primary color for headings and accents |
| Font Family | `Segoe UI, Arial, sans-serif` | Primary font for page text |
| Document Expiration | `30 days` | Days until converted pages expire |

### OpenAI Function Schema

```json
{
  "name": "file_to_html",
  "description": "Convert an uploaded DOCX or PDF document to a self-contained HTML page...",
  "parameters": {
    "type": "object",
    "properties": {
      "filename": { "type": "string", "description": "Filename of uploaded document" },
      "title": { "type": "string", "description": "Title for the HTML page" },
      "page_type": {
        "type": "string",
        "enum": ["documentation", "playbook"]
      }
    },
    "required": []
  }
}
```

### Example Usage

**User:** "Upload this policy document and convert it to a playbook HTML page"

1. User uploads `onboarding-policy.docx`
2. **AI Response:**
```
I'll convert your policy document to an interactive playbook HTML page with searchable accordion sections derived from the document headings.
```

3. **Function Call:**
```
file_to_html({
  filename: "onboarding-policy.docx",
  title: "Onboarding Policy Playbook",
  page_type: "playbook"
})
```
**Result:** Interactive playbook HTML page with sections from the document headings, search bar, and download button.

---

## Thread Sharing Tool

### Purpose

Enables users to share conversation threads with colleagues via secure, expiring links. Shared threads require authentication to view, ensuring data remains protected.

### Features

- **Secure Share Links**: Cryptographically generated tokens (32 bytes, URL-safe base64)
- **Expiration Control**: Optional expiry dates for time-limited access
- **Download Permissions**: Toggle whether recipients can download attached files
- **View Tracking**: Track how many times a shared thread has been viewed
- **Access Logging**: Audit trail of who accessed shared content
- **Email Notifications**: Optional email alerts when sharing (requires `send_email` tool)

### Configuration

```typescript
interface ShareThreadConfig {
  defaultExpiryDays: number;        // Default share expiry (7 = 7 days, null = never)
  allowDownloadsByDefault: boolean; // Default download permission
  allowedRoles: ('admin' | 'superuser' | 'user')[]; // Who can share
  maxSharesPerThread: number;       // Limit shares per thread (default: 10)
  rateLimitPerHour: number;         // Admin-configurable rate limit
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "defaultExpiryDays": 7,
    "allowDownloadsByDefault": true,
    "allowedRoles": ["admin", "superuser", "user"],
    "maxSharesPerThread": 10,
    "rateLimitPerHour": 20
  }
}
```

### User Interface

#### Sharing a Thread

1. Click the **Share** button on a thread in the sidebar
2. Configure share settings:
   - **Allow Downloads**: Toggle file download permissions
   - **Expiry**: Set expiration (7 days, 30 days, 90 days, or never)
   - **Email Notification**: Optionally send email to recipients
3. Click **Create Share Link**
4. Copy the generated link or send via email

#### Managing Shares

- View active shares for your threads
- See view count for each share
- Revoke shares at any time

### Shared Thread View

When a recipient accesses a shared link:

1. They must authenticate (sign in required)
2. They see the full conversation history
3. Sources and citations are visible
4. Generated files appear inline with their messages
5. If downloads are enabled, files can be downloaded

### Example Usage

**User clicks Share on a thread:**

**Share Modal:**
> Share this conversation
>
> 🔗 Copy Link  |  📧 Send Email
>
> Options:
> - [x] Allow file downloads
> - Expires: 7 days ▼
>
> [Create Share]

**After creating:**
> ✅ Share link created!
>
> `https://ai.abhirup.app/shared/abc123xyz...`
>
> Link expires: Jan 8, 2026

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/threads/[threadId]/share` | Create new share |
| GET | `/api/threads/[threadId]/share` | List shares for thread |
| PATCH | `/api/shares/[shareId]` | Update share settings |
| DELETE | `/api/shares/[shareId]` | Revoke share |
| GET | `/api/shared/[token]` | View shared thread |
| GET | `/api/shared/[token]/download/[type]/[id]` | Download file |

---

## Email Tool

### Purpose

Enables sending email notifications via SendGrid. Used by other tools (like `share_thread`) to send alerts and notifications.

### Features

- **SendGrid Integration**: Reliable email delivery
- **Admin-Configurable Sender**: Customize sender email and name
- **Rate Limiting**: Prevent abuse with configurable limits

### Configuration

```typescript
interface SendEmailConfig {
  sendgridApiKey: string;      // SendGrid API key
  senderEmail: string;         // Sender email address
  senderName: string;          // Display name (default: "AI Assistant")
  rateLimitPerHour: number;    // Rate limit (default: 50)
}
```

### Default Configuration

```json
{
  "enabled": false,
  "config": {
    "sendgridApiKey": "",
    "senderEmail": "",
    "senderName": "AI Assistant",
    "rateLimitPerHour": 50
  }
}
```

### Setup

1. Navigate to **Admin > Tools > Email**
2. Enable the tool
3. Enter your SendGrid API key
4. Configure sender email (must be verified in SendGrid)
5. Set sender name
6. Save and test

### Email Templates

#### Thread Share Notification

When a user shares a thread with email notification:

```
Subject: [User Name] shared a conversation with you

Hi,

[User Name] has shared an AI Assistant conversation with you:

"[Thread Title]"

View the conversation: [Share Link]

This link will expire on [Expiry Date].

---
AI Assistant
```

### Example Usage

The email tool is typically used by other tools rather than directly by users:

```typescript
// Used internally by share_thread tool
await sendShareNotification({
  recipientEmail: 'colleague@example.com',
  sharedBy: 'John Doe',
  threadTitle: 'Leave Policy Discussion',
  shareUrl: 'https://ai.abhirup.app/shared/abc123',
  expiresAt: new Date('2026-01-08')
});
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Emails not sending | Verify SendGrid API key is valid |
| Emails going to spam | Verify sender domain in SendGrid |
| Rate limit errors | Increase `rateLimitPerHour` or wait |
| Invalid sender | Use a verified sender email in SendGrid |

---

## KB Summary Tool

### Purpose

Provides a summary overview of all documents in the knowledge base for the current thread's categories. The LLM calls this tool when the user asks about KB contents — no regex-based intent detection needed.

### How It Works

1. User asks "what documents do you have?" or "summarise the KB" (any phrasing)
2. LLM recognizes the intent and calls `kb_summary`
3. Tool fetches pre-computed per-document summaries from the `document_summaries` table
4. For ≤3 documents: returns individual summaries directly
5. For >3 documents: synthesizes a consolidated category overview via LLM
6. LLM incorporates the overview into its response

### Prerequisites

- Documents must have summaries generated (Admin > Documents > Summarise All)
- New documents get summaries automatically on upload
- Thread must have categories selected

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | `true` | Toggle in Admin > Tools |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/tools/kb-summary.ts` | Tool definition and execution |
| `src/lib/document-summarizer.ts` | Per-document summary generation + category synthesis |
| `src/lib/db/compat/document-summaries.ts` | Database CRUD for `document_summaries` table |

### Admin API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/document-summaries/generate` | POST | Generate summaries (`{ documentId }`, `{ categoryId }`, or `{ all: true }`) |
| `/api/admin/document-summaries` | GET | Get summary statistics and doc IDs with summaries |

---

## Compliance Checker Tool

### Purpose

Validates AI responses against compliance rules and triggers Human-in-the-Loop (HITL) clarification when issues are detected. This processor tool runs after the AI generates a response, checking for missing sections, failed tool executions, empty results, and artifact failures.

### Type

**Processor Tool** - Runs after AI response generation, not during (unlike autonomous tools).

### Features

- **Weighted Scoring**: Different check types have different importance weights
- **Configurable Thresholds**: Set pass/warn thresholds for your compliance needs
- **HITL Clarification**: Intelligent dialog when issues are detected
- **LLM-Generated Questions**: Contextual questions based on specific failures
- **Template Fallbacks**: Pre-defined questions for common scenarios
- **Opt-In Model**: Only runs for skills with compliance explicitly enabled

### When It Runs

Compliance checking runs when ALL of these conditions are met:

1. `compliance_checker` tool is enabled globally (Admin > Tools)
2. At least one matched skill has `complianceConfig.enabled = true`

If no skills have compliance enabled, the check is skipped entirely.

### Configuration

```typescript
interface ComplianceCheckerConfig {
  // Core settings
  enabled: boolean;              // Enable/disable globally
  passThreshold: number;         // 0-100, default: 80
  warnThreshold: number;         // 0-100, default: 50
  enableHitl: boolean;           // Show HITL dialog, default: true
  useWeightedScoring: boolean;   // Weight checks by type, default: true

  // Clarification LLM settings
  clarificationProvider: 'auto' | 'openai' | 'gemini' | 'mistral';
  clarificationModel: string;    // Empty = use default LLM
  useLlmClarifications: boolean; // Use LLM for questions, default: true
  clarificationTimeout: number;  // ms, default: 5000
  fallbackToTemplates: boolean;  // Use templates if LLM fails, default: true

  // HITL options
  allowAcceptFlagged: boolean;   // Show "Accept & Flag" option, default: true
}
```

### Default Configuration

```json
{
  "enabled": true,
  "config": {
    "passThreshold": 80,
    "warnThreshold": 50,
    "enableHitl": true,
    "useWeightedScoring": true,
    "clarificationProvider": "auto",
    "clarificationModel": "",
    "useLlmClarifications": true,
    "clarificationTimeout": 5000,
    "fallbackToTemplates": true,
    "allowAcceptFlagged": true
  }
}
```

### Weighted Scoring

When `useWeightedScoring` is enabled, checks are weighted by importance:

| Check Type | Weight | Description |
|------------|--------|-------------|
| `artifact_valid` | 30% | Chart/document generation failures |
| `tool_success` | 25% | Tool execution errors |
| `data_returned` | 25% | Empty results from searches/queries |
| `sections_present` | 20% | Missing required markdown sections |

### Decision Flow

```
Response Generated
       ↓
Run Compliance Checks
       ↓
Calculate Weighted Score
       ↓
┌─────────────────────────────────────┐
│ Score >= passThreshold (80)?        │
│   YES → Pass (green badge)          │
│   NO  ↓                             │
│ Score >= warnThreshold (50)?        │
│   YES → Warn (yellow badge)         │
│   NO  → HITL (red badge + dialog)   │
└─────────────────────────────────────┘
```

### HITL Clarification

When score falls below `warnThreshold`, a clarification dialog appears:

1. **Analyze Failures**: System identifies what went wrong
2. **Generate Questions**: LLM creates contextual questions (or templates if LLM fails)
3. **User Response**: User selects options or provides free text
4. **Actions Available**:
   - `Continue` - Apply selections and retry
   - `Accept` - Accept current response as-is
   - `Accept & Flag` - Accept but mark for admin review
   - `Cancel` - Cancel the response

### Template Clarifications

When LLM clarification fails or is disabled, these templates are used:

| Failure Type | Template Question |
|--------------|-------------------|
| Empty web search | "How should I proceed? Try broader search / Skip search / Custom terms" |
| Chart no data | "Use text table instead / Skip visualization / Show placeholder" |
| Missing section | "Add with available data / Add with 'Data unavailable' / Remove requirement" |
| Document failed | "Try generating again / Provide as text / Skip generation" |

### Clarification Provider Settings

The compliance checker can use a separate LLM for generating clarification questions:

- **Auto**: Uses the same provider/model from main LLM Settings
- **OpenAI/Gemini/Mistral**: Use specific provider with model dropdown
- **Tip**: Use cheaper/faster models (e.g., gpt-4.1-mini) since clarifications are simple

### Admin UI

Configure in **Admin > Tools > Compliance Checker**:

1. **Enable/Disable**: Toggle compliance checking globally
2. **Thresholds**: Set pass (70-80 recommended) and warn (40-60) thresholds
3. **Scoring**: Enable weighted scoring for importance-based calculation
4. **HITL Settings**: Configure clarification provider, model, timeout
5. **Fallback Options**: Enable template fallbacks and "Accept & Flag"

### Example: Compliance Check Result

```typescript
{
  decision: 'warn',
  score: 65,
  checksPerformed: [
    { checkType: 'tool_success', target: 'web_search', passed: true, weight: 25 },
    { checkType: 'data_returned', target: 'web_search', passed: false, weight: 25 },
    { checkType: 'sections_present', target: '## Summary', passed: true, weight: 20 },
    { checkType: 'artifact_valid', target: 'chart_gen', passed: false, weight: 30 }
  ],
  failedChecks: ['data_returned', 'artifact_valid'],
  issues: ['Web search returned no results', 'Chart has no data points'],
  badgeType: 'warning',
  badgeText: '65% - Issues Found'
}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/hitl` | Submit user's HITL clarification response |
| GET | `/api/admin/compliance/stats` | Get compliance statistics and analytics |

### Database

Compliance results are logged to `compliance_results` table for audit and analytics.

---

## Preflight Clarification (Pre-response HITL)

### Purpose

Pauses the pipeline **before** the AI generates a response to collect missing context from the user. When enabled on a skill, the main LLM receives a `request_clarification` meta-tool and calls it only when the user's query is genuinely ambiguous — after reviewing all documents, conversation history, system prompt, and category prompts.

### Type

**Meta-tool** — Injected by the system at request time. Not visible in Admin > Tools and not DB-managed. Enabled via skill-level `preflightClarification` configuration and the global `preflightEnabled` toggle.

### Key Difference from Compliance Checker HITL

| Aspect | Preflight Clarification | Compliance Checker HITL |
|--------|------------------------|------------------------|
| **Timing** | Before response generation | After response generation |
| **Trigger** | Query ambiguous given full context | Response fails compliance checks |
| **Questions** | LLM generates from query context | LLM generates from response failures |
| **Outcome** | Answer injected as LLM context; response generated with it | User retries, accepts, or flags the response |

### Decision Flow

```
User message + RAG context assembled
        ↓
Main LLM receives: documents + prompts + history + message
        ↓
┌──────────────────────────────────────────────┐
│ Is preflight enabled for matched skill?      │
│   NO  → Skip, generate response directly     │
│   YES ↓                                      │
│ LLM decides: call request_clarification?     │
│   NO  → Generate response directly           │
│   YES → Show HITL dialog (2–4 options)       │
└──────────────────────────────────────────────┘
        ↓ (if dialog shown)
User responds → answer injected as tool result
        ↓
LLM generates response with clarification in context
```

### Why the LLM Makes Fewer Mistakes

Because the model sees the full RAG context before deciding, it can reason: *"The documents include a Retirement Benefits Policy that covers this. No clarification needed."* A separate preflight model with only the raw message cannot make that judgment.

### Constraints

- Disabled automatically for **Ollama models** (context budget is too tight for meta-tools)
- Requires **global** `preflightEnabled = true` (Admin > Compliance) **and** per-skill opt-in
- At most one clarification question per response cycle

### Configuration

Configured at the skill level. See **[Skills System — Preflight Clarification](SKILLS.md#preflight-clarification-pre-response-hitl)** for the full field reference and example skill config.

**Global settings (Admin > Compliance):**

| Setting | Default | Description |
|---------|---------|-------------|
| `preflightEnabled` | false | Master switch — must be enabled for any skill to use preflight |
| `preflightDefaultTimeoutMs` | 300000 | Default user wait time (5 min, max 15 min) |
| `preflightMaxQuestions` | 2 | Max questions per request (1–4) |
| `preflightSkipOnFollowUp` | true | Skip when message is a follow-up |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/preflight` | Submit user's answer to a preflight clarification question |

---

## Website Analysis — SSL/TLS Checks

> **Note:** SSL/TLS certificate validation is a feature of the [`website_analysis`](#website-analysis-tool) tool, not a standalone tool. Configure via Admin → Tools → Website Analysis.

### Purpose

Performs SSL/TLS security assessment of a domain. Returns a letter grade (A+ through F), certificate details, protocol version, cipher vulnerabilities, and forward secrecy status.

### Provider

**SSL Labs API v4** (Qualys) — industry-standard TLS grading service.

> **Note:** SSL Labs API v3 was deprecated on January 1st 2024. This tool uses v4, which requires a one-time registration.

**Fallback:** If SSL Labs is unavailable or no email is configured, the tool performs a **direct TLS check** using Node.js `tls.connect()`. This provides certificate expiry, issuer, and protocol version but does **not** produce a letter grade.

### SSL Labs v4 Registration (Required for graded scan)

SSL Labs v4 requires a one-time free registration with an **organisation email** (not Gmail/Yahoo/Hotmail).

**Step 1 — Register once:**

```bash
curl -X POST https://api.ssllabs.com/api/v4/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Admin","lastName":"YourOrg","email":"admin@yourorg.com","organization":"YourOrg"}'
```

Expected response: `{"message":"User successfully registered","status":"success"}`

**Step 2 — Configure in Admin UI:**

Admin → Tools → SSL Scan → Config → set the `email` field to the registered address.

Without an email configured, the tool skips SSL Labs and falls back to the direct TLS check automatically — no error, just no letter grade.

### Configuration

```typescript
interface SslScanConfig {
  maxWaitSeconds: number;    // Max polling time for SSL Labs scan (default: 120)
  cacheTTLSeconds: number;   // Result cache TTL in seconds (default: 21600 = 6 hours)
  rateLimitPerDay: number;   // Max scans per day (default: 20)
  email: string;             // Registered SSL Labs v4 org email — required for graded scan
}
```

### Default Configuration

```json
{
  "enabled": true,
  "config": {
    "maxWaitSeconds": 120,
    "cacheTTLSeconds": 21600,
    "rateLimitPerDay": 20,
    "email": ""
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `grade` | string | SSL Labs letter grade (A+/A/B/C/D/F) or "TLS Direct Check" if fallback used |
| `protocol` | string | Highest TLS protocol supported (e.g. "TLS 1.3") |
| `certExpiry` | string | Certificate expiry date (ISO 8601) |
| `certIssuer` | string | Certificate authority name |
| `daysUntilExpiry` | number | Days until certificate expires |
| `forwardSecrecy` | boolean | Whether forward secrecy is enabled |
| `supportsOldTls` | boolean | Whether TLS 1.0/1.1 is still supported (security risk if true) |
| `vulnerabilities` | string[] | Detected vulnerabilities (e.g. POODLE, BEAST, CRIME) |

### Notes

- SSL Labs scans take 60–120 seconds for a fresh assessment
- Results are cached for 6 hours to avoid hitting rate limits
- The free SSL Labs tier allows ~25 new scans/hour globally; during peak times the API returns HTTP 529 ("Running at full capacity") and the tool falls back to the direct TLS check
- Registered email is sent as a request header on every SSL Labs API call (v4 requirement)

---

## Website Analysis — DNS Inspection

> **Note:** DNS record inspection is a feature of the [`website_analysis`](#website-analysis-tool) tool, not a standalone tool. Configure via Admin → Tools → Website Analysis.

### Purpose

Inspects DNS records for a domain and reports configuration issues, missing records, and security posture (SPF, DMARC, DNSSEC).

### Configuration

Enable via Admin → Tools → DNS Scan. No API key required — uses public DNS resolvers.

### Output

| Field | Description |
|-------|-------------|
| `a_records` | IPv4 address records |
| `mx_records` | Mail exchange records |
| `spf` | SPF record status (missing, valid, misconfigured) |
| `dmarc` | DMARC policy |
| `dnssec` | DNSSEC validation status |
| `issues` | Detected DNS configuration problems |

---

## Website Analysis — Cookie Audit

> **Note:** Cookie compliance scanning is a feature of the [`website_analysis`](#website-analysis-tool) tool, not a standalone tool. Configure via Admin → Tools → Website Analysis.

### Purpose

Audits a website for cookie compliance — identifies tracking cookies, checks for consent banners, and flags GDPR/ePrivacy concerns.

### Configuration

Enable via Admin → Tools → Cookie Audit. No API key required.

### Output

| Field | Description |
|-------|-------------|
| `total_cookies` | Number of cookies set by the page |
| `tracking_cookies` | Third-party tracking cookies detected |
| `session_cookies` | Session-only cookies |
| `consent_banner` | Whether a consent banner was detected |
| `issues` | Compliance issues found |

---

## Website Analysis — Redirect Audit

> **Note:** URL redirect chain analysis is a feature of the [`website_analysis`](#website-analysis-tool) tool, not a standalone tool. Configure via Admin → Tools → Website Analysis.

### Purpose

Follows and reports URL redirect chains — identifies redirect loops, unnecessary hops, and mixed HTTP/HTTPS redirects.

### Configuration

Enable via Admin → Tools → Redirect Audit. No API key required.

### Output

| Field | Description |
|-------|-------------|
| `chain` | Full list of redirect URLs in order |
| `hops` | Number of redirects |
| `final_url` | Resolved destination URL |
| `final_status` | HTTP status of the final URL |
| `issues` | Mixed-content or loop problems |

---

## Website Analysis Tool

> **Note:** This tool is registered as `website_analysis` in [`src/lib/tools.ts`](../../src/lib/tools.ts). It encompasses Google PageSpeed Insights, SSL/TLS cert checks, DNS inspection, cookie audits, and redirect chain analysis — all configurable via Admin → Tools → Website Analysis.

### Purpose

Runs Google PageSpeed Insights analysis on a URL and returns Core Web Vitals, performance score, and actionable recommendations.

### API Key

Requires `PAGESPEED_API_KEY` environment variable (Google API key with PageSpeed Insights API enabled).

### Configuration

```typescript
interface PageSpeedConfig {
  apiKey: string;       // Google PageSpeed Insights API key
  strategy: 'mobile' | 'desktop';  // Default: desktop
}
```

### Output

| Field | Description |
|-------|-------------|
| `performance_score` | 0–100 overall performance score |
| `lcp` | Largest Contentful Paint (seconds) |
| `fid` | First Input Delay (ms) |
| `cls` | Cumulative Layout Shift |
| `fcp` | First Contentful Paint |
| `ttfb` | Time to First Byte |
| `opportunities` | Top recommendations with estimated savings |

---

## Code Quality Tool

> **Note:** This tool is registered as `code_analysis` in [`src/lib/tools.ts`](../../src/lib/tools.ts). It wraps SonarCloud for static code quality analysis.

### Purpose

Runs static code quality analysis on a GitHub/GitLab project via SonarCloud and returns bugs, vulnerabilities, code smells, and coverage.

### API Key

Requires `SONARCLOUD_TOKEN` and `SONARCLOUD_ORGANIZATION` environment variables.

### Configuration

```typescript
interface SonarCloudConfig {
  token: string;          // SonarCloud API token
  organization: string;   // SonarCloud organization key
}
```

### Output

| Field | Description |
|-------|-------------|
| `bugs` | Number of detected bugs |
| `vulnerabilities` | Security vulnerabilities |
| `code_smells` | Maintainability issues |
| `coverage` | Code coverage percentage |
| `duplications` | Duplication ratio |
| `quality_gate` | Overall pass/fail quality gate status |

---

## Load Test Tool

> **Note:** This tool is registered as `load_testing` in [`src/lib/tools.ts`](../../src/lib/tools.ts). It wraps k6 Cloud for distributed load testing.

### Purpose

Triggers and reports k6 Cloud load tests for API endpoints or web pages.

### API Key

Requires `K6_CLOUD_API_TOKEN` environment variable.

### Output

| Field | Description |
|-------|-------------|
| `vus` | Virtual users simulated |
| `duration` | Test duration |
| `p95_response_time` | 95th percentile response time (ms) |
| `error_rate` | Percentage of failed requests |
| `throughput` | Requests per second |
| `passed` | Whether performance thresholds were met |

---

## Security Scan Tool

> **⚠️ Not a standalone tool.** Automated security vulnerability scanning is not a separately registered tool in [`AVAILABLE_TOOLS`](../../src/lib/tools.ts). This section is retained for reference.

### Purpose

Automated security scanning that checks for common web vulnerabilities including open ports, outdated TLS, missing security headers, and exposed sensitive files.

### Configuration

Enable via Admin → Tools → Security Scan. No external API key required for basic scanning.

### Output

| Field | Description |
|-------|-------------|
| `open_ports` | Discovered open ports |
| `missing_headers` | Missing security response headers (CSP, HSTS, etc.) |
| `tls_issues` | TLS/SSL configuration problems |
| `exposed_files` | Sensitive files accessible publicly |
| `vulnerabilities` | Detected CVEs or misconfigurations |
| `risk_score` | Aggregate risk score (0–100) |

---

## Dependency Analysis Tool

> **⚠️ Not a standalone tool.** The [`dependencies.ts`](../../src/lib/tools/dependencies.ts) module is a **tool dependency configuration helper** for the admin UI — not an LLM-callable tool. This section is retained for reference.

### Purpose

Inspects a project's dependency manifest (package.json, requirements.txt, etc.) for outdated packages and known CVEs.

### Configuration

Enable via Admin → Tools → Dependencies. No external API key required.

### Output

| Field | Description |
|-------|-------------|
| `total_dependencies` | Total number of dependencies |
| `outdated` | Packages with newer versions available |
| `vulnerable` | Packages with known CVEs |
| `critical_vulnerabilities` | CVEs with CVSS score ≥ 9.0 |
| `recommendations` | Suggested upgrade actions |

---

## Tool Routing

### Purpose

Tool Routing enables automatic forcing of specific tool calls based on keyword or regex pattern matching in user messages. This ensures that tools like `chart_gen` and `task_planner` are reliably invoked when users request visualizations or multi-step assessments, rather than leaving the decision entirely to the LLM.

### Problem Solved

Without Tool Routing, the LLM may:
- Write prose about creating a chart instead of actually calling the `chart_gen` tool
- Ask for confirmation before generating charts
- Describe assessment steps instead of creating a task plan with `task_planner`

Tool Routing forces `tool_choice` in the OpenAI API when patterns match, ensuring deterministic tool invocation.

### How It Works

```
User Message: "Create a chart showing sales by region"
         ↓
┌─────────────────────────────────────────────────────┐
│              Tool Routing Engine                     │
│  1. Match against active routing rules               │
│  2. "chart" keyword matches chart_gen rule          │
│  3. Rule has forceMode: "required"                  │
└─────────────────────────────────────────────────────┘
         ↓
OpenAI API called with:
  tool_choice: { type: "function", function: { name: "chart_gen" } }
         ↓
LLM MUST call chart_gen tool (cannot generate prose instead)
```

### Force Modes

| Mode | `tool_choice` Value | Effect |
|------|---------------------|--------|
| **required** | `{type: "function", function: {name: "X"}}` | Force this specific tool |
| **preferred** | `"required"` | Force some tool call (LLM picks which) |
| **suggested** | `"auto"` | Hint but don't force |

### Rule Types

| Type | Description | Example |
|------|-------------|---------|
| **keyword** | Word boundary matching (case-insensitive) | `chart` matches "create a chart" |
| **regex** | Regular expression matching | `\bvisuali[sz]e\b` matches "visualize" or "visualise" |

### Database Schema

```sql
CREATE TABLE tool_routing_rules (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('keyword', 'regex')),
  patterns TEXT NOT NULL,           -- JSON array: ["chart", "graph", "visualize"]
  force_mode TEXT NOT NULL DEFAULT 'required'
    CHECK (force_mode IN ('required', 'preferred', 'suggested')),
  priority INTEGER DEFAULT 100,     -- Lower = higher priority
  category_ids TEXT DEFAULT NULL,   -- JSON array, NULL = all categories
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
```

### Default Routing Rules

The system seeds these default rules on first access:

| Tool | Rule Name | Patterns | Force Mode |
|------|-----------|----------|------------|
| `chart_gen` | Chart Visualization Keywords | chart, graph, plot, visualize, visualization, bar chart, pie chart, line graph, histogram, create a chart, show me a chart, generate a chart, draw a graph | required |
| `task_planner` | Assessment and Planning Keywords | initiate, assessment, evaluate all, assess all, review all, step by step, create a plan, multi-step, assessment plan, task plan, structured workflow | required |
| `doc_gen` | Document Generation Keywords | generate report, create pdf, export to pdf, download as pdf, save as pdf, formal document, create document, word document, docx | required |
| `web_search` | Web Search Keywords | search the web, look up online, find online, latest news, current information, recent updates, search online | preferred |

### Multi-Match Resolution

When multiple rules match:

1. Rules are sorted by `priority` (lower = higher priority)
2. If multiple `required` rules match different tools → `tool_choice: "required"` (LLM picks)
3. If single `required` rule matches → `tool_choice: {type: "function", function: {name: "X"}}`
4. If only `preferred` rules match → `tool_choice: "required"`
5. If only `suggested` rules match → `tool_choice: "auto"`

### Category Filtering

Rules can be scoped to specific categories:
- `categoryIds: null` → Rule applies to all categories
- `categoryIds: [1, 2, 3]` → Rule only applies when user is in one of these categories

### Admin UI

Tool Routing is managed in the Admin Dashboard under **Tools > Tool Routing**:

1. **View rules** - List of all rules grouped by tool
2. **Create rule** - Define new routing rule with patterns
3. **Edit rule** - Modify patterns, force mode, priority
4. **Enable/Disable** - Toggle individual rules
5. **Delete rule** - Remove routing rule
6. **Test panel** - Enter a message to see which rules match and the resulting `tool_choice`

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/tool-routing` | List all routing rules |
| POST | `/api/admin/tool-routing` | Create new rule |
| GET | `/api/admin/tool-routing/{id}` | Get rule by ID |
| PATCH | `/api/admin/tool-routing/{id}` | Update rule |
| DELETE | `/api/admin/tool-routing/{id}` | Delete rule |
| POST | `/api/admin/tool-routing/test` | Test routing with a message |

### Example: Create Routing Rule

```bash
curl -X POST https://ai.abhirup.app/api/admin/tool-routing \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -d '{
    "toolName": "chart_gen",
    "ruleName": "Custom Chart Keywords",
    "ruleType": "keyword",
    "patterns": ["diagram", "infographic", "data viz"],
    "forceMode": "required",
    "priority": 50,
    "categoryIds": [1, 2],
    "isActive": true
  }'
```

### Example: Test Routing

```bash
curl -X POST https://ai.abhirup.app/api/admin/tool-routing/test \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -d '{
    "message": "Create a chart showing quarterly revenue",
    "categoryIds": [1]
  }'
```

Response:
```json
{
  "message": "Create a chart showing quarterly revenue",
  "categoryIds": [1],
  "matches": [
    {
      "ruleName": "Chart Visualization Keywords",
      "toolName": "chart_gen",
      "pattern": "chart",
      "forceMode": "required"
    }
  ],
  "finalToolChoice": "function:chart_gen"
}
```

### Description Override

In addition to keyword routing, admins can customize tool descriptions sent to the LLM. This is done in **Tools > Tools Management** by expanding a tool and editing the "LLM Prompt Instructions" section.

Custom descriptions can make tools more prescriptive, telling the LLM exactly when and how to use them. For example, adding "ALWAYS call this tool instead of describing steps" to the task_planner description.

### Implementation Files

| File | Purpose |
|------|---------|
| `src/types/tool-routing.ts` | Type definitions |
| `src/lib/db/tool-routing.ts` | Database CRUD operations |
| `src/lib/tool-routing.ts` | Routing engine |
| `src/lib/openai.ts` | Integration with OpenAI API |
| `src/app/api/admin/tool-routing/` | API endpoints |
| `src/components/admin/ToolRoutingTab.tsx` | Admin UI |

---

## Tool Dependencies

### Purpose

The Tool Dependencies panel provides a visual overview of tool prerequisites and validation status. It helps administrators understand which tools require API keys, environment variables, or other tools to function.

### Features

- **Prerequisites Check**: Shows which API keys or environment variables each tool requires
- **Cross-Tool Dependencies**: Displays tools that depend on other tools
- **Validation Status**: Real-time validation of whether dependencies are met
- **Source Tracking**: Shows whether API keys are from settings or environment variables

### Dependency Registry

| Tool | Prerequisites | Notes |
|------|--------------|-------|
| `web_search` | Tavily API key | Can be set via TAVILY_API_KEY env var or admin settings |
| `doc_gen` | None | No external dependencies |
| `data_source` | None | No external dependencies |
| `chart_gen` | `data_source` enabled | Requires Data Source tool to be active |
| `function_api` | None | No external dependencies |
| `task_planner` | None | No external dependencies |
| `youtube` | Supadata API key (optional) | Falls back to npm package if no API key |
| `share_thread` | None | No external dependencies |
| `send_email` | SendGrid API key | Required for email notifications |

### Admin UI

Access via **Admin > Tools > Dependencies**:

```
┌──────────────────────────────────────────────────────────────┐
│ Tool Dependencies                                             │
├──────────────────────────────────────────────────────────────┤
│ ✅ Document Generator                                         │
│    Ready - no external dependencies                          │
├──────────────────────────────────────────────────────────────┤
│ ⚠️ Web Search                                                 │
│    Tavily API key required                                   │
│    └── TAVILY_API_KEY: Not set                               │
├──────────────────────────────────────────────────────────────┤
│ ⚠️ Chart Generator                                            │
│    Requires Data Source tool to be enabled                   │
│    └── data_source: ❌ Disabled                              │
└──────────────────────────────────────────────────────────────┘
```

### Validation Response

```typescript
interface DependencyValidation {
  ok: boolean;
  message: string;
  details?: {
    envVars?: Array<{ name: string; set: boolean; source?: string }>;
    tools?: Array<{ name: string; enabled: boolean }>;
  };
}

interface ToolDependencyStatus {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  validation: DependencyValidation;
  canEnable: boolean;
  missingDependencies: string[];
}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/tools/dependencies` | Get all tool dependency statuses |

---

## Tool Configuration

### Database Schema

Tools are configured via three tables:

```sql
-- Global tool configurations
CREATE TABLE tool_configs (
  id TEXT PRIMARY KEY,
  tool_name TEXT UNIQUE NOT NULL,
  is_enabled INTEGER DEFAULT 0,
  config_json TEXT NOT NULL,
  created_at DATETIME,
  updated_at DATETIME,
  updated_by TEXT NOT NULL
);

-- Audit trail for changes
CREATE TABLE tool_config_audit (
  id INTEGER PRIMARY KEY,
  tool_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- 'create', 'update', 'delete'
  old_config TEXT,
  new_config TEXT,
  changed_by TEXT NOT NULL,
  changed_at DATETIME
);
```

### Configuration Hierarchy

```
Category Override (if set)
    ↓
Global Config (tool_configs table)
    ↓
Default Config (TOOL_DEFAULTS constant)
```

### Admin UI

Tools are managed in the Admin Dashboard under the **Tools** tab:

1. **View all tools** - List with status, category, last update
2. **Configure tool** - Update settings, enable/disable
3. **Test tool** - Verify connectivity (for API-based tools)
4. **Reset to defaults** - Restore original configuration
5. **Initialize all** - Create database entries for all registered tools

---

## Category-Level Overrides

Superusers and Admins can configure tool settings per category.

### Use Cases

- Different branding per category (e.g., different logos for different departments)
- Enable/disable tools for specific categories
- Custom domain filters for web search per category
- **Tool-specific configurations** (e.g., Task Planner templates per category)

### Database Schema

```sql
CREATE TABLE category_tool_configs (
  id TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  is_enabled INTEGER,         -- null = inherit from global
  branding_json TEXT,         -- Category-specific branding
  config_json TEXT,           -- Tool-specific config overrides (e.g., templates)
  created_at DATETIME,
  updated_at DATETIME,
  updated_by TEXT NOT NULL,
  UNIQUE(category_id, tool_name)
);
```

### Config Field

The `config_json` column stores tool-specific configuration overrides as JSON. This is used for:

| Tool | Config Content |
|------|----------------|
| `task_planner` | Templates with placeholders and task lists |
| `web_search` | Category-specific domain filters |
| `doc_gen` | Category-specific branding overrides |

### Override Resolution

```typescript
function getEffectiveToolConfig(toolName: string, categoryId: number) {
  const categoryOverride = getCategoryToolConfig(categoryId, toolName);
  const globalConfig = getToolConfig(toolName);

  // Enabled: category override takes precedence
  let enabled = globalConfig?.isEnabled ?? false;
  if (categoryOverride?.isEnabled !== null && categoryOverride?.isEnabled !== undefined) {
    enabled = categoryOverride.isEnabled;
  }

  // Branding: category override takes precedence
  let branding = globalConfig?.config?.branding ?? null;
  if (categoryOverride?.branding) {
    branding = categoryOverride.branding;
  }

  // Config: deep merge global + category override
  let config = globalConfig?.config ? { ...globalConfig.config } : null;
  if (categoryOverride?.config) {
    config = { ...(config || {}), ...categoryOverride.config };
  }

  return { enabled, branding, config, globalConfig, categoryOverride };
}
```

---

## Creating a New Tool

This guide walks through the process of creating a new tool in AI Assistant, based on the patterns established in tools like `podcast_gen`, `pptx_gen`, and `xlsx_gen`.

### Overview

Creating a new tool requires:

1. **Type definitions** - Interfaces for arguments, config, and response
2. **Tool implementation** - Core logic, config helpers, and execution function
3. **Tool registration** - Adding to the tools registry
4. **OpenAI integration** - (Optional) Terminal tool handling and artifact callbacks

### File Structure

```
src/
├── types/
│   └── my-tool.ts              # Type definitions
├── lib/
│   ├── tools/
│   │   └── my-tool.ts          # Tool implementation
│   ├── tools.ts                # Tool registry (add import + registration)
│   └── openai.ts               # (Optional) Add to TERMINAL_TOOLS
└── lib/db/
    └── my-tool.ts              # (Optional) Database operations
```

### Step 1: Create Type Definitions

Create `src/types/my-tool.ts`:

```typescript
/**
 * Arguments passed from LLM function call
 */
export interface MyToolArgs {
  title: string;                    // Required parameter
  content: string;
  format?: 'option1' | 'option2';   // Optional with enum
  maxItems?: number;                // Optional with default
}

/**
 * Tool configuration (stored in database)
 */
export interface MyToolConfig {
  defaultFormat: 'option1' | 'option2';
  maxItems: number;
  apiKey?: string;                  // Optional external API key
  branding?: {
    enabled: boolean;
    organizationName?: string;
  };
}

/**
 * Tool execution response
 */
export interface MyToolResponse {
  success: boolean;
  message?: string;

  // For artifact-producing tools
  document?: {
    id: string;
    filename: string;
    downloadUrl: string;
    fileSize: number;
    mimeType: string;
  };

  // Standard error format
  error?: {
    code: string;
    message: string;
  };
}
```

### Step 2: Create Tool Implementation

Create `src/lib/tools/my-tool.ts`:

```typescript
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';
import type { MyToolArgs, MyToolConfig, MyToolResponse } from '@/types/my-tool';
import { getToolConfigAsync } from '@/lib/db/compat';

// ============================================
// 1. DEFAULT CONFIGURATION
// ============================================

export const MY_TOOL_DEFAULTS: MyToolConfig = {
  defaultFormat: 'option1',
  maxItems: 100,
  apiKey: '',
  branding: {
    enabled: false,
    organizationName: '',
  },
};

// ============================================
// 2. CONFIGURATION HELPERS
// ============================================

export async function getMyToolConfig(): Promise<MyToolConfig> {
  const config = await getToolConfigAsync('my_tool');
  return {
    ...MY_TOOL_DEFAULTS,
    ...(config?.config || {}),
  };
}

export async function isMyToolEnabled(): Promise<boolean> {
  const config = await getToolConfigAsync('my_tool');
  return config?.isEnabled ?? false;
}

// ============================================
// 3. MAIN EXECUTION FUNCTION
// ============================================

export async function executeMyTool(
  args: MyToolArgs,
  configOverride?: Record<string, unknown>
): Promise<MyToolResponse> {
  // Get config (with optional skill-level override)
  const baseConfig = await getMyToolConfig();
  const config = configOverride
    ? { ...baseConfig, ...configOverride }
    : baseConfig;

  // Check if enabled
  if (!(await isMyToolEnabled())) {
    return {
      success: false,
      error: {
        code: 'DISABLED',
        message: 'My Tool is not enabled. Contact your administrator.',
      },
    };
  }

  // Validate required arguments
  if (!args.title || !args.content) {
    return {
      success: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'Title and content are required.',
      },
    };
  }

  try {
    // === YOUR TOOL LOGIC HERE ===

    // Example: Generate a file
    const result = await generateOutput(args, config);

    return {
      success: true,
      message: `Generated ${result.filename}`,
      document: {
        id: result.id,
        filename: result.filename,
        downloadUrl: result.downloadUrl,
        fileSize: result.fileSize,
        mimeType: result.mimeType,
      },
    };
  } catch (error) {
    console.error('[my_tool] Execution error:', error);
    return {
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
    };
  }
}

// ============================================
// 4. VALIDATION SCHEMA (for Admin UI)
// ============================================

const myToolConfigSchema = {
  type: 'object',
  properties: {
    defaultFormat: {
      type: 'string',
      title: 'Default Format',
      enum: ['option1', 'option2'],
      default: 'option1',
    },
    maxItems: {
      type: 'number',
      title: 'Maximum Items',
      minimum: 1,
      maximum: 1000,
      default: 100,
    },
    apiKey: {
      type: 'string',
      title: 'API Key',
      format: 'password',
      description: 'External API key (if required)',
    },
    branding: {
      type: 'object',
      title: 'Branding',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enable Branding',
          default: false,
        },
        organizationName: {
          type: 'string',
          title: 'Organization Name',
        },
      },
    },
  },
};

// ============================================
// 5. VALIDATION FUNCTION
// ============================================

function validateMyToolConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate maxItems
  if (config.maxItems !== undefined) {
    const maxItems = config.maxItems as number;
    if (maxItems < 1 || maxItems > 1000) {
      errors.push('Maximum items must be between 1 and 1000');
    }
  }

  // Validate format
  if (config.defaultFormat !== undefined) {
    const format = config.defaultFormat as string;
    if (!['option1', 'option2'].includes(format)) {
      errors.push('Invalid default format');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================
// 6. TOOL DEFINITION
// ============================================

export const myToolDefinition: ToolDefinition = {
  name: 'my_tool',
  displayName: 'My Tool',
  description: 'Brief description of what this tool does',
  category: 'autonomous',  // or 'processor'

  // OpenAI function definition (for autonomous tools)
  definition: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: `Detailed description for the LLM explaining when and how to use this tool.

Use this tool when the user asks to [specific use cases].

Guidelines:
- Guideline 1
- Guideline 2`,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The title for the output',
          },
          content: {
            type: 'string',
            description: 'The content to process',
          },
          format: {
            type: 'string',
            enum: ['option1', 'option2'],
            description: 'Output format (default: option1)',
          },
          maxItems: {
            type: 'number',
            description: 'Maximum number of items to include',
          },
        },
        required: ['title', 'content'],
      },
    },
  },

  // Execute function called by the tool system
  execute: async (
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<string> => {
    const typedArgs = args as unknown as MyToolArgs;
    const configOverride = options?.configOverride;

    try {
      const result = await executeMyTool(typedArgs, configOverride);
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  },

  validateConfig: validateMyToolConfig,
  defaultConfig: MY_TOOL_DEFAULTS as Record<string, unknown>,
  configSchema: myToolConfigSchema,
};

export default myToolDefinition;
```

### Step 3: Register the Tool

Update `src/lib/tools.ts`:

```typescript
// Add import at the top
import { myToolDefinition } from './tools/my-tool';

// Add to AVAILABLE_TOOLS map
export const AVAILABLE_TOOLS: Record<string, ToolDefinition> = {
  // ... existing tools
  my_tool: myToolDefinition,
};
```

### Step 4: Terminal Tool Setup (Optional)

If your tool generates final artifacts (documents, images, audio), add to `TERMINAL_TOOLS` in `src/lib/openai.ts`:

```typescript
const TERMINAL_TOOLS = new Set([
  'image_gen',
  'doc_gen',
  'pptx_gen',
  'xlsx_gen',
  'podcast_gen',
  'chart_gen',
  'diagram_gen',
  'my_tool',  // Add here
]);
```

Terminal tools:
- Stop the tool loop after successful execution (prevents re-calling)
- Automatically get an LLM-generated summary explaining what was created
- Can emit artifacts via the callback system

### Step 5: Artifact Callbacks (Optional)

If your tool produces artifacts, return them in a hint structure:

```typescript
// In your tool response
return {
  success: true,
  // For documents
  document: {
    id: string,
    filename: string,
    downloadUrl: string,
    fileSize: number,
    mimeType: string,
  },
  // For images
  imageHint: {
    url: string,
    width: number,
    height: number,
  },
  // For audio
  podcastHint: {
    id: string,
    downloadUrl: string,
    duration: number,
    provider: string,
  },
  // For diagrams
  diagramHint: {
    svg: string,
    title: string,
  },
};
```

The system automatically detects these hints and calls `callbacks?.onArtifact(type, data)`.

### Error Handling Patterns

#### Standard Error Response

Always return errors in this format:

```typescript
{
  success: false,
  error: {
    code: 'ERROR_CODE',      // Machine-readable
    message: 'User message'   // Human-readable
  }
}
```

#### Common Error Codes

| Code | When to Use |
|------|-------------|
| `DISABLED` | Tool is disabled in admin settings |
| `INVALID_ARGS` | Required arguments missing or invalid |
| `INVALID_API_KEY` | Missing or invalid API credentials |
| `RATE_LIMIT` | External API rate limited |
| `EXECUTION_ERROR` | Runtime error during execution |
| `PROVIDER_DISABLED` | Specific provider not enabled |
| `FILE_TOO_LARGE` | Input exceeds size limits |

#### Never Throw Exceptions

The `execute` function should always return a JSON string, never throw:

```typescript
execute: async (args, options): Promise<string> => {
  try {
    const result = await executeMyTool(args);
    return JSON.stringify(result);
  } catch (error) {
    // Catch and return as JSON
    return JSON.stringify({
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}
```

### Configuration Patterns

#### Skill-Level Overrides

Tools can receive configuration overrides from skills:

```typescript
export async function executeMyTool(
  args: MyToolArgs,
  configOverride?: Record<string, unknown>
): Promise<MyToolResponse> {
  const baseConfig = await getMyToolConfig();

  // Merge base config with skill-level override
  const config = configOverride
    ? { ...baseConfig, ...configOverride }
    : baseConfig;

  // Use merged config
}
```

#### API Key Management

```typescript
import { getApiKey } from '@/lib/provider-helpers';

// Database-first, env-var fallback
const apiKey = config.apiKey || getApiKey('my_provider');

// All providers use direct API calls — no proxy
const apiKey = getApiKey('openai');
```

### Database Storage (Optional)

For tools that generate files, use `addThreadOutput`:

```typescript
import { addThreadOutput } from '@/lib/db/compat';

const output = await addThreadOutput(
  threadId,           // Thread ID
  messageId,          // Message ID
  filename,           // e.g., 'report.pdf'
  filepath,           // Server path
  fileType,           // e.g., 'document'
  fileSize,           // In bytes
  JSON.stringify(metadata),  // Tool-specific metadata
  expiresAt           // Optional expiration date
);
```

### Tool Categories

| Category | Triggered By | Has Definition | Examples |
|----------|--------------|----------------|----------|
| `autonomous` | LLM function call | Yes | `web_search`, `podcast_gen`, `image_gen` |
| `processor` | System after response | No | `send_email`, `compliance_checker` |

### Checklist

```
Creating a new tool:

[ ] 1. Create src/types/my-tool.ts
    - MyToolArgs interface
    - MyToolConfig interface
    - MyToolResponse interface

[ ] 2. Create src/lib/tools/my-tool.ts
    - MY_TOOL_DEFAULTS constant
    - getMyToolConfig() helper
    - isMyToolEnabled() helper
    - executeMyTool() function
    - Config validation schema
    - validateMyToolConfig() function
    - myToolDefinition export

[ ] 3. Register in src/lib/tools.ts
    - Import myToolDefinition
    - Add to AVAILABLE_TOOLS map

[ ] 4. (If terminal) Update src/lib/openai.ts
    - Add to TERMINAL_TOOLS set
    - Ensure artifact hints are handled

[ ] 5. Test
    - Tool appears in admin UI
    - Configuration saves correctly
    - Execution returns valid JSON
    - Errors handled gracefully
```

### Example: Minimal Tool

Here's a minimal working tool:

```typescript
// src/types/hello-tool.ts
export interface HelloToolArgs {
  name: string;
}

export interface HelloToolResponse {
  success: boolean;
  greeting?: string;
  error?: { code: string; message: string };
}

// src/lib/tools/hello-tool.ts
import type { ToolDefinition } from '../tools';

export const helloToolDefinition: ToolDefinition = {
  name: 'hello_tool',
  displayName: 'Hello Tool',
  description: 'A simple greeting tool',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'hello_tool',
      description: 'Generate a greeting for the user',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name to greet',
          },
        },
        required: ['name'],
      },
    },
  },

  execute: async (args): Promise<string> => {
    const { name } = args as { name: string };

    if (!name) {
      return JSON.stringify({
        success: false,
        error: { code: 'INVALID_ARGS', message: 'Name is required' },
      });
    }

    return JSON.stringify({
      success: true,
      greeting: `Hello, ${name}! Welcome to AI Assistant.`,
    });
  },

  validateConfig: () => ({ valid: true, errors: [] }),
  defaultConfig: {},
  configSchema: { type: 'object', properties: {} },
};

export default helloToolDefinition;
```

---

## API Reference

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/tools` | List all tools with configs |
| POST | `/api/admin/tools` | Initialize all tools to defaults |
| GET | `/api/admin/tools/{name}` | Get tool config + audit history |
| PATCH | `/api/admin/tools/{name}` | Update tool configuration |
| POST | `/api/admin/tools/{name}/test` | Test tool connectivity |

### Task Planner Template Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/tools/task-planner/templates?categoryId=X` | List templates for category |
| POST | `/api/admin/tools/task-planner/templates` | Create new template |
| GET | `/api/admin/tools/task-planner/templates/{key}?categoryId=X` | Get specific template |
| PATCH | `/api/admin/tools/task-planner/templates/{key}` | Update template |
| DELETE | `/api/admin/tools/task-planner/templates/{key}?categoryId=X` | Delete template (Admin only) |

### Superuser Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/superuser/tools` | List tools with category overrides |
| POST | `/api/superuser/tools/{name}` | Set category override |

### Example: Update Tool Configuration

```bash
curl -X PATCH https://ai.abhirup.app/api/admin/tools/web_search \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -d '{
    "enabled": true,
    "config": {
      "maxResults": 10,
      "defaultSearchDepth": "advanced",
      "includeDomains": ["gov.sg", "mof.gov.sg"]
    }
  }'
```

### Example: Test Tool

```bash
curl -X POST https://ai.abhirup.app/api/admin/tools/web_search/test \
  -H "Cookie: next-auth.session-token=..."
```

Response:
```json
{
  "tool": "web_search",
  "success": true,
  "message": "Connection successful",
  "latency": 245,
  "testedAt": "2024-12-12T14:30:00Z",
  "testedBy": "admin@example.com"
}
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `src/lib/tools.ts` | Main tool registry and API |
| `src/lib/tools/tavily.ts` | Web search implementation |
| `src/lib/tools/docgen.ts` | Document generator implementation |
| `src/lib/tools/pptx-gen.ts` | PowerPoint generator implementation |
| `src/lib/tools/xlsx-gen.ts` | Excel generator implementation |
| `src/lib/tools/podcast-gen.ts` | Podcast generator implementation |
| `src/lib/tools/data-source.ts` | Data source tool implementation |
| `src/lib/tools/chart-gen.ts` | Chart generator tool implementation |
| `src/lib/tools/function-api.ts` | Function API tool implementation |
| `src/lib/docgen/pdf-builder.ts` | PDF generation |
| `src/lib/docgen/docx-builder.ts` | DOCX generation |
| `src/lib/docgen/md-builder.ts` | Markdown generation |
| `src/lib/docgen/branding.ts` | Branding configuration |
| `src/lib/pptxgen/pptx-builder.ts` | PowerPoint slide building |
| `src/lib/xlsxgen/xlsx-builder.ts` | Excel workbook building |
| `src/lib/data-sources/api-caller.ts` | External API request handling |
| `src/lib/data-sources/csv-handler.ts` | CSV file querying |
| `src/lib/data-sources/aggregation.ts` | Data aggregation operations |
| `src/lib/db/tool-config.ts` | Database operations |
| `src/lib/db/data-sources.ts` | Data source CRUD operations |
| `src/lib/db/function-api-config.ts` | Function API CRUD operations |
| `src/lib/db/category-tool-config.ts` | Category overrides |
| `src/lib/db/tool-routing.ts` | Tool routing CRUD operations |
| `src/lib/tool-routing.ts` | Tool routing engine |
| `src/types/data-sources.ts` | Data source type definitions |
| `src/types/chart-gen.ts` | Chart generator type definitions |
| `src/types/pptx-gen.ts` | PowerPoint generator type definitions |
| `src/types/xlsx-gen.ts` | Excel generator type definitions |
| `src/types/podcast-gen.ts` | Podcast generator type definitions |
| `src/types/function-api.ts` | Function API type definitions |
| `src/types/tool-routing.ts` | Tool routing type definitions |
