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
} from 'lucide-react';

interface ServiceCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  category: string;
}

const SERVICES: ServiceCard[] = [
  // Tier 1: Reporting & Visualisation
  {
    id: 'reporting',
    icon: <FileText size={20} />,
    title: 'Smart Document Generation',
    description: 'Create DOCX, XLSX, PDF and HTML documents',
    tier: 1,
    category: 'Reporting',
  },
  {
    id: 'image-gen',
    icon: <Image size={20} />,
    title: 'Image Generation',
    description: 'Create images from text descriptions',
    tier: 1,
    category: 'Visualisation',
  },
  {
    id: 'diagrams',
    icon: <Map size={20} />,
    title: 'Diagram Creation',
    description: 'Generate flowcharts and diagrams',
    tier: 1,
    category: 'Visualisation',
  },
  {
    id: 'podcast',
    icon: <Headphones size={20} />,
    title: 'Audio/Podcast',
    description: 'Generate audio content and podcasts',
    tier: 1,
    category: 'Media',
  },
  // Tier 2: Planning
  {
    id: 'web-search',
    icon: <Globe size={20} />,
    title: 'Web Search',
    description: 'Search the web for current information',
    tier: 2,
    category: 'Research',
  },
  // Tier 4: Integration
  {
    id: 'html-render',
    icon: <Code size={20} />,
    title: 'HTML Rendering',
    description: 'Interactive HTML applications and playbooks',
    tier: 4,
    category: 'Development',
  },
];

const TOOLS = [
  { name: 'generateReport', description: 'Generate reports in multiple formats', category: 'Document' },
  { name: 'createImage', description: 'Create images from text descriptions', category: 'Visualisation' },
  { name: 'createDiagram', description: 'Generate diagrams and flowcharts', category: 'Visualisation' },
  { name: 'webSearch', description: 'Search the web for information', category: 'Research' },
  { name: 'createPodcast', description: 'Generate audio content', category: 'Media' },
  { name: 'createHTML', description: 'Create HTML playbook pages', category: 'Development' },
  { name: 'XLSXgenerateReport', description: 'Generate Excel reports', category: 'Document' },
  { name: 'createMarkdownPlaybook', description: 'Create Markdown playbooks', category: 'Document' },
  { name: 'webSearchTavily', description: 'Advanced web search', category: 'Research' },
  { name: 'webScraper', description: 'Scrape web pages for content', category: 'Research' },
];

const ROUTES = [
  {
    name: 'LiteLLM Proxy',
    description: 'Route 1 - Global cloud models via OpenAI-compatible API',
    providers: 'OpenAI, Gemini, Mistral, DeepSeek',
    models: 'GPT-4o, Gemini Pro, Mistral Large, DeepSeek V3',
    bestFor: 'Production workloads, fallback reliability',
  },
  {
    name: 'Direct Cloud',
    description: 'Route 2 - Direct provider APIs for specialized models',
    providers: 'Fireworks AI, Anthropic',
    models: 'Llama 3.3, Claude',
    bestFor: 'Cost optimization, specific model features',
  },
  {
    name: 'Ollama Local',
    description: 'Route 3 - Air-gapped deployment with local models',
    providers: 'Ollama',
    models: 'Llama, Mistral, DeepSeek (local)',
    bestFor: 'Sensitive data, offline environments',
  },
];

export default function HelpPage() {
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'capabilities' | 'tools' | 'routes'>('capabilities');
  const [expandedTiers, setExpandedTiers] = useState<Record<number, boolean>>({ 1: true });

  const userRole = (session?.user as { role?: string })?.role || 'user';

  const toggleTier = (tier: number) => {
    setExpandedTiers((prev) => ({ ...prev, [tier]: !prev[tier] }));
  };

  const filteredServices = SERVICES.filter((service) =>
    searchQuery === '' ||
    service.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    service.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const servicesByTier = filteredServices.reduce((acc, service) => {
    if (!acc[service.tier]) acc[service.tier] = [];
    acc[service.tier].push(service);
    return acc;
  }, {} as Record<number, ServiceCard[]>);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
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

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Search */}
        <div className="mb-8">
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search capabilities, tools, routes..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b mb-6">
          {(['capabilities', 'tools', 'routes'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'capabilities' && (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map((tier) => (
              <div
                key={tier}
                className={`rounded-lg border ${
                  tier === 1 ? 'border-blue-200' :
                  tier === 2 ? 'border-purple-200' :
                  tier === 3 ? 'border-amber-200' :
                  tier === 4 ? 'border-emerald-200' :
                  tier === 5 ? 'border-indigo-200' :
                  'border-cyan-200'
                } overflow-hidden`}
              >
                <button
                  onClick={() => toggleTier(tier)}
                  className={`w-full px-4 py-3 flex items-center justify-between ${
                    tier === 1 ? 'bg-blue-50' :
                    tier === 2 ? 'bg-purple-50' :
                    tier === 3 ? 'bg-amber-50' :
                    tier === 4 ? 'bg-emerald-50' :
                    tier === 5 ? 'bg-indigo-50' :
                    'bg-cyan-50'
                  }`}
                >
                  <span className="font-semibold">
                    {tier === 1 && 'Tier 1: Reporting & Visualisation'}
                    {tier === 2 && 'Tier 2: Planning'}
                    {tier === 3 && 'Tier 3: Domain Specific'}
                    {tier === 4 && 'Tier 4: Integration & Automation'}
                    {tier === 5 && 'Tier 5: Enterprise Architecture'}
                    {tier === 6 && 'Tier 6: Cyber Tools'}
                  </span>
                  {expandedTiers[tier] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                {expandedTiers[tier] && (
                  <div className="p-4 bg-white">
                    {servicesByTier[tier]?.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {servicesByTier[tier].map((service) => (
                          <div
                            key={service.id}
                            className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                          >
                            <div className="p-2 rounded bg-gray-100 text-gray-600">
                              {service.icon}
                            </div>
                            <div>
                              <h3 className="font-medium text-gray-900">{service.title}</h3>
                              <p className="text-sm text-gray-500">{service.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-center py-4">No services in this tier match your search.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Tool</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Description</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Category</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map((tool) => (
                  <tr key={tool.name} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{tool.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{tool.description}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{tool.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'routes' && (
          <div className="space-y-4">
            {ROUTES.map((route) => (
              <div key={route.name} className="bg-white rounded-lg border p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{route.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{route.description}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Providers:</span>
                    <p className="text-gray-600">{route.providers}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Models:</span>
                    <p className="text-gray-600">{route.models}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Best for:</span>
                    <p className="text-gray-600">{route.bestFor}</p>
                  </div>
                </div>
              </div>
            ))}
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
            <button
              onClick={() => {
                const content = document.documentElement.outerHTML;
                const blob = new Blob([content], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'policy-bot-documentation.html';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Download HTML
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
