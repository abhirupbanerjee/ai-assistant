'use client';

import { useState } from 'react';
import {
  MessageSquarePlus,
  FolderOpen,
  Zap,
  Globe,
  Bot,
  FileText,
  Users,
  Wrench,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  ExternalLink,
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

const ROLE_HIERARCHY = { user: 0, superuser: 1, admin: 2 };

function canAccess(
  userRole: 'user' | 'superuser' | 'admin',
  minRole: 'user' | 'superuser' | 'admin'
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

export default function WelcomeScreen({
  userRole,
  brandingName,
  onNewThread,
}: WelcomeScreenProps) {
  const router = useRouter();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const toggleCard = (id: string) => {
    setExpandedCard(expandedCard === id ? null : id);
  };

  const actionCards: ActionCard[] = [
    {
      id: 'chat',
      icon: <MessageSquarePlus size={28} />,
      title: 'Start a Chat',
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
      actionButton: undefined, // Uses onNewThread instead
      minRole: 'user',
      colorClass: 'border-blue-200 hover:border-blue-300',
      iconBgClass: 'bg-blue-100 text-blue-600',
    },
    {
      id: 'category',
      icon: <FolderOpen size={28} />,
      title: 'Setup a Category',
      shortDescription: 'Create topic areas with documents & users',
      expandedContent: {
        description: 'Organize knowledge into distinct domains.',
        bullets: [
          'Each category maps to a knowledge base',
          'Control access per category',
          'Examples: HR Policies, Legal, Finance',
        ],
        subItems: [
          {
            icon: <FileText size={16} className="text-amber-600" />,
            label: 'Documents',
            description: 'Upload PDFs to train the AI',
          },
          {
            icon: <Users size={16} className="text-emerald-600" />,
            label: 'Users',
            description: 'Control who can access',
          },
        ],
      },
      actionButton: {
        label: 'Manage Categories',
        route: '/manage',
      },
      minRole: 'superuser',
      colorClass: 'border-purple-200 hover:border-purple-300',
      iconBgClass: 'bg-purple-100 text-purple-600',
    },
    {
      id: 'skills',
      icon: <Zap size={28} />,
      title: 'Create Skills',
      shortDescription: 'Define custom AI behaviors',
      expandedContent: {
        description: 'Configure how the AI responds to different queries.',
        bullets: [
          'Always-on skills (apply to every prompt)',
          'Category-specific skills',
          'Keyword-triggered behaviors',
        ],
        subItems: [
          {
            icon: <Wrench size={16} className="text-slate-600" />,
            label: 'Tools',
            description:
              'Web search, charts, docs, image gen, podcasts...',
          },
        ],
      },
      actionButton: {
        label: 'Manage Skills',
        route: '/admin?tab=skills',
      },
      minRole: 'admin',
      colorClass: 'border-amber-200 hover:border-amber-300',
      iconBgClass: 'bg-amber-100 text-amber-600',
    },
    {
      id: 'chatbot',
      icon: <Globe size={28} />,
      title: 'Create Chatbot',
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
        route: '/admin?tab=workspaces',
      },
      minRole: 'superuser',
      colorClass: 'border-green-200 hover:border-green-300',
      iconBgClass: 'bg-green-100 text-green-600',
    },
    {
      id: 'agent',
      icon: <Bot size={28} />,
      title: 'Create Agent',
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
        route: '/admin?tab=agents',
      },
      minRole: 'superuser',
      colorClass: 'border-cyan-200 hover:border-cyan-300',
      iconBgClass: 'bg-cyan-100 text-cyan-600',
    },
  ];

  const visibleCards = actionCards.filter((card) =>
    canAccess(userRole, card.minRole)
  );

  // Flow questions between cards
  const flowQuestions: Record<string, string> = {
    chat: 'Where does the knowledge come from?',
    category: 'How can I customize AI responses?',
    skills: 'How can I deploy this externally?',
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-3xl w-full">
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

        {/* Section Header */}
        <div className="text-center mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            What You Can Do
          </h2>
        </div>

        {/* Action Flow */}
        <div className="space-y-3">
          {visibleCards.map((card, index) => {
            const isExpanded = expandedCard === card.id;
            const showFlowQuestion =
              flowQuestions[card.id] &&
              index < visibleCards.length - 1 &&
              canAccess(userRole, visibleCards[index + 1]?.minRole || 'admin');

            // Check if this is the last single card or part of the deployment pair
            const isDeploymentCard =
              card.id === 'chatbot' || card.id === 'agent';
            const nextCard = visibleCards[index + 1];
            const isFirstOfDeploymentPair =
              card.id === 'chatbot' && nextCard?.id === 'agent';
            const isSecondOfDeploymentPair = card.id === 'agent';

            // Render deployment cards side by side
            if (isSecondOfDeploymentPair) {
              return null; // Will be rendered with chatbot
            }

            if (isFirstOfDeploymentPair) {
              const agentCard = nextCard;
              const agentExpanded = expandedCard === 'agent';

              return (
                <div key="deployment-pair">
                  {/* Flow connector */}
                  <div className="flex flex-col items-center py-2">
                    <ArrowDown size={20} className="text-gray-300" />
                  </div>

                  {/* Side by side deployment cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Chatbot Card */}
                    <div
                      className={`bg-white rounded-xl border-2 ${card.colorClass} transition-all duration-200 cursor-pointer`}
                      onClick={() => toggleCard(card.id)}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={`shrink-0 p-2.5 rounded-xl ${card.iconBgClass}`}
                          >
                            {card.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-gray-900">
                                {card.title}
                              </h3>
                              {isExpanded ? (
                                <ChevronUp
                                  size={18}
                                  className="text-gray-400"
                                />
                              ) : (
                                <ChevronDown
                                  size={18}
                                  className="text-gray-400"
                                />
                              )}
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
                              {card.expandedContent.bullets.map(
                                (bullet, idx) => (
                                  <li
                                    key={idx}
                                    className="text-sm text-gray-600 flex items-start gap-2"
                                  >
                                    <span className="text-gray-400 mt-1">
                                      •
                                    </span>
                                    {bullet}
                                  </li>
                                )
                              )}
                            </ul>
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
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Agent Card */}
                    <div
                      className={`bg-white rounded-xl border-2 ${agentCard.colorClass} transition-all duration-200 cursor-pointer`}
                      onClick={() => toggleCard(agentCard.id)}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={`shrink-0 p-2.5 rounded-xl ${agentCard.iconBgClass}`}
                          >
                            {agentCard.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-gray-900">
                                {agentCard.title}
                              </h3>
                              {agentExpanded ? (
                                <ChevronUp
                                  size={18}
                                  className="text-gray-400"
                                />
                              ) : (
                                <ChevronDown
                                  size={18}
                                  className="text-gray-400"
                                />
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {agentCard.shortDescription}
                            </p>
                          </div>
                        </div>

                        {/* Expanded content */}
                        {agentExpanded && (
                          <div className="mt-4 pt-4 border-t border-gray-100">
                            <p className="text-sm text-gray-700 mb-3">
                              {agentCard.expandedContent.description}
                            </p>
                            <ul className="space-y-1.5 mb-4">
                              {agentCard.expandedContent.bullets.map(
                                (bullet, idx) => (
                                  <li
                                    key={idx}
                                    className="text-sm text-gray-600 flex items-start gap-2"
                                  >
                                    <span className="text-gray-400 mt-1">
                                      •
                                    </span>
                                    {bullet}
                                  </li>
                                )
                              )}
                            </ul>
                            {agentCard.actionButton && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(agentCard.actionButton!.route);
                                }}
                                className="flex items-center gap-1.5"
                              >
                                {agentCard.actionButton.label}
                                <ExternalLink size={14} />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={card.id}>
                {/* Flow connector with question */}
                {index > 0 && (
                  <div className="flex flex-col items-center py-2">
                    <ArrowDown size={20} className="text-gray-300" />
                  </div>
                )}

                {/* Card */}
                <div
                  className={`bg-white rounded-xl border-2 ${card.colorClass} transition-all duration-200 cursor-pointer`}
                  onClick={() => toggleCard(card.id)}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`shrink-0 p-2.5 rounded-xl ${card.iconBgClass}`}
                      >
                        {card.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900">
                            {card.title}
                          </h3>
                          {isExpanded ? (
                            <ChevronUp size={18} className="text-gray-400" />
                          ) : (
                            <ChevronDown size={18} className="text-gray-400" />
                          )}
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                            {card.expandedContent.subItems.map(
                              (subItem, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg"
                                >
                                  <div className="shrink-0">{subItem.icon}</div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-700">
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

                {/* Flow question */}
                {showFlowQuestion && !isDeploymentCard && (
                  <div className="flex justify-center py-3">
                    <span className="text-xs text-gray-400 italic">
                      {flowQuestions[card.id]}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Regular user info section */}
        {userRole === 'user' && (
          <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <h3 className="font-medium text-gray-700 mb-2">How It Works</h3>
            <p className="text-sm text-gray-600">
              Your administrator has set up knowledge categories with documents
              you can query. Select a category when starting a new thread to get
              focused answers from relevant documents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
