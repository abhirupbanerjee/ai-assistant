# Skills System

Comprehensive guide to the Skills system in Policy Bot - modular AI behavior configurations that enhance and customize the assistant's capabilities based on context.

---

## Table of Contents

1. [Introduction](#introduction)
2. [What are Skills?](#what-are-skills)
3. [Skill Types](#skill-types)
4. [Creating Skills](#creating-skills)
5. [Skill Configuration](#skill-configuration)
6. [Skill Prompts](#skill-prompts)
7. [Priority System](#priority-system)
8. [Managing Skills](#managing-skills)
9. [Skill Examples](#skill-examples)
10. [Best Practices](#best-practices)
11. [Advanced Usage](#advanced-usage)
12. [Troubleshooting](#troubleshooting)

---

## Introduction

The **Skills System** in Policy Bot allows administrators to inject specialized behaviors and instructions into AI conversations based on context. Skills are modular prompt additions that activate based on triggers like keywords, categories, or global application.

### Why Use Skills?

Instead of creating massive, complex system prompts that try to cover every scenario, skills allow you to:
- ✅ Modularize AI behaviors into reusable components
- ✅ Activate specialized instructions only when needed
- ✅ Maintain cleaner, more manageable prompts
- ✅ Test and iterate on specific behaviors independently
- ✅ Share common skills across categories
- ✅ Override or enhance behavior contextually

### Skills vs Prompts

| Feature | System/Category Prompts | Skills |
|---------|-------------------------|--------|
| **Scope** | Always active in context | Conditionally activated |
| **Modularity** | Single large block | Multiple small modules |
| **Triggers** | Category-based only | Category, keyword, or always-on |
| **Priority** | Fixed order | Configurable priority |
| **Testing** | Test entire prompt | Test individual skills |
| **Reusability** | Category-specific | Can apply across categories |

---

## What are Skills?

A **skill** is a named configuration that contains:
1. **Trigger conditions** - When the skill activates
2. **Skill prompt** - Instructions injected when active
3. **Priority** - Order of application
4. **Status** - Active or inactive

### How Skills Work

```
User sends message
        ↓
┌───────────────────────┐
│ Evaluate all skills   │
└───────────────────────┘
        ↓
┌───────────────────────┐
│ Check trigger types:  │
│ - Always-on?          │
│ - Category match?     │
│ - Keyword match?      │
└───────────────────────┘
        ↓
┌───────────────────────┐
│ Sort by priority      │
│ (lower = higher)      │
└───────────────────────┘
        ↓
┌───────────────────────┐
│ Combine skill prompts │
│ with system prompt    │
└───────────────────────┘
        ↓
┌───────────────────────┐
│ Send to AI            │
└───────────────────────┘
```

### Prompt Injection Order

Skills are injected into the prompt in this order:

```
1. Global System Prompt
2. Category Addendum (if applicable)
3. Skills (sorted by priority, lowest first)
4. User Memory Facts (if enabled)
5. Conversation History
6. Current User Message
```

---

## Skill Types

Skills have three trigger types that determine when they activate.

### 1. Always-On Skills

**Trigger:** Every conversation, all categories

**Use Cases:**
- Core behaviors that should always apply
- Citation formatting rules
- Memory recall instructions
- General safety guidelines

**Example:**
```
Name: Core Citation Format
Type: Always-on
Prompt:
  Always cite sources in this format: [Document Name] (Page X).
  If page numbers are available, include them.
  If multiple sources support an answer, list all relevant citations.
```

### 2. Category-Triggered Skills

**Trigger:** When thread is in specific category/categories

**Use Cases:**
- Department-specific behaviors
- Specialized terminology handling
- Category-specific compliance requirements
- Domain expertise injection

**Example:**
```
Name: Legal Disclaimer
Type: Category-triggered
Categories: Legal, Compliance
Prompt:
  For all legal and compliance topics, include this disclaimer:
  "This is general information only and not legal advice. Consult the
  Legal team for specific cases."
```

### 3. Keyword-Triggered Skills

**Trigger:** When user message contains specific words/patterns

**Use Cases:**
- Topic-specific instructions
- Sensitive subject handling
- Specialized analysis requests
- Contextual behavior changes
- **Force specific tools** when certain keywords are detected

**Example:**
```
Name: Contract Review Skill
Type: Keyword-triggered
Keywords: contract, agreement, terms, NDA, SLA
Match Type: Contains
Prompt:
  When discussing contracts or agreements:
  - Reference the Contracts and Procurement Guide
  - Emphasize legal review requirements
  - Note approval authority levels
  - Remind about signature requirements
```

### Tool Association (Keyword Skills Only)

Keyword-triggered skills can optionally force a specific tool to be called when the skill matches. This provides **deterministic tool invocation** based on keyword patterns, solving a common problem with LLM-based tool selection.

**Available when:** `trigger_type = keyword`

#### Why Use Tool Association?

Without tool forcing, the LLM may:
- 💬 Write about creating a chart instead of actually calling the chart tool
- 🤔 Ask for confirmation before generating visualizations
- 📝 Describe steps instead of using the Task Planner
- 🌐 Summarize what a web search might find instead of searching

**Example:**
```
User: "Create a bar chart showing sales by region"

Without Tool Association:
❌ AI: "I can help you create a bar chart. Let me describe
        how it might look: We'd have regions on the X-axis..."
        [No chart generated]

With Tool Association (Required mode):
✅ AI: [Calls chart_gen tool]
     "Here's a bar chart showing sales by region:"
     [Actual chart displayed]
```

#### Configuration Fields

| Field | Description |
|-------|-------------|
| **Force Tool** | The tool to invoke (web_search, chart_gen, doc_gen, data_source, etc.) |
| **Force Mode** | How strongly to enforce tool usage |
| **Tool Config Override** | Tool-specific settings (e.g., chart type, data source filter) |

#### Force Modes

| Mode | Behavior | API Mapping | When to Use |
|------|----------|-------------|-------------|
| **Required** | The LLM *must* call this specific tool | `tool_choice: {type: "function", function: {name: "tool"}}` | Pattern clearly indicates one tool, no ambiguity |
| **Preferred** | The LLM must use *some* tool (can choose which) | `tool_choice: "required"` | Multiple tools might apply, LLM should choose |
| **Suggested** | Hint to LLM, but doesn't force | `tool_choice: "auto"` | Gentle nudge, testing new rules |

#### Important: How Force Modes Actually Work

**Tools array is NOT filtered.** Regardless of which `tool_name` you configure on a skill, OpenAI always receives the **full list** of enabled tools. The force mode only controls the `tool_choice` parameter:

- **Required** — The skill's `tool_name` is sent as the specific forced tool. The LLM **must** call exactly that tool, no alternatives. Use only when the keyword unambiguously indicates tool usage (e.g., `"generate chart"` → chart_gen).

- **Preferred** — The skill's `tool_name` is **ignored at runtime**. The LLM receives `tool_choice: "required"` with all available tools and must call *some* tool, but picks which one. Since the current UI only allows one tool per skill, this mode is functionally "force any tool call" — the configured tool is just a hint in the admin UI.

- **Suggested** — The skill's `tool_name` is **ignored at runtime**. The LLM receives `tool_choice: "auto"` and decides freely whether to call any tool at all.

#### Keyword Matching is Intent-Blind

Keyword triggers match the **presence** of words, not the **intent** behind them. This means:

| User Message | Keyword `"work package"` | Intent | Tool Forced? |
|---|---|---|---|
| "generate work package" | Matches | Creation | Appropriate |
| "review the work package from last response" | Matches | Analysis | Inappropriate |

**Recommendation:** Use `suggested` as the default force mode for most skills. This injects the skill's prompt content (giving the LLM context) while letting the LLM decide whether a tool call is appropriate based on the user's actual intent. Only use `required` when the keyword itself implies the action (e.g., regex `^(create|generate)\s+work package`).

**Force Mode Selection Guide:**

| Force Mode | LLM Flexibility | Tool Behavior | Recommended For |
|------------|-----------------|---------------|-----------------|
| **Required** | None — must use the specific tool | Skill's `tool_name` is forced | Action-specific keywords (e.g., `^generate\s+chart`) |
| **Preferred** | Low — must use some tool, picks which | Skill's `tool_name` is ignored; LLM chooses from all tools | Multi-tool workflows (note: UI only allows 1 tool per skill) |
| **Suggested** | High — can skip tools entirely | Skill's `tool_name` is ignored; `tool_choice: "auto"` | **Default choice** — safest for broad keywords like `"work package"` |

#### Tool-Specific Config Options

When a tool is selected, additional configuration options appear:

| Tool | Config Options |
|------|----------------|
| **chart_gen** | Default chart type (bar, line, pie, scatter, area) |
| **doc_gen** | Default format (pdf, docx, markdown) |
| **data_source** | Restrict to specific data sources (include/exclude) |
| **function_api** | Restrict to specific function API |
| **web_search** | Include/exclude domains, wildcard patterns (e.g., `*.gov`) |
| **diagram_gen** | Preferred diagram type (flowchart, sequence, mindmap, etc.) |
| **image_gen** | Default style (realistic, artistic, etc.) |

#### Pattern Syntax for Tool Triggers

Use precise patterns with the Regex match type for reliable tool invocation:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `\b` | Word boundary | `\bchart\b` (not "charter") |
| `.*` | Any characters | `initiate.*assessment` |
| `\s+` | One or more spaces | `evaluate\s+all` |
| `(a\|b)` | OR operator | `(chart\|graph)` |
| `\d+` | One or more digits | `report\s+\d+` |
| `?` | Optional | `charts?` (chart or charts) |
| `^` | Start of string | `^create` |
| `$` | End of string | `please$` |

**Common Regex Patterns:**

```regex
# Exact phrase
\binitiate\s+assessment\b

# Multiple options
\b(SOE|state-owned enterprise)\b

# Optional plurals
\bpolic(y|ies)\b

# Numbers in context
\breport\s+\d{4}\b  # "report 2024"

# Start of message
^(create|generate|make)

# Complex phrase
\b(create|generate|make)\s+a\s+(chart|graph|plot)\b
```

#### Example Skills with Tool Association

**Example 1: Chart Generation**
```yaml
Name: Generate Budget Chart
Type: Keyword
Keywords: budget chart, spending graph, expense visualization
Match Type: Contains
Force Tool: chart_gen
Force Mode: Required
Tool Config: { "chartType": "bar" }
Prompt:
  Create a clear budget visualization with proper labels and legend.
  Use department names on the x-axis and amounts on the y-axis.
```

**Example 2: Web Search (Regex)**
```yaml
Name: Web Search Triggers
Type: Keyword
Keywords: \b(search|look up|latest news|current)\b
Match Type: Regex
Force Tool: web_search
Force Mode: Required
Tool Config: { "includeDomains": ["*.gov", "*.org"] }
Prompt:
  Search for the most recent and authoritative sources.
  Prioritize government and official organization websites.
```

**Example 3: Document Generation**
```yaml
Name: Report Generator
Type: Keyword
Keywords: \b(generate|create)\s+(a\s+)?(report|document|pdf)\b
Match Type: Regex
Force Tool: doc_gen
Force Mode: Required
Tool Config: { "format": "pdf" }
Prompt:
  Generate a professionally formatted document with:
  - Clear section headings
  - Executive summary
  - Source citations
```

**Example 4: Task Planner (Category-Scoped)**
```yaml
Name: SOE Assessment Planner
Type: Keyword
Categories: [SOE, Operations]
Keywords: \binitiate\b.*assessment
Match Type: Regex
Force Tool: task_planner
Force Mode: Required
Tool Config: { "template": "soe_identify" }
Prompt:
  Use the 6-dimension SOE assessment framework.
  Work through each dimension systematically.
```

#### Best Practices for Tool Association

✅ **Do:**
- Use specific, unambiguous patterns
- Test patterns with real user messages
- Use word boundaries in regex (`\b`)
- Choose Required mode for critical workflows
- Combine with skill prompts for context

❌ **Don't:**
- Use overly broad patterns ("data", "help")
- Create conflicting skills with different tools
- Over-complicate regex unnecessarily
- Use Required mode for ambiguous contexts

#### Troubleshooting Tool Association

**Issue: Tool Not Being Called**

| Possible Cause | Solution |
|----------------|----------|
| Skill is inactive | Verify Status = Active |
| Keyword not matching | Test with exact keyword phrases |
| Force mode is "Suggested" | Change to "Required" |
| Pattern too specific | Simplify regex pattern |

**Issue: Wrong Tool Called**

| Possible Cause | Solution |
|----------------|----------|
| Multiple skills matching | Check skill priorities, adjust as needed |
| Overlapping keywords | Make patterns more specific |
| Force mode is "Preferred" | Change to "Required" for specific tool |

**Issue: Tool Called When It Shouldn't Be**

| Possible Cause | Solution |
|----------------|----------|
| Pattern too broad | Add word boundaries (`\b`) |
| Contains mode too permissive | Switch to Regex with precise pattern |
| No category scope | Add category restrictions |

### Match Types for Keywords

| Match Type | Description | Example |
|------------|-------------|---------|
| **Exact** | Exact word match (case-insensitive) | "contract" matches "contract" but not "contracts" |
| **Contains** | Word appears anywhere | "contract" matches "contractor", "contractual" |
| **Regex** | Regular expression pattern | `\bcontract\b` matches "contract" but not "contractor" |

---

## Creating Skills

### Permissions

| Action | Admin | Superuser | User |
|--------|-------|-----------|------|
| Create skills (all tiers) | ✅ | ❌ | ❌ |
| Create skills (priority 100+) | ✅ | ✅ (managed categories) | ❌ |
| Use "always" trigger | ✅ | ❌ | ❌ |
| View skills | ✅ | ✅ | ❌ |
| Edit own skills | ✅ | ✅ | ❌ |
| Edit any skill | ✅ | ❌ | ❌ |
| Delete skills | ✅ (except core) | ✅ (own only) | ❌ |

**Note:** Superusers can create and manage skills for their assigned categories with restrictions:
- Priority must be 100 or higher (Medium/Low tiers)
- Cannot use the "always" trigger type (reserved for system-wide behaviors)
- Can only assign skills to categories they manage

### Step-by-Step Creation

1. **Access Skills Management**
   - Navigate to **Admin** → **Prompts** → **Skills**
   - Click **Add Skill**

2. **Basic Information**
   - **Name** - Unique identifier (e.g., "Legal Disclaimer")
   - **Description** - What this skill does
   - **Status** - Active or Inactive

3. **Trigger Configuration**
   - **Type** - Always-on, Category, or Keyword
   - **Categories** - (if Category type) Select one or more
   - **Keywords** - (if Keyword type) Enter comma-separated keywords
   - **Match Type** - (if Keyword type) Exact, Contains, or Regex

4. **Skill Prompt**
   - Write the instructions to inject
   - Keep focused and concise
   - Use clear, directive language

5. **Tool Association** (Keyword type only, optional)
   - **Force Tool** - Select a tool to invoke when skill matches
   - **Force Mode** - Required, Preferred, or Suggested
   - **Tool Config** - Tool-specific options (chart type, data sources, etc.)

6. **Priority**
   - Set priority (1-999, lower = higher priority)
   - Core skills: 1-9 (Admin only)
   - High priority: 10-99 (Admin only)
   - Medium priority: 100-499 (Admin + Superuser)
   - Low priority: 500+ (Admin + Superuser)

7. **Advanced Options**
   - **Is Core** - Protected from deletion (Admin only)
   - **Is Index** - Used for RAG optimization
   - **Token Estimate** - For budget tracking

8. **Compliance Configuration** (optional)
   - **Enable Compliance** - Turn on compliance validation for this skill
   - **Required Sections** - Markdown headings that must be present (e.g., "## Summary, ## Analysis")
   - **Threshold Overrides** - Custom pass/warn thresholds for this skill
   - **Clarification Instructions** - Custom context for LLM-generated questions

9. **Save**
   - Click **Save** to create the skill
   - Test in a conversation to verify

---

## Skill Configuration

### Name and Description

**Name:**
- Short, descriptive identifier
- Use Title Case
- Examples: "Legal Disclaimer", "Memory Recall", "SOE Assessment"

**Description:**
- Explain what the skill does
- Who should use it
- When it activates
- Expected behavior changes

### Trigger Types Explained

#### Always-On Configuration

```yaml
Type: Always-on
Categories: (ignored)
Keywords: (ignored)
```

The skill activates in **every** conversation.

#### Category Configuration

```yaml
Type: Category
Categories: [HR, Legal, Compliance]
Keywords: (ignored)
```

The skill activates when thread is in HR, Legal, OR Compliance categories.

**Multi-category behavior:**
- If any selected category matches → skill activates
- Acts as OR logic, not AND
- Empty category list = never activates

#### Keyword Configuration

```yaml
Type: Keyword
Categories: (ignored)
Keywords: assessment, evaluation, review
Match Type: Contains
```

The skill activates when user message contains "assessment", "evaluation", OR "review".

**Keyword behavior:**
- Case-insensitive matching
- Multiple keywords act as OR logic
- Matches are detected in the user's current message only

### Match Type Details

#### Exact Match
```
Keywords: contract, agreement
Matches: "contract", "agreement"
No Match: "contracts", "contractor", "agreements"
```

#### Contains Match
```
Keywords: contract
Matches: "contract", "contractor", "contracts", "contractual"
No Match: "agree", "document"
```

#### Regex Match
```
Regex: \b(contract|agreement)s?\b
Matches: "contract", "contracts", "agreement", "agreements"
No Match: "contractor" (because of \b word boundary)
```

**Regex Examples:**

```regex
\binitiate\b.*assessment     # "initiate" followed by "assessment"
\bevaluate\s+all\b           # "evaluate all" with space
(SOE|soe)\s+assessment       # SOE assessment (case variations)
\b(review|audit)\b           # Either "review" or "audit"
```

### Compliance Configuration

Skills can optionally enable compliance validation, which runs after the AI generates a response. This is an **opt-in** feature - compliance checks only run for skills that explicitly enable it.

#### Enabling Compliance

When editing a skill, expand the **Compliance Validation** section:

1. **Enable compliance checking** - Toggle on to run compliance for this skill
2. **Required Sections** - Comma-separated markdown headings that must be present
   - Example: `## Summary, ## Analysis, ## Recommendations`
3. **Pass Threshold** - Override global pass threshold (default: 80)
4. **Warning Threshold** - Override global warn threshold (default: 50)
5. **Custom Clarification Instructions** - Context for LLM-generated questions

#### How It Works

```
User message matches skill
        ↓
AI generates response with skill prompt
        ↓
┌───────────────────────────────────────┐
│ Is skill.complianceConfig.enabled?   │
│   NO  → Skip compliance check        │
│   YES ↓                              │
│ Run compliance validation            │
│   - Check required sections present  │
│   - Validate tool executions         │
│   - Calculate weighted score         │
│   - Trigger HITL if below threshold  │
└───────────────────────────────────────┘
```

#### Opt-In Model

Compliance checking is **opt-in** at the skill level:

- **No skills with compliance enabled** → Compliance checker skipped entirely
- **At least one matched skill has compliance** → Compliance runs for those skills

This prevents unnecessary overhead for simple questions and allows targeted validation for critical workflows.

#### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | false | Whether to run compliance for this skill |
| `sections` | string[] | [] | Required markdown headings (e.g., `["## Summary"]`) |
| `passThreshold` | number | 80 | Override global pass threshold |
| `warnThreshold` | number | 50 | Override global warn threshold |
| `clarificationInstructions` | string | null | Custom context for clarification questions |

#### Example: Compliance-Enabled Skill

```yaml
Name: SOE Assessment Report
Type: Keyword
Keywords: SOE assessment, evaluate state-owned
Priority: 30
Status: Active

Prompt:
  Conduct a comprehensive SOE assessment using the 6-dimension framework.
  Include fiscal health, governance, efficiency, market position,
  strategic importance, and political economy context.

Compliance:
  Enabled: true
  Required Sections:
    - "## Executive Summary"
    - "## Fiscal Health Analysis"
    - "## Recommendations"
  Pass Threshold: 75
  Clarification Instructions:
    For SOE assessments, prioritize asking about data recency
    and methodology when sections are incomplete.
```

#### When to Enable Compliance

✅ **Enable compliance when:**
- Skill generates structured reports with required sections
- Output quality is critical (legal, compliance, financial)
- Users expect specific deliverables
- You want to catch tool failures before showing response

❌ **Don't enable compliance when:**
- Skill is for simple Q&A
- Output format is flexible
- Performance is critical (adds latency)
- Already covered by another skill's compliance config

---

### Preflight Clarification (Pre-response HITL)

Skills can also enable **pre-response HITL clarification**, which gives the main LLM a chance to ask the user a focused question *before* generating its answer. Unlike post-response compliance checking, this fires before any tokens are generated.

#### How It Works

The main LLM is given a `request_clarification` tool. When enabled, the LLM can call it if — **after reviewing all available documents, conversation history, system prompt, and category prompts** — the query is still genuinely ambiguous. Because the LLM sees full context, it will only ask when truly necessary.

```
User sends message
        ↓
RAG retrieval (documents + prompts + memory)
        ↓
Main LLM reviews: documents + history + context + user message
        ↓
┌──────────────────────────────────────────────┐
│ Is the query ambiguous even with full        │
│ context?                                     │
│   NO  → Generate response directly           │
│   YES → Call request_clarification tool      │
└──────────────────────────────────────────────┘
        ↓ (if tool called)
User sees question dialog with 2–4 options
        ↓
User selects an option or types a free-text answer
        ↓
LLM receives answer as context → generates response
```

#### Why This Produces Fewer False Positives

The LLM can reason: *"The user asked about leave entitlements. The HR Policy document covers annual leave on page 4. The previous message was about the same topic. No clarification needed."* This is only possible because the same model that writes the response also decides whether to ask — with full visibility into every input.

#### Comparison: Preflight vs Compliance HITL

| Aspect | Preflight Clarification | Compliance Checker HITL |
|--------|------------------------|------------------------|
| **Timing** | Before response generation | After response generation |
| **Trigger** | Query ambiguous given full context | Response fails compliance checks |
| **Questions** | Generated from query ambiguity | Generated from response failures |
| **Outcome** | Answer fed back to LLM as context | User retries, accepts, or flags |
| **Best for** | Policy domains with multiple sub-topics | Structured reports with required sections |

#### Enabling Per Skill

When editing a skill, expand the **Pre-response Clarification** section:

1. **Enable** — Toggle on to allow this skill to request clarification
2. **Timeout** — How long to wait for the user before auto-continuing (default: 5 min, max: 15 min)
3. **Skip on follow-up** — Don't interrupt if the message is a follow-up to the previous turn (default: true)
4. **Instructions** — Optional domain context to help the LLM frame better questions

#### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | false | Per-skill opt-in (also requires global `preflightEnabled = true`) |
| `timeoutMs` | number | 300000 | Per-user wait time in ms (max 900000 = 15 min) |
| `skipOnFollowUp` | boolean | true | Skip clarification if message is a follow-up |
| `instructions` | string | null | Domain context for better question framing |

#### Global Settings (Admin > Compliance)

| Setting | Default | Description |
|---------|---------|-------------|
| `preflightEnabled` | false | Global kill switch — must be `true` for any skill to use preflight |
| `preflightDefaultTimeoutMs` | 300000 | Default wait time (5 min) |
| `preflightMaxQuestions` | 2 | Maximum questions per request (1–4) |
| `preflightSkipOnFollowUp` | true | Global default for skip-on-follow-up |

#### Example: Preflight-Enabled Skill

```yaml
Name: Benefits Policy Advisor
Type: Category
Category: HR
Status: Active

Prompt: |
  Answer questions about employee benefits, leave entitlements, and
  compensation using the official HR Policy documents.

PreflightClarification:
  Enabled: true
  TimeoutMs: 300000       # 5-minute timeout
  SkipOnFollowUp: true    # Don't interrupt follow-up questions
  Instructions: >
    This skill covers leave, benefits, and compensation. Ask about leave
    type (annual, sick, parental, unpaid) or benefit category (health,
    retirement, allowances) only when the query does not specify and the
    documents cover multiple options.
```

#### When to Enable Preflight

✅ **Enable preflight when:**
- The skill covers multiple distinct policy sub-topics (leave types, benefit categories, procedures)
- An ambiguous query would produce a wrong or incomplete response
- The cost of re-generating a response outweighs one quick clarification question

❌ **Don't enable preflight when:**
- The skill covers a single, clearly scoped topic
- Users are predominantly asking follow-ups (`skipOnFollowUp: true` handles most cases)
- You are using Ollama models (preflight tool is automatically suppressed for local models)
- The skill is for simple conversational Q&A

---

## Skill Prompts

### Writing Effective Skill Prompts

Skill prompts should be:
- **Focused** - Single purpose or behavior
- **Concise** - Under 300 tokens ideal
- **Directive** - Use imperative language
- **Complementary** - Work with system prompt

### Good vs Bad Skill Prompts

#### ❌ Bad: Too Vague
```
Help with legal stuff and be careful.
```

#### ✅ Good: Specific and Actionable
```
When discussing legal matters:
- Include disclaimer: "Not legal advice. Consult Legal team."
- Reference specific policy sections and dates
- Emphasize legal review for binding decisions
- Direct urgent matters to legal@company.com
```

#### ❌ Bad: Contradicts System Prompt
```
Don't cite sources. Just give answers.
```
*(Conflicts with global citation requirement)*

#### ✅ Good: Extends System Prompt
```
For technical documentation:
- Include code references when citing technical docs
- Use technical terminology appropriate for IT audience
- Link to internal wiki when relevant
```

#### ❌ Bad: Too Long and Unfocused
```
When someone asks about anything, first check if it's about HR, then
check if it's about benefits, then check if they mentioned insurance...
[continues for 500 words]
```

#### ✅ Good: Focused and Modular
```
For HR benefits questions:
- Reference the Benefits Guide (current year)
- Include enrollment period dates
- Direct complex cases to benefits@company.com
```

### Skill Prompt Structure

A well-structured skill prompt has:

1. **Context** - When to apply these instructions
2. **Actions** - What to do
3. **Format** - How to present information
4. **Escalation** - When to refer to humans

**Template:**
```markdown
[Context: When this skill applies]

[Action: What to do]
- Bullet point 1
- Bullet point 2
- Bullet point 3

[Format: How to present]
- Formatting guidelines
- Citation requirements

[Escalation: When to defer]
- Situations requiring human intervention
- Contact information
```

**Example:**
```markdown
When assisting with safety procedures:

Always prioritize safety:
- Emphasize exact adherence to written procedures
- Include relevant PPE requirements
- Reference applicable OSHA standards

Format all procedures as:
1. Numbered steps
2. Bold critical warnings
3. Citations to Safety Manual sections

For emergencies or unsafe conditions:
- Direct to Safety Hotline: 555-0100 (24/7)
- Emphasize STOP, SECURE, REPORT protocol
```

---

## Priority System

Skills are applied in **priority order**, with lower numbers having higher priority.

### Priority Tiers

Skills use a tiered priority system with role-based access:

| Tier | Priority Range | Access | Examples |
|------|----------------|--------|----------|
| **Core** | 1-9 | Admin only | Citation format, safety guidelines |
| **High** | 10-99 | Admin only | Legal disclaimers, compliance requirements |
| **Medium** | 100-499 | Admin + Superuser | Department-specific behaviors, category skills |
| **Low** | 500+ | Admin + Superuser | Nice-to-have enhancements, experimental |

**Note:** Superusers can only create skills in the Medium (100-499) or Low (500+) tiers. Core and High priority skills are reserved for system-wide behaviors managed by administrators.

### How Priority Works

```
Priority 10: Core Citation Format
  ↓
Priority 20: Legal Disclaimer
  ↓
Priority 40: Department Terminology
  ↓
Priority 60: Tone Adjustment
  ↓
Combined into final prompt
```

Lower priority skills are injected **first**, appearing earlier in the final prompt.

### Priority Conflicts

If two skills have the same priority:
- Both are included
- Order is undefined (database order)
- Best practice: Use unique priorities

### When to Adjust Priority

**Increase Priority (lower number):**
- Skill contains critical safety information
- Required for compliance
- Foundational behavior others depend on

**Decrease Priority (higher number):**
- Enhancement or optimization
- Experimental feature
- Minor formatting preference

---

## Managing Skills

### Viewing Skills

**Skills List View:**
- Name and description
- Trigger type
- Status (Active/Inactive)
- Priority
- Categories/keywords (if applicable)

### Editing Skills

1. Click skill name or Edit button
2. Modify any field
3. Click **Save**
4. Changes apply immediately to new conversations

**Note:** Editing a skill does not affect ongoing conversations. Only new conversations will use the updated skill.

### Activating/Deactivating

**To Deactivate:**
1. Edit the skill
2. Set **Status** to Inactive
3. Save

Inactive skills are ignored completely - as if they don't exist.

**Use Cases for Deactivating:**
- Temporarily disable problematic skill
- Seasonal skills (e.g., annual review period)
- A/B testing different approaches

### Deleting Skills

1. Select the skill
2. Click **Delete**
3. Confirm deletion

**Note:** Core skills (Is Core = true) cannot be deleted. This prevents accidental removal of critical behaviors.

### Core Skills

Skills marked as **Is Core** are:
- ✅ Protected from deletion
- ✅ Typically priority 0-10
- ✅ Essential system behaviors
- ❌ Can still be deactivated (but not deleted)

Examples of core skills:
- Citation formatting
- Source attribution
- Safety disclaimers
- Privacy guidelines

### Duplicating Skills

To create a variant of an existing skill:
1. View the skill
2. Click **Duplicate**
3. Modify name and settings
4. Save as new skill

Useful for:
- Creating similar skills for different categories
- Testing variations
- Creating backup before editing

---

## Skill Examples

### Example 1: Core Citation Skill (Always-On)

```yaml
Name: Core Citation Format
Type: Always-on
Priority: 5
Status: Active
Is Core: true

Prompt:
  Always cite your sources using this exact format:
  [Document Name] (Page X)

  Guidelines:
  - Include page numbers when available
  - If multiple sources, list all relevant citations
  - Place citations at the end of the statement they support
  - If no sources found, explicitly state: "No relevant documents found."
```

### Example 2: Legal Disclaimer (Category-Triggered)

```yaml
Name: Legal Disclaimer
Type: Category
Categories: Legal, Compliance, Contracts
Priority: 20
Status: Active

Prompt:
  You are now assisting with legal and compliance matters.

  ALWAYS include this disclaimer in your responses:
  "⚖️ This is general information only, not legal advice. For specific
  legal matters, consult the Legal team at legal@company.com"

  Additional guidelines:
  - Cite specific policy sections and effective dates
  - Emphasize when legal review is required
  - Direct binding decisions to qualified legal counsel
```

### Example 3: Contract Review (Keyword-Triggered)

```yaml
Name: Contract Review Skill
Type: Keyword
Keywords: contract, agreement, terms, NDA, SLA, MSA
Match Type: Contains
Priority: 40
Status: Active

Prompt:
  When discussing contracts or agreements:

  Reference Process:
  - Cite the Contracts and Procurement Guide
  - Mention required approvals by contract value:
    * Under $10K: Department Manager
    * $10K-$50K: Director approval
    * Over $50K: VP + Legal review

  Reminders:
  - All contracts require Legal review before signing
  - Use standard templates when available
  - Document all amendments and changes
  - Store signed contracts in the contracts repository
```

### Example 4: SOE Assessment (Category + Keyword)

```yaml
Name: SOE Assessment Framework
Type: Keyword
Keywords: SOE assessment, evaluate SOE, assess state-owned
Match Type: Regex: \b(SOE|soe)\s+(assessment|evaluation)
Priority: 30
Status: Active
Categories: SOE, Operations  # Also scope to categories

Prompt:
  When conducting SOE (State-Owned Enterprise) assessments:

  Use the 6-dimension framework:
  1. Fiscal Health
  2. Governance Quality
  3. Operational Efficiency
  4. Market Position
  5. Strategic Importance
  6. Political Economy Context

  For multi-step assessments:
  - Use the task_planner tool
  - Select appropriate template (e.g., "soe_identify")
  - Work through each dimension systematically
  - Provide evidence and citations for each dimension
```

### Example 5: Sensitive Topic Handling (Keyword-Triggered)

```yaml
Name: Sensitive HR Matters
Type: Keyword
Keywords: harassment, discrimination, termination, lawsuit, grievance
Match Type: Contains
Priority: 15
Status: Active

Prompt:
  ⚠️ SENSITIVE TOPIC DETECTED

  This appears to involve a sensitive HR matter. Important guidelines:

  1. Provide only general policy information
  2. Emphasize confidentiality
  3. Direct to appropriate resources:
     - HR Department: hr@company.com | (555) 0123
     - Employee Relations: er@company.com
     - Anonymous Hotline: 1-800-555-0199

  4. Include this message:
     "For confidential assistance with sensitive employment matters,
     please contact HR directly. Your privacy will be protected."

  5. Do NOT:
     - Provide legal advice
     - Discuss specific cases or individuals
     - Make judgments about situations
```

### Example 6: Memory Recall (Always-On)

```yaml
Name: Memory Recall
Type: Always-on
Priority: 25
Status: Active

Prompt:
  If relevant to the current question, reference information from previous
  conversations with this user:

  - Recall their role, department, or ongoing projects
  - Reference prior discussions when building on them
  - Cite: "Based on our previous conversation..."
  - Provide continuity and personalization

  Only recall facts directly relevant to the current query.
  Don't overwhelm with unnecessary historical details.
```

### Example 7: Chart Generation (Keyword-Triggered)

```yaml
Name: Data Visualization Skill
Type: Keyword
Keywords: chart, graph, plot, visualize, diagram
Match Type: Contains
Priority: 50
Status: Active

Prompt:
  When creating data visualizations:

  Chart Selection:
  - Bar chart: Comparing categories
  - Line chart: Trends over time
  - Pie chart: Part-to-whole relationships
  - Scatter plot: Correlations

  Best Practices:
  - Choose the most appropriate chart type
  - Label axes clearly
  - Include data source in caption
  - Use color sparingly and meaningfully
  - Ensure accessibility (patterns + color)
```

---

## Best Practices

### Design Principles

1. **Single Responsibility**
   - Each skill should do one thing well
   - Don't combine unrelated behaviors
   - Keep skills focused and modular

2. **Composability**
   - Skills should work together harmoniously
   - Avoid contradictions between skills
   - Test combinations of skills

3. **Clear Triggers**
   - Use specific category assignments
   - Choose keywords carefully
   - Test trigger conditions thoroughly

4. **Appropriate Priority**
   - Critical skills: Lower priority numbers
   - Enhancements: Higher priority numbers
   - Test priority ordering

5. **Maintainability**
   - Use descriptive names
   - Document the purpose clearly
   - Review and update regularly

### When to Create a Skill

✅ **Create a skill when:**
- Behavior is contextual (not always needed)
- Logic can be reused across contexts
- You want to test a behavior independently
- Instructions are modular and focused

❌ **Don't create a skill when:**
- Behavior should always apply (use system prompt)
- Logic is category-specific (use category addendum)
- Instructions are fundamental (use system prompt)

### Skill Lifecycle

1. **Create** - Define skill with clear trigger and prompt
2. **Test** - Verify in target contexts
3. **Refine** - Adjust based on real usage
4. **Monitor** - Check if skill activates correctly
5. **Update** - Modify as needs change
6. **Retire** - Deactivate when no longer needed

### Testing Skills

**Test Checklist:**
- ✅ Does it activate in the right contexts?
- ✅ Does it activate only in the right contexts?
- ✅ Does it conflict with other skills?
- ✅ Is the prompt clear and actionable?
- ✅ Does priority ordering work correctly?
- ✅ Are token limits respected?

**Testing Approach:**
1. Create thread in target category
2. Use trigger keywords in messages
3. Verify skill behavior appears
4. Test edge cases and conflicts
5. Check with different priority orderings

---

## Advanced Usage

### Multi-Category Skills

Skills can apply to multiple categories:

```yaml
Type: Category
Categories: [Finance, Legal, Compliance, Audit]
```

The skill activates in **any** of the selected categories.

**Use Case:**
Skills that apply across related domains, like compliance requirements shared by Legal, Finance, and Audit.

### Regex Patterns for Keywords

Use regex for precise matching:

```regex
# Exact word boundaries
\bcontract\b

# Multiple variations
\b(SOE|State-Owned Enterprise)\b

# Phrases
\binitiate\s+(assessment|evaluation|review)

# Optional plurals
\bpolic(y|ies)\b

# Case insensitive (already default, but explicit)
(?i)contract

# Negative lookahead (avoid certain contexts)
\bcontract\b(?!\s+law)  # "contract" but not "contract law"
```

### Conditional Skill Logic

Use conditional language in skill prompts:

```markdown
When discussing [topic]:
- IF source has page numbers, include them
- IF multiple sources, list all citations
- IF no sources found, state explicitly
- IF topic is sensitive, include escalation info
```

The AI will interpret these conditions naturally.

### Token Budget Management

Skills consume tokens. To manage:

1. **Estimate Tokens**
   - Set token_estimate field
   - Approximate: 1 token ≈ 4 characters

2. **Monitor Total Budget**
   - Sum all active skill tokens
   - Add to system prompt tokens
   - Keep under context window limit

3. **Optimize**
   - Remove redundant instructions
   - Use concise language
   - Deactivate unused skills

### Skill Analytics (Future)

Consider tracking:
- Activation frequency
- Effectiveness metrics
- Token usage per skill
- User satisfaction correlation

---

## Troubleshooting

### Issue: Skill Not Activating

**Possible Causes:**
1. Skill is inactive
2. Trigger conditions not met
3. Category mismatch
4. Keyword not found in message

**Solutions:**
- Verify Status = Active
- Check trigger type and settings
- For Category: Ensure thread is in selected category
- For Keyword: Test with exact keyword phrases
- Check server logs for skill activation debug

### Issue: Skill Activating Incorrectly

**Possible Causes:**
1. Keyword match too broad (Contains mode)
2. Category incorrectly assigned
3. Always-on skill when it should be conditional

**Solutions:**
- Use Regex for precise keyword matching
- Review category assignments
- Change type from Always-on to Category/Keyword
- Add word boundaries: `\bword\b`

### Issue: Skills Conflicting

**Possible Causes:**
1. Contradictory instructions
2. Overlapping keywords
3. Priority ordering issues

**Solutions:**
- Review all active skills for conflicts
- Adjust priorities so critical skills apply first
- Merge conflicting skills into one
- Deactivate one of the conflicting skills

### Issue: Prompt Too Long

**Possible Causes:**
1. Too many active skills
2. Individual skills too verbose
3. System prompt + skills exceed limits

**Solutions:**
- Deactivate unnecessary skills
- Shorten skill prompts
- Use more targeted triggers (fewer activations)
- Increase model context window (if possible)
- Split skills to activate in different contexts

### Issue: AI Ignoring Skill Instructions

**Possible Causes:**
1. Skill prompt too vague
2. Conflicts with system prompt
3. Skill priority too low
4. Prompt not clear enough

**Solutions:**
- Be more explicit and directive
- Check for contradictions with system prompt
- Increase priority (lower number)
- Use imperative language ("Always", "Must", "Never")
- Test with stronger phrasing

---

*Last updated: February 2025 (v1.1 - Added superuser skill creation permissions with tier restrictions)*
