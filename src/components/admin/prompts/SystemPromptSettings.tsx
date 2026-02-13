'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface SystemPromptConfig {
  prompt: string;
  updatedAt: string;
  updatedBy: string;
}

export default function SystemPromptSettings() {
  const [systemPrompt, setSystemPrompt] = useState<SystemPromptConfig | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load system prompt
  const loadSystemPrompt = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/system-prompt');
      if (!response.ok) throw new Error('Failed to load system prompt');
      const data = await response.json();
      setSystemPrompt(data);
      setEditedPrompt(data.prompt);
      setModified(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system prompt');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSystemPrompt();
  }, [loadSystemPrompt]);

  const handlePromptChange = (value: string) => {
    setEditedPrompt(value);
    setModified(value !== systemPrompt?.prompt);
  };

  const handleSavePrompt = async () => {
    if (!modified || !editedPrompt.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: editedPrompt }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save system prompt');
      }

      const result = await response.json();
      setSystemPrompt(result.config);
      setModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save system prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrompt = () => {
    if (systemPrompt) {
      setEditedPrompt(systemPrompt.prompt);
      setModified(false);
    }
  };

  const handleRestoreDefaultPrompt = async () => {
    setRestoring(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/system-prompt', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore default prompt');
      }

      const data = await response.json();
      setSystemPrompt({
        prompt: data.prompt,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      });
      setEditedPrompt(data.prompt);
      setModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore default prompt');
    } finally {
      setRestoring(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">System Prompt</h2>
            <p className="text-sm text-gray-500">
              Define the AI assistant&apos;s behavior and instructions
            </p>
          </div>
          <div className="flex items-center gap-2">
            {modified && (
              <Button variant="secondary" onClick={handleResetPrompt} disabled={saving}>
                Reset
              </Button>
            )}
            <Button onClick={handleSavePrompt} disabled={!modified || saving} loading={saving}>
              <Save size={18} className="mr-2" />
              Save
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="p-6">
          <textarea
            value={editedPrompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            rows={16}
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            placeholder="Enter the system prompt..."
          />
          <div className="mt-3 flex items-center justify-between">
            {systemPrompt && (
              <p className="text-xs text-gray-500">
                Last updated: {formatDate(systemPrompt.updatedAt)} by {systemPrompt.updatedBy}
              </p>
            )}
            <Button
              variant="secondary"
              onClick={handleRestoreDefaultPrompt}
              disabled={restoring || saving}
              loading={restoring}
              className="text-orange-600 border-orange-300 hover:bg-orange-50"
            >
              <RefreshCw size={16} className="mr-2" />
              Restore to Default
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
