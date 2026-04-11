'use client';

import { useState } from 'react';
import {
  Zap,
  Globe,
  Bot,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Languages,
  Image,
  Map,
  MessageCircle,
  ClipboardList,
  Sparkles,
  DollarSign,
  FileText,
  GitBranch,
  Target,
  FolderKanban,
  GraduationCap,
  Headphones,
  Plug,
  X,
  Activity,
  Code2,
  LayoutTemplate,
  Crosshair,
  Download,
  Loader2,
  Gauge,
  ShieldCheck,
  Lock,
  Server,
  Cookie,
  ArrowRightLeft,
  Package,
  Building2,
  FileCode,
  Github,
  Search,
} from 'lucide-react';

// ============ Interfaces ============

interface WelcomeScreenProps {
  userRole: 'user' | 'superuser' | 'admin';
  brandingName: string;
  onNewThread?: () => void;
}

interface ServiceCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  minRole: 'user' | 'superuser' | 'admin';
  colorClass: string;
  iconBgClass: string;
  category: string;
  samplePrompt: string;
  magicWords: string[];
  defaultLLM: string;
  fallbackLLM: string;
}

interface ToolEntry {
  name: string;
  description: string;
  keywords: string[];
}

// ============ Constants ============

const ROLE_HIERARCHY = { user: 0, superuser: 1, admin: 2 };

