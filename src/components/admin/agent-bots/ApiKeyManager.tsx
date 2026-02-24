'use client';

/**
 * API Key Manager
 *
 * Manages API keys for an agent bot - list, create, and revoke keys.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Key,
  Trash2,
  AlertCircle,
  Copy,
  Check,
  Clock,
  Shield,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

interface ApiKey {
  id: string;
  agent_bot_id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit_rpm: number;
  rate_limit_rpd: number;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
}

interface ApiKeyManagerProps {
  agentBotId: string;
}

export default function ApiKeyManager({ agentBotId }: ApiKeyManagerProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [newFullKey, setNewFullKey] = useState<string | null>(null);

  // Form state
  const [keyName, setKeyName] = useState('');
  const [rateLimitRpm, setRateLimitRpm] = useState(60);
  const [rateLimitRpd, setRateLimitRpd] = useState(1000);
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load API keys
  const loadApiKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/agent-bots/${agentBotId}/api-keys`);
      if (!response.ok) throw new Error('Failed to load API keys');
      const data = await response.json();
      setApiKeys(data.apiKeys || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  }, [agentBotId]);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  // Create API key
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/agent-bots/${agentBotId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: keyName.trim(),
          rate_limit_rpm: rateLimitRpm,
          rate_limit_rpd: rateLimitRpd,
          expires_in_days: expiresInDays || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create API key');
      }

      const data = await response.json();
      setNewFullKey(data.fullKey);
      setShowCreateModal(false);
      setShowKeyModal(true);
      await loadApiKeys();

      // Reset form
      setKeyName('');
      setRateLimitRpm(60);
      setRateLimitRpd(1000);
      setExpiresInDays('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  // Revoke API key
  const handleRevoke = async () => {
    if (!selectedKey) return;

    setIsRevoking(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/agent-bots/${agentBotId}/api-keys/${selectedKey.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to revoke API key');
      }

      await loadApiKeys();
      setShowRevokeModal(false);
      setSelectedKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key');
    } finally {
      setIsRevoking(false);
    }
  };

  // Copy key to clipboard
  const handleCopy = async () => {
    if (newFullKey) {
      await navigator.clipboard.writeText(newFullKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Format relative time
  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="lg" />
      </div>
    );
  }

  const activeKeys = apiKeys.filter((k) => k.is_active);
  const revokedKeys = apiKeys.filter((k) => !k.is_active);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            API Keys
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeKeys.length} active key{activeKeys.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Generate Key
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* API Keys List */}
      {apiKeys.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No API Keys
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Generate an API key to enable external access
          </p>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Generate Key
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active Keys */}
          {activeKeys.map((key) => (
            <div
              key={key.id}
              className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-blue-500" />
                    <span className="font-medium text-gray-900 dark:text-white">
                      {key.name}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">
                    {key.key_prefix}...
                  </p>
                  <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {key.rate_limit_rpm}/min, {key.rate_limit_rpd}/day
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last used: {formatRelativeTime(key.last_used_at)}
                    </span>
                    {key.expires_at && (
                      <span>
                        Expires:{' '}
                        {new Date(key.expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedKey(key);
                    setShowRevokeModal(true);
                  }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"
                  title="Revoke"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          {/* Revoked Keys */}
          {revokedKeys.length > 0 && (
            <>
              <div className="text-sm text-gray-500 dark:text-gray-400 pt-4">
                Revoked Keys
              </div>
              {revokedKeys.map((key) => (
                <div
                  key={key.id}
                  className="p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-500 dark:text-gray-400 line-through">
                      {key.name}
                    </span>
                    <span className="text-xs text-red-500">Revoked</span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1 font-mono">
                    {key.key_prefix}...
                  </p>
                  {key.revoked_at && (
                    <p className="text-xs text-gray-400 mt-1">
                      Revoked: {new Date(key.revoked_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Create Key Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Generate API Key"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Key Name *
            </label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g., Production Key"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Rate Limit (per minute)
              </label>
              <input
                type="number"
                value={rateLimitRpm}
                onChange={(e) => setRateLimitRpm(parseInt(e.target.value) || 60)}
                min={1}
                max={1000}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Rate Limit (per day)
              </label>
              <input
                type="number"
                value={rateLimitRpd}
                onChange={(e) => setRateLimitRpd(parseInt(e.target.value) || 1000)}
                min={1}
                max={100000}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Expiration (days)
            </label>
            <input
              type="number"
              value={expiresInDays}
              onChange={(e) =>
                setExpiresInDays(e.target.value ? parseInt(e.target.value) : '')
              }
              placeholder="Leave empty for no expiration"
              min={1}
              max={365}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !keyName.trim()}>
              {isCreating ? <Spinner size="sm" className="mr-2" /> : null}
              Generate Key
            </Button>
          </div>
        </form>
      </Modal>

      {/* Key Generated Modal */}
      <Modal
        isOpen={showKeyModal}
        onClose={() => {
          setShowKeyModal(false);
          setNewFullKey(null);
        }}
        title="API Key Generated"
      >
        <div className="space-y-4">
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>
                Copy this key now. You won&apos;t be able to see it again!
              </span>
            </p>
          </div>

          <div className="relative">
            <input
              type="text"
              readOnly
              value={newFullKey || ''}
              className="w-full px-3 py-2 pr-10 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 font-mono text-sm"
            />
            <button
              onClick={handleCopy}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {copied ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </button>
          </div>

          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Usage Example:
            </p>
            <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
              {`curl -X POST /api/agent-bots/[slug]/invoke \\
  -H "Authorization: Bearer ${newFullKey?.substring(0, 20)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"input": {"query": "..."}, "outputType": "json"}'`}
            </pre>
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={() => {
                setShowKeyModal(false);
                setNewFullKey(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* Revoke Confirmation Modal */}
      <Modal
        isOpen={showRevokeModal}
        onClose={() => {
          setShowRevokeModal(false);
          setSelectedKey(null);
        }}
        title="Revoke API Key"
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-300">
            Are you sure you want to revoke{' '}
            <span className="font-medium">{selectedKey?.name}</span>? This will
            immediately invalidate the key and any integrations using it will stop
            working.
          </p>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowRevokeModal(false);
                setSelectedKey(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? <Spinner size="sm" className="mr-2" /> : null}
              Revoke Key
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
