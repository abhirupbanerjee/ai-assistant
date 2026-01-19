# Prompts System

Comprehensive guide to configuring AI behavior through the prompts system in Policy Bot.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Global System Prompt](#global-system-prompt)
3. [Category Prompts](#category-prompts)
4. [Starter Prompts](#starter-prompts)
5. [Acronym Management](#acronym-management)
6. [AI Prompt Optimization](#ai-prompt-optimization)
7. [Prompt Variables](#prompt-variables)
8. [Best Practices](#best-practices)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

The prompts system in Policy Bot allows administrators and superusers to customize how the AI assistant behaves and responds. The system uses a hierarchical approach where prompts can be defined globally and then augmented per category.

### Prompt Hierarchy

```
┌─────────────────────────┐
│  Global System Prompt   │  ← Base instructions for all conversations
└─────────────────────────┘
            ↓
┌─────────────────────────┐
│ Category Addendum       │  ← Category-specific additions (appended)
└─────────────────────────┘
            ↓
┌─────────────────────────┐
│    Skills Injection     │  ← Contextual skills based on triggers
└─────────────────────────┘
            ↓
┌─────────────────────────┐
│   User Memory Facts     │  ← Personalization context (if enabled)
└─────────────────────────┘
            ↓
┌─────────────────────────┐
│   Final Prompt to AI    │  ← Combined prompt sent to the LLM
└─────────────────────────┘
```

### Permissions

| Action | Admin | Superuser | User |
|--------|-------|-----------|------|
| Edit global system prompt | ✅ | ❌ | ❌ |
| Edit category addendum | ✅ | ✅ (managed categories only) | ❌ |
| Create starter prompts | ✅ | ✅ (managed categories only) | ❌ |
| Manage acronyms | ✅ | ❌ | ❌ |
| View prompts | ✅ | ✅ (managed categories only) | ❌ |

---

## Global System Prompt

The **Global System Prompt** is the base instruction set that applies to every conversation in Policy Bot.

### What It Does

- Defines the AI's core personality and role
- Sets response formatting guidelines
- Establishes citation requirements
- Defines safety guardrails and ethical guidelines
- Applies to all users in all categories

### Accessing Global Prompt (Admin Only)

1. Navigate to **Admin** → **Prompts**
2. Select **System Prompt** from the submenu
3. The global prompt editor will appear
4. Edit the prompt text
5. Click **Save** to apply changes

### Components of a Good Global Prompt

A well-crafted global prompt should include:

#### 1. Role Definition
```markdown
You are an AI assistant for [Organization Name] that helps employees
find information in policy documents and answer questions about
company procedures.
```

#### 2. Behavior Guidelines
```markdown
- Always cite sources with document names and page numbers
- Provide concise, actionable answers
- If information is not in the documents, state this clearly
- Maintain a professional and helpful tone
```

#### 3. Response Formatting
```markdown
Format responses as follows:
- Use bullet points for lists
- Bold important terms
- Include citations in [Document Name] (Page X) format
- Provide page numbers when available
```

#### 4. Safety Guardrails
```markdown
- Do not provide legal or financial advice
- Direct users to appropriate departments for sensitive matters
- Respect confidentiality and data privacy
- Do not make up information not present in documents
```

### Example Global Prompt

```markdown
You are the Policy Bot AI assistant for GEA Global Corporation. Your role
is to help employees find accurate information in company policy documents
and answer questions about procedures, benefits, and guidelines.

Core Principles:
- Always cite your sources with document names and page numbers
- Provide clear, concise, and actionable answers
- If information is not in the documents, explicitly state this
- Maintain a professional, helpful, and supportive tone
- Respect confidentiality and data privacy guidelines

Response Format:
- Use markdown formatting for clarity
- Bold key terms and important information
- Use bullet points for multi-part answers
- Always include source citations in this format: [Document Name] (Page X)
- For questions spanning multiple documents, synthesize the information

When You Don't Know:
- If information is not in the available documents, say so clearly
- Do not make assumptions or provide information not in the sources
- Suggest alternative resources or departments to contact
- Offer to help rephrase the question if no results are found

Safety Guidelines:
- Do not provide legal, financial, or medical advice
- Direct sensitive HR matters to the HR department
- Respect all confidentiality and privacy policies
- Do not generate or share personal information about employees
```

### Best Practices

✅ **Do:**
- Be specific and detailed
- Include clear formatting instructions
- Define the AI's limitations
- Specify citation format
- Use consistent tone throughout

❌ **Don't:**
- Make the prompt too long (keep under 1000 tokens)
- Use vague or ambiguous language
- Contradict yourself
- Include temporary or time-sensitive information
- Reference specific documents (use category addendums for this)

---

## Category Prompts

**Category Prompts** (also called category addendums) are additional instructions that append to the global system prompt for specific categories.

### What They Do

- Add category-specific context and instructions
- Override or extend global behavior for specific departments
- Reference category-specific documents or processes
- Apply only to conversations within that category

### Accessing Category Prompts

#### For Admins:
1. Navigate to **Admin** → **Prompts**
2. Select **Category Prompts** from the submenu
3. Choose a category from the dropdown
4. Edit the **Category Addendum** field
5. Click **Save**

#### For Superusers:
1. Navigate to **Superuser** → **Prompts**
2. Select one of your managed categories
3. Edit the **Category Addendum** field
4. Click **Save**

### How Category Addendums Work

Category addendums are **appended** to the global prompt, not replaced:

```
[Global System Prompt]

---

Category-Specific Instructions for [Category Name]:
[Category Addendum]
```

### When to Use Category Prompts

Use category-specific prompts when:
- Different departments have unique terminology
- Specific compliance or regulatory requirements apply
- Category requires specialized response formats
- Department-specific processes need explanation

### Example Category Addendums

#### HR Category Addendum
```markdown
You are now assisting with HR-related questions. Additional guidelines:

- For leave requests, always reference the current leave policy year
- Employee benefits information must cite the most recent handbook
- Confidentiality is paramount - remind users to contact HR directly for
  personal matters
- Common HR documents include: Employee Handbook, Leave Policy, Benefits Guide
- When discussing sensitive topics (termination, disciplinary actions),
  emphasize consulting HR directly
```

#### Legal Category Addendum
```markdown
You are now assisting with legal and compliance questions. Important:

- Always include a disclaimer: "This is general information only and not
  legal advice. Consult the legal department for specific cases."
- Cite specific policy sections and effective dates when available
- For contract questions, reference the Contracts and Procurement Guide
- Emphasize the importance of legal review for binding decisions
- Direct urgent legal matters to legal@company.com
```

#### IT Security Category Addendum
```markdown
You are now assisting with IT security and technical questions. Guidelines:

- Security policies are mandatory - emphasize compliance
- For password resets or account issues, direct to IT helpdesk
- When discussing security incidents, stress immediate reporting
- Reference the Information Security Policy for all security matters
- Use technical terminology appropriate for the IT audience
- Include links to IT support portal when relevant
```

### Best Practices

✅ **Do:**
- Keep category prompts focused and relevant
- Reference category-specific documents
- Add department-specific terminology
- Clarify escalation paths
- Complement (not contradict) the global prompt

❌ **Don't:**
- Duplicate global prompt instructions
- Make assumptions about documents that don't exist
- Contradict global safety guidelines
- Make the addendum too long (under 500 tokens)

---

## Starter Prompts

**Starter Prompts** are suggested questions shown to users when they start a new conversation in a category. They help users understand what questions they can ask.

### Accessing Starter Prompts

#### For Admins:
1. Navigate to **Admin** → **Prompts**
2. Select **Category Prompts** from the submenu
3. Choose a category from the dropdown
4. Scroll to **Starter Prompts** section
5. Enter prompts (one per line)
6. Click **Save**

#### For Superusers:
1. Navigate to **Superuser** → **Prompts**
2. Select one of your managed categories
3. Scroll to **Starter Prompts** section
4. Enter prompts (one per line)
5. Click **Save**

### Format

Enter starter prompts **one per line**:

```
What is our leave policy?
How do I submit an expense report?
What are the working hours?
Where can I find the employee handbook?
```

### How Users See Them

When a user creates a new thread in a category with starter prompts:
1. The prompts appear as clickable chips/buttons
2. Clicking a prompt sends it as a message
3. Helps users get started quickly
4. Demonstrates the type of questions the AI can answer

### Examples by Category

#### HR Starter Prompts
```
What is the annual leave entitlement?
How do I apply for parental leave?
What are the company benefits?
What is the dress code policy?
How do I request remote work?
```

#### Finance Starter Prompts
```
What is the expense reimbursement process?
What are the travel policy guidelines?
How do I submit a purchase request?
What is the budget approval workflow?
What expenses are non-reimbursable?
```

#### IT Starter Prompts
```
What is the password policy?
How do I report a security incident?
What software is approved for use?
How do I request new hardware?
What is the BYOD policy?
```

### Best Practices

✅ **Do:**
- Use natural, conversational questions
- Cover common user queries
- Include 4-6 starter prompts per category
- Test that the AI can answer each prompt
- Update prompts as documents change

❌ **Don't:**
- Use overly complex questions
- Include prompts the AI can't answer
- Duplicate prompts across all categories
- Use more than 10 prompts (overwhelming)

---

## Acronym Management

The **Acronym System** helps the AI understand organization-specific abbreviations and acronyms during document processing and queries.

### What It Does

- Maps acronyms to their full meanings
- Used during document chunking and embedding
- Helps improve search relevance
- Provides context for ambiguous abbreviations

### Accessing Acronyms (Admin Only)

1. Navigate to **Admin** → **Prompts**
2. Select **Acronyms** from the submenu
3. View existing acronym mappings
4. Click **Add Acronym** to create new entries
5. Click **Save**

### Acronym Format

Each entry maps an acronym to its expansion:

| Acronym | Expansion | Category (Optional) |
|---------|-----------|---------------------|
| SOE | State-Owned Enterprise | Global |
| PTO | Paid Time Off | HR |
| P2P | Procure-to-Pay | Finance |
| BYOD | Bring Your Own Device | IT |

### How It Works

```
User Query: "What is the SOE assessment process?"
        ↓
AI sees: "What is the State-Owned Enterprise assessment process?"
        ↓
Better semantic understanding → Better search results
```

### Creating Acronym Entries

1. Click **Add Acronym**
2. Fill in:
   - **Acronym** - The abbreviation (e.g., "SOE")
   - **Expansion** - Full term (e.g., "State-Owned Enterprise")
   - **Category** - Optional category scope (or "Global")
3. Click **Save**

### Best Practices

✅ **Do:**
- Include industry-specific acronyms
- Add organization-specific abbreviations
- Document department-specific terms
- Keep expansions clear and concise
- Use "Global" for widely-used acronyms

❌ **Don't:**
- Add common acronyms (AI knows these)
- Use ambiguous expansions
- Create conflicting definitions
- Over-define obvious terms

### Example Acronym Database

```
HR Department:
- PTO → Paid Time Off
- FMLA → Family and Medical Leave Act
- ADA → Americans with Disabilities Act
- EOE → Equal Opportunity Employer

Finance:
- P2P → Procure-to-Pay
- AP → Accounts Payable
- AR → Accounts Receivable
- CAPEX → Capital Expenditure
- OPEX → Operating Expenditure

IT:
- BYOD → Bring Your Own Device
- SSO → Single Sign-On
- MFA → Multi-Factor Authentication
- VPN → Virtual Private Network

Operations:
- SOP → Standard Operating Procedure
- KPI → Key Performance Indicator
- SLA → Service Level Agreement
- QA → Quality Assurance
```

---

## AI Prompt Optimization

Policy Bot includes an AI-powered prompt optimizer that helps improve your prompts using AI suggestions.

### What It Does

- Analyzes your current prompt
- Suggests improvements for clarity
- Enhances formatting and structure
- Provides best practice recommendations

### Using the Optimizer

1. Write your initial prompt in the editor
2. Click **Optimize with AI** button
3. Wait for the AI to analyze your prompt
4. Review the suggested changes:
   - Side-by-side comparison
   - Highlighted differences
   - Explanation of improvements
5. Choose to:
   - **Accept** - Replace your prompt with suggestions
   - **Modify** - Edit the suggestion before accepting
   - **Reject** - Keep your original prompt
6. Click **Save** when satisfied

### What the Optimizer Looks For

The optimizer analyzes:
- **Clarity** - Is the prompt clear and unambiguous?
- **Completeness** - Are all necessary instructions included?
- **Formatting** - Is the structure well-organized?
- **Tone** - Is the tone appropriate and consistent?
- **Length** - Is the prompt concise yet comprehensive?

### Example Optimization

**Before:**
```
Help users find information. Be nice and cite sources.
```

**After (AI Optimized):**
```
You are a helpful AI assistant that provides information from policy
documents. Always maintain a professional and supportive tone.

Response Guidelines:
- Cite all sources with document names and page numbers
- Provide clear, actionable answers
- If information is not available, state this explicitly
- Use bullet points for multi-part answers
```

---

## Prompt Variables

Variables allow you to inject dynamic content into prompts.

### Available Variables

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{category}` | Current category name | "HR Policies" |
| `{user_name}` | Current user's display name | "John Doe" |
| `{user_email}` | Current user's email | "john@company.com" |
| `{date}` | Today's date | "January 19, 2025" |
| `{bot_name}` | Bot name from branding | "Policy Bot" |

### Using Variables

Simply include the variable in your prompt text:

```markdown
You are {bot_name}, assisting in the {category} category.
User's name: {user_name}
Today's date: {date}

Please personalize responses appropriately.
```

At runtime, this becomes:

```markdown
You are Policy Bot, assisting in the HR Policies category.
User's name: John Doe
Today's date: January 19, 2025

Please personalize responses appropriately.
```

### Variable Scope

| Variable | Global Prompt | Category Addendum |
|----------|---------------|-------------------|
| `{category}` | ❌ | ✅ |
| `{user_name}` | ✅ | ✅ |
| `{user_email}` | ✅ | ✅ |
| `{date}` | ✅ | ✅ |
| `{bot_name}` | ✅ | ✅ |

**Note:** `{category}` is only available in category addendums since global prompts don't have a specific category context.

---

## Best Practices

### Global Prompt Best Practices

1. **Be Specific About Role**
   - Define who the AI is and what it does
   - Set clear expectations for users

2. **Establish Core Behavior**
   - Citation requirements
   - Tone and style
   - Response format

3. **Set Boundaries**
   - What the AI should not do
   - When to escalate to humans
   - Safety and privacy guidelines

4. **Keep It Timeless**
   - Avoid time-sensitive information
   - Don't reference specific documents
   - Use category prompts for specifics

5. **Test Thoroughly**
   - Test across multiple categories
   - Verify citations work correctly
   - Check tone is consistent

### Category Prompt Best Practices

1. **Complement, Don't Duplicate**
   - Assume global prompt is already applied
   - Add only category-specific instructions

2. **Reference Category Resources**
   - Name key documents in this category
   - Provide department contacts
   - Include escalation paths

3. **Use Department Language**
   - Include jargon and terminology
   - Match the audience's expertise level

4. **Keep It Focused**
   - Under 500 tokens
   - 3-5 key points maximum
   - No redundant information

5. **Update Regularly**
   - Review quarterly
   - Update when documents change
   - Remove outdated references

### Starter Prompts Best Practices

1. **Represent Common Questions**
   - Based on actual user queries
   - Cover key use cases

2. **Answerable by AI**
   - Test each prompt
   - Ensure documents contain answers

3. **Natural Language**
   - Write as users would ask
   - Avoid overly formal language

4. **4-6 Prompts Ideal**
   - Enough variety
   - Not overwhelming

---

## Examples

### Example 1: Financial Services Company

**Global Prompt:**
```markdown
You are PolicyBot, the AI assistant for Acme Financial Services. You help
employees find information in company policy documents and answer questions
about procedures, compliance, and guidelines.

Core Guidelines:
- Always cite sources with [Document Name] (Page X) format
- Provide concise, accurate, and compliant responses
- If information is not in documents, state this clearly
- Maintain a professional, compliant, and helpful tone

Response Format:
- Use markdown for clarity
- Bold important regulatory terms
- Include all relevant citations
- For compliance matters, emphasize consulting with compliance team

Limitations:
- Do not provide legal or financial advice to customers
- Direct sensitive employee matters to HR
- Emphasize that policies may change - always verify with latest documents
- Respect all confidentiality and regulatory requirements
```

**Category Addendum (Compliance):**
```markdown
You are now assisting with compliance and regulatory questions.

Important:
- Always include: "This is general guidance. For specific compliance matters,
  consult the Compliance team at compliance@acme.com"
- Reference relevant regulations (e.g., SEC, FINRA, AML) when applicable
- Cite policy section numbers and effective dates
- Emphasize documentation and audit trail requirements
- Escalate any potential violations immediately

Key Documents:
- Compliance Manual (updated quarterly)
- Code of Conduct
- Anti-Money Laundering (AML) Policy
- Information Security Policy
```

**Starter Prompts (Compliance):**
```
What are the gift and entertainment limits?
How do I report a potential compliance issue?
What is our AML policy?
What are the insider trading restrictions?
How do I complete mandatory compliance training?
```

### Example 2: Manufacturing Company

**Global Prompt:**
```markdown
You are SafetyBot, the AI assistant for GlobalManufacture Corp. Your role
is to help employees find information about safety procedures, operational
guidelines, and company policies.

Core Principles:
- Safety is the top priority - emphasize safe practices
- Always cite sources with document names and sections
- Provide clear, actionable instructions
- If you're unsure, direct users to supervisors or safety officers

Response Format:
- Use numbered steps for procedures
- Bold safety warnings and critical information
- Include relevant safety codes and standards
- Always cite the source document

Critical:
- For emergencies, direct to emergency contacts immediately
- Safety procedures must be followed exactly as documented
- Equipment operation questions require supervisor approval
- Report all safety concerns to safety@globalmfg.com
```

**Category Addendum (Safety):**
```markdown
You are now assisting with safety and workplace procedures.

Safety-First Guidelines:
- ALL safety procedures must be followed exactly as written
- If equipment operation is involved, emphasize supervisor verification
- Include relevant PPE (Personal Protective Equipment) requirements
- Reference applicable OSHA standards when relevant
- For any injury or incident: STOP, SECURE, and REPORT immediately

Emergency Contact: Safety Hotline 555-0100 (24/7)

Key Documents:
- Safety Manual
- Equipment Operating Procedures
- Emergency Response Guide
- PPE Requirements Matrix
```

**Starter Prompts (Safety):**
```
What PPE is required for welding operations?
How do I report a near-miss incident?
What is the lockout/tagout procedure?
Where are the emergency exits in Building 3?
What do I do in case of a chemical spill?
```

---

## Troubleshooting

### Issue: AI Not Following Prompt Instructions

**Possible Causes:**
- Prompt is too long (over token limit)
- Conflicting instructions in global vs category prompts
- Vague or ambiguous language
- Prompt contradicts AI's training

**Solutions:**
1. Shorten the prompt - remove redundant instructions
2. Check for contradictions between global and category prompts
3. Be more specific and explicit
4. Test with simple queries first
5. Review AI logs to see what prompt is actually sent

### Issue: Citations Not Working Correctly

**Possible Causes:**
- Citation format not clearly specified
- Conflicting citation formats between prompts
- Documents don't have page numbers

**Solutions:**
1. Explicitly specify citation format in global prompt
2. Use examples: `[Document Name] (Page X)`
3. Test with documents that have clear page numbers
4. Ensure RAG pipeline includes page metadata

### Issue: AI Tone is Inconsistent

**Possible Causes:**
- Tone not defined in global prompt
- Category prompts override tone
- Conflicting tone instructions

**Solutions:**
1. Clearly define tone in global prompt
2. Review all category addendums for conflicts
3. Use consistent language (e.g., "professional and helpful")
4. Provide examples of desired tone

### Issue: Category Prompt Not Applied

**Possible Causes:**
- Thread not assigned to the category
- Prompt not saved correctly
- Cache issues

**Solutions:**
1. Verify thread is in the correct category
2. Re-save the category prompt
3. Clear prompt cache (admin settings)
4. Check server logs for errors

### Issue: Starter Prompts Not Appearing

**Possible Causes:**
- Not saved correctly
- Format error (not one per line)
- Category has no starter prompts

**Solutions:**
1. Re-enter prompts one per line
2. Click Save and verify success message
3. Refresh the page
4. Check browser console for errors

---

*Last updated: January 2025 (v1.0)*
