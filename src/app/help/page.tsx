'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  FileText,
  Image,
  Map,
  Headphones,
  Code,
  Globe,
  Bot,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Search,
  Download,
  Zap,
  Sparkles,
  ArrowRightLeft,
  BarChart3,
  Languages,
  GitBranch,
  Target,
  FolderKanban,
  GraduationCap,
  Plug,
  Activity,
  Code2,
  LayoutTemplate,
  Crosshair,
  Loader2,
  Gauge,
  ShieldCheck,
  Lock,
  Server,
  Cookie,
  Package,
  Building2,
  FileCode,
  Github,
  X,
} from 'lucide-react';

// ============ Interfaces ============

interface ServiceCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  category: string;
  samplePrompt: string;
  magicWords: string[];
  defaultLLM: string;
  fallbackLLM: string;
  minRole: 'user' | 'superuser' | 'admin';
}

interface ToolEntry {
  name: string;
  description: string;
  keywords: string[];
  category: string;
}

// ============ Constants ============

const ROLE_HIERARCHY: Record<string, number> = { user: 0, superuser: 1, admin: 2 };

const TIER_COLORS = {
  1: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  2: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  3: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  4: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  5: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700' },
  6: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', badge: 'bg-cyan-100 text-cyan-700' },
};

const TIER_NAMES: Record<number, string> = {
  1: 'Reporting & Visualisation',
  2: 'Planning',
  3: 'Domain Specific',
  4: 'Integration & Automation',
  5: 'Enterprise Architecture',
  6: 'Cyber Tools',
};

// Platform introduction content
const PLATFORM_INTRO = {
  title: 'AI Assistant Platform Guide',
  tagline: 'An open-source, interoperable AI platform for governments, ministries, and enterprises.',
  whyPlatform: `Governments and organizations face a critical challenge: how to adopt AI responsibly while meeting regulatory requirements for data protection, avoiding dependency on single vendors, and delivering value without building complex ML infrastructure.

AI Assistant solves this by providing:
- **Data Sovereignty** — All data remains on your infrastructure
- **Open Source** — Fully auditable code with no proprietary dependencies
- **Interoperability** — Switch AI providers freely
- **No Lock-In** — Standard databases, portable vector stores, exportable configurations
- **Zero ML Complexity** — Admin dashboard handles all AI configuration
- **Enterprise Security** — Role-based access, department isolation, audit trails`,
  supportedLLMs: [
    { provider: 'OpenAI', models: 'GPT-4.1, GPT-5.x, embeddings' },
    { provider: 'Anthropic', models: 'Claude Sonnet/Haiku/Opus 4.5, 1M context' },
    { provider: 'DeepSeek', models: 'Reasoner, Chat' },
    { provider: 'Mistral', models: 'Large 3, Small 3.2, vision, OCR' },
    { provider: 'Google Gemini', models: '2.5 Pro/Flash, 1M context' },
    { provider: 'Ollama', models: 'Local models (Llama, Qwen, Mistral, Phi)' },
  ],
  aiCapabilities: [
    { capability: 'Embeddings', details: 'OpenAI text-embedding-3-small/large, Gemini, local Transformers.js' },
    { capability: 'Reranking', details: 'BGE cross-encoder (large/base), Cohere API, local bi-encoder' },
    { capability: 'Chunking', details: 'Recursive (configurable size/overlap), Semantic (context-aware)' },
    { capability: 'Transcription', details: 'Whisper (OpenAI), Gemini, local Whisper' },
    { capability: 'Speech-to-Text', details: 'Whisper transcription for audio questions' },
    { capability: 'Text-to-Speech', details: 'OpenAI TTS, Gemini for podcast generation' },
    { capability: 'Vision/Multimodal', details: 'GPT-4.1/5.x, Claude 4.5, Gemini 2.5, Mistral' },
    { capability: 'Image Generation', details: 'DALL-E 3, Gemini Imagen' },
  ],
};

// ============ Helper Components ============

function RoleTag({ role }: { role: 'user' | 'superuser' | 'admin' }) {
  const config = {
    user: { label: 'All Users', className: 'bg-gray-100 text-gray-600' },
    superuser: { label: 'Superuser', className: 'bg-blue-100 text-blue-700' },
    admin: { label: 'Admin', className: 'bg-purple-100 text-purple-700' },
  };
  const { label, className } = config[role];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
      {label}
    </span>
  );
}

