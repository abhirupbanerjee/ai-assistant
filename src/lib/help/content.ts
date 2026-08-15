export type HelpTabId = 'overview' | 'main-chat' | 'workspace' | 'agent-bots';

export type HelpAudience =
  | 'All roles'
  | 'User'
  | 'Superuser'
  | 'Admin'
  | 'Super Admin'
  | 'Developer';

export type HelpCalloutTone = 'info' | 'tip' | 'warning' | 'security';

export interface HelpParagraphBlock {
  type: 'paragraph';
  text: string;
}

export interface HelpListBlock {
  type: 'list';
  items: string[];
}

export interface HelpStepsBlock {
  type: 'steps';
  items: Array<{ title: string; description: string }>;
}

export interface HelpTableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface HelpCalloutBlock {
  type: 'callout';
  tone: HelpCalloutTone;
  title: string;
  text: string;
}

export interface HelpCodeBlock {
  type: 'code';
  language: string;
  label: string;
  code: string;
}

export interface HelpCardsBlock {
  type: 'cards';
  items: Array<{ title: string; description: string }>;
}

export type HelpBlock =
  | HelpParagraphBlock
  | HelpListBlock
  | HelpStepsBlock
  | HelpTableBlock
  | HelpCalloutBlock
  | HelpCodeBlock
  | HelpCardsBlock;

export interface HelpAction {
  label: string;
  href: string;
  allowedRoles: Array<'superuser' | 'admin' | 'super_admin'>;
  requirement: string;
}

export interface HelpSection {
  id: string;
  title: string;
  summary: string;
  audiences: HelpAudience[];
  keywords: string[];
  blocks: HelpBlock[];
  action?: HelpAction;
}

export interface HelpTab {
  id: HelpTabId;
  label: string;
  shortLabel: string;
  description: string;
  icon: 'sparkles' | 'message' | 'panels' | 'bot';
  sections: HelpSection[];
}

