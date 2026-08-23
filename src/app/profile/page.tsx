'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Brain, AlertTriangle, Loader2, Download, Plug, FolderOpen, type LucideIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import ConnectedAccountsSection from '@/components/profile/ConnectedAccountsSection';
import PersonalMemorySection from '@/components/profile/PersonalMemorySection';
import CategoryMemorySection from '@/components/profile/CategoryMemorySection';
import OrganizationSwitcher from '@/components/org/OrganizationSwitcher';

type ProfileTab = 'memory' | 'categories' | 'backup' | 'accounts';

const PROFILE_TABS: { id: ProfileTab; label: string; icon: LucideIcon }[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'categories', label: 'Categories', icon: FolderOpen },
  { id: 'backup', label: 'Backup', icon: Download },
  { id: 'accounts', label: 'Connected Accounts', icon: Plug },
];

export default function ProfilePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [exportingHistory, setExportingHistory] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('memory');

  // Deep-linking: /profile?tab=backup selects a tab directly. Also auto-open
  // Connected Accounts when returning from an OAuth connect round-trip so the
  // success/error notice rendered by ConnectedAccountsSection is visible.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'memory' || tab === 'categories' || tab === 'backup' || tab === 'accounts') {
      setActiveTab(tab);
      return;
    }
    if (
      params.has('google_connected') ||
      params.has('google_error') ||
      params.has('ms_connected') ||
      params.has('ms_error')
    ) {
      setActiveTab('accounts');
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
      return;
    }
  }, [status, router]);

  const handleExportHistory = async () => {

    setExportingHistory(true);
    setExportError(null);
    try {
      const response = await fetch('/api/user/export/threads', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to export chat history');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-history-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export chat history');
    } finally {
      setExportingHistory(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/chat')}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to Chat"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Your Profile</h1>
                <p className="text-sm text-gray-500">{session?.user?.email}</p>
              </div>
            </div>
            <OrganizationSwitcher />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar Tabs */}
          <nav className="md:w-60 shrink-0" aria-label="Profile sections">
            <div className="bg-white rounded-lg border shadow-sm p-2 flex md:flex-col gap-1 overflow-x-auto">
              {PROFILE_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors whitespace-nowrap md:w-full text-left ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={16} className={isActive ? 'text-blue-600' : 'text-gray-400'} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Tab Content */}
          <div className="flex-1 min-w-0">
            {activeTab === 'memory' && <PersonalMemorySection />}
            {activeTab === 'categories' && <CategoryMemorySection />}

            {activeTab === 'backup' && (
              /* Backup Section */
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b">
                  <div className="flex items-center gap-3">
                    <Download className="text-blue-600" size={24} />
                    <div>
                      <h2 className="font-semibold text-gray-900">Backup</h2>
                      <p className="text-sm text-gray-500">Download all your conversations as a ZIP of Markdown files</p>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4">
                  {exportError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800 text-sm">
                      <AlertTriangle size={16} />
                      <span>{exportError}</span>
                    </div>
                  )}
                  <Button
                    variant="secondary"
                    onClick={handleExportHistory}
                    disabled={exportingHistory}
                  >
                    {exportingHistory ? (
                      <>
                        <Loader2 className="animate-spin mr-2" size={16} />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download size={16} className="mr-2" />
                        Download Chat History
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'accounts' && <ConnectedAccountsSection />}
          </div>
        </div>
      </main>

    </div>
  );
}