function canAccess(
  userRole: 'user' | 'superuser' | 'admin',
  minRole: 'user' | 'superuser' | 'admin'
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

/** Renders **bold** markers in text as <strong> tags safely */
function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ============ Data ============

const ALL_SERVICES: ServiceCard[] = [
  // ── Tier 1 — Reporting & Visualisation ──
  {
    id: 'report-generator',
    icon: <FileText size={20} />,
    title: 'Report Generator as a Service',
    description: 'Generate structured formatted reports from AI analysis and document content. Output: DOCX, PDF, PPTX, XLSX',
    tier: 1,
    category: '—',
    samplePrompt: 'Generate an executive **DOCX/ PDF / MD** report on the state of digital government services in the Caribbean — cover key trends, challenges and recommendations.',
    magicWords: ['create report', 'DOCX', 'PPTX', 'PDF', 'Excel'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'diagram',
    icon: <GitBranch size={20} />,
    title: 'Diagram as a Service',
    description: 'Generate technical and conceptual diagrams — flowcharts, process flows, sequence, mind maps, ERDs, state and class diagrams',
    tier: 1,
    category: '—',
    samplePrompt: 'Create a **flowchart diagram** showing the typical e-government service delivery process — from citizen request to resolution.',
    magicWords: ['flowchart', 'workflow', 'sequence diagram', 'interaction diagram', 'message flow', 'mindmap', 'mind map', 'state diagram', 'state machine', 'lifecycle', 'class diagram', 'er diagram', 'entity relationship', 'wireframe', 'mockup'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'graph',
    icon: <BarChart3 size={20} />,
    title: 'Graph as a Service',
    description: 'Generate data-driven charts from structured inputs or natural language — bar, line, area, stacked, pie, donut, radar, treemap, scatter, waterfall',
    tier: 1,
    category: 'Caribbean AI Survey, Citizen Survey, Grenada Service Feedback',
    samplePrompt: 'Create a **bar chart** comparing the UN E-Government Development Index scores for Caribbean nations in the latest available year.',
    magicWords: ['chart', 'graph', 'pie', 'bar', 'radar', 'stacked bar'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'infographic',
    icon: <Image size={20} />,
    title: 'Infographic as a Service',
    description: 'Auto-generate branded visual summary documents from policy and government content. Output: JPG/SVG',
    tier: 1,
    category: 'Grenada Digital Strategy',
    samplePrompt: 'Create an **infographic/ image** summarising the top 5 benefits of AI adoption in public sector organisations based on current research.',
    magicWords: ['infographic', 'image', 'roadmap infographic'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },

  // ── Tier 2 — Planning ──
  {
    id: 'project-management',
    icon: <FolderKanban size={20} />,
    title: 'Project Management as a Service',
    description: 'Integrated AI project planning with phases, milestones, dependencies and resource tracking',
    tier: 2,
    category: '—',
    samplePrompt: 'Create a full **project plan** for implementing a citizen e-portal.',
    magicWords: ['project plan', 'implementation plan', 'project schedule'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'strategy',
    icon: <Target size={20} />,
    title: 'Strategy as a Service',
    description: 'AI-assisted strategic plan development with objective mapping, KPIs and outcome tracking. Output: DOCX',
    tier: 2,
    category: 'Grenada Digital Strategy',
    samplePrompt: 'Develop an AI adoption **strategy** for a government ministry — include strategic objectives, guiding principles and KPIs for 2026–2028.',
    magicWords: ['strategy'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'roadmap',
    icon: <Map size={20} />,
    title: 'Roadmap as a Service',
    description: 'AI-assisted initiative and milestone planning with timeline generation. Output: PPTX, DOCX',
    tier: 2,
    category: 'Grenada Digital Strategy',
    samplePrompt: 'Build a 3-year digital transformation **roadmap** for a small island government — covering foundation, build and scale phases with estimated budgets.',
    magicWords: ['roadmap'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'work-package-generator',
    icon: <Package size={20} />,
    title: 'Work Package Generator',
    description: 'Generate structured work packages with scope, deliverables, timelines and resource requirements from project briefs',
    tier: 2,
    category: '—',
    samplePrompt: 'Create a **work package** for implementing a new digital identity verification system — include scope, deliverables, milestones, and resource requirements.',
    magicWords: ['work package', 'work breakdown', 'work package generator'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },

  // ── Tier 3 — Domain Specific ──
  {
    id: 'citizen-feedback',
    icon: <Globe size={20} />, // Using Globe as substitute for MessageCircle in help page
    title: 'Citizen Feedback Analyser',
    description: 'AI analysis of citizen feedback at scale — sentiment, themes, priority issues. Output: DOCX, XLSX',
    tier: 3,
    category: 'Grenada Service Feedback',
    samplePrompt: 'What are the top 3 **service feedback** across Grenada government ministries? Show sentiment breakdown and priority issues.',
    magicWords: ['citizen feedback', 'service feedback', 'complaints', 'grievances', 'satisfaction', 'ratings'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'survey',
    icon: <FileText size={20} />,
    title: 'Citizen Survey Analyser',
    description: 'Process and summarise structured and unstructured survey responses with insight extraction. Output: XLSX, DOCX',
    tier: 3,
    category: 'Caribbean AI Survey, Citizen Survey',
    samplePrompt: 'Summarise the key findings from the 2025 Grenada **citizen survey** — include top satisfaction themes and areas needing improvement.',
    magicWords: ['Caribbean AI survey', 'citizen survey', 'citizen survey 2025', 'citizen survey 2026'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'web-search',
    icon: <Globe size={20} />,
    title: 'Web Search',
    description: 'Search the web for current information via Tavily API',
    tier: 2,
    category: 'Research',
    samplePrompt: 'Search the **web** for the latest AI regulations in Caribbean governments for 2025.',
    magicWords: ['search the web', 'look up online', 'find online', 'latest news', 'current information'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },

  // ── Tier 4 — Integration & Automation ──
  {
    id: 'html-render',
    icon: <Code size={20} />,
    title: 'HTML Rendering',
    description: 'Interactive HTML applications and playbooks',
    tier: 4,
    category: 'Development',
    samplePrompt: 'Create an **interactive HTML playbook** for onboarding new staff with clickable sections and forms.',
    magicWords: ['html playbook', 'interactive html', 'html app'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'chatbot-service',
    icon: <Bot size={20} />,
    title: 'ChatBot as a Service',
    description: 'Deploy embeddable or standalone AI chat widgets scoped to specific document categories with custom branding',
    tier: 4,
    category: '—',
    samplePrompt: 'Explain how to set up an embedded AI chatbot for a government ministry website — what steps are needed and what can it answer?',
    magicWords: [],
    defaultLLM: 'GPT-4.1 mini',
    fallbackLLM: 'GPT-4.1',
    minRole: 'superuser',
  },
  {
    id: 'agent-bot',
    icon: <Bot size={20} />,
    title: 'Agent Bot as a Service',
    description: 'Build fully configurable AI agents with defined input/output schemas exposed via REST API with API key auth and webhook callbacks',
    tier: 4,
    category: '—',
    samplePrompt: 'Design an AI agent workflow that accepts a ministry name and automatically produces a digital transformation assessment report.',
    magicWords: [],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'admin',
  },

  // ── Tier 5 — Enterprise Architecture ──
  {
    id: 'architecture-diagram',
    icon: <Building2 size={20} />,
    title: 'Architecture Diagram as a Service',
    description: 'Generate enterprise architecture diagrams — solution architecture, system context, integration maps, and component diagrams aligned to EA frameworks',
    tier: 5,
    category: '—',
    samplePrompt: 'Create a **solution architecture diagram** for a government digital services platform — show key components, integrations, and data flows.',
    magicWords: ['architecture', 'system architecture', 'solution architecture', 'component diagram', 'conceptual', 'logical', 'technical'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'api-specification',
    icon: <FileCode size={20} />,
    title: 'API Specification as a Service',
    description: 'Generate OpenAPI/Swagger specifications, REST API documentation, and integration contracts from natural language descriptions',
    tier: 5,
    category: '—',
    samplePrompt: 'Generate an **OpenAPI specification** for a citizen e-services API — include endpoints for service discovery, application submission, and status tracking.',
    magicWords: ['api specification', 'openapi', 'swagger', 'api design', 'api spec', 'api contract'],
    defaultLLM: 'Claude Sonnet',
    fallbackLLM: 'Claude Haiku',
    minRole: 'user',
  },
  {
    id: 'service-simplification',
    icon: <LayoutTemplate size={20} />,
    title: 'Service Simplification as a Service',
    description: 'AI-assisted service redesign and simplification for improved citizen experience',
    tier: 5,
    category: 'GEA',
    samplePrompt: '**Service simplify**: Identify the top 3 government services that could be simplified or digitised based on EA policy standards and best practices.',
    magicWords: ['Service simplify'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'github-integrator',
    icon: <Github size={20} />,
    title: 'GitHub Integrator',
    description: 'Connect GitHub repositories to AI analysis — review pull requests, analyse code quality, generate documentation and audit repository health',
    tier: 5,
    category: '—',
    samplePrompt: 'Connect to my **GitHub repository** and analyse the code quality — identify key issues, outdated dependencies, and security vulnerabilities.',
    magicWords: ['github', 'github repository', 'github analysis', 'github integration'],
    defaultLLM: 'Claude Sonnet',
    fallbackLLM: 'Claude Haiku',
    minRole: 'user',
  },

  // ── Tier 6 — Cyber Tools ──
  {
    id: 'website-analyser',
    icon: <Activity size={20} />,
    title: 'Website Analyser as a Service',
    description: 'Analyse website performance, accessibility, SEO and best practices using Google Lighthouse',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**Analyse website** https://gea.gov.gd — show Lighthouse scores for performance, accessibility and SEO with priority fixes.',
    magicWords: ['analyse website', 'analyze website'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'code-analyser',
    icon: <Code2 size={20} />,
    title: 'Code Analyser as a Service',
    description: 'Analyse code quality using SonarCloud — bugs, vulnerabilities, code smells and security hotspots',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**Analyse code** in my repository for critical security vulnerabilities, bugs and code smells — prioritise by severity.',
    magicWords: ['analyse code', 'analyze code'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'security-scan',
    icon: <ShieldCheck size={20} />,
    title: 'Security Scan as a Service',
    description: 'Scan website security headers using Mozilla HTTP Observatory — CSP, HSTS, X-Frame-Options',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**Security scan** https://gea.gov.gd — check security headers and show the grade with recommendations.',
    magicWords: ['security scan'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'ssl-scan',
    icon: <Lock size={20} />,
    title: 'SSL Scan as a Service',
    description: 'Analyse SSL/TLS configuration — grades protocol, certificate expiry, cipher strength',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**SSL scan** https://gov.gd — analyse the SSL/TLS configuration and certificate, flag any weaknesses.',
    magicWords: ['ssl scan', 'tls scan', 'certificate check'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'dns-scan',
    icon: <Server size={20} />,
    title: 'DNS Security Scan',
    description: 'Check email authentication and DNS security records — SPF, DMARC, DKIM, DNSSEC',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**DNS scan** gov.gd — check SPF, DMARC, DKIM and DNSSEC records and explain the email spoofing risk.',
    magicWords: ['dns scan', 'dns security', 'spf check', 'dmarc check', 'email security'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'cookie-audit',
    icon: <Cookie size={20} />,
    title: 'Cookie Security Audit',
    description: 'Inspect website cookies for missing security flags — HttpOnly, Secure, SameSite',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**Cookie audit** https://gov.gd — inspect all cookies for missing HttpOnly, Secure, and SameSite flags.',
    magicWords: ['cookie audit', 'cookie security', 'cookie scan'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'redirect-audit',
    icon: <ArrowRightLeft size={20} />,
    title: 'Redirect Chain Audit',
    description: 'Analyse HTTP redirect chain — HTTP to HTTPS upgrade, mixed content, redirect loops',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**Redirect audit** http://gov.gd — follow the redirect chain and check for HTTP to HTTPS upgrade and loops.',
    magicWords: ['redirect audit', 'redirect chain', 'redirect scan'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
  {
    id: 'wcag-audit',
    icon: <Activity size={20} />,
    title: 'WCAG Accessibility Audit',
    description: 'Detailed WCAG 2.1 accessibility audit — maps Lighthouse violations to WCAG criteria',
    tier: 6,
    category: 'Cyber',
    samplePrompt: '**WCAG audit** https://gov.gd — run a detailed accessibility audit and map violations to WCAG 2.1 criteria.',
    magicWords: ['wcag audit', 'accessibility audit', 'wcag scan', 'a11y audit'],
    defaultLLM: 'Claude Haiku',
    fallbackLLM: 'Claude Sonnet',
    minRole: 'user',
  },
];

const TOOLS: ToolEntry[] = [
  { name: 'Web Search', description: 'Searches the web for current information', keywords: ['search the web', 'look up online', 'find online', 'latest news', 'current information'], category: 'Research' },
  { name: 'Document Generation', description: 'Generates formatted reports — PDF, DOCX, Markdown', keywords: ['generate report', 'create pdf', 'docx', 'word document', 'formal document'], category: 'Document' },
  { name: 'Chart Generator', description: 'Generates interactive bar, pie, line, radar, and scatter charts from data', keywords: ['chart', 'graph', 'plot', 'bar chart', 'pie chart', 'line graph', 'histogram'], category: 'Visualisation' },
  { name: 'Diagram Generator', description: 'Generates Mermaid diagrams — flowcharts, sequences, mindmaps, C4 architecture, timelines, block layouts', keywords: ['flowchart', 'workflow', 'sequence diagram', 'mindmap', 'architecture diagram', 'gantt chart', 'class diagram'], category: 'Visualisation' },
  { name: 'Spreadsheet Generator', description: 'Generates Excel spreadsheets (.xlsx)', keywords: ['create spreadsheet', 'make excel', 'xlsx', 'excel file'], category: 'Document' },
  { name: 'Presentation Generator', description: 'Generates PowerPoint presentations (.pptx)', keywords: ['create presentation', 'make slides', 'slide deck', 'powerpoint', 'pptx'], category: 'Document' },
  { name: 'Image Generation', description: 'Generates infographics and images (DALL-E 3 / Gemini)', keywords: ['infographic', 'image', 'roadmap infographic'], category: 'Media' },
  { name: 'Translation', description: 'Translates documents and responses across languages', keywords: ['translate', 'translation'], category: 'Language' },
  { name: 'Podcast Generator', description: 'Generates audio podcasts via text-to-speech', keywords: ['podcast', 'audio', 'tts'], category: 'Media' },
  { name: 'Website Analysis', description: 'Analyses website performance, accessibility and SEO via Google Lighthouse', keywords: ['analyse website', 'analyze website'], category: 'Cyber' },
  { name: 'Code Analysis', description: 'Analyses code quality via SonarCloud — bugs, vulnerabilities, code smells', keywords: ['analyse code', 'analyze code'], category: 'Cyber' },
  { name: 'Security Scan', description: 'Scans website security headers — CSP, HSTS, X-Frame-Options', keywords: ['security scan'], category: 'Cyber' },
  { name: 'SSL Scan', description: 'Analyses SSL/TLS certificate configuration and grades cipher strength', keywords: ['ssl scan', 'tls scan', 'certificate check'], category: 'Cyber' },
  { name: 'DNS Scan', description: 'Checks SPF, DMARC, DKIM and DNSSEC records for email security', keywords: ['dns scan', 'dns security', 'spf check', 'dmarc check'], category: 'Cyber' },
  { name: 'Cookie Audit', description: 'Inspects cookies for missing HttpOnly, Secure, SameSite flags', keywords: ['cookie audit', 'cookie security', 'cookie scan'], category: 'Cyber' },
  { name: 'Redirect Audit', description: 'Analyses HTTP redirect chains for security and SEO issues', keywords: ['redirect audit', 'redirect chain', 'redirect scan'], category: 'Cyber' },
  { name: 'WCAG Accessibility Audit', description: 'Detailed WCAG 2.1 accessibility audit mapped to conformance levels', keywords: ['wcag audit', 'accessibility audit', 'a11y audit'], category: 'Cyber' },
  { name: 'Data Source', description: 'Retrieves data from REST APIs and CSV/Excel uploads with query and filter', keywords: ['data source', 'api data', 'csv import'], category: 'Integration' },
  { name: 'Function API', description: 'Custom function execution for integrations via OpenAI-style schemas', keywords: ['function api', 'custom function'], category: 'Integration' },
  { name: 'YouTube Transcript', description: 'Extracts transcripts from YouTube video URLs', keywords: ['youtube', 'transcript', 'video'], category: 'Media' },
  { name: 'Share Thread', description: 'Shares conversation threads with expiry and download controls', keywords: ['share', 'thread', 'export conversation'], category: 'Utility' },
  { name: 'Send Email', description: 'Sends emails via SendGrid integration', keywords: ['send email', 'email'], category: 'Integration' },
];

// ============ Main Component ============

export default function HelpPage() {
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'capabilities' | 'tools' | 'routes' | 'intro'>('intro');
  const [expandedTiers, setExpandedTiers] = useState<Record<number, boolean>>({ 1: true });
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const userRole = ((session?.user as { role?: 'user' | 'superuser' | 'admin' })?.role) || 'user';

  const toggleTier = (tier: number) => {
    setExpandedTiers((prev) => ({ ...prev, [tier]: !prev[tier] }));
  };

  // Filter services by user role
  const visibleServices = ALL_SERVICES.filter((s) => canAccess(userRole, s.minRole));

  // Search filtering
  const q = searchQuery.toLowerCase().trim();
  const isSearching = q.length > 0;

  const filteredServices = isSearching
    ? visibleServices.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.samplePrompt.toLowerCase().includes(q) ||
          TIER_NAMES[s.tier].toLowerCase().includes(q) ||
          s.magicWords.some((mw) => mw.toLowerCase().includes(q))
      )
    : visibleServices;

  const filteredTools = isSearching
    ? TOOLS.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.keywords.join(' ').toLowerCase().includes(q)
      )
    : TOOLS;

  const totalSearchResults = isSearching ? filteredServices.length + filteredTools.length : 0;

  // ============ Export Functions ============

  const buildExportContent = () => {
    return {
      title: PLATFORM_INTRO.title,
      generatedAt: new Date().toISOString(),
      introduction: {
        tagline: PLATFORM_INTRO.tagline,
        whyPlatform: PLATFORM_INTRO.whyPlatform,
        supportedLLMs: PLATFORM_INTRO.supportedLLMs,
        aiCapabilities: PLATFORM_INTRO.aiCapabilities,
      },
      services: ([1, 2, 3, 4, 5, 6] as const).map((tier) => ({
        tier,
        tierName: TIER_NAMES[tier],
        items: ALL_SERVICES.filter((s) => s.tier === tier && canAccess(userRole, s.minRole)).map((s) => ({
          name: s.title,
          description: s.description,
          category: s.category,
          samplePrompt: s.samplePrompt,
          magicWords: s.magicWords,
          defaultLLM: s.defaultLLM,
          fallbackLLM: s.fallbackLLM,
          minRole: s.minRole,
        })),
      })),
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        keywords: t.keywords,
        category: t.category,
      })),
    };
  };

  const buildMarkdown = (content: ReturnType<typeof buildExportContent>) => {
    const lines: string[] = [];

    lines.push(`# ${content.title}`);
    lines.push('');
    lines.push(`*Generated: ${new Date().toLocaleDateString()}*`);
    lines.push('');
    lines.push(`> ${content.introduction.tagline}`);
    lines.push('');

    lines.push('## Why AI Assistant?');
    lines.push('');
    lines.push(content.introduction.whyPlatform);
    lines.push('');

    lines.push('## Supported LLMs');
    lines.push('');
    lines.push('| Provider | Models |');
    lines.push('|----------|--------|');
    content.introduction.supportedLLMs.forEach((llm) => {
      lines.push(`| ${llm.provider} | ${llm.models} |`);
    });
    lines.push('');

    lines.push('## AI Capabilities');
    lines.push('');
    lines.push('| Capability | Details |');
    lines.push('|------------|---------|');
    content.introduction.aiCapabilities.forEach((cap) => {
      lines.push(`| ${cap.capability} | ${cap.details} |`);
    });
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## Capabilities');
    lines.push('');
    content.services.forEach((tier) => {
      if (tier.items.length === 0) return;
      lines.push(`### Tier ${tier.tier} — ${tier.tierName}`);
      lines.push('');
      tier.items.forEach((service) => {
        lines.push(`#### ${service.name}`);
        lines.push('');
        const categoryText = service.category === '—'
          ? '*This service works across all categories using magic words*'
          : service.category;
        lines.push(`- **Category:** ${categoryText}`);
        lines.push(`- **Description:** ${service.description}`);
        lines.push(`- **Sample Prompt:** ${service.samplePrompt.replace(/\*\*/g, '**')}`);
        const magicWordsText = service.magicWords.length > 0
          ? service.magicWords.join(', ')
          : '—';
        lines.push(`- **Keywords:** ${magicWordsText}`);
        lines.push(`- **Default LLM:** ${service.defaultLLM} | **Fallback:** ${service.fallbackLLM}`);
        lines.push(`- **Access Level:** ${service.minRole === 'user' ? 'All Users' : service.minRole}`);
        lines.push('');
      });
    });
    lines.push('---');
    lines.push('');

    lines.push('## Tools Reference');
    lines.push('');
    lines.push('| Tool | Description | Category |');
    lines.push('|------|-------------|----------|');
    content.tools.forEach((tool) => {
      lines.push(`| ${tool.name} | ${tool.description} | ${tool.category} |`);
    });
    lines.push('');
    lines.push('---');
    lines.push('');

    return lines.join('\n');
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'md' | 'json') => {
    setIsExporting(true);
    setShowExportMenu(false);

    try {
      const content = buildExportContent();

      if (format === 'json') {
        downloadFile(JSON.stringify(content, null, 2), 'ai-assistant-documentation.json', 'application/json');
      } else {
        downloadFile(buildMarkdown(content), 'ai-assistant-documentation.md', 'text/markdown');
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/chat"
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>Back to Chat</span>
            </Link>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Help Documentation</h1>
          <div className="w-24" />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Search */}
        <div className="mb-8">
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search capabilities, tools, keywords..."
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Platform Intro Card */}
        {!isSearching && activeTab === 'intro' && (
          <div className="mb-8 bg-white rounded-xl border border-gray-200 p-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{PLATFORM_INTRO.title}</h2>
              <p className="text-gray-600 text-lg">{PLATFORM_INTRO.tagline}</p>
            </div>

            <div className="prose prose-sm max-w-none mb-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Why AI Assistant?</h3>
                <div className="text-gray-600 whitespace-pre-line text-sm">
                  {PLATFORM_INTRO.whyPlatform}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Supported LLMs</h3>
                <div className="bg-white border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {PLATFORM_INTRO.supportedLLMs.map((llm, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 font-medium text-gray-900">{llm.provider}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{llm.models}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">AI Capabilities</h3>
                <div className="bg-white border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {PLATFORM_INTRO.aiCapabilities.map((cap, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 font-medium text-gray-900">{cap.capability}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{cap.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b mb-6">
          {(['intro', 'capabilities', 'tools', 'routes'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-medium capitalize transition-colors flex items-center gap-2 ${
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab === 'intro' && <span className="flex items-center gap-2"><Sparkles size={16} /> Platform Intro</span>}
              {tab === 'capabilities' && <span className="flex items-center gap-2"><Zap size={16} /> Capabilities</span>}
              {tab === 'tools' && <span className="flex items-center gap-2"><Bot size={16} /> Tools</span>}
              {tab === 'routes' && <span className="flex items-center gap-2"><ArrowRightLeft size={16} /> Routes</span>}
            </button>
          ))}
        </div>

        {/* Search Results */}
        {isSearching && (
          <div className="space-y-6">
            {totalSearchResults === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Search size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No results for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            ) : (
              <>
                {/* Capabilities results */}
                {filteredServices.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Capabilities</span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{filteredServices.length}</span>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                            <th className="text-left px-4 py-2.5 font-medium">Service</th>
                            <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Category</th>
                            <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Sample Prompt</th>
                            <th className="text-right px-4 py-2.5 font-medium">Access</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredServices.map((card, idx) => (
                            <tr
                              key={card.id}
                              className={`hover:bg-gray-50 transition-colors ${idx < filteredServices.length - 1 ? 'border-b border-gray-100' : ''}`}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <span className="p-1.5 rounded-lg shrink-0 bg-gray-100 text-gray-600">{card.icon}</span>
                                  <span className="font-medium text-gray-900">{card.title}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs">
                                {card.category === '—' ? <span className="text-gray-300 italic">Cross-category</span> : card.category}
                              </td>
                              <td className="px-4 py-3 text-gray-600 hidden md:table-cell text-xs leading-relaxed">
                                <InlineBold text={card.samplePrompt} />
                              </td>
                              <td className="px-4 py-3 text-right"><RoleTag role={card.minRole} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tools results */}
                {filteredTools.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tools</span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{filteredTools.length}</span>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                            <th className="text-left px-4 py-2.5 font-medium">Tool</th>
                            <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Description</th>
                            <th className="text-left px-4 py-2.5 font-medium">Keywords</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTools.map((tool, idx) => (
                            <tr key={tool.name} className={`${idx < filteredTools.length - 1 ? 'border-b border-gray-100' : ''}`}>
                              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{tool.name}</td>
                              <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs">{tool.description}</td>
                              <td className="px-4 py-3">
                                {tool.keywords.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {tool.keywords.slice(0, 3).map((kw, i) => (
                                      <span key={i} className="inline-flex px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">{kw}</span>
                                    ))}
                                    {tool.keywords.length > 3 && <span className="text-xs text-gray-400">+{tool.keywords.length - 3}</span>}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400 italic">UI-triggered</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Capabilities Tab Content */}
        {!isSearching && activeTab === 'capabilities' && (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map((tier) => {
              const tierServices = visibleServices.filter((s) => s.tier === tier);
              if (tierServices.length === 0) return null;

              const colors = TIER_COLORS[tier as keyof typeof TIER_COLORS];
              const isExpanded = expandedTiers[tier] ?? false;

              return (
                <div
                  key={tier}
                  className={`rounded-lg border ${colors.border} overflow-hidden`}
                >
                  <button
                    onClick={() => toggleTier(tier)}
                    className={`w-full px-4 py-3 flex items-center justify-between ${colors.bg}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors.badge}`}>
                        Tier {tier}
                      </span>
                      <span className={`font-semibold ${colors.text}`}>
                        {TIER_NAMES[tier]}
                      </span>
                      <span className="text-sm text-gray-500">({tierServices.length})</span>
                    </div>
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>
                  {isExpanded && (
                    <div className="p-4 bg-white">
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                              <th className="text-left px-4 py-2.5 font-medium">Service</th>
                              <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Category</th>
                              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Sample Prompt</th>
                              <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">LLM</th>
                              <th className="text-right px-4 py-2.5 font-medium">Access</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tierServices.map((card, idx) => (
                              <tr
                                key={card.id}
                                className={`hover:bg-gray-50 transition-colors ${idx < tierServices.length - 1 ? 'border-b border-gray-100' : ''}`}
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-start gap-2.5">
                                    <span className={`p-1.5 rounded-lg shrink-0 bg-gray-100 text-gray-600`}>
                                      {card.icon}
                                    </span>
                                    <div>
                                      <span className="font-medium text-gray-900 block">{card.title}</span>
                                      <span className="text-xs text-gray-500 block mt-0.5">{card.description}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs">
                                  {card.category === '—' ? <span className="text-gray-300 italic">Cross-category</span> : card.category}
                                </td>
                                <td className="px-4 py-3 text-gray-600 hidden md:table-cell text-xs leading-relaxed">
                                  <InlineBold text={card.samplePrompt} />
                                </td>
                                <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">
                                  <div><span className="font-medium">Default:</span> {card.defaultLLM}</div>
                                  <div className="text-gray-400"><span className="font-medium">Fallback:</span> {card.fallbackLLM}</div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <RoleTag role={card.minRole} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {/* Mobile: Show magic words */}
                      <div className="sm:hidden mt-4 space-y-3">
                        {tierServices.map((card) => card.magicWords.length > 0 && (
                          <div key={card.id} className="text-xs">
                            <span className="font-medium text-gray-700">{card.title} — Magic Words:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {card.magicWords.map((mw, i) => (
                                <span key={i} className="inline-flex px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{mw}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Tools Tab */}
        {!isSearching && activeTab === 'tools' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Tool</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Description</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 hidden sm:table-cell">Category</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Keywords</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map((tool, idx) => (
                  <tr key={tool.name} className={`border-b last:border-b-0 hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{tool.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{tool.description}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">{tool.category}</td>
                    <td className="px-4 py-3">
                      {tool.keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tool.keywords.slice(0, 4).map((kw, i) => (
                            <span key={i} className="inline-flex px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">{kw}</span>
                          ))}
                          {tool.keywords.length > 4 && <span className="text-xs text-gray-400">+{tool.keywords.length - 4}</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">UI-triggered</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Routes Tab */}
        {!isSearching && activeTab === 'routes' && (
          <div className="space-y-8">
            {/* Route Comparison Table */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Route Comparison — LLM Models & Providers</h3>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs">
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500">Capability</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-purple-700 bg-purple-50">Route 2 — Direct Cloud</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-emerald-700 bg-emerald-50">Route 3 — Ollama Local</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Connection</td>
                      <td className="px-4 py-2.5 text-gray-600">Direct SDK / API</td>
                      <td className="px-4 py-2.5 text-gray-600">Local Ollama server</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Default</td>
                      <td className="px-4 py-2.5 text-gray-600">Enabled (Primary)</td>
                      <td className="px-4 py-2.5 text-gray-600">Disabled</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Air-gapped</td>
                      <td className="px-4 py-2.5 text-gray-600">No</td>
                      <td className="px-4 py-2.5 text-gray-600">No</td>
                      <td className="px-4 py-2.5 text-gray-600">Yes</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">API cost</td>
                      <td className="px-4 py-2.5 text-gray-600">Per-token (cloud)</td>
                      <td className="px-4 py-2.5 text-gray-600">Per-token (cloud)</td>
                      <td className="px-4 py-2.5 text-gray-600">Free (local compute)</td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-700">LLM Models</td>
                      <td className="px-4 py-2.5 text-gray-600">OpenAI (GPT-4.1, GPT-5 families), Google (Gemini 2.5, 3), Mistral (Large, Medium)</td>
                      <td className="px-4 py-2.5 text-gray-600">Anthropic (Claude Opus, Sonnet, Haiku), Fireworks (MiniMax M2.5, Kimi K2.5), Moonshot (Kimi K2.5, v1)</td>
                      <td className="px-4 py-2.5 text-gray-600">Ollama (Llama 3.2, Qwen3, GPT-OSS 20B)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Embedding</td>
                      <td className="px-4 py-2.5 text-gray-600">OpenAI (text-embedding-3-large/small), Mistral (mistral-embed), Google (text-embedding-004)</td>
                      <td className="px-4 py-2.5 text-gray-600">Fireworks (nomic-embed-text-v1.5, qwen3-embedding-8b)</td>
                      <td className="px-4 py-2.5 text-gray-600">Local (mxbai-embed-large, bge-m3)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Reranker</td>
                      <td className="px-4 py-2.5 text-gray-400 italic">—</td>
                      <td className="px-4 py-2.5 text-gray-600">Cohere, Fireworks</td>
                      <td className="px-4 py-2.5 text-gray-600">Local (BGE-Large, BGE-Base, Transformers.js)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Doc Extraction</td>
                      <td className="px-4 py-2.5 text-gray-600">Mistral OCR 4 (online)</td>
                      <td className="px-4 py-2.5 text-gray-600">Azure Document Intelligence (online)</td>
                      <td className="px-4 py-2.5 text-gray-600">PDF-Parse (local, built-in)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">STT</td>
                      <td className="px-4 py-2.5 text-gray-600">OpenAI Whisper, Gemini STT, Mistral Voxtral</td>
                      <td className="px-4 py-2.5 text-gray-600">Fireworks Whisper v3-turbo</td>
                      <td className="px-4 py-2.5 text-gray-400 italic">—</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">TTS</td>
                      <td className="px-4 py-2.5 text-gray-600">OpenAI gpt-4o-mini-tts, Gemini 2.5 Flash/Pro TTS (multi-speaker)</td>
                      <td className="px-4 py-2.5 text-gray-400 italic">—</td>
                      <td className="px-4 py-2.5 text-gray-400 italic">—</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Image Gen</td>
                      <td className="px-4 py-2.5 text-gray-600">OpenAI DALL-E 3, Google Imagen 3</td>
                      <td className="px-4 py-2.5 text-gray-400 italic">—</td>
                      <td className="px-4 py-2.5 text-gray-400 italic">—</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-gray-700">Web Search</td>
                      <td className="px-4 py-2.5 text-gray-600">Tavily (independent)</td>
                      <td className="px-4 py-2.5 text-gray-600">Tavily (independent)</td>
                      <td className="px-4 py-2.5 text-gray-600">Tavily (independent)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">All LLM models across all 3 routes support tool calling. Fallback: if primary route fails (rate limit, auth error), the system automatically tries enabled fallback routes.</p>
            </div>

            {/* Tools Available Table */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Tools Available (All Routes)</h3>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                      <th className="text-left px-4 py-2.5 font-semibold">Tool</th>
                      <th className="text-left px-4 py-2.5 font-semibold hidden sm:table-cell">Description</th>
                      <th className="text-left px-4 py-2.5 font-semibold">Requires</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {[
                      { tool: 'Web Search', desc: 'Search the web for current information', requires: 'Tavily API key' },
                      { tool: 'Document Generation', desc: 'PDF, DOCX, Markdown reports', requires: 'Tool-capable LLM' },
                      { tool: 'Chart Generator', desc: 'Bar, pie, line, radar, scatter charts', requires: 'Tool-capable LLM' },
                      { tool: 'Diagram Generator', desc: 'Flowcharts, mindmaps, sequences, ER, class, architecture', requires: 'Tool-capable LLM' },
                      { tool: 'Spreadsheet Generator', desc: 'Excel spreadsheets (.xlsx)', requires: 'Tool-capable LLM' },
                      { tool: 'Presentation Generator', desc: 'PowerPoint presentations (.pptx)', requires: 'Tool-capable LLM' },
                      { tool: 'Image Generation', desc: 'Infographics and images', requires: 'OpenAI or Gemini API key' },
                      { tool: 'Translation', desc: 'Multi-language document translation', requires: 'Tool-capable LLM' },
                      { tool: 'Podcast Generator', desc: 'Audio podcasts via TTS', requires: 'OpenAI or Gemini API key' },
                      { tool: 'Website Analysis', desc: 'Lighthouse performance, accessibility, SEO', requires: 'Tool-capable LLM' },
                      { tool: 'Code Analysis', desc: 'SonarCloud quality — bugs, vulnerabilities, smells', requires: 'Tool-capable LLM' },
                      { tool: 'Security Scan', desc: 'HTTP Observatory security headers', requires: 'Tool-capable LLM' },
                      { tool: 'SSL Scan', desc: 'SSL/TLS certificate analysis', requires: 'Tool-capable LLM' },
                      { tool: 'DNS Scan', desc: 'SPF, DMARC, DKIM, DNSSEC', requires: 'Tool-capable LLM' },
                      { tool: 'Cookie Audit', desc: 'HttpOnly, Secure, SameSite flags', requires: 'Tool-capable LLM' },
                      { tool: 'Redirect Audit', desc: 'HTTP redirect chain analysis', requires: 'Tool-capable LLM' },
                      { tool: 'WCAG Audit', desc: 'WCAG 2.1 accessibility conformance', requires: 'Tool-capable LLM' },
                      { tool: 'Data Source', desc: 'REST API and CSV/Excel queries', requires: 'Tool-capable LLM' },
                      { tool: 'Function API', desc: 'Custom function execution', requires: 'Tool-capable LLM' },
                      { tool: 'YouTube Transcript', desc: 'Extract transcripts from videos', requires: 'Tool-capable LLM' },
                      { tool: 'Share Thread', desc: 'Share conversations with expiry', requires: 'Tool-capable LLM' },
                      { tool: 'Send Email', desc: 'Email via SendGrid', requires: 'SendGrid API key' },
                    ].map((row) => (
                      <tr key={row.tool} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{row.tool}</td>
                        <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell">{row.desc}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                            row.requires === 'Tool-capable LLM'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {row.requires}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Quick Export */}
        <div className="mt-12 p-6 bg-white rounded-lg border">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Download size={20} />
            Export Documentation
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Download this documentation for offline reference or sharing.
          </p>
          <div className="flex gap-3">
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {isExporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                Export
                <ChevronDown size={14} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
              </button>
              {showExportMenu && (
                <div className="absolute top-full mt-2 left-0 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px] z-10">
                  <button
                    onClick={() => handleExport('md')}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
                  >
                    <FileText size={16} className="text-gray-600" />
                    Markdown (.md)
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
                  >
                    <Code size={16} className="text-green-600" />
                    JSON (.json)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