const overview: HelpTab = {
  id: 'overview',
  label: 'Overview',
  shortLabel: 'Overview',
  description: 'Understand the platform, its three-route architecture, data sovereignty, and the ways people and systems can use it.',
  icon: 'sparkles',
  sections: [
    {
      id: 'what-is-ai-assistant',
      title: 'What is AI Assistant?',
      summary: 'A self-hosted chat and agentic AI platform for organizational knowledge, analysis, content creation, and external integrations.',
      audiences: ['All roles'],
      keywords: ['platform', 'rag', 'knowledge', 'self-hosted', 'chat', 'agentic'],
      blocks: [
        {
          type: 'paragraph',
          text: 'AI Assistant combines grounded conversations, document retrieval, tools, reusable skills, specialized agents, embeddable workspaces, and programmatic Agent Bots in one platform. Organizations operate the application and choose which AI providers or local models are allowed.',
        },
        {
          type: 'cards',
          items: [
            { title: 'Main Chat', description: 'A full conversational workspace for people, with threads, category knowledge, uploads, citations, tools, and generated artifacts.' },
            { title: 'Workspaces', description: 'Branded standalone or embedded chats that bring category-scoped assistance into internal and public portals.' },
            { title: 'Agent Bots', description: 'Versioned REST APIs for forms, automations, scheduled workflows, mobile apps, and system-to-system integrations.' },
          ],
        },
      ],
    },
    {
      id: 'three-routes',
      title: 'Three routes, zero vendor lock-in',
      summary: 'Use direct cloud providers, local Ollama, and aggregator gateways independently or together.',
      audiences: ['All roles', 'Admin', 'Super Admin'],
      keywords: ['routes', 'route 2', 'route 3', 'route 5', 'vendor lock-in', 'ollama', 'fallback', 'providers'],
      blocks: [
        {
          type: 'table',
          headers: ['Route', 'Purpose', 'Connection', 'Examples'],
          rows: [
            ['Route 2', 'Direct providers', 'Native SDK or direct API', 'OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Moonshot'],
            ['Route 3', 'Local inference', 'Local Ollama server', 'Locally installed Ollama models; suitable for air-gapped deployments'],
            ['Route 5', 'Aggregator gateways', 'Native SDK or compatible API', 'Azure AI Foundry, Fireworks AI, Ollama Cloud'],
          ],
        },
        {
          type: 'list',
          items: [
            'Enable routes independently and choose a primary route without rewriting chat, tools, or integrations.',
            'Use cross-route fallback to improve availability when multiple routes are enabled.',
            'Keep model choice separate from organizational knowledge, tools, skills, Workspaces, and Agent Bot definitions.',
            'Use direct provider connections rather than depending on one mandatory LLM proxy.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Who configures routes?',
          text: 'Everyone can understand and benefit from routing. Route and provider configuration is an administrative option; availability depends on the deployment and your role.',
        },
      ],
      action: {
        label: 'Open route settings',
        href: '/admin?tab=settings&section=routes',
        allowedRoles: ['admin', 'super_admin'],
        requirement: 'Requires Admin or Super Admin',
      },
    },
    {
      id: 'data-sovereignty',
      title: 'Data sovereignty and control',
      summary: 'Control where application data, knowledge indexes, files, configuration, and model processing are hosted.',
      audiences: ['All roles', 'Admin', 'Super Admin'],
      keywords: ['sovereignty', 'privacy', 'postgresql', 'qdrant', 'air-gapped', 'local', 'security'],
      blocks: [
        {
          type: 'cards',
          items: [
            { title: 'Application data', description: 'Users, roles, threads, configuration, jobs, and audit-related records remain in the organization-operated PostgreSQL deployment.' },
            { title: 'Knowledge and files', description: 'Document indexes use the configured Qdrant deployment, while uploaded and generated files remain in organization-controlled storage.' },
            { title: 'Access boundaries', description: 'Four-tier roles and category-scoped access separate organizational knowledge and management responsibility.' },
            { title: 'Portable configuration', description: 'Standard databases, exportable settings, independent provider routes, Workspaces, and versioned Agent Bots reduce switching costs.' },
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Local control versus cloud processing',
          text: 'Complete offline sovereignty requires Route 3 with local models and local processing services. If a cloud route is enabled, prompts and the context required for a request are sent to the selected provider under that provider agreement. Administrators decide which routes are permitted.',
        },
      ],
    },
    {
      id: 'platform-frameworks',
      title: 'Chat, agents, tools, and skills',
      summary: 'Four complementary frameworks turn a grounded answer into a complete workflow.',
      audiences: ['All roles'],
      keywords: ['tools', 'skills', 'agents', 'artifacts', 'slash commands', 'mentions', 'framework'],
      blocks: [
        {
          type: 'table',
          headers: ['Framework', 'What it does', 'Example'],
          rows: [
            ['Chat and RAG', 'Answers with conversation context and permitted organizational documents', 'Ask a policy question and inspect cited sources'],
            ['Tools', 'Perform actions or create terminal outputs', 'Search the web, generate a chart, document, diagram, spreadsheet, presentation, image, or site'],
            ['Skills', 'Inject modular behavior when global, category, or keyword conditions match', 'Apply a compliance format or domain-specific methodology'],
            ['Specialized agents', 'Route work to configured planner, researcher, executor, critic, or presenter roles', 'Type an at mention in Main Chat to choose an available agent'],
          ],
        },
        {
          type: 'callout',
          tone: 'tip',
          title: 'Fast ways to guide a request',
          text: 'Type slash in Main Chat to suggest a tool or output format. Type at to select an available specialized agent. The exact menu depends on enabled tools, configured agents, the active category, and deployment settings.',
        },
      ],
    },
    {
      id: 'choose-experience',
      title: 'Choose the right experience',
      summary: 'Select Main Chat, a Workspace, or an Agent Bot based on who initiates the work and how the result is consumed.',
      audiences: ['All roles', 'Developer'],
      keywords: ['comparison', 'main chat', 'workspace', 'agent bot', 'embed', 'api'],
      blocks: [
        {
          type: 'table',
          headers: ['Need', 'Best fit', 'Why'],
          rows: [
            ['A person needs a full private conversation', 'Main Chat', 'Threads, history, category scope, uploads, sources, voice, tools, and artifacts'],
            ['A portal needs a branded conversational assistant', 'Workspace', 'Standalone and embed modes with branding, allowed domains, access rules, and rate limits'],
            ['A system needs structured or generated output', 'Agent Bot', 'Versioned API, schemas, API keys, async jobs, webhooks, and multiple output formats'],
          ],
        },
      ],
    },
  ],
};

const mainChat: HelpTab = {
  id: 'main-chat',
  label: 'Main Chat',
  shortLabel: 'Chat',
  description: 'Learn how categories, documents, user access, slash commands, and agent mentions shape a conversation.',
  icon: 'message',
  sections: [
    {
      id: 'chat-at-a-glance',
      title: 'Main Chat at a glance',
      summary: 'Start a thread, choose its knowledge scope, ask questions, inspect sources, and work with generated outputs.',
      audiences: ['All roles'],
      keywords: ['thread', 'messages', 'model', 'sources', 'artifacts', 'voice'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Create or open a thread', description: 'Each thread keeps its own messages, selected category context, uploads, and generated artifacts.' },
            { title: 'Ask in natural language', description: 'Provide the goal, context, expected format, and any constraints. Responses stream as they are generated.' },
            { title: 'Review evidence and outputs', description: 'Open source citations, inspect tool activity, and preview or download generated artifacts from the conversation.' },
            { title: 'Continue with context', description: 'Ask follow-up questions in the same thread or start a new thread for a separate subject or category.' },
          ],
        },
      ],
    },
    {
      id: 'categories',
      title: 'Use categories to choose knowledge',
      summary: 'A category determines which organizational document collection the conversation can retrieve from.',
      audiences: ['User', 'Superuser', 'Admin', 'Super Admin'],
      keywords: ['category', 'categories', 'knowledge base', 'rag', 'thread category', 'subscription'],
      blocks: [
        {
          type: 'list',
          items: [
            'Regular users select a permitted category when creating a thread.',
            'Superusers can use subscribed categories and manage the categories assigned to them.',
            'Admins and Super Admins can access categories across the deployment.',
            'The selected category also influences category prompts, skills, available agents, starter prompts, and retrieval scope.',
          ],
        },
        {
          type: 'callout',
          tone: 'tip',
          title: 'Choose the narrowest useful scope',
          text: 'A focused category usually returns more relevant sources. Start a separate thread when moving to a different department, policy area, or document set.',
        },
      ],
    },
    {
      id: 'documents',
      title: 'Work with documents and sources',
      summary: 'Use category knowledge for managed content and thread uploads for temporary, conversation-specific analysis.',
      audiences: ['All roles'],
      keywords: ['documents', 'uploads', 'attachments', 'files', 'web url', 'youtube', 'citations', 'sources'],
      blocks: [
        {
          type: 'table',
          headers: ['Content', 'Scope', 'Use it for'],
          rows: [
            ['Category documents', 'Available to authorized users across threads in that category', 'Approved policies, procedures, research, standards, and shared knowledge'],
            ['Thread uploads', 'Available only inside the current thread', 'Reviewing a draft, spreadsheet, image, presentation, or ad hoc reference'],
            ['Web URL or YouTube input', 'Attached to the current thread after extraction', 'Discussing a web page or video transcript alongside other context'],
            ['Generated artifacts', 'Created in the current thread', 'Documents, charts, diagrams, images, slides, spreadsheets, HTML, and other tool outputs'],
          ],
        },
        {
          type: 'steps',
          items: [
            { title: 'Attach content', description: 'Use the attachment control and choose a local file, web URL, or supported video source.' },
            { title: 'Wait for processing', description: 'Ask document-specific questions after extraction or indexing completes.' },
            { title: 'State the task', description: 'Name the attached file when helpful and say whether you want extraction, comparison, validation, transformation, or a generated output.' },
            { title: 'Verify citations', description: 'Open cited sources and confirm critical facts against the original material.' },
          ],
        },
      ],
    },
    {
      id: 'user-assignment',
      title: 'Understand user assignment and access',
      summary: 'Category subscriptions grant use; Superuser category assignments grant scoped management responsibility.',
      audiences: ['User', 'Superuser', 'Admin', 'Super Admin'],
      keywords: ['user assignment', 'subscriptions', 'assigned categories', 'access', 'permissions', 'roles'],
      blocks: [
        {
          type: 'table',
          headers: ['Role', 'Category use', 'Management options'],
          rows: [
            ['User', 'Uses categories assigned through active subscriptions', 'No category or user administration'],
            ['Superuser', 'Uses assigned and additionally subscribed categories', 'Manages content and users only within assigned categories'],
            ['Admin', 'Broad category access', 'Manages users, categories, Workspaces, Agent Bots, tools, and most settings'],
            ['Super Admin', 'Full category access', 'Full administration, including protected platform responsibilities'],
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Need another category?',
          text: 'Users should contact the Superuser responsible for that category or an administrator. Category access controls both document visibility and which category-scoped experiences are available.',
        },
      ],
      action: {
        label: 'Open user management',
        href: '/admin?tab=users',
        allowedRoles: ['superuser', 'admin', 'super_admin'],
        requirement: 'Requires Superuser, Admin, or Super Admin; Superusers are category-scoped',
      },
    },
    {
      id: 'slash-commands',
      title: 'Use slash commands',
      summary: 'Type slash to quickly suggest a tool or output format for the current request.',
      audiences: ['All roles'],
      keywords: ['slash', 'commands', '/pdf', '/docx', '/chart', '/diagram', '/image', '/slide', '/sheet'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Type slash', description: 'The autocomplete menu opens at the current trigger token.' },
            { title: 'Filter and select', description: 'Continue typing, use Arrow keys, then choose with Enter or Tab. Escape closes the menu.' },
            { title: 'Add the request', description: 'Describe the content, intended audience, data, visual style, and any required structure.' },
            { title: 'Send and review', description: 'The command supplies a strong suggestion. The selected tool must be enabled, and the AI may adapt the approach when the request requires it.' },
          ],
        },
        {
          type: 'table',
          headers: ['Command examples', 'Typical result'],
          rows: [
            ['/pdf, /docx', 'Formatted PDF or editable Word document'],
            ['/chart, /bar-chart, /line-chart', 'Data visualization'],
            ['/diagram, /flowchart, /sequence, /c4, /gantt', 'Mermaid diagram'],
            ['/image, /infographic, /photo', 'Generated visual'],
            ['/slide, /sheet', 'PowerPoint presentation or Excel spreadsheet'],
            ['/html, /site', 'Interactive HTML page or multi-page site'],
          ],
        },
        {
          type: 'code',
          language: 'text',
          label: 'Example request',
          code: '/docx Create an executive summary of the attached policy. Include key decisions, owners, risks, and source citations.',
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Configured availability',
          text: 'The menu is the authoritative list for your deployment. A command can be hidden or unavailable when the command or its underlying tool is disabled.',
        },
      ],
    },
    {
      id: 'agent-mentions',
      title: 'Use at mentions for specialized agents',
      summary: 'Type at to choose a configured agent that can plan, research, execute, critique, or present work.',
      audiences: ['All roles'],
      keywords: ['@', 'at mention', 'agent mention', 'planner', 'researcher', 'executor', 'critic', 'presenter'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Type at', description: 'The agent menu opens and filters as you type an agent name or identifier.' },
            { title: 'Choose an available agent', description: 'The menu reflects configured agents and may be narrowed by the active category.' },
            { title: 'Describe a concrete outcome', description: 'Give the agent a goal, required inputs, constraints, and the expected deliverable.' },
            { title: 'Review the result', description: 'Complex pipelines may show stages, request approval, or combine outputs before returning a final response.' },
          ],
        },
        {
          type: 'cards',
          items: [
            { title: 'Planner', description: 'Breaks complex outcomes into an ordered approach.' },
            { title: 'Researcher', description: 'Collects and synthesizes relevant evidence.' },
            { title: 'Executor', description: 'Carries out scoped tasks with its configured tools.' },
            { title: 'Critic', description: 'Checks quality, gaps, risks, and compliance.' },
            { title: 'Presenter', description: 'Shapes findings into a clear final deliverable.' },
          ],
        },
        {
          type: 'code',
          language: 'text',
          label: 'Example request',
          code: '@researcher Compare the attached strategy with current regional digital-government practices and cite the strongest sources.',
        },
      ],
    },
    {
      id: 'chat-troubleshooting',
      title: 'Main Chat troubleshooting',
      summary: 'Resolve common category, document, command, agent, and citation issues.',
      audiences: ['All roles'],
      keywords: ['troubleshooting', 'no documents', 'disabled command', 'no agents', 'missing sources'],
      blocks: [
        {
          type: 'table',
          headers: ['Issue', 'What to check'],
          rows: [
            ['Category is missing', 'Confirm your subscription or ask the responsible Superuser or administrator for access'],
            ['Document is not used', 'Confirm processing is complete, the correct category is active, or the file is attached to this thread'],
            ['Slash command is unavailable', 'The command or underlying tool may be disabled by an administrator'],
            ['No agents are listed', 'No matching agent may be enabled for the active category'],
            ['Sources are weak or absent', 'Narrow the question, use the correct category, name the relevant file, or ask specifically for citations'],
            ['Image cannot be analyzed', 'Choose a vision-capable model or ask an administrator whether OCR or vision is enabled'],
          ],
        },
      ],
    },
  ],
};

