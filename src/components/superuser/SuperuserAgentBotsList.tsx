'use client';

/**
 * Superuser Agent Bots List
 *
 * Displays a list of agent bots that the superuser has access to
 * based on category overlap. Links to documentation pages.
 */

import { useState, useEffect } from 'react';
import { Bot, FileText, ExternalLink, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface AgentBotItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  categories: string[];
  default_version: number | null;
}

export default function SuperuserAgentBotsList() {
  const [agentBots, setAgentBots] = useState<AgentBotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgentBots = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/superuser/agent-bots');

      if (!response.ok) {
        if (response.status === 403) {
          setError('You do not have access to any agent bots.');
          setAgentBots([]);
          return;
        }
        throw new Error('Failed to load agent bots');
      }

      const data = await response.json();
      setAgentBots(data.agentBots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent bots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgentBots();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Agent Bots</h2>
          <p className="text-sm text-gray-500">
            API documentation for agent bots in your categories
          </p>
        </div>
        <Button variant="secondary" onClick={loadAgentBots} disabled={loading}>
          <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!error && agentBots.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <Bot className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Agent Bots Available</h3>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            There are no agent bots configured for your categories yet.
            Contact your administrator to create one.
          </p>
        </div>
      )}

      {/* Agent Bots List */}
      {agentBots.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-6 py-3 font-medium">Agent Bot</th>
                <th className="px-6 py-3 font-medium">Categories</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agentBots.map((bot) => (
                <tr key={bot.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Bot size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{bot.name}</p>
                        {bot.description && (
                          <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">
                            {bot.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1 font-mono">
                          /{bot.slug}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {bot.categories.map((cat, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {bot.is_active ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <a
                      href={`/docs/agent-bots/${bot.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors"
                    >
                      <FileText size={14} />
                      View Docs
                      <ExternalLink size={12} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-700">
          <strong>Note:</strong> You can view documentation for agent bots that share
          categories with your assigned categories. From the docs page, you can download
          OpenAPI specs, Postman collections, and integration guides.
        </p>
      </div>
    </div>
  );
}
