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
| Create skills | ✅ | ❌ | ❌ |
| View skills | ✅ | ❌ | ❌ |
| Edit skills | ✅ | ❌ | ❌ |
| Delete skills | ✅ (except core) | ❌ | ❌ |

**Note:** Only Admins can create and manage skills. This is intentional to maintain system-wide consistency.

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

5. **Priority**
   - Set priority (0-100, lower = higher priority)
   - Default: 50
   - Core skills: 0-10
   - Standard skills: 40-60
   - Low-priority skills: 70-100

6. **Advanced Options**
   - **Is Core** - Protected from deletion
   - **Is Index** - Used for RAG optimization
   - **Token Estimate** - For budget tracking

7. **Save**
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

### Priority Ranges

| Range | Purpose | Examples |
|-------|---------|----------|
| **0-10** | Core system behaviors | Citation format, safety guidelines |
| **11-30** | Important contextual skills | Legal disclaimers, compliance requirements |
| **31-60** | Standard skills | Department-specific behaviors |
| **61-90** | Low-priority skills | Nice-to-have enhancements |
| **91-100** | Experimental skills | Testing new behaviors |

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

*Last updated: January 2025 (v1.0)*