const workspace: HelpTab = {
  id: 'workspace',
  label: 'Workspace',
  shortLabel: 'Workspace',
  description: 'Create a branded, category-scoped chat and add it to an internal or public portal.',
  icon: 'panels',
  sections: [
    {
      id: 'workspace-overview',
      title: 'Workspace overview',
      summary: 'A Workspace packages AI Assistant chat into a dedicated standalone experience or lightweight portal embed.',
      audiences: ['All roles', 'Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['workspace', 'chatbot', 'portal', 'standalone', 'embed', 'branding'],
      blocks: [
        {
          type: 'paragraph',
          text: 'Each Workspace links to one or more document categories and can have its own title, logo, color, greeting, suggested prompts, model preferences, file and voice options, access rules, rate limits, and analytics.',
        },
        {
          type: 'table',
          headers: ['Aspect', 'Standalone', 'Embed'],
          rows: [
            ['Best for', 'Internal team or department portal', 'Public website or customer-support widget'],
            ['Experience', 'Full chat with persistent threads and richer features', 'Lightweight session-based chat'],
            ['Address', 'Dedicated workspace slug', 'Hosted embed address or external script'],
            ['Access', 'Authentication or configured anonymous access', 'Allowed-domain and optional authentication rules'],
            ['Portal controls', 'Link from an intranet or application', 'Script tag, iframe, position, rate limits, and origin validation'],
          ],
        },
      ],
    },
    {
      id: 'workspace-prerequisites',
      title: 'Before you create a Workspace',
      summary: 'Prepare the knowledge, owners, visual identity, security rules, and portal details first.',
      audiences: ['Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['prerequisites', 'categories', 'documents', 'allowed domains', 'branding', 'owner'],
      blocks: [
        {
          type: 'list',
          items: [
            'A Superuser with assigned categories, an Admin, or a Super Admin creates and configures the Workspace.',
            'At least one category should contain processed, tested documents for grounded answers.',
            'Choose Standalone for a full portal chat or Embed for a lightweight widget.',
            'Prepare the title, greeting, suggested prompts, logo, primary color, and support owner.',
            'For embeds, list every approved production and test domain and decide appropriate daily and session limits.',
            'Identify the portal developer who will install and test the generated integration code.',
          ],
        },
      ],
    },
    {
      id: 'workspace-setup',
      title: 'Create and configure a Workspace',
      summary: 'Set knowledge scope, experience, branding, model behavior, features, and access in one guided flow.',
      audiences: ['Superuser', 'Admin', 'Super Admin'],
      keywords: ['new workspace', 'create workspace', 'setup', 'model override', 'access mode'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Open Admin → Workspaces', description: 'Select New Workspace and choose Standalone or Embed. Superusers can work only with categories assigned to them.' },
            { title: 'Link category knowledge', description: 'Choose one or more categories containing the material this assistant is allowed to retrieve.' },
            { title: 'Design the welcome experience', description: 'Set the name, chat title, greeting, suggested prompts, logo, primary color, and footer text.' },
            { title: 'Choose model behavior', description: 'Keep the global model, select Auto, or configure an allowed model and temperature override for this Workspace.' },
            { title: 'Set user features', description: 'Enable or disable file uploads and voice input and confirm the upload size limit.' },
            { title: 'Configure access', description: 'For Standalone, choose category-based or explicit-user access. For Embed, configure domains, authentication, and message limits.' },
            { title: 'Save and copy deployment details', description: 'Open the generated Script area to obtain the standalone address, script tag, or hosted embed address.' },
          ],
        },
      ],
      action: {
        label: 'Open Workspaces',
        href: '/admin?tab=workspaces',
        allowedRoles: ['superuser', 'admin', 'super_admin'],
        requirement: 'Requires Superuser, Admin, or Super Admin; Superusers are category-scoped',
      },
    },
    {
      id: 'workspace-security',
      title: 'Configure access and security',
      summary: 'Use category rules for internal users and origin, authentication, and rate limits for external embeds.',
      audiences: ['Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['security', 'access', 'explicit users', 'allowed domains', 'origin', 'rate limits', 'authentication'],
      blocks: [
        {
          type: 'table',
          headers: ['Control', 'Use it to'],
          rows: [
            ['Category-based access', 'Require authenticated users to hold active access to the Workspace categories'],
            ['Explicit user list', 'Grant a controlled list of users access to a Standalone Workspace'],
            ['Allowed domains', 'Reject embed requests whose browser Origin is not on the approved list'],
            ['Require authentication', 'Send unauthenticated users through the deployment login flow'],
            ['Daily and session limits', 'Control public usage and reduce abuse per IP and session'],
            ['File and voice toggles', 'Expose only the inputs required by the portal use case'],
          ],
        },
        {
          type: 'callout',
          tone: 'security',
          title: 'Use exact production domains',
          text: 'Add the real portal hostnames, including required test environments. Do not use an unrestricted wildcard. Test the browser Origin behavior before launch and review limits after observing real traffic.',
        },
      ],
    },
    {
      id: 'workspace-embed',
      title: 'Add a Workspace to an external portal',
      summary: 'Use the generated script for a floating widget, an iframe for controlled placement, or a direct link for a full portal.',
      audiences: ['Admin', 'Super Admin', 'Developer'],
      keywords: ['embed', 'script tag', 'iframe', 'portal integration', 'workspace.js', 'standalone link'],
      blocks: [
        {
          type: 'callout',
          tone: 'tip',
          title: 'Start with generated code',
          text: 'Copy deployment code from the Workspace Script area because it includes the correct deployment origin and Workspace slug. The snippets below show the pattern only.',
        },
        {
          type: 'code',
          language: 'html',
          label: 'Floating widget pattern',
          code: '<script\n  src="https://YOUR-AI-DOMAIN/embed/workspace.js"\n  data-workspace-id="YOUR-WORKSPACE-SLUG"\n  data-api-base="https://YOUR-AI-DOMAIN"\n  data-position="bottom-right"\n  async\n></script>',
        },
        {
          type: 'code',
          language: 'html',
          label: 'Iframe pattern',
          code: '<iframe\n  src="https://YOUR-AI-DOMAIN/e/YOUR-WORKSPACE-SLUG"\n  title="Organization assistant"\n  width="400"\n  height="600"\n  allow="microphone"\n></iframe>',
        },
        {
          type: 'table',
          headers: ['Pattern', 'Choose it when'],
          rows: [
            ['Script tag', 'You want a floating launcher, asynchronous loading, and automatic visitor persistence'],
            ['Iframe', 'You need a fixed area, isolated styling, or richer hosted-page rendering'],
            ['Standalone link', 'Authenticated users need persistent threads and the full Workspace experience'],
          ],
        },
      ],
    },
    {
      id: 'workspace-launch',
      title: 'Test and launch',
      summary: 'Validate knowledge quality, security, browser behavior, responsive placement, and operations before publishing.',
      audiences: ['Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['testing', 'launch', 'qa', 'analytics', 'responsive', 'rate limit'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Test grounded answers', description: 'Run representative questions and verify citations against the linked category documents.' },
            { title: 'Test allowed and blocked origins', description: 'Open the embed on an approved domain and confirm an unapproved domain is rejected.' },
            { title: 'Test every enabled input', description: 'Verify text, file upload, voice, authentication, and rate-limit states that the portal exposes.' },
            { title: 'Test responsive behavior', description: 'Check launcher position, keyboard focus, iframe size, mobile viewport, and host-page overlap.' },
            { title: 'Prepare support and analytics', description: 'Assign an owner, document escalation, monitor sessions and errors, and review limits after launch.' },
          ],
        },
      ],
    },
    {
      id: 'workspace-troubleshooting',
      title: 'Workspace troubleshooting',
      summary: 'Resolve common domain, access, rate-limit, formatting, and upload issues.',
      audiences: ['All roles', 'Developer'],
      keywords: ['workspace disabled', 'domain not allowed', '403', '429', 'markdown', 'upload error'],
      blocks: [
        {
          type: 'table',
          headers: ['Issue', 'Resolution'],
          rows: [
            ['Workspace disabled or not found', 'Confirm it is enabled and the generated slug is correct'],
            ['Domain not allowed', 'Add the portal hostname to Allowed Domains and confirm the request Origin'],
            ['User access denied', 'Check category subscriptions or the explicit user list for a Standalone Workspace'],
            ['Rate limit reached', 'Wait for reset or adjust daily and session limits after reviewing abuse risk'],
            ['Formatting is too limited', 'Use the hosted iframe when richer Markdown rendering is required'],
            ['File rejected', 'Check file type, maximum size, upload toggle, and current session state'],
          ],
        },
      ],
    },
  ],
};

