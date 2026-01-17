# Admin Guide

This guide explains how to use the Admin Dashboard to manage all aspects of Policy Bot.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Dashboard Overview](#2-dashboard-overview)
3. [Categories](#3-categories)
4. [Users](#4-users)
5. [Documents](#5-documents)
6. [Prompts](#6-prompts)
7. [Skills](#7-skills)
8. [Tools](#8-tools)
9. [Tool Routing](#9-tool-routing)
10. [Task Planner Templates](#10-task-planner-templates)
11. [Data Sources](#11-data-sources)
12. [Workspaces](#12-workspaces)
13. [Settings](#13-settings)
14. [System Management](#14-system-management)
15. [Troubleshooting](#15-troubleshooting)
16. [Quick Reference](#16-quick-reference)

---

## 1. Introduction

### What is an Admin?

An **Admin** has full control over all aspects of Policy Bot. Admins can:
- Manage all categories, users, and content
- Configure global settings and tools
- Create and manage skills
- Perform system administration tasks
- Grant Superuser access to other users

### Role Comparison

| Capability | User | Superuser | Admin |
|------------|------|-----------|-------|
| Chat with assistant | ✅ | ✅ | ✅ |
| Upload documents to threads | ✅ | ✅ | ✅ |
| Upload documents to categories | ❌ | ✅ (assigned) | ✅ (all + global) |
| Manage user subscriptions | ❌ | ✅ (assigned) | ✅ (all) |
| Configure data sources | ❌ | ✅ (assigned) | ✅ (all) |
| Configure tools per category | ❌ | ✅ (assigned) | ✅ (global + all) |
| Edit category prompts | ❌ | ✅ (assigned) | ✅ (global + all) |
| Create/manage workspaces | ❌ | ✅ (assigned) | ✅ (all) |
| Create/delete users | ❌ | ❌ | ✅ |
| Manage all categories | ❌ | ❌ | ✅ |
| Create and manage skills | ❌ | ❌ | ✅ |
| System settings & backups | ❌ | ❌ | ✅ |

### Accessing the Admin Dashboard

1. Log in to Policy Bot with an Admin account
2. Click your profile or the menu icon
3. Select **Admin** from the navigation
4. Or navigate directly to `/admin`

---

## 2. Dashboard Overview

The Admin Dashboard provides a comprehensive overview of system health and activity.

### Statistics Cards

| Card | Description |
|------|-------------|
| **Total Users** | Number of registered user accounts |
| **Active Users** | Users who logged in within the last 30 days |
| **Total Documents** | Documents across all categories |
| **Total Categories** | Number of configured categories |
| **Processing Queue** | Documents currently being indexed |
| **Error Count** | Documents with processing errors |

### System Health

The dashboard displays system component status:

| Component | Description |
|-----------|-------------|
| **Database** | SQLite database connection status |
| **Vector Store** | Embedding/search engine status |
| **LLM Proxy** | LiteLLM proxy connection |
| **OCR Service** | Document processing pipeline |

### Recent Activity

Widgets showing recent system activity:
- **Recent Documents** - Last 20 uploads across all categories
- **Recent Users** - Latest user registrations and logins
- **Processing Activity** - Document processing status

### Navigation Tabs

| Tab | Purpose |
|-----|---------|
| **Dashboard** | Overview and system health |
| **Stats** | Detailed usage statistics |
| **Categories** | Manage document categories |
| **Documents** | All documents across categories |
| **Users** | User account management |
| **Prompts** | System prompt, category prompts, acronyms, skills |
| **Tools** | Tool management, dependencies, and routing |
| **Workspaces** | Embed and standalone chatbot instances |
| **Settings** | LLM, RAG, reranker, memory, and system configuration |

### Prompts Submenu

| Section | Purpose |
|---------|---------|
| **System Prompt** | Global AI instructions for all conversations |
| **Category Prompts** | Category-specific addendums and starter prompts |
| **Acronyms** | Acronym mappings for document processing |
| **Skills** | AI behavior configurations (keyword/category triggered) |

### Tools Submenu

| Section | Purpose |
|---------|---------|
| **Tools Management** | Enable/disable tools, configure API keys |
| **Dependencies** | Manage tool dependencies and execution order |
| **Tool Routing** | Keyword/regex patterns to force specific tools |

### Settings Submenu

| Section | Purpose |
|---------|---------|
| **LLM** | Model selection, temperature, max tokens |
| **RAG** | Retrieval settings, chunk size, similarity threshold |
| **RAG Tuning** | Interactive RAG parameter testing |
| **Reranker** | Enable/configure Cohere or local reranking |
| **Memory** | User memory extraction settings |
| **Summarization** | Thread summarization settings |
| **Limits** | Conversation history, upload limits |
| **Superuser** | Superuser quota and permissions |
| **Backup** | Database backup and restore |
| **Branding** | Bot name, icon, accent color |
| **Cache** | Cache TTL and management |

---

## 3. Categories

Categories organize documents and control user access.

### Viewing Categories

The Categories tab lists all configured categories:

| Column | Description |
|--------|-------------|
| **Name** | Category display name |
| **Slug** | URL-friendly identifier |
| **Documents** | Document count |
| **Subscribers** | Users with access |
| **Superusers** | Assigned Superuser managers |
| **Status** | Active/Inactive |

### Creating a Category

1. Click **Add Category**
2. Fill in the configuration:
   - **Name** - Display name (e.g., "HR Policies")
   - **Slug** - URL identifier (auto-generated, editable)
   - **Description** - Purpose of this category
   - **Icon** - Optional emoji or icon
3. Configure access:
   - **Public** - Visible to all authenticated users
   - **Private** - Visible only to subscribed users
4. Click **Create**

### Category Settings

#### General Settings

| Setting | Description |
|---------|-------------|
| **Name** | Display name |
| **Slug** | URL identifier (changing breaks links) |
| **Description** | Category purpose |
| **Status** | Active/Inactive |

#### Access Control

| Setting | Description |
|---------|-------------|
| **Visibility** | Public or Private |
| **Default Subscription** | Auto-subscribe new users |
| **Require Approval** | Manual subscription approval |

#### Assigned Superusers

Assign users with Superuser role to manage this category:
1. Click **Manage Superusers**
2. Select users from the list
3. Click **Save**

### Deleting a Category

> **Warning:** Deleting a category removes all associated documents permanently.

1. Select the category
2. Click **Delete**
3. Type the category name to confirm
4. Click **Confirm Delete**

---

## 4. Users

Manage all user accounts and access.

### User List

| Column | Description |
|--------|-------------|
| **Email** | User's email address |
| **Name** | Display name |
| **Role** | User, Superuser, or Admin |
| **Status** | Active, Inactive, or Pending |
| **Subscriptions** | Category count |
| **Last Active** | Most recent login |
| **Created** | Account creation date |

### Creating a User

1. Click **Add User**
2. Fill in account details:
   - **Email** - Required, must be unique
   - **Name** - Display name
   - **Password** - Initial password (user can change)
   - **Role** - User, Superuser, or Admin
3. Configure subscriptions:
   - Select categories for access
4. Click **Create User**

### User Roles

| Role | Capabilities |
|------|-------------|
| **User** | Chat, upload to threads only, access subscribed categories |
| **Superuser** | Manage assigned categories + can be subscribed to other categories for read access |
| **Admin** | Full system access |

> **Note:** Superusers support a hybrid role model where they can both manage their assigned categories (full access) and be subscribed to other categories (read-only access for chat/queries).

### Editing a User

1. Click the user row or **Edit** button
2. Modify details as needed:
   - Change role
   - Update subscriptions
   - Reset password
   - Activate/deactivate account
3. Click **Save**

### Assigning Superuser Categories

For users with Superuser role:
1. Edit the user
2. In **Assigned Categories**, select categories for management
3. Click **Save**

The Superuser can now manage those categories (upload documents, manage users, configure tools/prompts).

### Adding Subscriptions to Superusers

Superusers can also be subscribed to additional categories for **read-only access** (hybrid role):

1. Edit the superuser
2. In **Subscribed Categories**, select categories for read access
3. Click **Save**

This allows a superuser to:
- **Manage** their assigned categories (full access)
- **Query/chat** with subscribed categories (read-only)

**Example use case:** An HR superuser manages the "HR Policies" category but is subscribed to "Legal" and "Compliance" for reference when answering questions.

**Visual indicators in the user list:**
- **Orange badges** - Assigned/managed categories
- **Blue badges** - Subscribed categories (read-only)

### Deactivating vs Deleting

| Action | Effect |
|--------|--------|
| **Deactivate** | User cannot log in, data preserved |
| **Delete** | Account and associated data removed |

### Bulk Operations

Select multiple users to:
- Bulk activate/deactivate
- Bulk add to category
- Bulk remove from category
- Export user list

---

## 5. Documents

Manage all documents across all categories.

### Document List

| Column | Description |
|--------|-------------|
| **Filename** | Document name |
| **Category** | Assigned category (or Global) |
| **Size** | File size |
| **Status** | Processing, Ready, or Error |
| **Uploaded By** | User who uploaded |
| **Upload Date** | When uploaded |

### Filtering Documents

Filter by:
- **Category** - Specific category or Global
- **Status** - Processing, Ready, Error
- **Uploader** - Specific user
- **Date Range** - Upload date range

### Uploading Documents

#### To a Category

1. Click **Upload**
2. Select target category (or Global)
3. Choose upload method:
   - **File** - Drag and drop or browse
   - **Text** - Paste content directly
   - **Web** - Enter URLs to ingest
   - **YouTube** - Enter video URL for transcript
4. Click **Upload**

#### Global Documents

Global documents are available to all categories:
1. Select **Global** as the category
2. Upload as normal

### Document Processing

After upload, documents are processed:

| Stage | Description |
|-------|-------------|
| **Uploaded** | File received |
| **Processing** | Text extraction and chunking |
| **Embedding** | Vector embeddings generated |
| **Ready** | Searchable in chat |

### Managing Documents

| Action | Description |
|--------|-------------|
| **View** | See document details and chunks |
| **Reprocess** | Re-run processing pipeline |
| **Move** | Change category assignment |
| **Delete** | Remove document permanently |

### Processing Errors

If a document shows Error status:
1. Click the document to see error details
2. Common issues:
   - Unsupported format
   - Corrupted file
   - OCR failure
   - File too large
3. Options:
   - Fix and re-upload
   - Try text upload instead
   - Contact support for complex issues

---

## 6. Prompts

Configure AI behavior through system prompts.

### Global System Prompt

The global prompt applies to all conversations:

1. Navigate to **Prompts** tab
2. Select **Global** from the category dropdown
3. Edit the **System Prompt** text area
4. Click **Save**

**Best practices for global prompts:**
- Define the AI's role and personality
- Set response formatting guidelines
- Establish citation requirements
- Specify safety guardrails

### Category-Specific Prompts

Add category-specific instructions that append to the global prompt:

1. Select a category from the dropdown
2. Edit the **Category Addendum** text area
3. Click **Save**

**Prompt hierarchy:**
```
Global System Prompt
        ↓
Category Addendum (appended)
        ↓
Final prompt to AI
```

### Starter Prompts

Configure suggested questions for new conversations:

1. Select a category
2. Scroll to **Starter Prompts**
3. Enter one prompt per line
4. Click **Save**

Users see these as clickable suggestions when starting a chat.

### AI Prompt Optimization

Use AI to improve your prompts:

1. Write your initial prompt
2. Click **Optimize with AI**
3. Review suggestions
4. Accept, modify, or reject
5. Save the final version

### Prompt Variables

Available variables in prompts:

| Variable | Description |
|----------|-------------|
| `{category}` | Current category name |
| `{user_name}` | Current user's name |
| `{date}` | Today's date |

---

## 7. Skills

Skills are specialized behaviors that enhance AI capabilities.

### What are Skills?

Skills inject additional instructions based on context:
- **Always-on** - Active in every conversation
- **Category-triggered** - Active in specific categories
- **Keyword-triggered** - Active when user mentions specific words

### Viewing Skills

The Skills tab displays all configured skills:

| Column | Description |
|--------|-------------|
| **Name** | Skill identifier |
| **Trigger Type** | Always-on, Category, or Keyword |
| **Categories** | Linked categories (if category-triggered) |
| **Keywords** | Trigger words (if keyword-triggered) |
| **Status** | Active or Inactive |

### Creating a Skill

1. Click **Add Skill**
2. Configure the skill:
   - **Name** - Unique identifier
   - **Description** - What this skill does
   - **Trigger Type** - When to activate
3. For Category triggers:
   - Select one or more categories
4. For Keyword triggers:
   - Enter keywords (comma-separated)
   - Set match type: Exact, Contains, or Regex
5. Write the **Skill Prompt**:
   - Instructions injected when skill activates
6. Set **Active** to Yes
7. Click **Save**

### Skill Prompt Guidelines

Skill prompts should:
- Be concise and focused
- Complement (not contradict) the system prompt
- Include specific instructions for the skill's purpose
- Provide examples if the behavior is complex

### Skill Examples

#### Memory Recall Skill (Always-on)
```
When relevant to the user's question, recall and reference
previous conversation context. Cite specific earlier exchanges
when building on prior discussions.
```

#### Compliance Skill (Keyword-triggered)
Keywords: `compliance, regulation, policy violation, audit`
```
When discussing compliance topics:
- Reference specific regulation sections
- Include effective dates
- Note any recent changes
- Recommend consulting the compliance team for specific cases
```

#### SOE Assessment Skill (Category-triggered)
Categories: `SOE`
```
You are an SOE assessment specialist. Use the 6-dimension
framework for assessments. When multi-step analysis is needed,
use the task_planner tool with appropriate templates.
```

### Editing Skills

1. Click the skill name or **Edit**
2. Modify configuration
3. Update the prompt
4. Click **Save**

### Deactivating Skills

Toggle **Active** to No to disable a skill without deleting it.

---

## 8. Tools

Configure AI tools and their settings.

### Tool Overview

Policy Bot includes these built-in tools:

| Tool | Description |
|------|-------------|
| **Web Search** | Search the web via Tavily API |
| **Document Generator** | Create PDF, DOCX, Markdown files |
| **Data Source Query** | Query APIs and CSV data |
| **Chart Generator** | Create data visualizations |
| **YouTube Transcript** | Extract video transcripts |
| **Task Planner** | Multi-step task management |
| **Function APIs** | Call external APIs |
| **Thread Sharing** | Share conversations via secure links |
| **Email (SendGrid)** | Send email notifications |

### Global Tool Configuration

Configure default settings for all categories:

1. Navigate to **Tools** tab
2. Select a tool
3. Configure global settings:
   - **Enabled** - Tool available by default
   - **API Keys** - Required credentials
   - **Default Options** - Default parameters
4. Click **Save**

### Category Tool Overrides

Override global settings per category:

1. Select a tool
2. Click **Category Overrides**
3. Select a category
4. Configure:
   - **Enabled** - Override global enabled state
   - **Branding** - Category-specific branding (for Doc Gen)
   - **Config** - Category-specific options
5. Click **Save**

### Tool-Specific Configuration

#### Web Search (Tavily)

| Setting | Description |
|---------|-------------|
| **API Key** | Tavily API key |
| **Default Topic** | general, news, or finance |
| **Search Depth** | basic or advanced |
| **Max Results** | Results per query (1-20) |
| **Include Answer** | AI summary: false, basic, advanced |
| **Include Domains** | Restrict to specific domains |
| **Exclude Domains** | Block specific domains |

#### Document Generator

| Setting | Description |
|---------|-------------|
| **Default Format** | PDF, DOCX, or Markdown |
| **Logo URL** | Organization logo |
| **Organization Name** | Header text |
| **Primary Color** | Theme color (hex) |
| **Font Family** | Document font |

#### YouTube Transcript

| Setting | Description |
|---------|-------------|
| **Enabled** | Allow transcript extraction |
| **Preferred Language** | Transcript language preference |

#### Task Planner

| Setting | Description |
|---------|-------------|
| **Enabled** | Allow multi-step planning |
| **Max Tasks** | Maximum tasks per plan |

#### Thread Sharing

| Setting | Description |
|---------|-------------|
| **Enabled** | Allow users to share threads |
| **Default Expiry Days** | Default link expiration (7, 30, 90, or never) |
| **Allow Downloads by Default** | Default download permission |
| **Allowed Roles** | Which roles can share (admin, superuser, user) |
| **Max Shares per Thread** | Limit shares per thread |
| **Rate Limit** | Maximum shares per hour |

#### Email (SendGrid)

| Setting | Description |
|---------|-------------|
| **Enabled** | Enable email notifications |
| **SendGrid API Key** | Your SendGrid API key |
| **Sender Email** | Verified sender email address |
| **Sender Name** | Display name for emails |
| **Rate Limit** | Maximum emails per hour |

**Email Setup:**
1. Create a SendGrid account at sendgrid.com
2. Verify your sender email/domain
3. Generate an API key with "Mail Send" permission
4. Enter the API key in the Email tool settings
5. Configure sender email (must match verified sender)
6. Test by sharing a thread with email notification

### Testing Tools

1. Select a tool
2. Click **Test**
3. Enter test parameters
4. View results
5. Verify configuration works

---

## 9. Tool Routing

Tool Routing allows you to force specific tools to be called when user messages match certain patterns. This ensures reliable tool invocation instead of leaving the decision entirely to the LLM.

### Why Use Tool Routing?

Without routing rules, the LLM may:
- Write prose about creating a chart instead of actually calling the chart tool
- Ask for confirmation before generating visualizations
- Describe assessment steps instead of using the Task Planner

Tool routing forces `tool_choice` in the OpenAI API, ensuring deterministic behavior.

### Accessing Tool Routing

1. Navigate to the **Tools** tab
2. Click the **Tool Routing** sub-tab
3. View, create, or edit routing rules

### Understanding Routing Rules

Each routing rule consists of:

| Field | Description |
|-------|-------------|
| **Tool Name** | The tool to invoke when patterns match |
| **Rule Name** | Descriptive name for the rule |
| **Rule Type** | `keyword` (word boundary matching) or `regex` |
| **Patterns** | List of patterns to match |
| **Force Mode** | How strongly to force the tool |
| **Priority** | Order of evaluation (lower = higher priority) |
| **Categories** | Limit rule to specific categories (optional) |
| **Active** | Enable/disable the rule |

### Force Modes

| Mode | Behavior |
|------|----------|
| **Required** | Forces this specific tool to be called |
| **Preferred** | Forces the LLM to use some tool (can choose which) |
| **Suggested** | Hint only, LLM still decides |

### Creating a Routing Rule

1. Click **Add Rule**
2. Configure the rule:
   - Select the target **Tool**
   - Enter a **Rule Name**
   - Choose **Rule Type** (keyword or regex)
   - Add **Patterns** (one per line)
   - Select **Force Mode**
   - Set **Priority** (default: 100)
   - Optionally limit to specific **Categories**
3. Click **Save**

### Example Rules

#### Chart Generation Keywords
```
Tool: chart_gen
Type: keyword
Patterns: chart, graph, plot, visualize, visualization
Force Mode: required
```

When a user says "create a chart showing sales", the `chart_gen` tool is forced.

#### Task Planner Regex
```
Tool: task_planner
Type: regex
Patterns: \binitiate\b.*assessment, \bevaluate\s+all\b
Force Mode: required
```

When a user says "initiate SOE assessment", the `task_planner` tool is forced.

### Testing Routing Rules

1. Click **Test Routing**
2. Enter a test message
3. Optionally select categories
4. Click **Test**
5. View which rules match and the resulting `tool_choice`

### Multi-Match Resolution

When multiple rules match the same message:

1. Rules are sorted by **priority** (lower number first)
2. If multiple `required` rules match different tools → LLM must use one of them
3. If single `required` rule matches → That specific tool is forced
4. `preferred` rules are processed after `required`
5. `suggested` rules only apply if no higher modes match

### Default Rules

On first access, these default rules are created:

| Tool | Patterns |
|------|----------|
| **chart_gen** | chart, graph, plot, visualize, bar chart, pie chart, line graph |
| **task_planner** | initiate, assessment, evaluate all, step by step, create a plan |
| **doc_gen** | generate report, create pdf, export to pdf, formal document |
| **web_search** | search the web, look up online, latest news, current information |

### Editing and Deleting Rules

- **Edit**: Click a rule to modify its configuration
- **Delete**: Click the delete icon to remove a rule
- **Toggle Active**: Enable/disable rules without deleting them

### Best Practices

1. **Use specific patterns** - Avoid overly broad patterns that match unintended messages
2. **Set appropriate priority** - More specific rules should have lower priority numbers
3. **Test before saving** - Use the test panel to verify patterns match as expected
4. **Use categories when appropriate** - Limit domain-specific rules to relevant categories
5. **Monitor tool logs** - Check server logs to verify routing is working as expected

---

## 10. Task Planner Templates

Templates define structured workflows for the AI.

### Template Management

Access template management:
1. Navigate to **Tools** tab
2. Select **Task Planner**
3. Click **Manage Templates**

### Viewing Templates

| Column | Description |
|--------|-------------|
| **Key** | Unique identifier |
| **Name** | Display name with placeholders |
| **Category** | Assigned category |
| **Tasks** | Number of steps |
| **Status** | Active or Inactive |

### Creating Templates

1. Click **Add Template**
2. Select the target category
3. Configure:
   - **Key** - Unique identifier (e.g., `quarterly_review`)
   - **Name** - Display name (e.g., `{department} Q{quarter} Review`)
   - **Description** - When to use this template
   - **Placeholders** - Variables (comma-separated)
4. Add tasks:
   - Click **Add Task**
   - Enter description with `{placeholders}`
   - Reorder with drag handles
5. Set **Active** to Yes
6. Click **Save**

### Template Structure

```json
{
  "key": "soe_identify",
  "name": "{country} SOE Identification",
  "description": "Identify SOEs in a country",
  "placeholders": ["country"],
  "tasks": [
    { "id": 1, "description": "Search for {country} SOE list" },
    { "id": 2, "description": "Gather fiscal data" },
    { "id": 3, "description": "Apply Pareto filter" }
  ]
}
```

### Template Permissions

| Role | Can Create | Can Edit | Can Delete |
|------|------------|----------|------------|
| Admin | ✅ All categories | ✅ All | ✅ All |
| Superuser | ✅ Assigned only | ✅ Assigned only | ❌ |

### Deactivating Templates

1. Edit the template
2. Set **Active** to No
3. Save

Inactive templates are hidden from the AI but preserved in the database.

---

## 11. Data Sources

Configure external data connections for AI queries.

### Data Source Types

| Type | Description |
|------|-------------|
| **API** | REST API endpoints |
| **CSV** | Uploaded CSV files |

### Creating an API Data Source

1. Click **Add Data Source** → **API**
2. Configure connection:
   - **Name** - Display name
   - **Description** - What data this provides
   - **Endpoint URL** - Full API URL
   - **Method** - GET or POST
3. Configure authentication:
   - **None** - No auth required
   - **API Key** - Key in header or query
   - **Bearer Token** - JWT or OAuth token
   - **Basic Auth** - Username/password
4. Define parameters:
   - Parameters the AI can use
   - Mark required vs optional
5. Map response:
   - Define expected response structure
   - Map fields to descriptions
6. Assign categories:
   - Select which categories can use this source
7. Click **Save**

### Creating a CSV Data Source

1. Click **Add Data Source** → **CSV**
2. Upload your CSV file
3. Review detected columns:
   - Confirm data types
   - Add descriptions
4. Assign categories
5. Click **Save**

### Testing Data Sources

1. Select the data source
2. Click **Test Connection**
3. Review:
   - Connection status
   - Sample data
   - Response time
4. Fix any errors before saving

### Authentication Types

| Type | Configuration |
|------|---------------|
| **None** | No additional config |
| **API Key** | Key value, header name, location |
| **Bearer** | Token value |
| **Basic** | Username and password |

### OpenAPI Import

Import from OpenAPI/Swagger specifications:
1. Click **Import OpenAPI**
2. Paste the spec (JSON or YAML)
3. Review parsed configuration
4. Adjust as needed
5. Save

---

## 12. Workspaces

Workspaces allow you to create embeddable and standalone chatbot instances that can be deployed on external websites or accessed via direct URLs.

### What is a Workspace?

A **Workspace** is a configurable chatbot instance that:
- Can access **one or more categories** (document collections)
- Has its own branding (colors, logo, greeting)
- Has its own URL path (random 16-character string)
- Can be either **Embed** or **Standalone** type

### Workspace Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Embed** | Lightweight widget for external websites | Customer support widget, FAQ bot |
| **Standalone** | Full-featured chat with threads and history | Internal team portal, department-specific assistant |

### Feature Comparison

| Feature | Main Policy Bot | Standalone Workspace | Embed Workspace |
|---------|-----------------|---------------------|-----------------|
| Memory (facts) | ✅ | ❌ | ❌ |
| Settings menu | ✅ | ❌ | ❌ |
| Thread sidebar | ✅ | ✅ | ❌ |
| Artifacts panel | ✅ | ✅ | ❌ |
| Clear chat button | ❌ | ❌ | ✅ |
| Message persistence | ✅ | ✅ | Analytics only |
| Authentication | Required | Optional | None |
| Voice input | ✅ | ✅ (if enabled) | ✅ (if enabled) |
| File upload | ✅ | ✅ (if enabled) | ✅ (if enabled) |

### Enabling Workspaces

The Workspaces feature can be enabled/disabled globally:

1. Navigate to **Settings** → **General**
2. Find **Enable Workspaces**
3. Toggle the switch

When disabled, all workspace URLs return 404.

### Creating a Workspace

1. Navigate to **Workspaces** tab
2. Click **New Workspace**
3. Select type: **Embed** or **Standalone**
4. Configure the workspace:

#### Basic Settings

| Setting | Description |
|---------|-------------|
| **Name** | Internal display name for admin reference |
| **Categories** | Select one or more categories the workspace can access |
| **Greeting Message** | Welcome message shown to users |
| **Suggested Prompts** | Starter questions (one per line) |

#### Branding

| Setting | Description |
|---------|-------------|
| **Primary Color** | Hex color for UI elements |
| **Logo URL** | Optional logo image URL |
| **Chat Title** | Custom title (default: workspace name) |
| **Footer Text** | Optional footer message |

#### LLM Overrides (Optional)

Override global LLM settings for this workspace:

| Setting | Description |
|---------|-------------|
| **Provider** | OpenAI, Gemini, Mistral, etc. (default: global) |
| **Model** | Specific model to use |
| **Temperature** | Response creativity (0-1) |
| **System Prompt** | Additional instructions prepended to global prompt |

#### Feature Toggles

| Setting | Description |
|---------|-------------|
| **Voice Input** | Enable microphone input |
| **File Upload** | Allow file attachments |
| **Max File Size** | Maximum upload size in MB |

#### Embed-Specific Settings

For **Embed** workspaces only:

| Setting | Description |
|---------|-------------|
| **Allowed Domains** | Whitelist of domains where embed can run |
| **Daily Limit** | Maximum messages per day (all users) |
| **Session Limit** | Maximum messages per session |

5. Click **Create**
6. Copy the generated URL or embed script

### Workspace URLs

Workspaces use random 16-character slugs for security:

| Type | URL Pattern | Example |
|------|-------------|---------|
| Standalone | `/{slug}` | `policybot.app/2yibbnmbmctyu` |
| Embed (hosted) | `/e/{slug}` | `policybot.app/e/2yibbnmbmctyu` |
| Embed (script) | External site with script tag | See embed script section |

### Embed Script

For **Embed** workspaces, copy the generated script:

```html
<!-- Policy Bot Workspace -->
<script
  src="https://policybot.abhirup.app/embed/workspace.js"
  data-workspace-id="2yibbnmbmctyu"
></script>
```

Paste this script into the target website's HTML to display the chat widget.

### Access Control (Standalone)

Standalone workspaces support two access modes:

#### Category-Based Access (Default)

Users must have access to **ALL** categories linked to the workspace:

```
Workspace linked to: [HR, Legal, Finance]
User has: [HR, Legal, Finance, IT] → ✅ Can access
User has: [HR, Legal]              → ❌ Cannot access (missing Finance)
```

#### Explicit User List

Only users explicitly added to the workspace can access:

1. Select workspace
2. Click **Manage Users**
3. Add users from the search
4. Click **Save**

To switch access mode:
1. Edit workspace
2. Change **Access Mode** to "Explicit User List"
3. Add authorized users

### Managing Workspace Users

For standalone workspaces with explicit access mode:

| Action | Steps |
|--------|-------|
| **Add User** | Click "Add User" → Search → Select → Add |
| **Remove User** | Find user in list → Click "Remove" |
| **Bulk Import** | Upload CSV with email addresses |

### Workspace Analytics

View usage statistics for each workspace:

| Metric | Description |
|--------|-------------|
| **Sessions** | Total unique sessions |
| **Messages** | Total messages sent |
| **Unique Visitors** | Distinct visitor count |
| **Avg Response Time** | Average AI response latency |
| **Token Usage** | Total tokens consumed |

Access analytics:
1. Select workspace
2. Click **Analytics**
3. Select date range

### Editing Workspaces

1. Navigate to **Workspaces** tab
2. Click on the workspace name or **Edit** button
3. Modify settings
4. Click **Save**

### Disabling/Enabling Workspaces

Toggle individual workspaces on/off:
1. Find the workspace in the list
2. Click the **Enabled** toggle

Disabled workspaces return 404 at their URLs.

### Deleting Workspaces

1. Select the workspace
2. Click **Delete**
3. Confirm the action

**Warning:** Deleting a workspace removes all session data and analytics.

### Superuser Workspace Management

Superusers can create and manage workspaces within their assigned categories:

| Action | Admin | Superuser |
|--------|-------|-----------|
| Create workspace (any category) | ✅ | ❌ |
| Create workspace (assigned categories) | ✅ | ✅ |
| Add any user to workspace | ✅ | ❌ |
| Add users from assigned categories | ✅ | ✅ |
| View all workspaces | ✅ | ❌ |
| View own workspaces | ✅ | ✅ |

---

## 13. Settings

Configure system-wide settings.

### General Settings

| Setting | Description |
|---------|-------------|
| **Application Name** | Displayed in UI and documents |
| **Application Logo** | Logo URL for branding |
| **Support Email** | Contact for user support |
| **Default Language** | UI language |

### Appearance Settings

| Setting | Description |
|---------|-------------|
| **Accent Color** | Primary theme color for the application (users can customize) |

### AI Configuration

| Setting | Description |
|---------|-------------|
| **LLM Model** | Default model for chat (OpenAI, Gemini, Mistral, Ollama) |
| **Temperature** | Response creativity (0-1) |
| **Max Tokens** | Maximum response length |
| **Context Window** | Document context size |
| **Streaming** | Enable real-time streaming responses |
| **Memory Extraction Tokens** | Maximum tokens for memory extraction |
| **Prompt Max Tokens** | Maximum tokens for prompt context |

#### Vision-Capable Models

The following models support image analysis (multimodal):

| Model | Provider | Vision Support |
|-------|----------|----------------|
| gpt-4.1 | OpenAI | ✅ |
| gpt-4.1-mini | OpenAI | ✅ |
| gpt-4.1-nano | OpenAI | ✅ |
| gemini-2.5-pro | Google | ✅ |
| gemini-2.5-flash | Google | ✅ |
| gemini-2.5-flash-lite | Google | ✅ |
| mistral-large-3 | Mistral | ✅ |
| mistral-small-3.2 | Mistral | ✅ |

When a vision-capable model is configured, users can upload images in their chat threads for analysis.

### Embedding Settings

| Setting | Description |
|---------|-------------|
| **Embedding Model** | Model for vector embeddings |
| **Chunk Size** | Document chunk size |
| **Chunk Overlap** | Overlap between chunks |

### RAG Settings

| Setting | Description |
|---------|-------------|
| **Top K Results** | Documents to retrieve |
| **Similarity Threshold** | Minimum relevance score |
| **Reranker** | Enable/disable reranking |
| **Reranker Model** | Model for reranking |

### Security Settings

| Setting | Description |
|---------|-------------|
| **Session Timeout** | Auto-logout duration |
| **Password Requirements** | Minimum complexity |
| **Rate Limiting** | Request limits per user |
| **Allowed Domains** | Email domain restrictions |

### API Configuration

| Setting | Description |
|---------|-------------|
| **LiteLLM Endpoint** | LLM proxy URL |
| **Tavily API Key** | Web search API key |
| **YouTube API Key** | YouTube data API key |

---

## 14. System Management

Administrative functions for system maintenance.

### Backup & Restore

#### Creating a Backup

1. Navigate to **Settings** → **Backup**
2. Click **Create Backup**
3. Select what to include:
   - Database
   - Uploaded files
   - Configuration
4. Click **Generate**
5. Download the backup file

#### Restoring from Backup

1. Navigate to **Settings** → **Restore**
2. Upload backup file
3. Select what to restore
4. Click **Restore**

> **Warning:** Restore overwrites current data.

### Database Management

| Action | Description |
|--------|-------------|
| **Vacuum** | Optimize database size |
| **Reindex** | Rebuild search indexes |
| **Clear Cache** | Clear temporary data |

### Processing Queue

View and manage document processing:

| Column | Description |
|--------|-------------|
| **Document** | Filename |
| **Status** | Queue position, processing, error |
| **Started** | When processing began |
| **Duration** | Processing time |

Actions:
- **Retry** - Re-queue failed document
- **Cancel** - Stop processing
- **Priority** - Move to front of queue

### System Logs

View system activity:
- **Access Logs** - User activity
- **Error Logs** - System errors
- **API Logs** - External API calls
- **Chat Logs** - Conversation history

### Usage Statistics

| Metric | Description |
|--------|-------------|
| **Total Queries** | Chat interactions |
| **Documents Processed** | Processing volume |
| **API Calls** | External API usage |
| **Storage Used** | Disk space consumption |

---

## 15. Troubleshooting

### Common Issues

#### Documents Not Appearing in Search

**Causes:**
- Document still processing
- Processing error
- Wrong category

**Solutions:**
1. Check document status in Documents tab
2. Wait for processing to complete
3. If Error, click for details and fix
4. Verify category assignment

#### Users Cannot Access Category

**Causes:**
- No subscription
- Inactive subscription
- Category is private

**Solutions:**
1. Check user's subscriptions
2. Verify subscription is Active
3. Add subscription if missing

#### Tool Not Working

**Causes:**
- Tool disabled globally
- Tool disabled for category
- Missing API key
- Invalid configuration

**Solutions:**
1. Check global tool settings
2. Check category overrides
3. Verify API keys are valid
4. Test tool with Test button

#### AI Not Using Skills

**Causes:**
- Skill inactive
- Trigger conditions not met
- Conflicting skills

**Solutions:**
1. Verify skill is Active
2. Check trigger type and conditions
3. Test with explicit trigger words/categories

#### Tool Routing Not Working

**Causes:**
- Rule inactive
- Pattern not matching
- Wrong force mode
- Category scope mismatch

**Solutions:**
1. Verify the routing rule is Active
2. Test the pattern with **Test Routing** panel
3. Check if the rule is scoped to specific categories
4. Verify the pattern type (keyword vs regex) matches your intent
5. Check server logs for routing debug messages

#### Processing Queue Stuck

**Causes:**
- OCR service down
- Large file backlog
- System resources exhausted

**Solutions:**
1. Check system health on Dashboard
2. Restart OCR service if needed
3. Cancel stuck documents and retry
4. Contact support for persistent issues

#### Thread Sharing Not Working

**Causes:**
- Thread sharing tool disabled
- User's role not allowed to share
- Rate limit exceeded

**Solutions:**
1. Verify `share_thread` tool is enabled in Tools settings
2. Check `allowedRoles` configuration includes the user's role
3. Review rate limit settings if users report blocked shares
4. Check server logs for detailed error messages

#### Email Notifications Not Sending

**Causes:**
- Email tool not enabled
- Invalid SendGrid API key
- Sender email not verified
- Rate limit exceeded

**Solutions:**
1. Enable the `send_email` tool in Tools settings
2. Verify SendGrid API key is correct and active
3. Ensure sender email is verified in SendGrid dashboard
4. Check SendGrid activity logs for delivery issues
5. Increase rate limit if needed

### Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Rate limit exceeded" | Too many requests | Wait and retry |
| "Model not available" | LLM service issue | Check LiteLLM proxy |
| "Embedding failed" | Vector store issue | Check embedding service |
| "Authentication failed" | Invalid credentials | Verify API keys |

### Getting Help

For issues not covered here:
1. Check system logs for details
2. Note exact error messages
3. Document steps to reproduce
4. Contact support with details

---

## 16. Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `Esc` | Close modal |
| `Ctrl+S` | Save current form |
| `Ctrl+N` | New item (context-aware) |

### File Upload Limits

| Type | Limit |
|------|-------|
| File upload | 50MB |
| Text content | 10MB |
| Web URLs | 5 per batch |
| YouTube | 1 per request |

### Supported File Types

- PDF (`.pdf`)
- Word (`.docx`)
- Excel (`.xlsx`)
- PowerPoint (`.pptx`)
- Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`)

### Status Icons

| Icon | Meaning |
|------|---------|
| 🟢 | Active/Ready |
| 🟡 | Processing/Pending |
| 🔴 | Error/Inactive |
| ⚙️ | Configurable |
| 🔒 | Locked/Protected |

### Role Hierarchy

```
Admin
  ├── Full system access
  ├── All category management
  ├── User administration
  └── System configuration

Superuser
  ├── Managed category access (full control)
  │   ├── Document uploads
  │   ├── User subscriptions
  │   ├── Tool configuration
  │   └── Prompt customization
  ├── Subscribed category access (read-only)
  │   └── Chat/query documents
  └── Category creation (within quota)

User
  ├── Chat access
  ├── Thread document uploads
  └── Subscribed category access
```

### Tool Availability

| Tool | Admin | Superuser | User |
|------|-------|-----------|------|
| Web Search | Configure | Configure* | Use |
| Doc Generator | Configure | Configure* | Use |
| Data Sources | Create all | Create* | Use |
| Task Planner | Configure | Create templates* | Use |
| Chart Gen | Configure | Configure* | Use |
| YouTube | Configure | Configure* | Use |

*For assigned categories only

---

*Last updated: January 2025 (v2.4 - Added vision-capable models, thread sharing and email notification)*
