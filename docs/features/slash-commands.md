# Slash Commands

Slash commands provide a fast, explicit way for users to request specific terminal tool outputs. By typing `/` followed by a command key, users can guide the AI toward generating images, documents, charts, diagrams, and more.

> **Related:** See [`Tools.md`](Tools.md) for the full tools system reference and [`src/lib/db/compat/slash-commands.ts`](../../src/lib/db/compat/slash-commands.ts) for the database layer.

---

## Philosophy

Slash commands are **strong hints**, not forced directives. When a user invokes a slash command, the system injects a `[SUGGESTED APPROACH: ...]` instruction into the system prompt. The LLM can still override this suggestion if the user's actual message clearly indicates a different intent. This balances user convenience with AI flexibility.

## User Interface

**Autocomplete (Type `/`):**
- Typing `/` at the start of the message input opens an inline autocomplete menu
- Commands are filtered by key or alias as the user types
- Keyboard navigation: ↑/↓ to select, Enter/Tab to confirm, Esc to close
- Selecting a command strips the `/` prefix and shows an active chip above the input

**Direct Typing:**
- Users can type `/command message` directly (e.g., `/pdf summary of leave policy`)
- The `/command` prefix is stripped from the saved message history

## Available Commands

| Command | Aliases | Tool | Output | Description |
|---------|---------|------|--------|-------------|
| `/image` | `img` | `image_gen` | Image | AI-generated image (Gemini / Imagen 4) |
| `/chart` | — | `chart_gen` | Chart | Interactive data visualization |
| `/diagram` | `diag` | `diagram_gen` | Diagram | Mermaid diagram (general) |
| `/flowchart` | — | `diagram_gen` | Diagram | Mermaid flowchart |
| `/sequence` | — | `diagram_gen` | Diagram | Mermaid sequence diagram |
| `/c4` | — | `diagram_gen` | Diagram | Mermaid C4 architecture diagram |
| `/gantt` | — | `diagram_gen` | Diagram | Mermaid Gantt chart |
| `/bar-chart` | — | `chart_gen` | Chart | Bar chart visualization |
| `/line-chart` | — | `chart_gen` | Chart | Line chart visualization |
| `/infographic` | — | `image_gen` | Image | Infographic-style image |
| `/photo` | — | `image_gen` | Image | Photorealistic image |
| `/pdf` | — | `doc_gen` | PDF document | Formatted PDF report |
| `/docx` | `doc`, `word` | `doc_gen` | Word document | Editable DOCX file |
| `/html` | — | `html_gen` | HTML page | Interactive HTML page |
| `/site` | `website`, `web` | `site_gen` | Website (zip) | Multi-page themed website |
| `/slide` | `pptx` | `pptx_gen` | Presentation | PowerPoint presentation |
| `/sheet` | `xlsx` | `xlsx_gen` | Spreadsheet | Excel spreadsheet |

## Command Behavior

**Enabled State:** Commands are only available if:
1. The command itself is enabled in the slash command registry
2. The underlying tool is enabled in Admin → Tools

If a command's tool is disabled, the command appears grayed out in the UI with a warning.

**Format Hints:** Different command families use different hint strategies:

| Tool Family | Hint Strategy | Example |
|-------------|---------------|---------|
| `doc_gen` | `formatHint` column (`pdf`, `docx`) | Backend appends `Use format='pdf'` |
| `diagram_gen` | Baked into hint text | `diagram_type='flowchart'` |
| `chart_gen` | Baked into hint text | `recommended_chart='bar'` |
| `image_gen` | Baked into hint text | `style='photo'`, `style='infographic'`, `style='illustration'`, etc. |
| `html_gen`, `pptx_gen`, `xlsx_gen` | Tool-only hint | No format parameter needed |

**Message Stripping:** The slash prefix is always stripped from saved messages. If a user sends `/pdf leave policy summary`, the thread history stores only `leave policy summary`. The `toolHint` is passed separately in the chat preferences.

## Backend Injection

In the streaming chat endpoint (`src/app/api/chat/stream/route.ts`):

```typescript
const { toolHint } = body;
if (toolHint) {
  const command = await getSlashCommandByKey(toolHint);
  if (command && command.enabled && await isToolEnabled(command.toolName)) {
    effectiveSystemPrompt += `\n\n[SUGGESTED APPROACH: ${command.hint}]`;
  }
}
```

The hint is appended to the system prompt just before the LLM call. This ensures the LLM sees the suggestion in the same context as all other instructions.

## Admin Registry

Admins manage slash commands at **Admin → Tools → Slash Commands**.

**Editable Fields:**
| Field | Description |
|-------|-------------|
| **Label** | Display name in the UI |
| **Description** | Short help text |
| **Aliases** | Alternative command keys (comma-separated) |
| **Hint** | The exact text injected into the system prompt |
| **Icon** | Lucide icon name for UI display |
| **Enabled** | Whether the command is active |
| **Sort Order** | Position in the autocomplete list |

**Limitations:**
- Admins can only edit the 16 predefined commands (cannot create new ones or remap tools)
- The `commandKey` and `toolName` are fixed per command
- Reset to defaults restores all original labels, hints, and aliases

## Database Schema

```sql
CREATE TABLE slash_command_configs (
  id SERIAL PRIMARY KEY,
  command_key VARCHAR(50) NOT NULL UNIQUE,
  tool_name VARCHAR(100) NOT NULL,
  label VARCHAR(100) NOT NULL,
  description TEXT,
  aliases TEXT,              -- JSON array ["alias1", "alias2"]
  hint TEXT NOT NULL,        -- Injected into system prompt
  icon VARCHAR(50),          -- Lucide icon name
  format_hint VARCHAR(50),   -- e.g., 'pdf', 'docx'
  enabled BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

Commands are seeded automatically on first startup via `ensureSlashCommandsExist()`.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/chat/slash-commands` | List all enabled slash commands for autocomplete |

## Key Source Files

| File | Purpose |
|------|---------|
| [`src/lib/db/compat/slash-commands.ts`](../../src/lib/db/compat/slash-commands.ts) | Database CRUD and seed logic |
| [`src/app/api/chat/stream/route.ts`](../../src/app/api/chat/stream/route.ts) | Backend injection into chat stream |
| [`src/types/slash-commands.ts`](../../src/types/slash-commands.ts) | TypeScript type definitions |
