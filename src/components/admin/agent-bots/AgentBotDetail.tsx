'use client';

/**
 * Agent Bot Detail
 *
 * Detail view for a single agent bot with tabs for:
 * - Versions
 * - API Keys
 * - Settings
 * - Test
 * - Analytics
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Bot,
  Power,
  PowerOff,
  Settings,
  Key,
  BarChart3,
  PlayCircle,
  Layers,
  FileText,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import VersionList from './VersionList';
import ApiKeyManager from './ApiKeyManager';
import AgentBotTester from './AgentBotTester';
import AgentBotAnalytics from './AgentBotAnalytics';

interface AgentBot {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_by: string;
  created_by_role: 'admin' | 'superuser';
  created_at: string;
  updated_at: string;
}

type TabId = 'versions' | 'api-keys' | 'settings' | 'test' | 'analytics' | 'docs';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'versions', label: 'Versions', icon: <Layers className="w-4 h-4" /> },
  { id: 'api-keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
  { id: 'test', label: 'Test', icon: <PlayCircle className="w-4 h-4" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'docs', label: 'API Docs', icon: <FileText className="w-4 h-4" /> },
];

interface AgentBotDetailProps {
  botId: string;
  onBack: () => void;
}

export default function AgentBotDetail({ botId, onBack }: AgentBotDetailProps) {
  const [bot, setBot] = useState<AgentBot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('versions');

  // Load agent bot
  const loadBot = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/agent-bots/${botId}`);
      if (!response.ok) throw new Error('Failed to load agent bot');
      const data = await response.json();
      setBot(data.agentBot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent bot');
    } finally {
      setIsLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    loadBot();
  }, [loadBot]);

  // Handle toggle active status
  const handleToggleActive = async () => {
    if (!bot) return;

    try {
      const response = await fetch(`/api/admin/agent-bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !bot.is_active }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to toggle agent bot status');
      }

      await loadBot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Agent bot not found</p>
        <Button onClick={onBack} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Agent Bots
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={onBack}
            className="flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Agent Bots
          </button>
          <div className="flex items-center gap-3">
            <Bot className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                {bot.name}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">
                  {bot.slug}
                </code>
                {bot.description && <span className="ml-2">{bot.description}</span>}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleActive}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
              bot.is_active
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {bot.is_active ? (
              <>
                <Power className="w-4 h-4" /> Active
              </>
            ) : (
              <>
                <PowerOff className="w-4 h-4" /> Inactive
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-sm text-red-600 dark:text-red-400 underline mt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'versions' && <VersionList agentBotId={bot.id} />}
        {activeTab === 'api-keys' && <ApiKeyManager agentBotId={bot.id} />}
        {activeTab === 'test' && <AgentBotTester agentBot={bot} />}
        {activeTab === 'analytics' && <AgentBotAnalytics agentBotId={bot.id} />}
        {activeTab === 'docs' && (
          <div className="p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              API Documentation
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Share API documentation with external developers.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Public Documentation URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/docs/agent-bots/${bot.slug}`}
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${window.location.origin}/docs/agent-bots/${bot.slug}`
                      );
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(`/docs/agent-bots/${bot.slug}/openapi.json`, '_blank')
                  }
                >
                  Download OpenAPI Spec
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(`/docs/agent-bots/${bot.slug}/readme.md`, '_blank')
                  }
                >
                  Download Markdown
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(`/docs/agent-bots/${bot.slug}/postman.json`, '_blank')
                  }
                >
                  Download Postman Collection
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
