# User Guide

This guide explains how to use Policy Bot as a regular user to chat with the AI assistant and access policy documents.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
3. [Chat Interface](#3-chat-interface)
4. [Threads & Conversations](#4-threads--conversations)
5. [Working with Documents](#5-working-with-documents)
6. [Voice Input](#6-voice-input)
7. [Using Tools](#7-using-tools)
8. [Sharing Threads](#8-sharing-threads)
9. [Categories & Subscriptions](#9-categories--subscriptions)
10. [Mobile Access](#10-mobile-access)
11. [Personalization](#11-personalization)
12. [Tips & Best Practices](#12-tips--best-practices)
13. [Troubleshooting](#13-troubleshooting)
14. [Quick Reference](#14-quick-reference)

---

## 1. Introduction

### What is Policy Bot?

Policy Bot is an AI-powered assistant that helps you find information in your organization's policy documents. You can ask questions in plain English and get answers with source citations.

### What You Can Do

As a user, you can:
- Chat with the AI assistant about policies and procedures
- Upload documents to your conversation threads for analysis
- Upload images for visual analysis (with vision-capable models)
- Use voice input for hands-free questioning
- Access documents from your subscribed categories
- Personalize the interface with custom colors
- Access Policy Bot from any device with a web browser

### Role Overview

| Role | What They Can Do |
|------|------------------|
| **User (You)** | Chat, upload to threads, access subscribed categories |
| **Superuser** | Manage assigned categories + can access additional subscribed categories |
| **Admin** | Full system management |

---

## 2. Getting Started

### Logging In

1. Navigate to Policy Bot in your browser
2. Click **Sign In**
3. Choose your authentication method:
   - **Microsoft** - Use your organization's Microsoft account
   - **Google** - Use your Google account
   - **Email / Password** - Use credentials if set up by your admin
4. Complete the authentication flow
5. You'll be redirected to the chat interface

### First Time Setup

When you first log in:
1. Policy Bot creates your user profile
2. You're automatically subscribed to default categories (if configured)
3. You can start chatting immediately

### Interface Overview

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo] Policy Bot                    [Settings] [Profile]  │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────────────────────────────────┐ │
│ │   Threads   │ │                                         │ │
│ │  Sidebar    │ │           Chat Messages                 │ │
│ │             │ │                                         │ │
│ │ • Thread 1  │ │   ┌─────────────────────────────────┐   │ │
│ │ • Thread 2  │ │   │ User: What is the leave policy? │   │ │
│ │ • Thread 3  │ │   └─────────────────────────────────┘   │ │
│ │             │ │                                         │ │
│ │ [+ New]     │ │   ┌─────────────────────────────────┐   │ │
│ │             │ │   │ Bot: According to the Employee  │   │ │
│ │             │ │   │ Handbook (page 23)...           │   │ │
│ │             │ │   │ [Source: HR_Handbook.pdf]       │   │ │
│ │             │ │   └─────────────────────────────────┘   │ │
│ │             │ │                                         │ │
│ └─────────────┘ │ ┌─────────────────────────────────────┐ │ │
│                 │ │ Type your message...    [📎] [🎤] [➤]│ │ │
│                 │ └─────────────────────────────────────┘ │ │
│                 └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Chat Interface

### Sending Messages

1. Type your question in the message box at the bottom
2. Press **Enter** or click the **Send** button
3. Wait for the AI to respond

### Streaming Responses

Policy Bot uses streaming responses, which means:
- You see the answer as it's being generated
- A typing indicator shows the AI is working
- Responses appear word by word for faster feedback

### Understanding Responses

AI responses include:
- **Answer** - The main response to your question
- **Sources** - Document citations with page numbers
- **Relevance Scores** - How confident the AI is in each source

### Example Conversation

**You:** What are the working hours?

**Bot:** According to the Employee Handbook (page 15), standard working hours are 9:00 AM to 5:00 PM, Monday through Friday. Flexible working arrangements may be available upon manager approval.

**Sources:**
- [Employee_Handbook.pdf] Page 15 (Score: 0.89)
- [HR_Policies_2024.pdf] Page 8 (Score: 0.72)

### Message History

- Scroll up to see previous messages
- The AI remembers context from earlier in the conversation
- Very long conversations are automatically summarized to maintain context

---

## 4. Threads & Conversations

### What is a Thread?

A thread is a separate conversation with the AI. Each thread:
- Has its own message history
- Is linked to specific categories
- Can have uploaded documents

### Creating a New Thread

1. Click **+ New Thread** in the sidebar
2. Select the categories you want to query
3. Optionally name your thread
4. Click **Create**

### Selecting Categories

When creating a thread, you can select one or more categories:
- **Single category** - Query documents from one department
- **Multiple categories** - Query across multiple departments

The chat header shows which categories are active.

### Managing Threads

| Action | How |
|--------|-----|
| **Switch thread** | Click on a thread in the sidebar |
| **Rename** | Click the pencil icon or right-click |
| **Delete** | Click the trash icon or right-click |
| **Pin** | Right-click and select Pin |

### Thread Privacy

Your threads are private to you. Other users cannot see your conversations or uploaded documents.

---

## 5. Working with Documents

### Uploading Content to Threads

You can upload various types of content to your conversation for analysis. Click the **Attachment** (📎) button to open the upload modal with three tabs:

#### File Upload Tab
Upload files directly from your device:
1. Click the **File** tab
2. Drag & drop files or click **browse**
3. Select one or more files
4. Click **Upload All** to process

**Supported file types:**
| Type | Extensions | Use Case |
|------|------------|----------|
| Documents | PDF, TXT | Policy documents, reports, text files |
| Images | PNG, JPG, JPEG, WebP | Screenshots, diagrams, receipts (requires vision model) |

#### Web URL Tab
Extract content from web pages (requires Tavily API configured by admin):
1. Click the **Web URL** tab
2. Enter the full URL (e.g., `https://example.com/article`)
3. Click the **+** button to add to queue
4. Click **Upload All** to extract content

#### YouTube Tab
Extract transcripts from YouTube videos (requires Supadata API configured by admin):
1. Click the **YouTube** tab
2. Paste a YouTube URL (e.g., `https://youtube.com/watch?v=...`)
3. Click the **+** button to add to queue
4. Click **Upload All** to extract transcript

### Upload Limits

| Limit | Value |
|-------|-------|
| Files per thread | 3 (configurable by admin) |
| Max file size | 10MB each |
| Supported types | PDF, TXT, PNG, JPG, JPEG, WebP |

### Document Compliance Checking

A common use case is checking your documents against policies:

**You:** [Uploads: expense_report.pdf]

**You:** Does this expense report comply with our travel policy?

**Bot:** I've reviewed your expense report against the Travel & Expense Policy. Here are my findings:

✅ Hotel rate is within daily limit
⚠️ Meal receipt from May 3rd is missing
❌ Transportation expense exceeds $50 limit without approval

### Artifacts Panel

The right side of the chat interface shows the **Artifacts Panel**, which organizes all content in your thread:

```
┌──────────────────────┐
│ 📎 Artifacts    (4)  │
├──────────────────────┤
│ ▼ AI Generated  (1)  │  ← Purple: Generated docs/images
│   📄 Summary.pdf     │
├──────────────────────┤
│ ▼ User Uploads  (1)  │  ← Blue: Your uploaded files
│   📄 report.pdf  ✕   │
├──────────────────────┤
│ ▼ Web Sources   (1)  │  ← Green: Extracted web content
│   🔗 example.com ✕   │
├──────────────────────┤
│ ▼ YouTube       (1)  │  ← Red: YouTube transcripts
│   ▶ Video ID    ✕    │
└──────────────────────┘
```

**Features:**
- **Collapse/Expand**: Click section headers to show/hide items
- **Remove Items**: Click ✕ to remove uploads or URL sources
- **Download**: Click AI-generated documents to download
- **Collapse Panel**: Click the panel toggle to minimize

### Tips for Document Uploads

- Supported formats: PDF, DOCX, XLSX, PPTX, TXT, MD, JSON, and images (PNG, JPG, WEBP, GIF)
- Office documents (DOCX, XLSX, PPTX) are processed locally — no external API needed
- Use images when you need visual analysis (requires vision model)
- Keep file names descriptive
- Upload before asking questions about the content
- Documents are only available in the current thread
- Use Web URL tab to extract articles without manual copy/paste
- Use YouTube tab to query video content as text

### Image Analysis

If your organization uses a vision-capable model (GPT-4.1, Gemini, or Mistral Large), you can upload images for analysis:

1. Click the **Attachment** (📎) button
2. Select an image file (PNG, JPG, JPEG, WebP, GIF)
3. Ask questions about the image content

**Example uses:**
- "What does this flowchart show?"
- "Analyze this expense receipt"
- "Extract the data from this table image"
- "Does this diagram match our process documentation?"

#### Image Processing Modes

Depending on your organization's configuration, you may see different behaviors:

| Warning | Meaning |
|---------|---------|
| *(No warning)* | Full visual analysis + OCR text extraction available |
| **Yellow banner**: "Text will be extracted via OCR" | Your model doesn't support visual analysis, but text in images will be extracted |
| **Red banner**: "Image uploads not available" | Neither vision nor OCR is configured; contact your admin |

#### Troubleshooting Image Uploads

If you see "Image uploads not available":
- Your current model may not support vision
- OCR services may not be configured
- Contact your admin to enable image processing

If you see "Text extracted via OCR":
- Images are processed but only text content is extracted
- Visual elements (charts, diagrams, photos) cannot be analyzed
- For full visual analysis, ask your admin about vision-capable models

---

## 6. Voice Input

### Using Voice Input

1. Click the **Microphone** (🎤) button
2. Allow microphone access if prompted
3. Speak your question clearly
4. Click the button again to stop recording
5. Your speech is transcribed and sent

### Voice Input Tips

- Speak clearly and at a moderate pace
- Reduce background noise for better accuracy
- Short questions work best
- Review the transcription before sending

### Supported Languages

Voice input primarily supports English. Other languages may work but with reduced accuracy.

---

## 7. Using Tools

The AI has access to various tools that enhance its capabilities.

### Web Search

When the AI needs current information not in the documents:

**You:** What are the latest tax rate changes?

**Bot:** Based on a web search, here are the current tax changes effective 2024...
[WEB] Source: irs.gov - Tax Rate Updates

### Chart Generation

Request data visualizations:

**You:** Create a chart showing our quarterly budget allocation

**Bot:** Here's a pie chart showing the Q4 budget allocation across departments:
[Displays interactive chart]

### Document Generation

Request formatted documents:

**You:** Generate a PDF summary of leave policies

**Bot:** I've created a PDF document summarizing the leave policies:
[Download: Leave_Policy_Summary.pdf]

### Task Planning

For complex multi-step requests:

**You:** Help me plan a new employee onboarding process

**Bot:** I'll create a task plan for onboarding. Let me work through this step by step...
[Shows progress through each step]

---

## 8. Sharing Threads

### What is Thread Sharing?

Thread sharing allows you to share a conversation with colleagues via a secure link. Recipients must sign in to view the shared thread, keeping your organization's information protected.

### Sharing a Thread

1. Hover over a thread in the sidebar
2. Click the **Share** icon (or right-click and select "Share")
3. Configure share options:
   - **Allow Downloads**: Let recipients download attached files
   - **Expiration**: Set when the link expires (7, 30, 90 days, or never)
   - **Email Notification**: Optionally notify recipients by email
4. Click **Create Share Link**
5. Copy the link to share

### Share Options

| Option | Description |
|--------|-------------|
| **Allow Downloads** | Recipients can download files attached to the thread |
| **Expiration** | Link becomes invalid after this time |
| **Email Notification** | Send an email with the link (if enabled by admin) |

### Viewing a Shared Thread

When someone shares a thread with you:

1. Click the share link you received
2. Sign in if not already logged in
3. View the conversation with all messages and sources
4. Generated files appear inline with their associated messages
5. Download files if the share creator allowed downloads

### Managing Your Shares

To view or revoke shares you've created:

1. Click the Share icon on the thread
2. View **Active Shares** showing:
   - View count
   - Expiration date
   - Download permission
3. Click **Revoke** to disable a share link

### Share Limitations

- You can only share your own threads
- Shares require authentication to view
- Expired or revoked shares show an error message
- Your admin may have disabled sharing

### Example

**Sharing a policy discussion:**

1. You have a thread about leave policy clarifications
2. Click Share on the thread
3. Enable "Allow Downloads" (thread has a PDF summary)
4. Set expiration to 7 days
5. Enter colleague's email for notification
6. Click **Create Share**
7. Colleague receives email with link
8. They sign in and view the conversation
9. They can download the PDF summary

---

## 9. Categories & Subscriptions

### Understanding Categories

Categories organize documents by department or topic:
- **HR Policies** - Leave, benefits, employee handbook
- **Finance** - Budgets, expenses, procurement
- **IT** - Security policies, software guidelines
- **Operations** - Procedures, workflows

### Your Subscriptions

You can only access documents from categories you're subscribed to. Your subscriptions are managed by your Superuser or Admin.

### Viewing Your Categories

To see which categories you have access to:
1. Click your profile icon
2. Select **Settings**
3. View **My Categories**

Or check the category selector when creating a new thread.

### Requesting Access

If you need access to additional categories:
1. Contact your Superuser or Admin
2. Specify which category you need
3. Explain why you need access
4. Wait for approval and subscription

---

## 10. Mobile Access

### Responsive Design

Policy Bot is fully responsive and works on any device with a modern web browser.

### Mobile Features

- **Touch-friendly UI** - Optimized for touch interactions
- **Responsive layout** - Adapts to any screen size
- **Swipe gestures** - Navigate between threads on mobile

### Supported Browsers

| Browser | Desktop | Mobile |
|---------|---------|--------|
| Chrome | ✅ | ✅ |
| Safari | ✅ | ✅ |
| Firefox | ✅ | ✅ |
| Edge | ✅ | ✅ |

### Progressive Web App (PWA)

Policy Bot can be installed as a standalone app on your device for a better experience.

#### Benefits

- **App-like Experience** - No browser UI clutter
- **Quick Access** - Launch from home screen or desktop
- **Auto-Updates** - Always get the latest version
- **Faster Loading** - Optimized performance

#### Installing on Desktop

**Chrome / Edge:**
1. Open Policy Bot in your browser
2. Look for the **install icon** (⊕) in the address bar
3. Click **"Install Policy Bot"**
4. Confirm installation
5. App opens in a standalone window
6. Find the app in:
   - Windows: Start Menu
   - macOS: Applications folder
   - Linux: Applications menu

#### Installing on Mobile

**Android (Chrome):**
1. Visit Policy Bot in Chrome
2. Tap the **install banner** at the bottom
3. Or tap **⋮ menu** → **"Install app"**
4. Icon appears on home screen
5. Launch from home screen

**iOS (Safari):**
1. Visit Policy Bot in Safari
2. Tap the **Share button** (box with arrow)
3. Scroll and select **"Add to Home Screen"**
4. Tap **"Add"**
5. Launch from home screen

#### Using the App

Once installed:
- ✅ Launches in standalone window (no browser bars)
- ✅ All Policy Bot features work normally
- ✅ Custom app icon and name
- ✅ Updates automatically
- ⚠️ **Requires internet connection** - Cannot work offline

**Note:** Policy Bot requires an online connection to search documents and chat with the AI. When offline, you'll see a message to check your connection.

#### Uninstalling

**Desktop:**
- Open the app → **⋮ menu** → **"Uninstall Policy Bot"**
- Or use your OS app manager

**Mobile:**
- **Android:** Long-press icon → **"Uninstall"**
- **iOS:** Long-press icon → **"Remove App"**

For more details, see [docs/features/PWA.md](../../features/PWA.md).

---

## 11. Personalization

### Custom Accent Color

Personalize the interface with your preferred color:

1. Click your profile icon
2. Select **Settings**
3. Find **Accent Color**
4. Choose from preset colors or enter a custom hex code
5. The color is applied immediately
6. Your preference is saved across sessions

### Available Preset Colors

| Color | Hex |
|-------|-----|
| Blue | #3B82F6 |
| Green | #10B981 |
| Purple | #8B5CF6 |
| Orange | #F97316 |
| Pink | #EC4899 |
| Teal | #14B8A6 |

### Theme Settings

Depending on your organization's configuration:
- **Light Mode** - Default light theme
- **Dark Mode** - Eye-friendly dark theme
- **System** - Follows your device preference

---

## 12. Tips & Best Practices

### Asking Better Questions

**Do:**
- Be specific: "What is the maximum number of sick days per year?"
- Provide context: "For the procurement process, what approval is needed for purchases over $5000?"
- Reference documents: "According to the Employee Handbook, what are the dress code requirements?"

**Don't:**
- Ask vague questions: "Tell me about policies"
- Ask multiple unrelated questions at once
- Assume the AI knows about recent changes not in documents

### Getting Better Answers

1. **Start with broad questions** - Then drill down into specifics
2. **Use follow-up questions** - "Can you elaborate on that?"
3. **Ask for sources** - "Which document covers this?"
4. **Request formatting** - "List the steps" or "Create a table"

### When Web Search is Used

The AI automatically searches the web when:
- Information isn't in the documents
- You ask about current events
- You specifically request web information

You'll see `[WEB]` tags on web-sourced information.

### Understanding Limitations

The AI:
- Only knows what's in the documents
- Cannot access documents you're not subscribed to
- May not have the very latest policy updates
- Provides guidance, not legal or financial advice

---

## 13. Troubleshooting

### Common Issues

#### "No relevant documents found"

**Causes:**
- Question doesn't match document content
- You're not subscribed to the right category
- Documents haven't been uploaded yet

**Solutions:**
1. Try rephrasing your question
2. Check which categories you're subscribed to
3. Contact your Superuser about missing documents

#### "Connection lost"

**Causes:**
- Network connectivity issue
- Server maintenance

**Solutions:**
1. Check your internet connection
2. Wait a moment and refresh
3. Try again in a few moments

#### Voice input not working

**Causes:**
- Microphone permission denied
- Browser doesn't support Web Speech API
- Background noise

**Solutions:**
1. Check browser permissions for microphone
2. Try a different browser (Chrome recommended)
3. Move to a quieter location

#### Slow responses

**Causes:**
- Complex question requiring extensive search
- High server load
- Poor network connection

**Solutions:**
1. Wait for streaming to complete
2. Try simpler questions
3. Refresh and try again

### Getting Help

If you encounter issues:
1. Try the solutions above
2. Note any error messages
3. Contact your Superuser or Admin
4. Provide details about what you were trying to do

---

## 14. Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `/` | Focus search |
| `Esc` | Close modal |

### Message Input

| Button | Action |
|--------|--------|
| 📎 | Attach document |
| 🎤 | Voice input |
| ➤ | Send message |

### Thread Upload Limits

| Type | Limit |
|------|-------|
| Files per thread | 3 (configurable) |
| Max file size | 10MB |
| Supported types | PDF, TXT, PNG, JPG, WebP |
| URL sources | Web pages, YouTube videos |

### Response Indicators

| Indicator | Meaning |
|-----------|---------|
| Typing... | AI is generating response |
| [Source] | Document citation |
| [WEB] | Web search result |
| Score: X.XX | Source relevance (0-1) |

### Category Access

| Status | Meaning |
|--------|---------|
| Active | You can access documents |
| Inactive | Subscription paused |
| Not subscribed | No access (contact Admin) |

---

*Last updated: January 2025 (v1.4 - Added Artifacts Panel, multi-format uploads, Web URL and YouTube extraction)*
