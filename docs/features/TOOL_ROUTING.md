# Tool Routing

Comprehensive guide to Tool Routing in Policy Bot - pattern-based forced tool invocation for reliable and deterministic AI behavior.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Why Tool Routing?](#why-tool-routing)
3. [How It Works](#how-it-works)
4. [Routing Rules](#routing-rules)
5. [Force Modes](#force-modes)
6. [Pattern Matching](#pattern-matching)
7. [Creating Rules](#creating-rules)
8. [Testing Rules](#testing-rules)
9. [Rule Examples](#rule-examples)
10. [Best Practices](#best-practices)
11. [Advanced Usage](#advanced-usage)
12. [Troubleshooting](#troubleshooting)

---

## Introduction

**Tool Routing** is a powerful feature that allows administrators to force specific tools to be called when user messages match certain patterns. Instead of leaving tool selection entirely to the LLM's discretion, routing rules provide deterministic control over when tools are invoked.

### The Problem

Without routing, the LLM may:
- 💬 Write about creating a chart instead of actually calling the chart tool
- 🤔 Ask for confirmation before generating visualizations
- 📝 Describe steps instead of using the Task Planner
- 🌐 Summarize what a web search might find instead of searching

### The Solution

Tool Routing forces the AI to call specific tools when patterns match:
- 📊 "create a chart" → Forces `chart_gen` tool
- ✅ "initiate assessment" → Forces `task_planner` tool
- 🔍 "search the web" → Forces `web_search` tool
- 📄 "generate a report" → Forces `doc_gen` tool

### Benefits

✅ **Reliable Behavior** - Tools are called deterministically
✅ **Better UX** - No confirmations or hesitation
✅ **Predictable Outcomes** - Users know what to expect
✅ **Reduced Tokens** - Skip unnecessary back-and-forth
✅ **Custom Workflows** - Tailor to your organization's needs

---

## Why Tool Routing?

### LLM Tool Selection Limitations

When using OpenAI's function calling (or similar), the LLM decides whether to call a tool based on:
- Tool descriptions
- User message content
- Conversation context
- LLM's internal reasoning

This can lead to inconsistency:

**Example 1: Chart Generation**
```
User: "Create a bar chart showing sales by region"

Without Routing:
❌ AI: "I can help you create a bar chart. Let me describe
        how it might look: We'd have regions on the X-axis..."
        [No chart generated]

With Routing:
✅ AI: [Calls chart_gen tool]
     "Here's a bar chart showing sales by region:"
     [Actual chart displayed]
```

**Example 2: Task Planning**
```
User: "Initiate SOE assessment for Brazil"

Without Routing:
❌ AI: "To conduct an SOE assessment, you would need to:
        1. Identify major SOEs
        2. Gather fiscal data..."
        [Just describes the process]

With Routing:
✅ AI: [Calls task_planner tool with SOE template]
     "I've created a task plan for Brazil SOE assessment.
     Let's work through it step by step..."
     [Actual structured plan with progress tracking]
```

### When to Use Routing

✅ **Use routing when:**
- Tool invocation should be deterministic
- Users expect immediate tool usage
- Specific keywords always mean "use this tool"
- Consistency is critical for workflows

❌ **Don't use routing when:**
- LLM discretion is preferred
- Context matters more than keywords
- Tool usage should be optional
- Over-routing would limit flexibility

---

## How It Works

### Routing Flow

```
User Message
    │
    ▼
┌─────────────────────────┐
│ Extract user message    │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Get active thread       │
│ categories              │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Load all routing rules  │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Filter by category      │
│ scope (if specified)    │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Sort by priority        │
│ (lower number first)    │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Test patterns:          │
│ - Keyword matching      │
│ - Regex matching        │
└─────────────────────────┘
    │
    ├── No Match ──────────────────┐
    │                              │
    ├── Single Required Match ─────┤
    │   → Force that specific tool │
    │                              │
    ├── Multiple Required Matches ─┤
    │   → Force LLM to pick one    │
    │                              │
    ├── Preferred Matches ─────────┤
    │   → Force tool use (any)     │
    │                              │
    └── Suggested Matches ─────────┘
        → Hint to LLM (optional)
              │
              ▼
    ┌─────────────────────────┐
    │ Set tool_choice in API  │
    └─────────────────────────┘
              │
              ▼
    ┌─────────────────────────┐
    │ Send to LLM             │
    └─────────────────────────┘
```

### OpenAI tool_choice Parameter

Routing sets the `tool_choice` parameter in the OpenAI API call:

| tool_choice Value | Behavior |
|-------------------|----------|
| `"auto"` | LLM decides whether to use tools |
| `"required"` | LLM must use a tool, can choose which |
| `{type: "function", function: {name: "chart_gen"}}` | Must use specific tool |

Routing rules map to these values based on force mode and matches.

---

## Routing Rules

A routing rule consists of:

### Rule Components

| Field | Description | Example |
|-------|-------------|---------|
| **Tool Name** | Target tool to invoke | `chart_gen` |
| **Rule Name** | Descriptive identifier | "Chart Generation Keywords" |
| **Rule Type** | Pattern matching method | `keyword` or `regex` |
| **Patterns** | Patterns to match (array) | `["chart", "graph", "plot"]` |
| **Force Mode** | How strongly to force | `required`, `preferred`, `suggested` |
| **Priority** | Evaluation order (0-100) | `50` (lower = higher priority) |
| **Categories** | Category scope (optional) | `["Finance", "Sales"]` |
| **Active** | Enable/disable | `true` or `false` |

### Rule Structure Example

```json
{
  "id": "rule_123",
  "toolName": "chart_gen",
  "ruleName": "Chart Generation Keywords",
  "ruleType": "keyword",
  "patterns": ["chart", "graph", "plot", "visualize"],
  "forceMode": "required",
  "priority": 50,
  "categories": [],  // Empty = all categories
  "active": true
}
```

### Category Scoping

Rules can be:
- **Global** - Apply to all categories (categories = [])
- **Scoped** - Apply only to specific categories

**Example:**
```json
{
  "toolName": "task_planner",
  "categories": ["SOE", "Operations"],
  "patterns": ["assessment", "evaluation"]
}
```

This rule only applies when the thread is in the "SOE" or "Operations" category.

---

## Force Modes

Force modes determine how strongly the tool is enforced.

### 1. Required Mode

**Behavior:** Forces the **specific tool** to be called

**API Mapping:**
```json
{
  "tool_choice": {
    "type": "function",
    "function": {"name": "chart_gen"}
  }
}
```

**When to Use:**
- You're certain this tool should be called
- No ambiguity or alternatives
- Critical workflow step

**Example:**
```
Pattern: "create a chart"
Force Mode: required
Result: chart_gen MUST be called
```

### 2. Preferred Mode

**Behavior:** Forces the LLM to use **some tool**, but lets it choose which

**API Mapping:**
```json
{
  "tool_choice": "required"
}
```

**When to Use:**
- Multiple tools might apply
- LLM should choose the best tool
- You want tool usage but not a specific tool

**Example:**
```
Pattern: "analyze the data"
Force Mode: preferred
Result: LLM must call a tool (could be data_source, chart_gen, or others)
```

### 3. Suggested Mode

**Behavior:** Hints to the LLM but doesn't force

**API Mapping:**
```json
{
  "tool_choice": "auto"  // But tool is emphasized in prompt
}
```

**When to Use:**
- Gentle nudge toward a tool
- LLM should still have discretion
- Testing a routing rule

**Example:**
```
Pattern: "show me"
Force Mode: suggested
Result: LLM considers the tool but may choose not to use it
```

### Mode Comparison

| Force Mode | LLM Flexibility | Use Case |
|------------|-----------------|----------|
| **Required** | None - must use specific tool | Critical workflows |
| **Preferred** | Low - must use some tool | General tool encouragement |
| **Suggested** | High - can opt out | Gentle hints |

---

## Pattern Matching

### Rule Types

#### 1. Keyword Matching

**How It Works:**
- Splits user message into words
- Checks if any pattern word matches any message word
- Case-insensitive
- Word boundary matching

**Example:**
```
Patterns: ["chart", "graph"]
Matches: "create a chart", "show graph", "Chart please"
No Match: "charter", "biography"
```

**Word Boundaries:**
- "chart" matches "chart" but not "charter"
- Automatically uses word boundaries (`\b`)

**Configuration:**
```json
{
  "ruleType": "keyword",
  "patterns": ["chart", "graph", "plot", "visualize"]
}
```

#### 2. Regex Matching

**How It Works:**
- Tests user message against regex patterns
- Full regex syntax supported
- Case-insensitive by default
- More precise control

**Example:**
```
Pattern: \binitiate\b.*assessment
Matches: "initiate SOE assessment", "please initiate the assessment"
No Match: "assess and initiate", "initiated"
```

**Configuration:**
```json
{
  "ruleType": "regex",
  "patterns": [
    "\\binitiate\\b.*assessment",
    "\\bevaluate\\s+all\\b"
  ]
}
```

**Note:** Escape backslashes in JSON: `\b` becomes `\\b`

### Pattern Syntax

#### Keyword Patterns

```
Simple words: chart, graph, report
Multiple words treated as separate: "bar chart" → ["bar", "chart"]
Case insensitive: Chart = chart = CHART
```

#### Regex Patterns

Common regex constructs:

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

**Examples:**

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

### Pattern Testing

Before saving rules, test patterns:

1. Enter test messages
2. View which patterns match
3. Verify correct tool is selected
4. Adjust patterns as needed

**Testing Interface:**
```
┌────────────────────────────────┐
│ Test Routing                   │
├────────────────────────────────┤
│ Message:                       │
│ [create a bar chart showing...]│
│                                │
│ Categories: [Finance]          │
│                                │
│ [Test]                         │
├────────────────────────────────┤
│ Results:                       │
│ ✅ Matched: Chart Keywords     │
│    Tool: chart_gen             │
│    Force: required             │
│    Priority: 50                │
│                                │
│ Final tool_choice:             │
│ {type: "function",             │
│  function: {name: "chart_gen"}}│
└────────────────────────────────┘
```

---

## Creating Rules

### Access

1. Navigate to **Admin** → **Tools** → **Tool Routing**
2. Click **Add Rule**

### Step-by-Step

#### 1. Basic Information

- **Rule Name** - Descriptive name for this rule
- **Tool Name** - Select the target tool from dropdown
- **Active** - Enable the rule

**Example:**
```
Rule Name: Chart Generation Keywords
Tool Name: chart_gen
Active: Yes
```

#### 2. Pattern Configuration

- **Rule Type** - Keyword or Regex
- **Patterns** - Enter patterns (one per line)

**For Keywords:**
```
chart
graph
plot
visualize
visualization
bar chart
line graph
pie chart
```

**For Regex:**
```
\b(chart|graph|plot)\b
\bvisuali[sz]e\b
\bcreate\s+a\s+(chart|graph)\b
```

#### 3. Force Mode

Select force mode:
- ☑️ Required - Force specific tool
- ☑️ Preferred - Force tool use (LLM picks)
- ☑️ Suggested - Hint only

#### 4. Priority

- Enter priority (0-100)
- Lower = higher priority
- Default: 50

**Guidelines:**
- Critical rules: 10-30
- Standard rules: 40-60
- Low-priority rules: 70-90

#### 5. Category Scope (Optional)

- Leave empty for all categories
- Select specific categories to limit scope

**Example:**
```
Categories: [SOE, Operations]
→ Only applies to threads in SOE or Operations
```

#### 6. Save and Test

- Click **Save**
- Use **Test Routing** panel to verify
- Adjust as needed

---

## Testing Rules

### Test Panel

The Test Routing panel allows you to simulate routing without actual conversations.

**Steps:**
1. Click **Test Routing** button
2. Enter a test message
3. Optionally select categories
4. Click **Test**
5. View results

### Test Results

The panel shows:

**Matched Rules:**
- Which rules matched
- Pattern that triggered
- Force mode
- Priority

**Final tool_choice:**
- What would be sent to the API
- Why this value was chosen
- Any conflicts or ambiguities

**Example Output:**
```
Message: "Create a chart showing quarterly sales"
Categories: Finance

✅ Matched Rules:
1. Chart Generation Keywords (Priority 50)
   - Pattern: "chart" (keyword)
   - Tool: chart_gen
   - Force: required

Final tool_choice:
{
  "type": "function",
  "function": {"name": "chart_gen"}
}

Reason: Single required rule matched
```

### Testing Scenarios

Test these scenarios:

**1. Single Match**
```
Message: "create a chart"
Expected: One rule matches, tool forced
```

**2. Multiple Matches (Same Tool)**
```
Message: "create a bar chart visualization"
Expected: Multiple rules match same tool, tool forced
```

**3. Multiple Matches (Different Tools)**
```
Message: "analyze data and create chart"
Expected: Multiple tools matched, LLM picks
```

**4. No Match**
```
Message: "what is the policy on vacation?"
Expected: No routing, tool_choice = "auto"
```

**5. Category Scope**
```
Message: "initiate assessment"
Category: HR (rule scoped to SOE)
Expected: No match (wrong category)
```

---

## Rule Examples

### Example 1: Chart Generation

```json
{
  "ruleName": "Chart Generation Keywords",
  "toolName": "chart_gen",
  "ruleType": "keyword",
  "patterns": [
    "chart",
    "graph",
    "plot",
    "visualize",
    "visualization",
    "bar chart",
    "line graph",
    "pie chart",
    "scatter plot"
  ],
  "forceMode": "required",
  "priority": 50,
  "categories": [],
  "active": true
}
```

**Matches:**
- "create a chart"
- "show me a graph"
- "plot the data"
- "visualize quarterly results"

---

### Example 2: Task Planner (Regex)

```json
{
  "ruleName": "Task Planner Triggers",
  "toolName": "task_planner",
  "ruleType": "regex",
  "patterns": [
    "\\binitiate\\b.*assessment",
    "\\bevaluate\\s+all\\b",
    "\\bstep\\s+by\\s+step\\b",
    "\\bcreate\\s+a\\s+plan\\b"
  ],
  "forceMode": "required",
  "priority": 40,
  "categories": ["SOE", "Operations"],
  "active": true
}
```

**Matches:**
- "initiate SOE assessment"
- "evaluate all dimensions"
- "create a step by step plan"

**Doesn't Match:**
- "assess the situation" (doesn't match pattern)
- (In HR category - not in scope)

---

### Example 3: Web Search

```json
{
  "ruleName": "Web Search Triggers",
  "toolName": "web_search",
  "ruleType": "keyword",
  "patterns": [
    "search the web",
    "look up online",
    "latest news",
    "current information",
    "search for"
  ],
  "forceMode": "required",
  "priority": 45,
  "categories": [],
  "active": true
}
```

**Matches:**
- "search the web for latest tax changes"
- "look up online current OSHA regulations"
- "get the latest news on trade policy"

---

### Example 4: Document Generation

```json
{
  "ruleName": "Document Generation",
  "toolName": "doc_gen",
  "ruleType": "regex",
  "patterns": [
    "\\bgenerate\\s+(a\\s+)?(report|document|pdf|docx)\\b",
    "\\bcreate\\s+(a\\s+)?(report|document|pdf|docx)\\b",
    "\\bexport\\s+to\\s+(pdf|docx)\\b",
    "\\bformal\\s+document\\b"
  ],
  "forceMode": "required",
  "priority": 55,
  "categories": [],
  "active": true
}
```

**Matches:**
- "generate a report"
- "create a PDF summary"
- "export to DOCX"
- "create a formal document"

---

### Example 5: Data Source Query

```json
{
  "ruleName": "Data Source Queries",
  "toolName": "data_source",
  "ruleType": "keyword",
  "patterns": [
    "query the database",
    "fetch data",
    "retrieve records",
    "get data from",
    "pull data"
  ],
  "forceMode": "preferred",
  "priority": 60,
  "categories": ["Finance", "Sales", "Operations"],
  "active": true
}
```

**Note:** Uses `preferred` mode because the LLM should choose which data source to query.

---

## Best Practices

### Pattern Design

✅ **Do:**
- Use specific, unambiguous patterns
- Test patterns with real user messages
- Include common variations
- Use word boundaries in regex (`\b`)
- Document why each pattern exists

❌ **Don't:**
- Use overly broad patterns ("data", "help")
- Create conflicting rules
- Over-complicate regex unnecessarily
- Forget to test edge cases

### Force Mode Selection

**Use Required when:**
- ✅ Pattern clearly indicates one tool
- ✅ No ambiguity or alternatives
- ✅ Workflow depends on specific tool

**Use Preferred when:**
- ✅ Multiple tools might apply
- ✅ LLM should choose best option
- ✅ Tool use is important but tool type isn't

**Use Suggested when:**
- ✅ Testing a new rule
- ✅ Gentle nudge preferred
- ✅ Context matters more than pattern

### Priority Assignment

```
0-20:   Reserved for critical business workflows
21-40:  Important but not critical
41-60:  Standard rules (default range)
61-80:  Low-priority or experimental
81-100: Rarely used or deprecated
```

**Ordering Strategy:**
- Lower priority = evaluated first
- More specific rules = lower priority number
- General rules = higher priority number

### Category Scoping

✅ **Use category scope when:**
- Tool only makes sense in specific contexts
- Different departments have different workflows
- Reducing false positives

❌ **Don't scope when:**
- Tool is universally applicable
- Pattern is specific enough already
- Would create duplicate rules per category

### Rule Maintenance

**Regular Review:**
- ✅ Monthly: Review activation frequency
- ✅ Quarterly: Update patterns based on user queries
- ✅ Annually: Audit all rules for relevance

**Version Control:**
- Document changes
- Note why rules were added/modified
- Keep backup of working configurations

---

## Advanced Usage

### Multi-Tool Workflows

Chain tools using patterns:

```
Rule 1: "analyze data" → data_source (required)
Rule 2: "visualize" → chart_gen (required)

User: "analyze sales data and visualize it"
Result: LLM must use one tool (both matched)
LLM picks: data_source first, then suggests chart_gen
```

### Conditional Routing

Use regex for context-aware routing:

```regex
# Only "create chart" at start of message
^create\s+a\s+chart\b

# "Assessment" but not "self-assessment"
\bassessment\b(?!\s+of\s+myself)

# Exclude certain contexts
\bcontract\b(?!\s+law)  # Not "contract law"
```

### Priority Cascades

Design rules that cascade:

```
Priority 10: Specific pattern → Specific tool
Priority 50: General pattern → General tool
Priority 90: Catch-all → Preferred mode
```

If high-priority rule matches, lower-priority rules are still evaluated but may not change the outcome.

### A/B Testing Rules

Test routing strategies:

1. Create two similar rules
2. Activate one at a time
3. Compare user satisfaction and outcomes
4. Keep the better-performing rule

### Analytics Integration

Track:
- Rule activation frequency
- User satisfaction after forced tool calls
- Failed tool invocations
- Pattern match rates

---

## Troubleshooting

### Issue: Rule Not Matching

**Possible Causes:**
- Pattern typo
- Case sensitivity (for regex)
- Category scope mismatch
- Rule is inactive

**Solutions:**
1. Use Test Routing panel to debug
2. Simplify pattern to test
3. Check rule status (Active = true)
4. Verify category scope
5. Try keyword instead of regex

### Issue: Wrong Tool Selected

**Possible Causes:**
- Multiple rules matching
- Priority ordering issue
- Force mode not "required"

**Solutions:**
1. Check all matching rules in test panel
2. Adjust priorities
3. Change force mode to "required"
4. Make patterns more specific
5. Deactivate conflicting rules

### Issue: Too Many Tools Forced

**Possible Causes:**
- Patterns too broad
- Too many active rules
- No way to opt out

**Solutions:**
1. Review all active rules
2. Make patterns more specific
3. Add word boundaries to regex
4. Use category scoping
5. Consider using "suggested" mode

### Issue: Pattern Not Matching Expected Text

**Regex Debugging:**

```regex
# Test incrementally:
\binitiate\b              # Step 1: Does "initiate" match?
\binitiate.*assessment\b  # Step 2: Add context
\binitiate\s+.*assessment\b  # Step 3: Require space
```

**Keyword Debugging:**

```
# If "bar chart" doesn't match:
- Try just "bar"
- Try just "chart"
- Check for typos
- Verify word boundaries
```

### Issue: Rule Works in Test But Not in Chat

**Possible Causes:**
- Test message ≠ actual message
- Category context different
- Caching issues

**Solutions:**
1. Check actual message in logs
2. Verify thread category
3. Clear routing cache
4. Check for middleware interference

---

*Last updated: January 2025 (v1.0)*