const agentBots: HelpTab = {
  id: 'agent-bots',
  label: 'Agent Bots',
  shortLabel: 'Agent Bots',
  description: 'Configure a versioned AI API and connect it securely to forms, portals, automations, and external systems.',
  icon: 'bot',
  sections: [
    {
      id: 'agent-bot-overview',
      title: 'Agent Bot overview',
      summary: 'Agent Bots expose category RAG, tools, file inputs, and generated outputs through a stable programmatic interface.',
      audiences: ['All roles', 'Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['agent bot', 'api', 'rest', 'structured output', 'automation', 'versioned'],
      blocks: [
        {
          type: 'cards',
          items: [
            { title: 'Purpose-built behavior', description: 'Give each bot a focused description, system prompt, input schema, category scope, tools, model settings, and output formats.' },
            { title: 'Versioned configuration', description: 'Test changes in versions, activate approved versions, and select a default without silently changing every integration.' },
            { title: 'Secure invocation', description: 'Issue bot-scoped API keys, apply rate limits, and keep credentials in the calling system backend.' },
            { title: 'Operational workflows', description: 'Run synchronously for small requests or asynchronously with polling or signed webhooks for production jobs.' },
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Workspace or Agent Bot?',
          text: 'Choose a Workspace when people need a ready-made chat interface. Choose an Agent Bot when an application submits structured input and handles the result, file, job status, or webhook itself.',
        },
      ],
    },
    {
      id: 'agent-bot-prerequisites',
      title: 'Before you create an Agent Bot',
      summary: 'Define the workflow contract and prepare trusted knowledge before configuring the API.',
      audiences: ['Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['prerequisites', 'input schema', 'output types', 'categories', 'tools', 'backend'],
      blocks: [
        {
          type: 'list',
          items: [
            'A Superuser with assigned categories, Admin, or Super Admin creates and configures the bot.',
            'Prepare processed documents in the categories the bot is allowed to retrieve from.',
            'Define the caller, business outcome, required and optional input fields, expected outputs, and failure experience.',
            'Enable and test any tools the bot needs, such as web search, data sources, functions, charts, or diagrams.',
            'Identify a trusted backend or automation runtime that can protect the API key.',
            'Choose asynchronous processing for production requests that may search, call tools, or generate files.',
          ],
        },
      ],
    },
    {
      id: 'agent-bot-setup',
      title: 'Create, configure, and activate an Agent Bot',
      summary: 'Build a bot, define its version contract, test it, and activate a default version.',
      audiences: ['Superuser', 'Admin', 'Super Admin'],
      keywords: ['create agent bot', 'version', 'activate', 'default version', 'system prompt', 'output config'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Create the bot', description: 'Open Admin → Agent Bots, select Create Agent Bot, and set a clear name, unique slug, and purpose.' },
            { title: 'Define the input contract', description: 'Add named parameters, types, descriptions, defaults, and required flags. Keep the main request field explicit.' },
            { title: 'Choose outputs', description: 'Enable only needed formats and choose a default, such as text, JSON, Markdown, PDF, DOCX, XLSX, PPTX, image, podcast, chart, or diagram.' },
            { title: 'Write focused instructions', description: 'Specify the role, method, structure, tone, citation rules, constraints, and quality expectations.' },
            { title: 'Link knowledge and tools', description: 'Select permitted categories and the minimum tools needed for the workflow.' },
            { title: 'Configure the model', description: 'Use the global default, Auto selection, or an allowed model override; set temperature, token limits, and source behavior.' },
            { title: 'Save and test the version', description: 'Use realistic input and verify validation, sources, output quality, tool behavior, duration, and failure states.' },
            { title: 'Activate and set default', description: 'Only active versions can serve public calls. Set the approved version as default for callers that do not request one.' },
          ],
        },
      ],
      action: {
        label: 'Open Agent Bots',
        href: '/admin?tab=agents',
        allowedRoles: ['superuser', 'admin', 'super_admin'],
        requirement: 'Requires Superuser, Admin, or Super Admin; Superusers are category-scoped',
      },
    },
    {
      id: 'agent-bot-api-key',
      title: 'Generate and protect an API key',
      summary: 'Treat every bot key as a production secret and expose Agent Bot calls only through trusted server code.',
      audiences: ['Superuser', 'Admin', 'Super Admin', 'Developer'],
      keywords: ['api key', 'ab_pk_', 'authorization', 'bearer', 'secret', 'rotate', 'revoke'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Create a named key', description: 'In the bot API Keys tab, use a name that identifies the environment and calling system.' },
            { title: 'Copy it once', description: 'Keys use the ab_pk_ prefix and the secret is shown only when generated.' },
            { title: 'Store it server-side', description: 'Use a secret manager or protected server environment variable. Never put the key in browser JavaScript, mobile bundles, repositories, logs, or analytics.' },
            { title: 'Rotate and revoke', description: 'Issue a replacement, update the caller, verify traffic, and revoke unused or exposed keys.' },
          ],
        },
        {
          type: 'callout',
          tone: 'security',
          title: 'Do not call Agent Bots directly from a public browser',
          text: 'A browser request exposes its Bearer token to users and browser tooling. Send portal requests to your own trusted backend, then let that backend authenticate to AI Assistant.',
        },
      ],
    },
    {
      id: 'agent-bot-test',
      title: 'Test before integration',
      summary: 'Use the built-in Test tab to verify the version contract and operational behavior before issuing production access.',
      audiences: ['Superuser', 'Admin', 'Super Admin'],
      keywords: ['test tab', 'run test', 'schema validation', 'sources', 'async'],
      blocks: [
        {
          type: 'list',
          items: [
            'Test minimum valid input, typical input, maximum expected input, and invalid types or missing required fields.',
            'Confirm output type, structure, branding, citations, filenames, and download behavior.',
            'Verify category retrieval with questions that should and should not match the linked documents.',
            'Exercise every enabled tool and confirm the bot fails safely when an upstream service is unavailable.',
            'Use asynchronous mode for web research, multiple tool calls, and generated file outputs.',
          ],
        },
      ],
    },
    {
      id: 'agent-bot-integration',
      title: 'Connect an external portal',
      summary: 'Discover the bot contract, invoke asynchronously, track the job, and deliver completed outputs to the user.',
      audiences: ['Admin', 'Super Admin', 'Developer'],
      keywords: ['external portal', 'discovery', 'spec', 'invoke', 'async', 'polling', 'job status', 'download'],
      blocks: [
        {
          type: 'steps',
          items: [
            { title: 'Discover the contract', description: 'Call the specification endpoint with the issued key to obtain the bot identity, input schema, upload rules, output types, and endpoint addresses.' },
            { title: 'Upload optional files', description: 'When enabled, upload files first and include returned file identifiers in the invocation.' },
            { title: 'Invoke asynchronously', description: 'Send validated input, an enabled output type, and async set to true. Store the returned job identifier against the portal request.' },
            { title: 'Track completion', description: 'Poll the job endpoint at a controlled interval or configure a server webhook and verify its HMAC signature.' },
            { title: 'Deliver the result', description: 'Render structured output or retrieve generated files through the authenticated download endpoint.' },
          ],
        },
        {
          type: 'code',
          language: 'javascript',
          label: 'Trusted backend invocation pattern',
          code: "const response = await fetch(\n  `${process.env.AI_ASSISTANT_URL}/api/agent-bots/YOUR-BOT-SLUG/invoke`,\n  {\n    method: 'POST',\n    headers: {\n      Authorization: `Bearer ${process.env.AGENT_BOT_API_KEY}`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({\n      input: { query: 'Create the requested assessment' },\n      outputType: 'docx',\n      async: true,\n    }),\n  }\n);\n\nif (!response.ok) throw new Error('Agent Bot request failed');\nconst { jobId } = await response.json();",
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Production requests should be asynchronous',
          text: 'Synchronous mode blocks until work finishes and can exceed proxy timeouts when a bot searches, calls tools, or creates documents. Explicitly send async as true, then poll or use a webhook.',
        },
      ],
    },
    {
      id: 'agent-bot-production',
      title: 'Production integration checklist',
      summary: 'Protect credentials, verify callbacks, handle limits and retries, and provide clear job states to portal users.',
      audiences: ['Admin', 'Super Admin', 'Developer'],
      keywords: ['production', 'webhook', 'hmac', 'rate limit', 'retry', 'logging', 'retention'],
      blocks: [
        {
          type: 'list',
          items: [
            'Keep API keys and webhook secrets in a managed server-side secret store and define a rotation owner.',
            'Validate portal input before invoking the bot and do not pass untrusted values into URLs or logs.',
            'Respect rate-limit and Retry-After headers; use bounded retries with backoff for transient failures.',
            'Verify webhook signatures before accepting job status or download addresses.',
            'Persist the mapping between portal request, user, bot slug, version, and job identifier.',
            'Show pending, running, completed, failed, and cancelled states with recovery guidance.',
            'Protect output downloads and define retention, deletion, audit, and support procedures.',
            'Monitor duration, success rate, token usage, failed webhooks, and repeated validation errors.',
          ],
        },
      ],
    },
    {
      id: 'agent-bot-troubleshooting',
      title: 'Agent Bot troubleshooting',
      summary: 'Resolve authentication, version, validation, timeout, retrieval, rate-limit, webhook, and output problems.',
      audiences: ['All roles', 'Developer'],
      keywords: ['invalid api key', 'inactive version', 'validation error', '524', '429', 'webhook failed', 'empty rag'],
      blocks: [
        {
          type: 'table',
          headers: ['Issue', 'Resolution'],
          rows: [
            ['Invalid, expired, or revoked key', 'Check the Bearer header and issue or rotate the named bot key'],
            ['Bot or version not found', 'Verify the slug and confirm the requested version is active or a default is set'],
            ['Input validation failed', 'Compare required names and types with the discovery specification'],
            ['Output type not supported', 'Request one of the enabled output types for the selected version'],
            ['Timeout or 524', 'Use async true and poll the job endpoint or configure a webhook'],
            ['Rate limit exceeded', 'Honor Retry-After and rate-limit headers; reduce or schedule request volume'],
            ['Empty RAG result', 'Confirm linked categories contain processed documents relevant to the request'],
            ['Webhook failed', 'Check public HTTPS reachability, signature secret, response time, and server logs'],
            ['Output cannot be downloaded', 'Use the same bot authorization and verify the job, output identifier, and retention window'],
          ],
        },
      ],
    },
  ],
};

export const HELP_TABS: HelpTab[] = [overview, mainChat, workspace, agentBots];

export const HELP_SCHEMA_VERSION = 1;

export function isHelpTabId(value: string | null): value is HelpTabId {
  return HELP_TABS.some((tab) => tab.id === value);
}

export function getHelpTab(id: HelpTabId): HelpTab {
  return HELP_TABS.find((tab) => tab.id === id) ?? HELP_TABS[0];
}

export function getHelpSectionText(section: HelpSection): string {
  const blockText = section.blocks.flatMap((block) => {
    switch (block.type) {
      case 'paragraph':
        return [block.text];
      case 'list':
        return block.items;
      case 'steps':
        return block.items.flatMap((item) => [item.title, item.description]);
      case 'table':
        return [...block.headers, ...block.rows.flat()];
      case 'callout':
        return [block.title, block.text];
      case 'code':
        return [block.label, block.language, block.code];
      case 'cards':
        return block.items.flatMap((item) => [item.title, item.description]);
    }
  });

  return [
    section.title,
    section.summary,
    ...section.audiences,
    ...section.keywords,
    ...blockText,
  ].join(' ');
}
