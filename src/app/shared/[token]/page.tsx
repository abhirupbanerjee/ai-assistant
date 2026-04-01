'use client';

import { useState, useEffect, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageSquare,
  User,
  Calendar,
  Download,
  Eye,
  Lock,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { MarkdownComponents } from '@/components/markdown/MarkdownRenderers';
import Button from '@/components/ui/Button';
import Link from 'next/link';

interface SharedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources?: Array<{ title: string; url?: string; score: number }>;
  createdAt: string;
}

interface SharedThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  categories: Array<{ id: number; name: string; slug: string }>;
}

interface SharedData {
  share: {
    id: string;
    allowDownload: boolean;
    expiresAt: string | null;
    viewCount: number;
    createdByName?: string;
    createdAt: string;
  };
  thread: SharedThread;
  messages: SharedMessage[];
  permissions: {
    canDownload: boolean;
    isOwner: boolean;
    isShareCreator: boolean;
  };
  uploads?: Array<{
    id: number;
    filename: string;
    fileSize: number;
    uploadedAt: string;
  }>;
  outputs?: Array<{
    id: number;
    messageId: string | null;
    filename: string;
    fileType: string;
    fileSize: number;
    createdAt: string;
  }>;
}

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function SharedThreadPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      // Redirect to sign in with callback to this page
      router.push(`/auth/signin?callbackUrl=/shared/${resolvedParams.token}`);
      return;
    }

    loadSharedThread();
  }, [status, resolvedParams.token]);

  const loadSharedThread = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/shared/${resolvedParams.token}`);

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        const result = await response.json();
        setError(result.error || 'Failed to load shared thread');
      }
    } catch (err) {
      console.error('Failed to load shared thread:', err);
      setError('Failed to load shared thread');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (type: 'upload' | 'output', id: number, filename: string) => {
    try {
      const response = await fetch(
        `/api/shared/${resolvedParams.token}/download/${type}/${id}`
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const result = await response.json();
        alert(result.error || 'Failed to download file');
      }
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download file');
    }
  };

  // Loading state
  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading shared thread...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Unable to Access Share
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link href="/">
            <Button variant="secondary">
              <ArrowLeft size={16} className="mr-2" />
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { share, thread, messages, permissions, uploads, outputs } = data;

  // Helper to get outputs for a specific message
  const getOutputsForMessage = (messageId: string) => {
    if (!outputs || !permissions.canDownload) return [];
    return outputs.filter(o => o.messageId === messageId);
  };

  // Get outputs without a message_id (thread-level outputs)
  const orphanOutputs = outputs?.filter(o => !o.messageId) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/chat"
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={18} />
              <span className="text-sm">Back to Chat</span>
            </Link>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Eye size={14} />
                {share.viewCount} views
              </span>
              {share.expiresAt && (
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  Expires {formatDate(share.expiresAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Thread Info Banner */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{thread.title}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            {share.createdByName && (
              <span className="flex items-center gap-1">
                <User size={14} />
                Shared by {share.createdByName}
              </span>
            )}
            <span className="flex items-center gap-1">
              <MessageSquare size={14} />
              {thread.messageCount} messages
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={14} />
              Created {formatDate(thread.createdAt)}
            </span>
            {permissions.canDownload ? (
              <span className="flex items-center gap-1 text-green-600">
                <Download size={14} />
                Downloads enabled
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-400">
                <Lock size={14} />
                Downloads disabled
              </span>
            )}
          </div>
          {thread.categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {thread.categories.map((cat) => (
                <span
                  key={cat.id}
                  className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium"
                >
                  {cat.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="space-y-4">
          {messages.map((message) => {
            const messageOutputs = getOutputsForMessage(message.id);

            return (
              <div key={message.id}>
                <div
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border text-gray-900'
                    }`}
                  >
                    <div className={`markdown-content ${message.role === 'user' ? 'text-white' : ''}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={MarkdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                    <div
                      className={`text-xs mt-2 ${
                        message.role === 'user' ? 'text-blue-200' : 'text-gray-400'
                      }`}
                    >
                      {formatTime(message.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Inline outputs for this message */}
                {messageOutputs.length > 0 && (
                  <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} mt-2`}>
                    <div className="max-w-[80%] space-y-2">
                      {messageOutputs.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between bg-white border rounded-lg p-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {file.fileType === 'image' ? (
                              <ImageIcon size={18} className="text-gray-400 shrink-0" />
                            ) : (
                              <FileText size={18} className="text-gray-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {file.filename}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatFileSize(file.fileSize)} • {file.fileType.toUpperCase()}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDownload('output', file.id, file.filename)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg ml-2"
                          >
                            <Download size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Files Section - Only show uploads and orphan outputs (outputs without message_id) */}
        {permissions.canDownload && ((uploads && uploads.length > 0) || orphanOutputs.length > 0) && (
          <div className="mt-8 border-t pt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Files</h2>

            {uploads && uploads.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Uploaded Files</h3>
                <div className="space-y-2">
                  {uploads.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between bg-white border rounded-lg p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText size={18} className="text-gray-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {file.filename}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(file.fileSize)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload('upload', file.id, file.filename)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {orphanOutputs.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Generated Files</h3>
                <div className="space-y-2">
                  {orphanOutputs.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between bg-white border rounded-lg p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {file.fileType === 'image' ? (
                          <ImageIcon size={18} className="text-gray-400 shrink-0" />
                        ) : (
                          <FileText size={18} className="text-gray-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {file.filename}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(file.fileSize)} • {file.fileType.toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload('output', file.id, file.filename)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-6 border-t text-center text-sm text-gray-500">
          <p>
            This thread was shared via{' '}
            <Link href="/" className="text-blue-600 hover:underline">
              Policy Bot
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
