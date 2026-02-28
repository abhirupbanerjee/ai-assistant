'use client';

import { useState } from 'react';
import {
  MessageSquarePlus,
  FolderOpen,
  Zap,
  Globe,
  Bot,
  Users,
  Wrench,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileUp,
  FolderSync,
  Link,
  Youtube,
  BarChart3,
  Languages,
  Image,
  Map,
  MessageCircle,
  GanttChart,
  ClipboardList,
  Landmark,
  Settings,
  Sparkles,
  Database,
  DollarSign,
  FileText,
  GitBranch,
  Target,
  FolderKanban,
  ShieldAlert,
  Calculator,
  Wallet,
  GraduationCap,
  Headphones,
  Plug,
  X,
  Activity,
  Code2,
  Table2,
  LayoutTemplate,
  Flag,
  Palette,
  Crosshair,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { useRouter } from 'next/navigation';

interface WelcomeScreenProps {
  userRole: 'user' | 'superuser' | 'admin';
  brandingName: string;
  onNewThread?: () => void;
}

interface SubItem {
  icon: React.ReactNode;
  label: string;
  description: string;
}

interface ActionCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  shortDescription: string;
  expandedContent: {
    description: string;
    bullets: string[];
    subItems?: SubItem[];
  };
  actionButton?: {
    label: string;
    route: string;
  };
  minRole: 'user' | 'superuser' | 'admin';
  colorClass: string;
  iconBgClass: string;
}

interface ServiceCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  code: string;
  description: string;
  tier: 1 | 2 | 3 | 4 | 5;
  isSubService?: boolean;
  minRole: 'user' | 'superuser' | 'admin';
  colorClass: string;
  iconBgClass: string;
  // Action type determines what happens when service is clicked
  actionType: 'modal' | 'category' | 'route' | 'message' | 'choice';
  categorySlug?: string;      // For 'category' type - creates thread with this category
  route?: string;             // For 'route' type - navigates to this page
  message?: string;           // For 'message' type - shows this info message
  choiceOptions?: {           // For 'choice' type - shows modal with options
    label: string;
    description: string;
    route: string;
  }[];
}

interface MagicWord {
  id: string;
  icon: React.ReactNode;
  description: string;
  keywords: string[];
}

const ROLE_HIERARCHY = { user: 0, superuser: 1, admin: 2 };