const TIER_COLORS = {
  1: { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700' },
  2: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  3: { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  badge: 'bg-amber-100 text-amber-700' },
  4: { bg: 'bg-emerald-50',border: 'border-emerald-200',text: 'text-emerald-700',badge: 'bg-emerald-100 text-emerald-700' },
  5: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700' },
  6: { bg: 'bg-cyan-50',   border: 'border-cyan-200',   text: 'text-cyan-700',   badge: 'bg-cyan-100 text-cyan-700' },
};

const TIER_NAMES = {
  1: 'Reporting & Visualisation',
  2: 'Planning',
  3: 'Domain Specific',
  4: 'Integration & Automation',
  5: 'Enterprise Architecture',
  6: 'Cyber Tools',
};

// Platform introduction content (from README.md)
const PLATFORM_INTRO = {
  title: 'AI Assistant Platform Guide',
  tagline: 'An open-source, interoperable AI platform for governments, ministries, and enterprises.',
  whyPolicyBot: `Governments and organizations face a critical challenge: how to adopt AI responsibly while meeting regulatory requirements for data protection, avoiding dependency on single vendors, and delivering value without building complex ML infrastructure.

Policy Bot solves this by providing:
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

function canAccess(
  userRole: 'user' | 'superuser' | 'admin',
  minRole: 'user' | 'superuser' | 'admin'
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

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

export default function WelcomeScreen({
  userRole,
  brandingName,
  onNewThread,
}: WelcomeScreenProps) {
  const [collapsedTiers, setCollapsedTiers] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'capabilities' | 'tools' | 'routes'>('capabilities');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleTier = (tier: number) => {
    setCollapsedTiers(prev => {
      const next = new Set(prev);
      next.has(tier) ? next.delete(tier) : next.add(tier);
      return next;
    });
  };

  // ============ Export Functions ============

  const buildExportContent = () => {
    return {
      title: PLATFORM_INTRO.title,
      generatedAt: new Date().toISOString(),
      introduction: {
        tagline: PLATFORM_INTRO.tagline,
        whyPolicyBot: PLATFORM_INTRO.whyPolicyBot,
        supportedLLMs: PLATFORM_INTRO.supportedLLMs,
        aiCapabilities: PLATFORM_INTRO.aiCapabilities,
      },
      services: ([1, 2, 3, 4, 5, 6] as const).map((tier) => ({
        tier,
        tierName: TIER_NAMES[tier],
        items: serviceCards
          .filter((s) => s.tier === tier)
          .map((s) => ({
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
      tools: toolsList.map((t) => ({
        name: t.name,
        description: t.description,
        keywords: t.keywords,
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

    lines.push('## Why Policy Bot?');
    lines.push('');
    lines.push(content.introduction.whyPolicyBot);
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
    lines.push('| Tool | Description | Keywords |');
    lines.push('|------|-------------|----------|');
    content.tools.forEach((tool) => {
      const keywords = tool.keywords.length > 0 ? tool.keywords.join(', ') : '—';
      lines.push(`| ${tool.name} | ${tool.description} | ${keywords} |`);
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

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'md' | 'docx' | 'json') => {
    setIsExporting(true);
    setShowExportMenu(false);

    try {
      const content = buildExportContent();

      if (format === 'json') {
        downloadFile(JSON.stringify(content, null, 2), 'platform-guide.json', 'application/json');
      } else if (format === 'md') {
        downloadFile(buildMarkdown(content), 'platform-guide.md', 'text/markdown');
      } else {
        const markdownContent = buildMarkdown(content);
        const response = await fetch('/api/welcome/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdownContent,
            title: 'AI Assistant Platform Guide',
          }),
        });
        if (response.ok) {
          const blob = await response.blob();
          downloadBlob(blob, 'platform-guide.docx');
        } else {
          console.error('DOCX export failed:', await response.text());
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // ============ Tools Data ============

  const toolsList: ToolEntry[] = [
    { name: 'Web Search', description: 'Searches the web for current information', keywords: ['search the web', 'look up online', 'find online', 'latest news', 'current information'] },
    { name: 'Document Generation', description: 'Generates formatted reports — PDF, DOCX, Markdown', keywords: ['generate report', 'create pdf', 'docx', 'word document', 'formal document'] },
    { name: 'Chart Generator', description: 'Generates interactive bar, pie, line, radar, and scatter charts from data', keywords: ['chart', 'graph', 'plot', 'bar chart', 'pie chart', 'line graph', 'histogram'] },
    { name: 'Diagram Generator', description: 'Generates Mermaid diagrams — flowcharts, sequences, mindmaps, C4 architecture, timelines, block layouts, quadrant charts, ER, class, state, gantt, journey, pie (18 types)', keywords: ['flowchart', 'workflow', 'sequence diagram', 'mindmap', 'architecture diagram', 'infrastructure diagram', 'gantt chart', 'class diagram', 'ER diagram', 'state diagram', 'state machine', 'timeline', 'block diagram', 'quadrant chart', 'priority matrix', 'user journey', 'c4 diagram', 'c4 container', 'c4 component', 'c4 deployment'] },
    { name: 'Spreadsheet Generator', description: 'Generates Excel spreadsheets (.xlsx)', keywords: ['create spreadsheet', 'make excel', 'xlsx', 'excel file', 'export to excel'] },
    { name: 'Presentation Generator', description: 'Generates PowerPoint presentations (.pptx)', keywords: ['create presentation', 'make slides', 'slide deck', 'powerpoint', 'pptx'] },
    { name: 'Image Generation', description: 'Generates infographics and images (DALL-E 3 / Gemini)', keywords: ['infographic', 'image', 'roadmap infographic'] },
    { name: 'Translation', description: 'Translates documents and responses across languages', keywords: [] },
    { name: 'Podcast Generator', description: 'Generates audio podcasts via text-to-speech', keywords: [] },
    { name: 'Website Analysis', description: 'Analyses website performance, accessibility and SEO via Google Lighthouse', keywords: ['analyse website', 'analyze website'] },
    { name: 'Code Analysis', description: 'Analyses code quality via SonarCloud — bugs, vulnerabilities, code smells', keywords: ['analyse code', 'analyze code'] },
    { name: 'Load Testing', description: 'Runs load tests against web endpoints using k6 Cloud', keywords: ['load test'] },
    { name: 'Security Scan', description: 'Scans website security headers — CSP, HSTS, X-Frame-Options, cookies', keywords: ['security scan'] },
    { name: 'SSL Scan', description: 'Analyses SSL/TLS certificate configuration and grades cipher strength', keywords: ['ssl scan', 'tls scan', 'certificate check'] },
    { name: 'DNS Scan', description: 'Checks SPF, DMARC, DKIM and DNSSEC records for email security', keywords: ['dns scan', 'dns security', 'spf check', 'dmarc check'] },
    { name: 'Cookie Audit', description: 'Inspects cookies for missing HttpOnly, Secure, SameSite flags', keywords: ['cookie audit', 'cookie security', 'cookie scan'] },
    { name: 'Redirect Audit', description: 'Analyses HTTP redirect chains for security and SEO issues', keywords: ['redirect audit', 'redirect chain', 'redirect scan'] },
    { name: 'WCAG Accessibility Audit', description: 'Detailed WCAG 2.1 accessibility audit mapped to conformance levels (A/AA/AAA)', keywords: ['wcag audit', 'accessibility audit', 'a11y audit'] },
    { name: 'Data Source', description: 'Retrieves data from REST APIs and CSV/Excel uploads with query and filter', keywords: [] },
    { name: 'Function API', description: 'Custom function execution for integrations via OpenAI-style schemas', keywords: [] },
    { name: 'YouTube', description: 'Extracts transcripts from YouTube video URLs', keywords: [] },
    { name: 'Share Thread', description: 'Shares conversation threads with expiry and download controls', keywords: [] },
    { name: 'Send Email', description: 'Sends emails via SendGrid integration', keywords: [] },
  ];

  // ============ Service Cards ============

  const serviceCards: ServiceCard[] = [
    // ── Tier 1 — Reporting & Visualisation ──
    { id: 'report-generator', icon: <FileText size={24} />, title: 'Report Generator as a Service', description: 'Generate structured formatted reports from AI analysis and document content. Output: DOCX, PDF, PPTX, XLSX', tier: 1, minRole: 'user', colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md', iconBgClass: 'bg-blue-100 text-blue-600', category: '—', samplePrompt: 'Generate an executive **DOCX/ PDF / MD** report on the state of digital government services in the Caribbean — cover key trends, challenges and recommendations.', magicWords: ['create report', 'DOCX', 'PPTX', 'PDF', 'Excel'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'diagram', icon: <GitBranch size={24} />, title: 'Diagram as a Service', description: 'Generate technical and conceptual diagrams — flowcharts, process flows, sequence, mind maps, ERDs, state and class diagrams', tier: 1, minRole: 'user', colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md', iconBgClass: 'bg-blue-100 text-blue-600', category: '—', samplePrompt: 'Create a **flowchart diagram** showing the typical e-government service delivery process — from citizen request to resolution.', magicWords: ['flowchart', 'workflow', 'sequence diagram', 'interaction diagram', 'message flow', 'mindmap', 'mind map', 'state diagram', 'state machine', 'lifecycle', 'class diagram', 'er diagram', 'entity relationship', 'wireframe', 'mockup'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'graph', icon: <BarChart3 size={24} />, title: 'Graph as a Service', description: 'Generate data-driven charts from structured inputs or natural language — bar, line, area, stacked, pie, donut, radar, treemap, scatter, waterfall', tier: 1, minRole: 'user', colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md', iconBgClass: 'bg-blue-100 text-blue-600', category: 'Caribbean AI Survey, Citizen Survey, Grenada Service Feedback', samplePrompt: 'Create a **bar chart** comparing the UN E-Government Development Index scores for Caribbean nations in the latest available year.', magicWords: ['chart', 'graph', 'pie', 'bar', 'radar', 'stacked bar'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'infographic', icon: <Image size={24} />, title: 'Infographic as a Service', description: 'Auto-generate branded visual summary documents from policy and government content. Output: JPG/SVG', tier: 1, minRole: 'user', colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md', iconBgClass: 'bg-blue-100 text-blue-600', category: 'Grenada Digital Strategy', samplePrompt: 'Create an **infographic/ image** summarising the top 5 benefits of AI adoption in public sector organisations based on current research.', magicWords: ['infographic', 'image', 'roadmap infographic'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },

    // ── Tier 2 — Planning ──
    { id: 'project-management', icon: <FolderKanban size={24} />, title: 'Project Management as a Service', description: 'Integrated AI project planning with phases, milestones, dependencies and resource tracking', tier: 2, minRole: 'user', colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md', iconBgClass: 'bg-purple-100 text-purple-600', category: '—', samplePrompt: 'Create a full **project plan** for implementing a citizen e-portal.', magicWords: ['project plan', 'implementation plan', 'project schedule'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'strategy', icon: <Target size={24} />, title: 'Strategy as a Service', description: 'AI-assisted strategic plan development with objective mapping, KPIs and outcome tracking. Output: DOCX', tier: 2, minRole: 'user', colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md', iconBgClass: 'bg-purple-100 text-purple-600', category: 'Grenada Digital Strategy', samplePrompt: 'Develop an AI adoption **strategy** for a government ministry — include strategic objectives, guiding principles and KPIs for 2026–2028.', magicWords: ['strategy'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'roadmap', icon: <Map size={24} />, title: 'Roadmap as a Service', description: 'AI-assisted initiative and milestone planning with timeline generation. Output: PPTX, DOCX', tier: 2, minRole: 'user', colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md', iconBgClass: 'bg-purple-100 text-purple-600', category: 'Grenada Digital Strategy', samplePrompt: 'Build a 3-year digital transformation **roadmap** for a small island government — covering foundation, build and scale phases with estimated budgets.', magicWords: ['roadmap'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'work-package-generator', icon: <Package size={24} />, title: 'Work Package Generator', description: 'Generate structured work packages with scope, deliverables, timelines and resource requirements from project briefs', tier: 2, minRole: 'user', colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md', iconBgClass: 'bg-purple-100 text-purple-600', category: '—', samplePrompt: 'Create a **work package** for implementing a new digital identity verification system — include scope, deliverables, milestones, and resource requirements.', magicWords: ['work package', 'work breakdown', 'work package generator'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },

    // ── Tier 3 — Domain Specific ──
    { id: 'citizen-feedback', icon: <MessageCircle size={24} />, title: 'Citizen Feedback Analyser', description: 'AI analysis of citizen feedback at scale — sentiment, themes, priority issues. Output: DOCX, XLSX', tier: 3, minRole: 'user', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: 'Grenada Service Feedback', samplePrompt: 'What are the top 3 **service feedback** across Grenada government ministries? Show sentiment breakdown and priority issues.', magicWords: ['citizen feedback', 'service feedback', 'complaints', 'grievances', 'satisfaction', 'ratings'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'survey', icon: <ClipboardList size={24} />, title: 'Citizen Survey Analyser', description: 'Process and summarise structured and unstructured survey responses with insight extraction. Output: XLSX, DOCX', tier: 3, minRole: 'user', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: 'Caribbean AI Survey, Citizen Survey', samplePrompt: 'Summarise the key findings from the 2025 Grenada **citizen survey** — include top satisfaction themes and areas needing improvement.', magicWords: ['Caribbean AI survey', 'citizen survey', 'citizen survey 2025', 'citizen survey 2026'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'compensation', icon: <DollarSign size={24} />, title: 'Pay Grade & Compensation Review', description: 'Benchmark and analyse compensation structures, grade bands and pay equity. Output: XLSX, DOCX', tier: 3, minRole: 'user', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: 'Compensation review', samplePrompt: 'Run a **compensation review** for Trinidad and Tobago.', magicWords: ['compensation review', 'salary review', 'pay review', 'remuneration review', 'benchmark salaries', 'compensation rating'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'soe-assessment', icon: <Building2 size={24} />, title: 'SOE Assessment & Transformation', description: 'Comprehensive 6-dimension health index assessment for state-owned enterprises — financial, operational, governance, staffing, strategic alignment, risk', tier: 3, minRole: 'user', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: 'Trinidad, TT SOE, Grenada', samplePrompt: '**Evaluate SOE** — run a 6-dimension health index assessment for a state-owned enterprise.', magicWords: ['evaluate SOE'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'training', icon: <GraduationCap size={24} />, title: 'Change Support', description: 'AI-powered onboarding and training via conversational chatbots grounded in SOPs and organisational documents', tier: 3, minRole: 'user', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: 'Change, GOG Change', samplePrompt: 'What **change readiness** training resources are available for ministry staff? Summarise key modules and recommended learning paths.', magicWords: ['change readiness', 'stakeholder impact', 'role clarity', 'change execution', 'decision clarity', 'legitimacy'], defaultLLM: 'GPT-4.1 mini', fallbackLLM: 'GPT-4.1' },
    { id: 'customer-support', icon: <Headphones size={24} />, title: 'Citizen & Customer Support as a Service', description: 'Embeddable AI chatbots scoped to an entity\'s documents, services and policies for always-on public support', tier: 3, minRole: 'superuser', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: '—', samplePrompt: 'What are the most common questions citizens ask about filing taxes in Grenada? Show top FAQs with answers. **IRD tax flow** for income tax.', magicWords: ['IRD tax flow for [tax type]'], defaultLLM: 'GPT-4.1 mini', fallbackLLM: 'GPT-4.1' },
    { id: 'translation', icon: <Languages size={24} />, title: 'Translation as a Service', description: 'Multi-language AI translation of documents, responses and live communications for multilingual environments. Output: DOCX', tier: 3, minRole: 'user', colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md', iconBgClass: 'bg-amber-100 text-amber-600', category: '—', samplePrompt: '**Translate** the following government policy excerpt into Spanish, then provide a plain-language English summary for a public audience.', magicWords: ['translate', 'translation', 'translate to', 'multilingual'], defaultLLM: '-', fallbackLLM: '-' },

    // ── Tier 4 — Integration & Automation ──
    { id: 'chatbot-service', icon: <Globe size={24} />, title: 'ChatBot as a Service', description: 'Deploy embeddable or standalone AI chat widgets scoped to specific document categories with custom branding', tier: 4, minRole: 'superuser', colorClass: 'border-emerald-200 hover:border-emerald-300 hover:shadow-md', iconBgClass: 'bg-emerald-100 text-emerald-600', category: '—', samplePrompt: 'Explain how to set up an embedded AI chatbot for a government ministry website — what steps are needed and what can it answer?', magicWords: [], defaultLLM: 'GPT-4.1 mini', fallbackLLM: 'GPT-4.1' },
    { id: 'agent-bot', icon: <Bot size={24} />, title: 'Agent Bot as a Service', description: 'Build fully configurable AI agents with defined input/output schemas exposed via REST API with API key auth and webhook callbacks', tier: 4, minRole: 'admin', colorClass: 'border-emerald-200 hover:border-emerald-300 hover:shadow-md', iconBgClass: 'bg-emerald-100 text-emerald-600', category: '—', samplePrompt: 'Design an AI agent workflow that accepts a ministry name and automatically produces a digital transformation assessment report.', magicWords: [], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'data-integration', icon: <Plug size={24} />, title: 'Data Integration as a Service', description: 'Connect AI to external data sources — REST APIs with OpenAPI import and CSV/Excel uploads — with query, filter and aggregation', tier: 4, minRole: 'superuser', colorClass: 'border-emerald-200 hover:border-emerald-300 hover:shadow-md', iconBgClass: 'bg-emerald-100 text-emerald-600', category: '—', samplePrompt: 'What are the best practices for connecting a government HR system to an AI assistant via REST API — what data should be exposed and what should be kept restricted?', magicWords: [], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },

    // ── Tier 5 — Enterprise Architecture ──
    { id: 'architecture-diagram', icon: <Building2 size={24} />, title: 'Architecture Diagram as a Service', description: 'Generate enterprise architecture diagrams — solution architecture, system context, integration maps, and component diagrams aligned to EA frameworks', tier: 5, minRole: 'user', colorClass: 'border-indigo-200 hover:border-indigo-300 hover:shadow-md', iconBgClass: 'bg-indigo-100 text-indigo-600', category: '—', samplePrompt: 'Create a **solution architecture diagram** for a government digital services platform — show key components, integrations, and data flows.', magicWords: ['architecture', 'system architecture', 'solution architecture', 'component diagram', 'conceptual', 'logical', 'technical'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'api-specification', icon: <FileCode size={24} />, title: 'API Specification as a Service', description: 'Generate OpenAPI/Swagger specifications, REST API documentation, and integration contracts from natural language descriptions', tier: 5, minRole: 'user', colorClass: 'border-indigo-200 hover:border-indigo-300 hover:shadow-md', iconBgClass: 'bg-indigo-100 text-indigo-600', category: '—', samplePrompt: 'Generate an **OpenAPI specification** for a citizen e-services API — include endpoints for service discovery, application submission, and status tracking.', magicWords: ['api specification', 'openapi', 'swagger', 'api design', 'api spec', 'api contract'], defaultLLM: 'Claude Sonnet', fallbackLLM: 'Claude Haiku' },
    { id: 'service-simplification', icon: <LayoutTemplate size={24} />, title: 'Service Simplification as a Service', description: 'AI-assisted service redesign and simplification for improved citizen experience', tier: 5, minRole: 'user', colorClass: 'border-indigo-200 hover:border-indigo-300 hover:shadow-md', iconBgClass: 'bg-indigo-100 text-indigo-600', category: 'GEA', samplePrompt: '**Service simplify**: Identify the top 3 government services that could be simplified or digitised based on EA policy standards and best practices.', magicWords: ['Service simplify'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'github-integrator', icon: <Github size={24} />, title: 'GitHub Integrator', description: 'Connect GitHub repositories to AI analysis — review pull requests, analyse code quality, generate documentation and audit repository health', tier: 5, minRole: 'user', colorClass: 'border-indigo-200 hover:border-indigo-300 hover:shadow-md', iconBgClass: 'bg-indigo-100 text-indigo-600', category: '—', samplePrompt: 'Connect to my **GitHub repository** and analyse the code quality — identify key issues, outdated dependencies, and security vulnerabilities.', magicWords: ['github', 'github repository', 'github analysis', 'github integration'], defaultLLM: 'Claude Sonnet', fallbackLLM: 'Claude Haiku' },

    // ── Tier 6 — Cyber Tools ──
    { id: 'website-analyser', icon: <Activity size={24} />, title: 'Website Analyser as a Service', description: 'Analyse website performance, accessibility, SEO and best practices using Google Lighthouse', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Analyse website** https://gea.gov.gd — show Lighthouse scores for performance, accessibility and SEO with priority fixes.', magicWords: ['analyse website', 'analyze website'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'code-analyser', icon: <Code2 size={24} />, title: 'Code Analyser as a Service', description: 'Analyse code quality using SonarCloud — bugs, vulnerabilities, code smells and security hotspots', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Analyse code** in my repository for critical security vulnerabilities, bugs and code smells — prioritise by severity.', magicWords: ['analyse code', 'analyze code'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'gap-spotter', icon: <Crosshair size={24} />, title: 'GapSpotter as a Service', description: 'Review cyber policy and audit documents to check alignment with ISO, NIST standards', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Gap Spotter** — review the uploaded document against ISO27001 standards and suggest audit findings.', magicWords: ['gap spotter'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'load-testing', icon: <Gauge size={24} />, title: 'Load Testing as a Service', description: 'Run load tests against web endpoints using k6 Cloud — response times, throughput and error rates', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Load test** https://gea.gov.gd — run a load test with 10 concurrent users for 30 seconds and show performance metrics.', magicWords: ['load test'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'security-scan', icon: <ShieldCheck size={24} />, title: 'Security Scan as a Service', description: 'Scan website security headers using Mozilla HTTP Observatory — CSP, HSTS, X-Frame-Options', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Security scan** https://gea.gov.gd — check security headers and show the grade with recommendations.', magicWords: ['security scan'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'ssl-scan', icon: <Lock size={24} />, title: 'SSL Scan as a Service', description: 'Analyse SSL/TLS configuration — grades protocol, certificate expiry, cipher strength', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**SSL scan** https://gov.gd — analyse the SSL/TLS configuration and certificate, flag any weaknesses.', magicWords: ['ssl scan', 'tls scan', 'certificate check'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'dns-scan', icon: <Server size={24} />, title: 'DNS Security Scan', description: 'Check email authentication and DNS security records — SPF, DMARC, DKIM, DNSSEC', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**DNS scan** gov.gd — check SPF, DMARC, DKIM and DNSSEC records and explain the email spoofing risk.', magicWords: ['dns scan', 'dns security', 'spf check', 'dmarc check', 'email security'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'cookie-audit', icon: <Cookie size={24} />, title: 'Cookie Security Audit', description: 'Inspect website cookies for missing security flags — HttpOnly, Secure, SameSite', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Cookie audit** https://gov.gd — inspect all cookies for missing HttpOnly, Secure, and SameSite flags.', magicWords: ['cookie audit', 'cookie security', 'cookie scan'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'redirect-audit', icon: <ArrowRightLeft size={24} />, title: 'Redirect Chain Audit', description: 'Analyse HTTP redirect chain — HTTP to HTTPS upgrade, mixed content, redirect loops', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**Redirect audit** http://gov.gd — follow the redirect chain and check for HTTP to HTTPS upgrade and loops.', magicWords: ['redirect audit', 'redirect chain', 'redirect scan'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
    { id: 'wcag-audit', icon: <Activity size={24} />, title: 'WCAG Accessibility Audit', description: 'Detailed WCAG 2.1 accessibility audit — maps Lighthouse violations to WCAG criteria', tier: 6, minRole: 'user', colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md', iconBgClass: 'bg-cyan-100 text-cyan-600', category: 'Cyber', samplePrompt: '**WCAG audit** https://gov.gd — run a detailed accessibility audit and map violations to WCAG 2.1 criteria.', magicWords: ['wcag audit', 'accessibility audit', 'wcag scan', 'a11y audit'], defaultLLM: 'Claude Haiku', fallbackLLM: 'Claude Sonnet' },
  ];

  // ============ Search ============

  const q = searchQuery.toLowerCase().trim();
  const isSearching = q.length > 0;

  const searchCapabilities = isSearching
    ? serviceCards.filter(
        (s) =>
          canAccess(userRole, s.minRole) &&
          (s.title.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            s.samplePrompt.toLowerCase().includes(q) ||
            TIER_NAMES[s.tier].toLowerCase().includes(q))
      )
    : [];

  const searchTools =
    isSearching && (userRole === 'admin' || userRole === 'superuser')
      ? toolsList.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.keywords.join(' ').toLowerCase().includes(q)
        )
      : [];

  const totalSearchResults = searchCapabilities.length + searchTools.length;

  // ============ Render ============

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-6xl w-full">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Welcome to {brandingName}
          </h1>
          <p className="text-gray-600">
            Your AI assistant for policy documents and compliance
          </p>

          {/* Export Button */}
          <div className="flex justify-center mt-4">
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                Export Guide
                <ChevronDown size={14} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
              </button>
              {showExportMenu && (
                <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px] z-10">
                  <button
                    onClick={() => handleExport('md')}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <FileText size={16} className="text-gray-500" />
                    Markdown (.md)
                  </button>
                  <button
                    onClick={() => handleExport('docx')}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <FileText size={16} className="text-blue-500" />
                    Word (.docx)
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <Code2 size={16} className="text-green-500" />
                    JSON (.json)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative max-w-md mx-auto mb-6">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search capabilities, tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Search Results ── */}
        {isSearching ? (
          <div className="space-y-6">
            {totalSearchResults === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Search size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No results for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            ) : (
              <>
                {/* Capabilities results */}
                {searchCapabilities.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Capabilities</span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{searchCapabilities.length}</span>
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
                          {searchCapabilities.map((card, idx) => (
                            <tr
                              key={card.id}
                              className={`hover:bg-gray-50 transition-colors ${idx < searchCapabilities.length - 1 ? 'border-b border-gray-100' : ''}`}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <span className={`p-1.5 rounded-lg shrink-0 ${card.iconBgClass}`}>{card.icon}</span>
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
                {searchTools.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tools</span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{searchTools.length}</span>
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
                          {searchTools.map((tool, idx) => (
                            <tr key={tool.name} className={`${idx < searchTools.length - 1 ? 'border-b border-gray-100' : ''}`}>
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
        ) : (
          <>
            {/* ── Tab Navigation ── */}
            <div className="flex justify-center mb-6">
              <div className="inline-flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('capabilities')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'capabilities'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Sparkles size={16} />
                    Capabilities
                  </span>
                </button>

                {(userRole === 'admin' || userRole === 'superuser') && (
                  <button
                    onClick={() => setActiveTab('tools')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'tools'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Zap size={16} />
                      Tools
                    </span>
                  </button>
                )}

                <button
                  onClick={() => setActiveTab('routes')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'routes'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ArrowRightLeft size={16} />
                    Routes
                  </span>
                </button>
              </div>
            </div>

            {/* ── Capabilities Tab ── */}
            {activeTab === 'capabilities' && (
              <div className="space-y-3">
                {([1, 2, 3, 4, 5, 6] as const).map((tier) => {
                  const tierServices = serviceCards.filter(
                    (s) => s.tier === tier && canAccess(userRole, s.minRole)
                  );
                  if (tierServices.length === 0) return null;

                  const colors = TIER_COLORS[tier];
                  const isCollapsed = collapsedTiers.has(tier);

                  return (
                    <div key={tier} className="space-y-2">
                      {/* Collapsible tier header */}
                      <button
                        onClick={() => toggleTier(tier)}
                        className="flex items-center gap-2 w-full text-left py-1.5 group"
                      >
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors.badge}`}>
                          Tier {tier}
                        </span>
                        <span className={`text-sm font-semibold ${colors.text} flex-1`}>
                          {TIER_NAMES[tier]}
                        </span>
                        <span className={`${colors.text} opacity-60 group-hover:opacity-100 transition-opacity`}>
                          {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        </span>
                      </button>

                      {/* Tier table */}
                      {!isCollapsed && (
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
                              {tierServices.map((card, idx) => (
                                <tr
                                  key={card.id}
                                  className={`hover:bg-gray-50 transition-colors ${
                                    idx < tierServices.length - 1 ? 'border-b border-gray-100' : ''
                                  }`}
                                >
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2.5">
                                      <span className={`p-1.5 rounded-lg shrink-0 ${card.iconBgClass}`}>
                                        {card.icon}
                                      </span>
                                      <span className="font-medium text-gray-900">{card.title}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs">
                                    {card.category === '—' ? <span className="text-gray-300 italic">Cross-category</span> : card.category}
                                  </td>
                                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell text-xs leading-relaxed">
                                    <InlineBold text={card.samplePrompt} />
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <RoleTag role={card.minRole} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Tools Tab ── */}
            {activeTab === 'tools' && (userRole === 'admin' || userRole === 'superuser') && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                        <th className="text-left px-4 py-3 font-semibold">Tool</th>
                        <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">Description</th>
                        <th className="text-left px-4 py-3 font-semibold">Keywords</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {toolsList.map((tool) => (
                        <tr key={tool.name} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                            {tool.name}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                            {tool.description}
                          </td>
                          <td className="px-4 py-3">
                            {tool.keywords.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {tool.keywords.map((kw, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full"
                                  >
                                    {kw}
                                  </span>
                                ))}
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

            {/* ── Routes Tab ── */}
            {activeTab === 'routes' && (
              <div className="space-y-8">
                {/* Route Comparison Table */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Route Comparison — LLM Models &amp; Providers</h3>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs">
                          <th className="text-left px-4 py-2.5 font-semibold text-gray-500">Capability</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-blue-700 bg-blue-50">Route 1 — LiteLLM Proxy</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-purple-700 bg-purple-50">Route 2 — Direct Cloud</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-emerald-700 bg-emerald-50">Route 3 — Ollama Local</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs">
                        <tr>
                          <td className="px-4 py-2.5 font-medium text-gray-700">Connection</td>
                          <td className="px-4 py-2.5 text-gray-600">Via LiteLLM proxy</td>
                          <td className="px-4 py-2.5 text-gray-600">Direct SDK / API</td>
                          <td className="px-4 py-2.5 text-gray-600">Local Ollama server</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2.5 font-medium text-gray-700">Default</td>
                          <td className="px-4 py-2.5 text-gray-600">Enabled (Primary)</td>
                          <td className="px-4 py-2.5 text-gray-600">Disabled</td>
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
                          <td className="px-4 py-2.5 text-gray-600">Anthropic (Claude Opus, Sonnet, Haiku), Fireworks (MiniMax M2.5, Kimi K2.5)</td>
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
                          <td className="px-4 py-2.5 text-gray-600">Mistral OCR (online)</td>
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
                          { tool: 'Load Testing', desc: 'k6 Cloud endpoint testing', requires: 'Tool-capable LLM' },
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

          </>
        )}

      </div>

    </div>
  );
}
