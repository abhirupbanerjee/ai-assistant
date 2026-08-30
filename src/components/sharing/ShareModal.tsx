'use client';

import { useState, useEffect } from 'react';
import { Mail, Loader2, Users } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  threadId: string;
  threadTitle: string;
}

interface DirectShare {
  id: string;
  sourceThreadId: string;
  recipientThreadId: string;
  sharedByUserId: number;
  sharedWithUserId: number;
  organizationId: number | null;
  categoryIdsSnapshot: unknown;
  createdAt: string;
  sharedByEmail?: string | null;
  sharedByName?: string | null;
  sharedWithEmail?: string | null;
  sharedWithName?: string | null;
}

export default function ShareModal({
  isOpen,
  onClose,
  threadId,
  threadTitle,
}: ShareModalProps) {
  const [shares, setShares] = useState<DirectShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [shareEnabled, setShareEnabled] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadShares();
      checkToolStatus();
    }
  }, [isOpen, threadId]);

  const checkToolStatus = async () => {
    try {
      const response = await fetch('/api/tools/status');
      if (response.ok) {
        const data = await response.json();
        setShareEnabled(data.share_thread?.enabled ?? true);
      }
    } catch (err) {
      console.error('Failed to check tool status:', err);
    }
  };

  const loadShares = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/threads/${threadId}/share`);
      if (response.ok) {
        const data = await response.json();
        setShares(data.directShares || []);
      } else if (response.status === 403) {
        const data = await response.json();
        setShareEnabled(false);
        setError(data.error || 'Thread sharing is disabled');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to load shares');
      }
    } catch (err) {
      console.error('Failed to load shares:', err);
      setError('Failed to load shares');
    } finally {
      setLoading(false);
    }
  };

  const createShare = async () => {
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/threads/${threadId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail }),
      });

      if (response.ok) {
        const data = await response.json();
        setSuccess(`Shared with ${data.share.recipientEmail}. They received their own independent copy.`);
        setRecipientEmail('');
        await loadShares();
      } else {
        const data = await response.json();
        // The server returns owner-facing messages for shareability failures
        // (e.g. THREAD_NOT_ORG_SCOPED) and a generic message for recipient
        // eligibility failures.
        setError(data.error || 'Failed to share thread');
      }
    } catch (err) {
      console.error('Failed to share thread:', err);
      setError('Failed to share thread');
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Thread">
      {!shareEnabled ? (
        <div className="text-center py-4">
          <p className="text-gray-600 mb-4">
            Thread sharing is currently disabled by your administrator.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Create new share */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Share within your organization</h3>
            <p className="text-sm text-gray-500">
              The recipient receives their own independent copy of “{threadTitle}”, including
              files and generated artifacts. Your original thread is not modified.
            </p>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Recipient email</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
            )}
            {success && (
              <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">{success}</p>
            )}

            <Button
              onClick={createShare}
              loading={creating}
              disabled={!recipientEmail.trim()}
              className="w-full"
            >
              <Mail size={16} className="mr-2" />
              Share Thread
            </Button>
          </div>

          {/* Existing direct shares */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : shares.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900">
                Shared With ({shares.length})
              </h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <Users size={14} className="text-gray-400 shrink-0" />
                        <span className="text-gray-700 truncate">
                          {share.sharedWithEmail || `User ${share.sharedWithUserId}`}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Shared {formatDate(share.createdAt)}
                      </div>
                    </div>
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs shrink-0">
                      Shared
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">
              No shares yet. Enter a recipient email above.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
