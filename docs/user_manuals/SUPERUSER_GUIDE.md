# Superuser Guide

This guide explains how to use the Superuser Dashboard to manage your assigned categories in Policy Bot.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Dashboard Tab](#2-dashboard-tab)
3. [Categories Tab](#3-categories-tab)
4. [Users Tab](#4-users-tab)
5. [Documents Tab](#5-documents-tab)
6. [Prompts Tab](#6-prompts-tab)
7. [Tools Tab](#7-tools-tab)
8. [Settings Tab](#8-settings-tab)
9. [Task Planner Templates](#9-task-planner-templates)
10. [Data Sources](#10-data-sources)
11. [Workspaces](#11-workspaces)
12. [Permissions Summary](#12-permissions-summary)
13. [Troubleshooting](#13-troubleshooting)
14. [Quick Reference](#14-quick-reference)

---

## 1. Introduction

### What is a Superuser?

A **Superuser** is a category-focused manager role in Policy Bot. Superusers can manage documents, users, and configurations for their **assigned categories** only. This role is ideal for department heads or team leads who need to manage their team's access to specific policy documents.

### Hybrid Role Support

Superusers can have two types of category access:

| Access Type | Description | Capabilities |
|-------------|-------------|--------------|
| **Managed Categories** | Categories assigned for management | Upload documents, manage users, configure tools/prompts, create new categories |
| **Subscribed Categories** | Categories subscribed for read access | Chat and query documents (same as regular user access) |

This allows a superuser to manage their department's categories while also having read access to other relevant categories (e.g., an HR superuser managing HR Policies but subscribed to Legal for reference).

### Role Comparison

| Capability | User | Superuser | Admin |
|------------|------|-----------|-------|
| Chat with assistant | ✅ | ✅ | ✅ |
| Upload documents to threads | ✅ | ✅ | ✅ |
| Upload documents to categories | ❌ | ✅ (managed only) | ✅ (all + global) |
| Create new categories | ❌ | ✅ (within quota) | ✅ |
| Manage user subscriptions | ❌ | ✅ (managed only) | ✅ (all) |
| Configure data sources | ❌ | ✅ (managed only) | ✅ (all) |
| Configure tools per category | ❌ | ✅ (managed only) | ✅ (global + all) |
| Edit category prompts | ❌ | ✅ (managed only) | ✅ (global + all) |
| Create/manage workspaces | ❌ | ✅ (managed only) | ✅ (all) |
| Access subscribed categories | ✅ | ✅ | ✅ |
| Create/delete users | ❌ | ❌ | ✅ |
| Manage all categories | ❌ | ❌ | ✅ |
| System settings & backups | ❌ | ✅ (own categories) | ✅ |

### How to Get Superuser Access

Superuser access is granted by an **Admin**:

1. Admin navigates to **Admin Dashboard → Users**
2. Admin creates or edits your user account
3. Admin sets your role to **Superuser**
4. Admin assigns specific categories to your account

Once assigned, you'll see the **Superuser** option in the navigation menu.

### Accessing the Superuser Dashboard

1. Log in to Policy Bot
2. Click your profile or the menu icon
3. Select **Superuser** from the navigation
4. Or navigate directly to `/superuser`

---

## 2. Dashboard Tab

The Dashboard tab provides an overview of your categories and recent activity.

### Statistics Cards

Three metric cards show key statistics:

| Card | Description |
|------|-------------|
| **Assigned Categories** | Number of categories you manage |
| **Total Documents** | Total documents across all your categories |
| **Total Subscribers** | Total active users subscribed to your categories |

### Category Breakdown Table

A detailed table shows per-category information:

| Column | Description |
|--------|-------------|
| **Category** | Category name |
| **Documents** | Number of documents in the category |
| **Ready** | Documents successfully processed |
| **Processing** | Documents currently being indexed |
| **Error** | Documents with processing errors |
| **Subscribers** | Number of active subscribers |
| **Custom Prompt** | Whether a category-specific prompt is configured |

### Recent Activity Widgets

Two widgets show recent activity:

- **Recent Documents** - Last 10 documents uploaded across your categories
- **Recent Subscriptions** - Last 10 subscription changes

### Refreshing Statistics

Click the **Refresh** button to update all statistics with the latest data.

---

## 3. Categories Tab

The Categories tab provides a unified view of all your categories - both managed and subscribed - and lets you create new categories.

### Viewing Your Categories

The Categories tab displays two sections:

#### Managed Categories

Categories you have full management access to:
- Displayed with **orange badges**
- Click a category to manage its documents, users, prompts, and tools
- Shows document count and subscriber count

```
Managed Categories:
[HR Policies] 45 docs, 12 subscribers
[Training] 23 docs, 8 subscribers
```

#### Subscribed Categories

Categories you have read-only access to (for chat/queries):
- Displayed with **blue badges**
- You can select these when starting a chat to query their documents
- You cannot upload documents or manage users in these categories

```
Subscribed Categories:
[Legal] [Finance] [Operations]
```

### Creating New Categories

Superusers can create new categories within their quota:

1. Click the **Create Category** button
2. Fill in the category details:
   - **Name** - Display name (e.g., "Training Materials")
   - **Description** - Purpose of this category
3. Click **Create**

The new category is automatically assigned to you for management.

### Category Quota

Your Admin may configure a limit on how many categories you can create:

| Setting | Description |
|---------|-------------|
| **Created Categories** | Number of categories you've created |
| **Quota Limit** | Maximum categories allowed (set by Admin) |
| **Unlimited** | If no quota is set, shown as "Unlimited" |

If you reach your quota limit, contact your Admin to:
- Increase your quota
- Delete categories you no longer need
- Have an Admin create additional categories for you

### Categories in Chat

When starting a new chat conversation, you can select **one or more categories** from your available categories:
- All your **managed categories** (orange)
- All your **subscribed categories** (blue)

**Multi-Category Selection:**
- **Single category** - Query documents from one specific category
- **Multiple categories** - Query across multiple categories simultaneously

This allows you to query documents from categories you manage as well as reference documents from other categories you're subscribed to. The chat header shows which categories are active for the current thread.

---

## 4. Users Tab

The Users tab lets you manage which users have access to your assigned categories.

### Viewing Users

The Users tab displays all users subscribed to your assigned categories:

- **Email** - User's email address
- **Name** - User's display name
- **Subscriptions** - List of category subscriptions with status

### Adding Users to Categories

To give a user access to one of your categories:

1. Click **Add Subscription**
2. Enter the user's email address (must be an existing user)
3. Select the category from the dropdown
4. Click **Add**

> **Note:** You cannot create new user accounts. Ask an Admin to create the user first.

### Removing User Subscriptions

To remove a user's access to a category:

1. Find the user in the list
2. Locate the subscription you want to remove
3. Click the **Remove** (✕) button next to the subscription

### Understanding Subscription Status

| Status | Description |
|--------|-------------|
| **Active** | User can access documents in this category |
| **Inactive** | Subscription exists but access is disabled |

---

## 5. Documents Tab

The Documents tab is where you upload and manage documents for your managed categories.

### Uploading Documents

Click the **Upload** button to open the upload modal. Four upload methods are available:

#### File Upload

Upload document files directly:

1. Select the **File** tab
2. Choose the target category from the dropdown
3. Drag and drop files or click to browse
4. Click **Upload**

**Supported file types:**
- PDF (`.pdf`)
- Microsoft Word (`.docx`)
- Microsoft Excel (`.xlsx`)
- Microsoft PowerPoint (`.pptx`)
- Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`)

**Size limit:** 50MB per file

#### Text Content Upload

Paste text content directly (bypasses OCR processing):

1. Select the **Text** tab
2. Choose the target category
3. Enter a filename (e.g., `meeting-notes.txt`)
4. Paste or type your text content
5. Click **Upload**

**Size limit:** 10MB of text content

> **Tip:** Use text upload for content you've already extracted or written. It's faster because it skips OCR processing.

#### Web URL Ingestion

Ingest content from web pages:

1. Select the **Web** tab
2. Choose the target category
3. Enter up to 5 URLs (one per line)
4. Click **Ingest**

**Requirements:**
- Tavily API must be configured by Admin
- URLs must be publicly accessible

#### YouTube Transcript Extraction

Extract transcripts from YouTube videos:

1. Select the **YouTube** tab
2. Choose the target category
3. Enter the YouTube URL
4. Click **Extract**

**Requirements:**
- YouTube Transcript API must be configured
- Video must have available transcripts/captions

### Managing Documents

#### Document Status

Documents go through processing after upload:

| Status | Description |
|--------|-------------|
| **Processing** | Document is being chunked and indexed |
| **Ready** | Document is searchable in chat |
| **Error** | Processing failed (hover for details) |

#### Searching Documents

Use the search box to filter documents:
- Matches filename
- Matches category name
- Matches status

#### Sorting Documents

Click column headers to sort:
- Filename
- Size
- Status
- Upload date

#### Deleting Documents

You can only delete documents that you uploaded:

1. Find the document in the list
2. Click the **Delete** (🗑️) button
3. Confirm the deletion

> **Note:** You cannot delete documents uploaded by Admins or other Superusers.

### Upload Limits Summary

| Upload Type | Limit |
|-------------|-------|
| File size | 50MB per file |
| Text content | 10MB |
| Web URLs | 5 URLs per batch |
| YouTube | 1 video per request |

---

## 6. Prompts Tab

The Prompts tab lets you customize AI behavior for your managed categories. It has three subsections accessible from the sidebar.

> **📖 Detailed Documentation:** For comprehensive information about the prompts system, see [docs/features/PROMPTS.md](../../features/PROMPTS.md).

### Prompts Submenu

| Section | Purpose |
|---------|---------|
| **Global Prompt** | View the global system prompt (read-only) |
| **Category Prompts** | Edit category-specific addendums and starter prompts |
| **Skills** | Create and manage skills for your categories (with restrictions) |

### Understanding Prompt Hierarchy

Prompts follow a hierarchy:

```
Global System Prompt (Admin-managed, read-only)
         ↓
Category-Specific Addendum (Superuser-editable)
         ↓
Final prompt sent to AI
```

The global prompt applies to all categories. Your category addendum is appended to customize behavior for your specific category.

### Viewing the Global Prompt

The global system prompt is displayed in read-only mode. This provides context for what the AI already knows before your category customizations.

### Editing Category-Specific Prompts

To customize the AI for your category:

1. Select a category from the dropdown
2. Edit the **Category Prompt Addendum** text area
3. Click **Save**

**Example addendum:**
```
When answering questions about HR policies:
- Always reference the employee handbook section numbers
- Include effective dates for policy changes
- Remind users to consult HR for specific situations
```

### Configuring Starter Prompts

Starter prompts are suggested questions shown to users when they start a new conversation:

1. Select a category
2. Edit the **Starter Prompts** section
3. Enter one prompt per line
4. Click **Save**

**Example starter prompts:**
```
What is the annual leave policy?
How do I submit an expense report?
What are the working hours?
```

### Using AI Prompt Optimization

Let AI help improve your prompts:

1. Write your initial prompt
2. Click **Optimize with AI**
3. Review the suggested improvements
4. Accept or modify the suggestions
5. Save the final version

### Resetting to Global Prompt

To remove category customizations and use only the global prompt:

1. Select the category
2. Click **Reset to Global**
3. Confirm the action

### Skills

The Skills section lets you create and manage AI skills for your categories.

**What are Skills?**

Skills are specialized behaviors that extend the AI assistant's capabilities. They inject custom instructions based on context or keywords.

| Type | Description | Example |
|------|-------------|---------|
| **Category-triggered** | Active when user is in specific categories | Department-specific procedures |
| **Keyword-triggered** | Active when user mentions specific words | "compliance" → regulatory guidelines |

### Superuser Skill Restrictions

Superusers can create and manage skills with the following restrictions:

| Restriction | Details |
|-------------|---------|
| **Priority** | Must be 100 or higher (Medium or Low tier) |
| **Trigger Type** | Cannot use "always" trigger (reserved for Admins) |
| **Categories** | Can only assign to your managed categories |
| **Edit Access** | Can only edit skills you created |

### Priority Tiers

| Tier | Priority Range | Access |
|------|----------------|--------|
| **Core** | 1-9 | Admin only |
| **High** | 10-99 | Admin only |
| **Medium** | 100-499 | Superuser + Admin |
| **Low** | 500+ | Superuser + Admin |

> **Note:** Core and High priority skills (1-99) are managed by Admins only. Contact your Admin if you need a skill with higher priority.

### Creating a Skill

1. Click **Add Skill**
2. Fill in the configuration:
   - **Name** - Display name (e.g., "HR Policy Formatting")
   - **Content** - The instructions to inject into the AI context
   - **Trigger Type** - "keyword" or "category"
   - **Trigger Value** - Keyword(s) or category selection
   - **Priority** - 100-999 (higher numbers = lower priority)
3. **Tool Association** (keyword trigger only, optional):
   - **Force Tool** - Select a tool to invoke when keywords match
   - **Force Mode** - Required, Preferred, or Suggested
   - **Tool Config** - Tool-specific options (chart type, data sources, etc.)
4. Click **Save**

### Tool Association

Keyword-triggered skills can optionally force a specific tool:

| Field | Description |
|-------|-------------|
| **Force Tool** | web_search, chart_gen, doc_gen, data_source, etc. |
| **Force Mode** | Required (must call), Preferred (encouraged), Suggested (optional) |
| **Tool Config** | Chart type, data source filter, domains, etc. |

**Example:** A skill with keywords "create chart, visualize data" can force the `chart_gen` tool with a default chart type of "bar".

### Editing Skills

You can only edit skills you created:

1. Find the skill in the list
2. Click **Edit**
3. Modify fields as needed
4. Click **Save**

> **Note:** You cannot edit Admin-created skills or skills with priority below 100.

---

## 7. Tools Tab

The Tools tab lets you configure AI tools for your managed categories.

> **📖 Detailed Documentation:** For comprehensive information about tools, see [docs/features/Tools.md](../../features/Tools.md). For skill-based tool routing, see [docs/features/SKILLS.md](../../features/SKILLS.md).

### Understanding Tool Inheritance

Tools follow a configuration hierarchy:

```
Global Tool Config (Admin-managed)
         ↓
Category Override (Superuser-editable)
         ↓
Effective config for users in category
```

If no category override is set, the global configuration applies.

### Available Tools

| Tool | Description |
|------|-------------|
| **Web Search** | Search the web for current information |
| **Document Generator** | Create PDF, DOCX, or Markdown documents |
| **Data Source Query** | Query configured APIs and CSV data |
| **Chart Generator** | Create visualizations from data |
| **Function APIs** | Call external APIs with structured schemas |

### Enabling/Disabling Tools per Category

To control tool availability for your category:

1. Select a category from the dropdown
2. Find the tool you want to configure
3. Toggle the **Enabled** switch:
   - **On** - Tool is available for this category
   - **Off** - Tool is disabled for this category
   - **Inherit** - Use global setting

### Configuring Tool Branding

Some tools support category-specific branding (e.g., Document Generator):

1. Select a category
2. Click **Configure Branding** for the tool
3. Set category-specific options:
   - Logo URL
   - Organization name
   - Primary color
   - Font family
4. Click **Save**

### Resetting to Global Defaults

To remove category overrides and use global settings:

1. Select the category
2. Click **Reset to Global** for the tool
3. Confirm the action

### Tool Routing

> **Note:** Tool Routing (keyword-based tool forcing) is configured by Admins only. Superusers cannot view or modify routing rules. If tools are not being called as expected, contact your Admin to review the routing configuration.

---

## 8. Settings Tab

The Settings tab provides access to configuration options for superusers. It has two subsections.

### Settings Submenu

| Section | Purpose |
|---------|---------|
| **RAG Tuning** | Interactive testing and tuning of RAG parameters |
| **Backup** | View and download category-specific backups |

### RAG Tuning

The RAG Tuning section allows you to interactively test how different retrieval parameters affect search results for your categories.

**What you can tune:**
- **Top K Results** - Number of chunks to retrieve
- **Similarity Threshold** - Minimum relevance score
- **Reranking** - Enable/disable result reranking

**How to use:**
1. Navigate to Settings → RAG Tuning
2. Select a category to test
3. Enter a sample query
4. Adjust parameters using the sliders
5. Click **Test** to see results
6. Compare different parameter combinations
7. Save optimal settings

### Backup

Export threads and messages from your assigned categories as a JSON backup file.

**What is included:**
- All threads that belong to your assigned categories
- All messages within those threads
- Category metadata (name, slug, ID)

**How to backup:**

1. Navigate to **Settings → Backup**
2. Click **Download Backup**
3. A JSON file is downloaded: `threads-backup-YYYY-MM-DD.json`

**Backup file format:**
```json
{
  "exportedAt": "2026-03-21T12:00:00.000Z",
  "exportedBy": "you@example.com",
  "version": "1.0",
  "categories": [{ "id": 1, "name": "HR Policies", "slug": "hr-policies" }],
  "threads": [
    {
      "id": "abc123",
      "title": "Leave policy question",
      "categories": [...],
      "messages": [{ "role": "user", "content": "..." }, ...]
    }
  ]
}
```

> **Note:** This export covers **threads and messages only** for your assigned categories. Full system backup (including documents, users, and settings) is performed by Admins.

---

## 9. Task Planner Templates

Task Planner Templates allow the AI to execute structured, multi-step workflows for complex tasks within your categories.

### What are Task Planner Templates?

Templates are predefined task sequences that guide the AI through complex operations. When a user requests a multi-step task, the AI can use a template to:
- Break the work into discrete, trackable tasks
- Execute tasks sequentially with progress tracking
- Provide structured outputs at each stage

### Viewing Templates

The Task Planner section displays all templates configured for your assigned categories:

| Column | Description |
|--------|-------------|
| **Template Key** | Unique identifier used by the AI (e.g., `soe_identify`) |
| **Name** | Display name with placeholder support (e.g., `{country} SOE Assessment`) |
| **Description** | When the AI should use this template |
| **Placeholders** | Variables the AI provides (e.g., `country`, `soe_name`) |
| **Tasks** | Number of steps in the template |
| **Status** | Active or Inactive |

### Creating a Template

To create a new template for your category:

1. Click **Add Template**
2. Fill in the configuration:
   - **Key** - Unique identifier (lowercase, underscores, e.g., `quarterly_review`)
   - **Name** - Display name, can include `{placeholders}`
   - **Description** - When the AI should use this template
   - **Placeholders** - Variables the AI will substitute (comma-separated)
3. Add tasks:
   - Click **Add Task** for each step
   - Enter a description (can include `{placeholders}`)
   - Reorder tasks using drag handles
4. Set **Active** to Yes
5. Click **Save Template**

### Template Example

**Template Key:** `quarterly_review`
**Name:** `{department} Q{quarter} Review`
**Placeholders:** `department`, `quarter`

**Tasks:**
| ID | Description |
|----|-------------|
| 1 | Search knowledge base for {department} policies |
| 2 | Gather Q{quarter} performance metrics |
| 3 | Compare against targets |
| 4 | Identify gaps and issues |
| 5 | Generate recommendations |
| 6 | Create summary report |

When a user asks "Review IT department for Q3", the AI:
1. Selects this template
2. Substitutes: `department` → "IT", `quarter` → "3"
3. Executes each task sequentially
4. Tracks and reports progress

### Editing Templates

To modify an existing template:

1. Find the template in the list
2. Click **Edit**
3. Modify fields as needed
4. Add, remove, or reorder tasks
5. Click **Save**

### Template Status

| Status | Behavior |
|--------|----------|
| **Active** | AI can use this template |
| **Inactive** | Template hidden from AI, preserved in database |

> **Note:** Only Admins can deactivate or delete templates. Superusers can create and edit templates for their categories.

### Best Practices

1. **Clear task descriptions** - Each task should be specific and actionable
2. **Logical ordering** - Place research tasks before analysis tasks
3. **User checkpoints** - Include tasks that confirm with the user before proceeding
4. **Reasonable scope** - 5-15 tasks per template is typical
5. **Meaningful placeholders** - Use descriptive names like `{company_name}` not `{x}`

---

## 10. Data Sources

Data Sources allow the AI to query external APIs and CSV files to answer questions with real data. Data Sources are managed through the Tools tab.

### Accessing Data Sources

Data Sources may be accessed through the Tools tab or a dedicated Data Sources section, depending on your configuration.

### Creating an API Data Source

To connect an external API:

1. Click **Add Data Source** → **API**
2. Fill in the configuration:
   - **Name** - Display name (e.g., "Employee Directory API")
   - **Description** - What data this provides
   - **Endpoint URL** - Full API URL
   - **Method** - GET or POST
   - **Response Format** - JSON or CSV
3. Configure authentication (if required):
   - None
   - API Key (header or query parameter)
   - Bearer Token
   - Basic Auth
4. Define parameters the AI can use
5. Map the response structure
6. Select categories that can access this source
7. Click **Save**

### Uploading a CSV Data Source

To make CSV data queryable:

1. Click **Add Data Source** → **CSV**
2. Upload your CSV file
3. Review auto-detected columns and types
4. Add descriptions for each column
5. Select categories that can access this source
6. Click **Save**

### Testing Data Source Connections

Before saving, test your data source:

1. Click **Test Connection**
2. Review the test results:
   - Connection status
   - Sample data returned
   - Response time
3. Fix any errors before saving

### Configuring Authentication

| Auth Type | Configuration |
|-----------|---------------|
| **None** | No authentication required |
| **API Key** | Key value, header name, location (header/query) |
| **Bearer** | Token value |
| **Basic** | Username and password |

> **Security Note:** Credentials are encrypted in storage and never displayed after saving.

### Parsing OpenAPI Specifications

To auto-configure from an OpenAPI/Swagger spec:

1. Click **Import OpenAPI**
2. Paste the OpenAPI JSON/YAML
3. Review the parsed configuration
4. Adjust as needed
5. Save the data source

### Editing and Deleting Data Sources

- **Edit** - Click the data source name to modify configuration
- **Delete** - Click the delete button (only for sources you created)

---

## 11. Workspaces

Workspaces allow you to create embeddable and standalone chatbot instances for your managed categories.

### What are Workspaces?

A **Workspace** is a separate chatbot interface that:
- Can access **one or more categories** you manage
- Has its own branding (colors, logo, greeting)
- Has its own URL (random 16-character path)
- Can be **Embed** (widget for external sites) or **Standalone** (full chat)

### Workspace Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Embed** | Lightweight widget via script tag | FAQ bot on department website |
| **Standalone** | Full chat with threads | Team portal with conversation history |

### Creating a Workspace

1. Navigate to **Workspaces** tab
2. Click **New Workspace**
3. Select type: **Embed** or **Standalone**
4. Select categories from **your managed categories only**
5. Configure branding and settings
6. Click **Create**

> **Note:** You can only create workspaces using categories you manage. Contact Admin if you need to include other categories.

### Workspace Settings

| Setting | Description |
|---------|-------------|
| **Name** | Internal display name |
| **Categories** | Select from your managed categories |
| **Greeting Message** | Welcome message |
| **Suggested Prompts** | Starter questions |
| **Primary Color** | UI accent color |
| **Logo URL** | Optional logo |

### Feature Toggles

| Setting | Description |
|---------|-------------|
| **Voice Input** | Enable microphone input |
| **File Upload** | Allow file attachments |
| **Max File Size** | Maximum upload size in MB |

### Embed-Specific Settings

For **Embed** workspaces only:

| Setting | Description |
|---------|-------------|
| **Allowed Domains** | Whitelist of domains where embed can run |
| **Daily Limit** | Maximum messages per day |
| **Session Limit** | Maximum messages per session |

### Getting the Embed Script

For embed workspaces:
1. Select the workspace
2. Click **Get Embed Code**
3. Copy the script snippet
4. Paste into your website HTML

### Managing Workspace Users

For standalone workspaces with explicit access mode:

1. Select the workspace
2. Click **Manage Users**
3. Add users from your managed categories
4. Click **Save**

> **Note:** You can only add users who are subscribed to your managed categories.

### Viewing Workspace Analytics

Access usage statistics:
1. Select workspace
2. Click **Analytics**
3. View sessions, messages, and token usage

### Workspace Permissions

| Action | Superuser Can Do |
|--------|-----------------|
| Create workspace (managed categories) | ✅ |
| Create workspace (unassigned categories) | ❌ |
| Add users from managed categories | ✅ |
| Add users from other categories | ❌ |
| Edit own workspaces | ✅ |
| Delete own workspaces | ✅ |
| View workspace analytics | ✅ |

---

## 12. Permissions Summary

### What Superusers CAN Do

✅ **Categories**
- View all managed categories (with full access)
- View all subscribed categories (read-only access)
- Create new categories (within quota)
- Manage categories you created

✅ **Documents**
- Upload files, text, web URLs, and YouTube videos to managed categories
- View all documents in managed categories
- Delete documents you uploaded
- Monitor document processing status

✅ **Users**
- View users subscribed to managed categories
- Add existing users to your managed categories
- Remove user subscriptions from your managed categories

✅ **Data Sources**
- Create API and CSV data sources for managed categories
- Edit data source configurations
- Delete data sources you created
- Test data source connections

✅ **Tools**
- Enable/disable tools per managed category
- Configure tool branding per managed category
- Reset tool config to global defaults

✅ **Prompts**
- Edit category-specific prompt addendums for managed categories
- Configure starter prompts
- Use AI prompt optimization
- Reset to global prompt

✅ **Skills**
- Create skills for managed categories (priority 100+)
- Edit skills you created
- View all available skills
- Assign skills to managed categories

✅ **Task Planner Templates**
- Create templates for managed categories
- Edit existing templates for managed categories
- View all templates for managed categories

✅ **Workspaces**
- Create embed and standalone workspaces for managed categories
- Configure branding, LLM settings, and feature toggles
- Manage workspace users (from managed categories)
- View workspace analytics
- Edit and delete own workspaces

✅ **Chat Access**
- Query documents from both managed and subscribed categories
- Select any accessible category when starting a conversation

### What Superusers CANNOT Do

❌ **Global Operations**
- Upload documents to global scope
- Create global data sources
- Modify global tool configuration
- Modify global system prompt
- Configure tool routing rules

❌ **Cross-Category Access**
- Access categories not assigned to you
- Manage documents in other categories
- Configure tools for unassigned categories

❌ **User Management**
- Create new user accounts
- Delete user accounts
- Change user roles
- Manage other Superusers or Admins

❌ **System Administration**
- Perform backups/restores
- Access system settings
- View all users across all categories
- Configure reranker or LLM settings

❌ **Skills Restrictions**
- Create skills with priority below 100 (Core/High tier)
- Use "always" trigger type
- Edit skills created by Admins
- Assign skills to categories you don't manage

❌ **Task Planner Templates**
- Deactivate or delete templates
- Create templates for unassigned categories

❌ **Workspaces**
- Create workspaces for unassigned categories
- Add users from unassigned categories to workspaces
- Manage workspaces created by other users
- Configure global workspace settings

---

## 13. Troubleshooting

### Common Errors

#### "You don't have access to this category"

**Cause:** You're trying to access a category not assigned to you.

**Solution:** Contact an Admin to assign the category to your account.

#### "User not found"

**Cause:** Trying to add a subscription for a user that doesn't exist.

**Solution:** Ask an Admin to create the user account first.

#### "Already subscribed"

**Cause:** User already has a subscription to this category.

**Solution:** No action needed. The subscription already exists.

#### "Cannot delete this document"

**Cause:** You're trying to delete a document uploaded by someone else.

**Solution:** Only the original uploader or an Admin can delete the document.

### Document Processing Issues

#### Document stuck in "Processing"

**Possible causes:**
- Large file taking time to process
- System queue backlog
- Processing error

**Solutions:**
1. Wait a few minutes and refresh
2. Check if other recent uploads are processing
3. If stuck for over 30 minutes, contact Admin

#### Document shows "Error" status

**Possible causes:**
- Unsupported file format
- Corrupted file
- OCR failure for scanned documents

**Solutions:**
1. Hover over the error status for details
2. Try re-uploading the file
3. For scanned PDFs, try text upload instead
4. Contact Admin if issue persists

#### Web URL ingestion failed

**Possible causes:**
- URL not accessible
- Tavily API not configured
- Website blocks scraping

**Solutions:**
1. Verify URL is publicly accessible
2. Check if Tavily is enabled (Admin setting)
3. Try a different URL format
4. Use text upload as alternative

#### YouTube transcript extraction failed

**Possible causes:**
- Video has no captions/transcripts
- YouTube API not configured
- Video is private or restricted

**Solutions:**
1. Verify video has captions (CC icon on YouTube)
2. Check if YouTube tool is enabled
3. Try a different video
4. Contact Admin about API configuration

### Access Denied Errors

#### "Forbidden" or 403 Error

**Possible causes:**
- Session expired
- Role changed
- Category assignment removed

**Solutions:**
1. Log out and log back in
2. Verify you still have Superuser role
3. Check if category is still assigned
4. Contact Admin if issues persist

### Getting Help

If you encounter issues not covered here:

1. Note the exact error message
2. Note what action you were performing
3. Contact your Admin with these details

---

## 14. Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search box |
| `Esc` | Close modal |

### Upload Limits

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
| 🟢 | Ready/Active |
| 🟡 | Processing |
| 🔴 | Error/Inactive |
| ⚙️ | Configurable |
| 🔒 | Read-only |

---

*Last updated: February 2025 (v2.3 - Updated Skills section: superusers can now create and manage skills with restrictions)*