function canAccess(
  userRole: 'user' | 'superuser' | 'admin',
  minRole: 'user' | 'superuser' | 'admin'
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

const TIER_COLORS = {
  1: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  2: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  3: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  4: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  5: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', badge: 'bg-cyan-100 text-cyan-700' },
};

const TIER_NAMES = {
  1: 'Reporting & Visualisation',
  2: 'Planning',
  3: 'Domain Specific',
  4: 'Integration & Automation',
  5: 'Developer Tools',
};

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

export default function WelcomeScreen({
  userRole,
  brandingName,
  onNewThread,
}: WelcomeScreenProps) {
  const router = useRouter();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'setup' | 'services' | 'magicwords'>('services');
  const [selectedService, setSelectedService] = useState<ServiceCard | null>(null);
  const [showMessageModal, setShowMessageModal] = useState<string | null>(null);
  const [showChoiceModal, setShowChoiceModal] = useState<ServiceCard | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  const toggleCard = (id: string) => {
    setExpandedCard(expandedCard === id ? null : id);
  };

  // Handle service action based on actionType
  const handleServiceAction = async (service: ServiceCard) => {
    setSelectedService(null);

    switch (service.actionType) {
      case 'modal':
        // Open new thread modal (existing behavior)
        onNewThread?.();
        break;

      case 'category':
        // Create thread with pre-selected category
        if (service.categorySlug) {
          setIsCreatingThread(true);
          try {
            // First get the category ID from the slug
            const catResponse = await fetch('/api/user/categories');
            if (catResponse.ok) {
              const { categories } = await catResponse.json();
              const category = categories.find((c: { slug: string }) => c.slug === service.categorySlug);
              if (category) {
                // Create thread with this category
                const response = await fetch('/api/threads', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: `${service.title} Thread`,
                    categoryIds: [category.id]
                  }),
                });
                if (response.ok) {
                  // Refresh to show the new thread
                  window.location.reload();
                }
              } else {
                // Category not found, fall back to regular thread
                onNewThread?.();
              }
            }
          } catch (error) {
            console.error('Failed to create thread with category:', error);
            onNewThread?.();
          } finally {
            setIsCreatingThread(false);
          }
        } else {
          onNewThread?.();
        }
        break;

      case 'route':
        if (service.route) {
          router.push(service.route);
        }
        break;

      case 'message':
        if (service.message) {
          setShowMessageModal(service.message);
        }
        break;

      case 'choice':
        setShowChoiceModal(service);
        break;

      default:
        onNewThread?.();
    }
  };

  // Setup the Platform cards
  const setupCards: ActionCard[] = [
    {
      id: 'chat',
      icon: <MessageSquarePlus size={24} />,
      title: 'Chat',
      shortDescription: 'Ask questions about your documents',
      expandedContent: {
        description: 'Begin a conversation with the AI assistant.',
        bullets: [
          'Select a category to focus your questions',
          'Upload PDFs (up to 5MB) for analysis',
          'Use voice input or paste URLs',
          'Get answers from your document library',
        ],
      },
      actionButton: undefined,
      minRole: 'user',
      colorClass: 'border-blue-200 hover:border-blue-300',
      iconBgClass: 'bg-blue-100 text-blue-600',
    },
    {
      id: 'category',
      icon: <FolderOpen size={24} />,
      title: 'Categories',
      shortDescription: 'Organize knowledge into domains',
      expandedContent: {
        description:
          'Create topic areas to organize your knowledge base. Each category can have its own documents and user access controls.',
        bullets: [
          'Create domains like HR Policies, Legal, Finance',
          'Control user access per category',
          'Add category-specific AI behaviors',
        ],
      },
      actionButton: {
        label: 'Manage Categories',
        route: '/superuser?tab=categories',
      },
      minRole: 'superuser',
      colorClass: 'border-purple-200 hover:border-purple-300',
      iconBgClass: 'bg-purple-100 text-purple-600',
    },
    {
      id: 'knowledge',
      icon: <Database size={24} />,
      title: 'Knowledge',
      shortDescription: 'Add documents to train the AI',
      expandedContent: {
        description:
          'Upload various document types to build your knowledge base. The AI uses this content to answer questions.',
        bullets: [
          'Multiple upload methods supported',
          'Automatic text extraction and indexing',
          'Supports PDFs, DOCX, TXT and more',
        ],
        subItems: [
          {
            icon: <FileUp size={16} className="text-blue-600" />,
            label: 'File Upload',
            description: 'Upload PDFs, DOCX, TXT files',
          },
          {
            icon: <FolderSync size={16} className="text-purple-600" />,
            label: 'Folder Sync',
            description: 'Sync from Google Drive, OneDrive',
          },
          {
            icon: <Link size={16} className="text-green-600" />,
            label: 'Web URLs',
            description: 'Scrape content from websites',
          },
          {
            icon: <Youtube size={16} className="text-red-600" />,
            label: 'YouTube',
            description: 'Extract video transcripts',
          },
        ],
      },
      actionButton: {
        label: 'Add Documents',
        route: '/superuser?tab=documents',
      },
      minRole: 'superuser',
      colorClass: 'border-indigo-200 hover:border-indigo-300',
      iconBgClass: 'bg-indigo-100 text-indigo-600',
    },
    {
      id: 'users',
      icon: <Users size={24} />,
      title: 'Users',
      shortDescription: 'Control access and permissions',
      expandedContent: {
        description:
          'Add users and assign them to categories they can access.',
        bullets: [
          'Add users by email',
          'Assign roles: User, Superuser, Admin',
          'Subscribe users to specific categories',
          'Superusers can manage their assigned categories',
        ],
      },
      actionButton: {
        label: 'Manage Users',
        route: '/admin?tab=users',
      },
      minRole: 'admin',
      colorClass: 'border-emerald-200 hover:border-emerald-300',
      iconBgClass: 'bg-emerald-100 text-emerald-600',
    },
    {
      id: 'tools',
      icon: <Wrench size={24} />,
      title: 'Tools',
      shortDescription: 'Enable AI capabilities',
      expandedContent: {
        description:
          'Configure tools that the AI can use to enhance responses and generate content.',
        bullets: [
          'Web search for real-time information',
          'Chart and graph generation',
          'Document creation (PDF, DOCX)',
          'Image generation',
          'Podcast creation',
          'Translation services',
        ],
      },
      actionButton: {
        label: 'Manage Tools',
        route: '/superuser?tab=tools',
      },
      minRole: 'superuser',
      colorClass: 'border-slate-200 hover:border-slate-300',
      iconBgClass: 'bg-slate-100 text-slate-600',
    },
    {
      id: 'skills',
      icon: <Zap size={24} />,
      title: 'Skills',
      shortDescription: 'Define custom AI behaviors',
      expandedContent: {
        description: 'Configure how the AI responds to different queries.',
        bullets: [
          'Always-on skills (apply to every prompt)',
          'Category-specific skills',
          'Keyword-triggered behaviors',
        ],
      },
      actionButton: {
        label: 'Manage Skills',
        route: '/superuser?tab=skills',
      },
      minRole: 'superuser',
      colorClass: 'border-amber-200 hover:border-amber-300',
      iconBgClass: 'bg-amber-100 text-amber-600',
    },
    {
      id: 'chatbot',
      icon: <Globe size={24} />,
      title: 'Workspaces',
      shortDescription: 'Embed on external websites',
      expandedContent: {
        description: 'Deploy a branded chat widget on any website.',
        bullets: [
          'Custom branding (colors, logo, greeting)',
          'Domain whitelisting for security',
          'Rate limiting per session/day',
          'No authentication required for visitors',
        ],
      },
      actionButton: {
        label: 'Create Workspace',
        route: '/superuser?tab=workspaces',
      },
      minRole: 'superuser',
      colorClass: 'border-green-200 hover:border-green-300',
      iconBgClass: 'bg-green-100 text-green-600',
    },
    {
      id: 'agent',
      icon: <Bot size={24} />,
      title: 'Agents',
      shortDescription: 'API for external systems',
      expandedContent: {
        description: 'Build API-accessible bots for system integrations.',
        bullets: [
          'Define input schemas & output formats',
          'Versioned configurations',
          'API keys with rate limiting',
          'Webhook support for async processing',
          'Output: Text, JSON, PDF, DOCX, Images...',
        ],
      },
      actionButton: {
        label: 'Create Agent',
        route: '/superuser?tab=agent-bots',
      },
      minRole: 'superuser',
      colorClass: 'border-cyan-200 hover:border-cyan-300',
      iconBgClass: 'bg-cyan-100 text-cyan-600',
    },
  ];

  // Services organized by tiers
  const serviceCards: ServiceCard[] = [
    // Tier 1 — Reporting & Visualisation Services
    {
      id: 'report-generator',
      icon: <FileText size={24} />,
      title: 'Report Generator as a Service',
      code: 'RGaaS',
      description: 'Generate structured formatted reports from AI analysis and document content',
      tier: 1,
      minRole: 'user',
      colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md',
      iconBgClass: 'bg-blue-100 text-blue-600',
      actionType: 'modal',
    },
    {
      id: 'diagram',
      icon: <GitBranch size={24} />,
      title: 'Diagram as a Service',
      code: 'DGaaS',
      description: 'Generate technical and conceptual diagrams — flowcharts, architecture, process, sequence, mind maps, ERDs, state and class diagrams',
      tier: 1,
      minRole: 'user',
      colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md',
      iconBgClass: 'bg-blue-100 text-blue-600',
      actionType: 'modal',
    },
    {
      id: 'graph',
      icon: <BarChart3 size={24} />,
      title: 'Graph as a Service',
      code: 'GRaaS',
      description: 'Generate data-driven charts from structured inputs or natural language — bar, line, area, stacked, pie, donut, radar, treemap, heatmap, scatter, waterfall, funnel',
      tier: 1,
      minRole: 'user',
      colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md',
      iconBgClass: 'bg-blue-100 text-blue-600',
      actionType: 'modal',
    },
    {
      id: 'infographic',
      icon: <Image size={24} />,
      title: 'Infographic as a Service',
      code: 'IGaaS',
      description: 'Auto-generate branded visual summary documents from policy and government content',
      tier: 1,
      minRole: 'user',
      colorClass: 'border-blue-200 hover:border-blue-300 hover:shadow-md',
      iconBgClass: 'bg-blue-100 text-blue-600',
      actionType: 'modal',
    },
    // Tier 2 — Planning Services
    {
      id: 'roadmap',
      icon: <Map size={24} />,
      title: 'Roadmap as a Service',
      code: 'RMaaS',
      description: 'AI-assisted initiative and milestone planning with timeline generation',
      tier: 2,
      minRole: 'user',
      colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md',
      iconBgClass: 'bg-purple-100 text-purple-600',
      actionType: 'category',
      categorySlug: 'grenada-digital-strategy',
    },
    {
      id: 'strategy',
      icon: <Target size={24} />,
      title: 'Strategy as a Service',
      code: 'STaaS',
      description: 'AI-assisted strategic plan development with objective mapping, KPIs and outcome tracking',
      tier: 2,
      minRole: 'user',
      colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md',
      iconBgClass: 'bg-purple-100 text-purple-600',
      actionType: 'category',
      categorySlug: 'grenada-digital-strategy',
    },
    {
      id: 'project-management',
      icon: <FolderKanban size={24} />,
      title: 'Project Management as a Service',
      code: 'PMaaS',
      description: 'Integrated AI project planning covering Gantt, RAID, RACI and Budget in one workflow',
      tier: 2,
      minRole: 'user',
      colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md',
      iconBgClass: 'bg-purple-100 text-purple-600',
      actionType: 'modal',
    },
    {
      id: 'gantt',
      icon: <GanttChart size={24} />,
      title: 'Gantt Charts',
      code: 'GTaaS',
      description: 'Build project timelines and schedules from natural language descriptions',
      tier: 2,
      isSubService: true,
      minRole: 'user',
      colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md',
      iconBgClass: 'bg-purple-100 text-purple-600',
      actionType: 'modal',
    },
    {
      id: 'raid',
      icon: <ShieldAlert size={24} />,
      title: 'RAID Logs',
      code: 'RAIDaaS',
      description: 'AI-generated Risk, Assumption, Issue and Dependency registers',
      tier: 2,
      isSubService: true,
      minRole: 'user',
      colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md',
      iconBgClass: 'bg-purple-100 text-purple-600',
      actionType: 'modal',
    },
    {
      id: 'raci',
      icon: <Users size={24} />,
      title: 'RACI Matrix',
      code: 'RACIaaS',
      description: 'Auto-generate Responsibility Assignment matrices from project or policy descriptions',
      tier: 2,
      isSubService: true,
      minRole: 'user',
      colorClass: 'border-purple-200 hover:border-purple-300 hover:shadow-md',
      iconBgClass: 'bg-purple-100 text-purple-600',
      actionType: 'modal',
    },
    // Tier 3 — Domain Specific Services
    {
      id: 'citizen-feedback',
      icon: <MessageCircle size={24} />,
      title: 'Citizen Feedback Analyser',
      code: 'CFaaS',
      description: 'AI analysis of citizen feedback at scale — sentiment, themes, priority issues',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'category',
      categorySlug: 'grenada-service-feedback',
    },
    {
      id: 'survey',
      icon: <ClipboardList size={24} />,
      title: 'Citizen Survey Analyser',
      code: 'SVaaS',
      description: 'Process and summarise structured and unstructured survey responses with insight extraction',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'category',
      categorySlug: 'citizen-survey',
    },
    {
      id: 'compensation',
      icon: <DollarSign size={24} />,
      title: 'Pay Grade & Compensation Review',
      code: 'PCaaS',
      description: 'Benchmark and analyse compensation structures, grade bands and pay equity',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'category',
      categorySlug: 'compensation-review',
    },
    {
      id: 'service-simplification',
      icon: <LayoutTemplate size={24} />,
      title: 'Service Simplification as a Service',
      code: 'SSaaS',
      description: 'AI-assisted service redesign and simplification for improved citizen experience',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'category',
      categorySlug: 'gea',
    },
    {
      id: 'branding',
      icon: <Palette size={24} />,
      title: 'Branding as a Service',
      code: 'BaaS',
      description: 'AI-powered brand consistency analysis and guideline generation for government communications',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'category',
      categorySlug: 'branding-guidelines',
    },
    {
      id: 'training',
      icon: <GraduationCap size={24} />,
      title: 'Capacity Development & Training as a Service',
      code: 'CDaaS',
      description: 'AI-powered onboarding and training via conversational chatbots grounded in SOPs, organisational documents and training materials',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'category',
      categorySlug: 'gog-change',
    },
    {
      id: 'customer-support',
      icon: <Headphones size={24} />,
      title: 'Citizen & Customer Support as a Service',
      code: 'CCSaaS',
      description: 'Embeddable AI chatbots scoped to an entity\'s documents, services and policies for always-on public support',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'route',
      route: '/superuser',
      message: 'Create a new workspace to embed as a chatbot',
    },
    {
      id: 'translation',
      icon: <Languages size={24} />,
      title: 'Translation as a Service',
      code: 'TLaaS',
      description: 'Multi-language AI translation of documents, responses and live communications for multilingual environments',
      tier: 3,
      minRole: 'user',
      colorClass: 'border-amber-200 hover:border-amber-300 hover:shadow-md',
      iconBgClass: 'bg-amber-100 text-amber-600',
      actionType: 'message',
      message: 'Access Translation via chat input: Click the + button and select Translate',
    },
    // Tier 4 — Integration & Automation Services
    {
      id: 'chatbot-service',
      icon: <Globe size={24} />,
      title: 'ChatBot as a Service',
      code: 'CBaaS',
      description: 'Deploy embeddable or standalone AI chat widgets scoped to specific document categories with custom branding and domain restrictions',
      tier: 4,
      minRole: 'superuser',
      colorClass: 'border-emerald-200 hover:border-emerald-300 hover:shadow-md',
      iconBgClass: 'bg-emerald-100 text-emerald-600',
      actionType: 'route',
      route: '/superuser?tab=workspaces',
    },
    {
      id: 'agent-bot',
      icon: <Bot size={24} />,
      title: 'Agent Bot as a Service',
      code: 'ABaaS',
      description: 'Build fully configurable AI agents with defined input/output schemas exposed via REST API with API key auth, sync/async execution and webhook callbacks',
      tier: 4,
      minRole: 'admin',
      colorClass: 'border-emerald-200 hover:border-emerald-300 hover:shadow-md',
      iconBgClass: 'bg-emerald-100 text-emerald-600',
      actionType: 'route',
      route: '/admin?tab=agents',
    },
    {
      id: 'data-integration',
      icon: <Plug size={24} />,
      title: 'Data Integration as a Service',
      code: 'DIaaS',
      description: 'Connect AI to external data sources — REST APIs with OpenAPI import and CSV/Excel uploads — with query, filter and aggregation capabilities',
      tier: 4,
      minRole: 'superuser',
      colorClass: 'border-emerald-200 hover:border-emerald-300 hover:shadow-md',
      iconBgClass: 'bg-emerald-100 text-emerald-600',
      actionType: 'choice',
      choiceOptions: [
        { label: 'Data Source Query', description: 'Connect to REST APIs or upload CSV/Excel files', route: '/superuser' },
        { label: 'Function Calling API', description: 'Create custom function APIs for AI tool use', route: '/superuser' },
      ],
    },
    // Tier 5 — Developer Tools
    {
      id: 'website-analyser',
      icon: <Activity size={24} />,
      title: 'Website Analyser as a Service',
      code: 'WAaaS',
      description: 'Analyse website performance, accessibility, SEO, and best practices using Lighthouse. Get Core Web Vitals metrics and actionable optimization recommendations.',
      tier: 5,
      minRole: 'user',
      colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md',
      iconBgClass: 'bg-cyan-100 text-cyan-600',
      actionType: 'category',
      categorySlug: 'cyber',
    },
    {
      id: 'code-analyser',
      icon: <Code2 size={24} />,
      title: 'Code Analyser as a Service',
      code: 'CAaaS',
      description: 'Analyse code quality using SonarCloud. Identify bugs, vulnerabilities, code smells, and security hotspots with actionable insights and quality ratings.',
      tier: 5,
      minRole: 'user',
      colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md',
      iconBgClass: 'bg-cyan-100 text-cyan-600',
      actionType: 'category',
      categorySlug: 'cyber',
    },
    {
      id: 'gap-spotter',
      icon: <Crosshair size={24} />,
      title: 'Gap Spotter as a Service',
      code: 'GSaaS',
      description: 'AI-powered gap analysis to identify missing elements, inconsistencies, and improvement opportunities in policies, processes, and systems.',
      tier: 5,
      minRole: 'user',
      colorClass: 'border-cyan-200 hover:border-cyan-300 hover:shadow-md',
      iconBgClass: 'bg-cyan-100 text-cyan-600',
      actionType: 'category',
      categorySlug: 'cyber',
    },
  ];

  const visibleSetupCards = setupCards.filter((card) =>
    canAccess(userRole, card.minRole)
  );

  // Magic Words data
  const magicWords: MagicWord[] = [
    {
      id: 'charts',
      icon: <BarChart3 size={20} />,
      description: 'Create a pie chart, bar graph, or data visualization',
      keywords: ['pie', 'bar', 'radar', 'stacked bar', 'chart', 'graph'],
    },
    {
      id: 'flowchart',
      icon: <GitBranch size={20} />,
      description: 'Create a flowchart or process diagram',
      keywords: ['flowchart', 'workflow'],
    },
    {
      id: 'architecture',
      icon: <Landmark size={20} />,
      description: 'Create an architecture or system diagram',
      keywords: ['architecture', 'conceptual', 'logical', 'technical', 'system architecture', 'solution architecture', 'component diagram'],
    },
    {
      id: 'timeline',
      icon: <GanttChart size={20} />,
      description: 'Create a project timeline or Gantt chart',
      keywords: ['implementation plan', 'gantt chart', 'project plan', 'project schedule', 'timeline', 'milestones', 'project phases', 'delivery plan'],
    },
    {
      id: 'table',
      icon: <Table2 size={20} />,
      description: 'Compare items in a table',
      keywords: ['table', 'compare', 'comparison', 'matrix', 'versus', 'vs', 'side by side', 'differences between'],
    },
    {
      id: 'websearch',
      icon: <Globe size={20} />,
      description: 'Search the web for current information',
      keywords: ['web search', 'online', 'search', 'latest', 'current', 'recent', 'news', 'update', '2024', '2025', 'today', 'this week', 'this month'],
    },
    {
      id: 'wireframe',
      icon: <LayoutTemplate size={20} />,
      description: 'Create a UI wireframe or mockup',
      keywords: ['wireframe', 'screen layout', 'ui design', 'user interface', 'mockup', 'prototype', 'screen design', 'page layout'],
    },
    {
      id: 'raci',
      icon: <Users size={20} />,
      description: 'Create a RACI responsibility matrix',
      keywords: ['raci', 'raci matrix', 'responsibility matrix', 'responsibility assignment', 'roles and responsibilities'],
    },
    {
      id: 'raid',
      icon: <ClipboardList size={20} />,
      description: 'Create a RAID log (Risks, Assumptions, Issues, Dependencies)',
      keywords: ['raid log', 'raid plan', 'risks assumptions issues dependencies', 'project raid', 'raid register', 'raid analysis'],
    },
    {
      id: 'risk',
      icon: <ShieldAlert size={20} />,
      description: 'Create a risk register or risk assessment',
      keywords: ['risk register', 'risk assessment', 'risk matrix', 'risk management', 'risk analysis', 'risk log', 'risk evaluation', 'risk scoring'],
    },
    {
      id: 'grenada',
      icon: <Flag size={20} />,
      description: 'Apply Grenada government branding',
      keywords: ['Grenada', 'GoG'],
    },
    {
      id: 'trinidad',
      icon: <Flag size={20} />,
      description: 'Apply Trinidad & Tobago government branding',
      keywords: ['Trinidad', 'Trinidad and Tobago', 'TT', 'GoRTT'],
    },
    {
      id: 'ey',
      icon: <Sparkles size={20} />,
      description: 'Apply EY brand standards',
      keywords: ['EY'],
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Welcome to {brandingName}
          </h1>
          <p className="text-gray-600">
            Your AI assistant for policy documents and compliance
          </p>
        </div>

        {/* Primary CTA */}
        <div className="flex justify-center mb-8">
          <Button
            onClick={onNewThread}
            className="flex items-center gap-2 px-6 py-3 text-base"
          >
            <MessageSquarePlus size={20} />
            Start New Thread
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('services')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'services'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <Sparkles size={16} />
                Services
              </span>
            </button>
            <button
              onClick={() => setActiveTab('setup')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'setup'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings size={16} />
                Setup
              </span>
            </button>
            <button
              onClick={() => setActiveTab('magicwords')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'magicwords'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <Zap size={16} />
                Magic Words
              </span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'services' && (
          <div className="space-y-6">
            {/* Services organized by Tier */}
            {([1, 2, 3, 4, 5] as const).map((tier) => {
              const tierServices = serviceCards.filter(
                (s) => s.tier === tier && canAccess(userRole, s.minRole)
              );
              if (tierServices.length === 0) return null;

              const colors = TIER_COLORS[tier];
              return (
                <div key={tier} className="space-y-3">
                  {/* Tier Header */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors.badge}`}>
                      Tier {tier}
                    </span>
                    <span className={`text-sm font-medium ${colors.text}`}>
                      {TIER_NAMES[tier]}
                    </span>
                  </div>
                  {/* Tier Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {tierServices.map((card) => (
                      <div
                        key={card.id}
                        onClick={() => setSelectedService(card)}
                        className={`bg-white rounded-xl border-2 ${card.colorClass} p-4 cursor-pointer transition-all duration-200 min-h-[120px]`}
                      >
                        <div className="flex flex-col h-full">
                          <div className="flex items-start justify-between mb-2">
                            <div className={`p-2 rounded-lg ${card.iconBgClass}`}>
                              {card.icon}
                            </div>
                            <RoleTag role={card.minRole} />
                          </div>
                          <h3 className="font-medium text-gray-900 text-sm mb-1 line-clamp-2">
                            {card.isSubService && '— '}{card.title}
                          </h3>
                          <p className="text-xs text-gray-500 line-clamp-2 mt-auto">
                            {card.code}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Service Modal */}
        {selectedService && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedService(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-md mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <div className={`p-2 rounded-lg ${selectedService.iconBgClass}`}>
                  {selectedService.icon}
                </div>
                <button
                  onClick={() => setSelectedService(null)}
                  className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              {/* Modal Body - Simple Table */}
              <div className="p-4 sm:p-6">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="py-3 pr-4 text-gray-500 font-medium whitespace-nowrap">Name</td>
                      <td className="py-3 text-gray-900">{selectedService.title}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-3 pr-4 text-gray-500 font-medium whitespace-nowrap">Code</td>
                      <td className="py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-mono ${TIER_COLORS[selectedService.tier].badge}`}>
                          {selectedService.code}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-gray-500 font-medium whitespace-nowrap align-top">Description</td>
                      <td className="py-3 text-gray-700">{selectedService.description}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-gray-100">
                <Button
                  onClick={() => handleServiceAction(selectedService)}
                  disabled={isCreatingThread}
                  className="w-full flex items-center justify-center gap-2"
                >
                  {isCreatingThread ? (
                    <>Creating...</>
                  ) : selectedService.actionType === 'route' ? (
                    <>
                      <ExternalLink size={18} />
                      Go to {selectedService.route === '/superuser' ? 'Dashboard' : 'Settings'}
                    </>
                  ) : selectedService.actionType === 'message' ? (
                    <>
                      <MessageCircle size={18} />
                      View Info
                    </>
                  ) : selectedService.actionType === 'choice' ? (
                    <>
                      <Settings size={18} />
                      Choose Option
                    </>
                  ) : (
                    <>
                      <MessageSquarePlus size={18} />
                      Start Thread
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Message Modal */}
        {showMessageModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowMessageModal(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-blue-100">
                  <MessageCircle size={24} className="text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Information</h3>
              </div>
              <p className="text-gray-700 mb-4">{showMessageModal}</p>
              <Button
                onClick={() => setShowMessageModal(null)}
                className="w-full"
              >
                Got it
              </Button>
            </div>
          </div>
        )}

        {/* Choice Modal */}
        {showChoiceModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowChoiceModal(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-md mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${showChoiceModal.iconBgClass}`}>
                    {showChoiceModal.icon}
                  </div>
                  <h3 className="font-semibold text-gray-900">{showChoiceModal.title}</h3>
                </div>
                <button
                  onClick={() => setShowChoiceModal(null)}
                  className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-600 mb-4">Choose how you want to proceed:</p>
                {showChoiceModal.choiceOptions?.map((option, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setShowChoiceModal(null);
                      router.push(option.route);
                    }}
                    className="w-full p-4 text-left border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all"
                  >
                    <div className="font-medium text-gray-900">{option.label}</div>
                    <div className="text-sm text-gray-600">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="space-y-4">
            {/* Setup Cards - Using flex wrap to prevent grid stretching */}
            <div className="flex flex-wrap gap-4">
              {visibleSetupCards.map((card) => {
                const isExpanded = expandedCard === card.id;

                return (
                  <div
                    key={card.id}
                    className={`bg-white rounded-xl border-2 ${card.colorClass} transition-all duration-200 cursor-pointer w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.67rem)]`}
                    onClick={() => toggleCard(card.id)}
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={`shrink-0 p-2 rounded-xl ${card.iconBgClass}`}
                        >
                          {card.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-gray-900">
                              {card.title}
                            </h3>
                            <div className="flex items-center gap-2 shrink-0">
                              <RoleTag role={card.minRole} />
                              {isExpanded ? (
                                <ChevronUp size={18} className="text-gray-400" />
                              ) : (
                                <ChevronDown
                                  size={18}
                                  className="text-gray-400"
                                />
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {card.shortDescription}
                          </p>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <p className="text-sm text-gray-700 mb-3">
                            {card.expandedContent.description}
                          </p>
                          <ul className="space-y-1.5 mb-4">
                            {card.expandedContent.bullets.map((bullet, idx) => (
                              <li
                                key={idx}
                                className="text-sm text-gray-600 flex items-start gap-2"
                              >
                                <span className="text-gray-400 mt-1">•</span>
                                {bullet}
                              </li>
                            ))}
                          </ul>

                          {/* Sub-items */}
                          {card.expandedContent.subItems && (
                            <div className="grid grid-cols-2 gap-2 mb-4">
                              {card.expandedContent.subItems.map(
                                (subItem, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"
                                  >
                                    <div className="shrink-0">
                                      {subItem.icon}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-gray-700">
                                        {subItem.label}
                                      </div>
                                      <div className="text-xs text-gray-500 truncate">
                                        {subItem.description}
                                      </div>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          )}

                          {/* Action button */}
                          {card.actionButton && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(card.actionButton!.route);
                              }}
                              className="flex items-center gap-1.5"
                            >
                              {card.actionButton.label}
                              <ExternalLink size={14} />
                            </Button>
                          )}

                          {/* New Thread button for chat card */}
                          {card.id === 'chat' && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNewThread?.();
                              }}
                              className="flex items-center gap-1.5"
                            >
                              <MessageSquarePlus size={14} />
                              New Thread
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Regular user info section */}
            {userRole === 'user' && (
              <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h3 className="font-medium text-gray-700 mb-2">How It Works</h3>
                <p className="text-sm text-gray-600">
                  Your administrator has set up knowledge categories with
                  documents you can query. Select a category when starting a new
                  thread to get focused answers from relevant documents.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'magicwords' && (
          <div className="space-y-4">
            {/* Header */}
            <div className="text-center mb-4">
              <p className="text-sm text-gray-600">
                Use these keywords in your prompts to trigger special features
              </p>
            </div>

            {/* Magic Words Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12"></th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      What do you want to do?
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Try these magic words
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {magicWords.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="p-1.5 rounded-lg bg-gray-100 text-gray-600 inline-flex">
                          {item.icon}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {item.description}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {item.keywords.map((keyword, idx) => (
                            <span
                              key={idx}
                              className="inline-flex px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer Note */}
            <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Last updated:</span> 27 Feb 2026
              </p>
              <p className="text-sm text-gray-500 mt-1">
                This guide gives you a headstart to working with the system.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
