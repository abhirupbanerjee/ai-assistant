'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import ChatWindow from '@/components/chat/ChatWindow';
import ThreadSidebar from '@/components/layout/ThreadSidebar';
import ArtifactsPanel from '@/components/chat/ArtifactsPanel';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import WelcomeScreen from '@/components/chat/WelcomeScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { Thread, UserSubscription, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource } from '@/types';

export default function Home() {
  const { data: session } = useSession();
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [userSubscriptions, setUserSubscriptions] = useState<UserSubscription[]>([]);
  const [brandingName, setBrandingName] = useState<string>('Policy Bot');
  const [showShareModal, setShowShareModal] = useState(false);

  // Sidebar visibility states (persisted to localStorage)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('left-sidebar-open');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('right-sidebar-open');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  // Artifacts state (lifted from ChatWindow)
  const [artifactsData, setArtifactsData] = useState<{
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    urlSources: UrlSource[];
  }>({
    threadId: null,
    uploads: [],
    generatedDocs: [],
    generatedImages: [],
    urlSources: [],
  });

  // Persist sidebar states
  useEffect(() => {
    localStorage.setItem('left-sidebar-open', String(leftSidebarOpen));
  }, [leftSidebarOpen]);

  useEffect(() => {
    localStorage.setItem('right-sidebar-open', String(rightSidebarOpen));
  }, [rightSidebarOpen]);

  // Load user subscriptions and branding on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load user subscriptions
        const subsResponse = await fetch('/api/user/subscriptions');
        if (subsResponse.ok) {
          const subsData = await subsResponse.json();
          setUserSubscriptions(subsData.subscriptions || []);
        }

        // Load branding
        const brandingResponse = await fetch('/api/branding');
        if (brandingResponse.ok) {
          const brandingData = await brandingResponse.json();
          setBrandingName(brandingData.botName || 'Policy Bot');
        }
      } catch (err) {
        console.error('Failed to load user data:', err);
      }
    };
    loadData();
  }, []);

  const handleThreadSelect = (thread: Thread | null) => {
    setActiveThread(thread);
  };

  const handleThreadCreated = (thread: Thread) => {
    setActiveThread(thread);
  };

  const handleArtifactsChange = useCallback((data: {
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    urlSources: UrlSource[];
  }) => {
    setArtifactsData(data);
  }, []);

  const handleRemoveUpload = useCallback(async (filename: string) => {
    if (!artifactsData.threadId) return;

    try {
      const response = await fetch(
        `/api/threads/${artifactsData.threadId}/upload?filename=${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        // Update local state to remove the upload
        setArtifactsData(prev => ({
          ...prev,
          uploads: prev.uploads.filter(f => f !== filename),
        }));
      } else {
        const error = await response.json();
        console.error('Failed to delete upload:', error);
      }
    } catch (err) {
      console.error('Failed to delete upload:', err);
    }
  }, [artifactsData.threadId]);

  const handleRemoveUrlSource = useCallback(async (filename: string) => {
    if (!artifactsData.threadId) return;

    try {
      const response = await fetch(
        `/api/threads/${artifactsData.threadId}/upload?filename=${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        // Update local state to remove the URL source
        setArtifactsData(prev => ({
          ...prev,
          urlSources: prev.urlSources.filter(s => s.filename !== filename),
        }));
      } else {
        const error = await response.json();
        console.error('Failed to delete URL source:', error);
      }
    } catch (err) {
      console.error('Failed to delete URL source:', err);
    }
  }, [artifactsData.threadId]);

  // Header always shows the bot name (branding)
  const getHeaderTitle = () => brandingName;

  // Get user role for WelcomeScreen
  const userRole = (session?.user as { role?: string })?.role as 'user' | 'superuser' | 'admin' | undefined;

  return (
    <div className="fixed-layout bg-gray-50">
      {/* Full-width header */}
      <AppHeader
        title={getHeaderTitle()}
        onToggleLeftSidebar={() => setLeftSidebarOpen(!leftSidebarOpen)}
        onToggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
        leftSidebarOpen={leftSidebarOpen}
        rightSidebarOpen={rightSidebarOpen}
        showShareButton={!!activeThread}
        onShare={() => setShowShareModal(true)}
      />

      {/* Content area with sidebars */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar - Thread list */}
        <ThreadSidebar
          isOpen={leftSidebarOpen}
          onToggle={() => setLeftSidebarOpen(!leftSidebarOpen)}
          onThreadSelect={handleThreadSelect}
          onThreadCreated={handleThreadCreated}
          selectedThreadId={activeThread?.id}
        />

        {/* Main content area */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {activeThread ? (
            <ErrorBoundary moduleName="ChatWindow">
              <ChatWindow
                activeThread={activeThread}
                onThreadCreated={handleThreadCreated}
                userSubscriptions={userSubscriptions}
                brandingName={brandingName}
                showShareModal={showShareModal}
                onCloseShareModal={() => setShowShareModal(false)}
                onArtifactsChange={handleArtifactsChange}
              />
            </ErrorBoundary>
          ) : (
            <WelcomeScreen
              userRole={userRole || 'user'}
              brandingName={brandingName}
              onNewThread={() => {
                // Trigger new thread modal in ThreadSidebar
                // For now, just open the sidebar if closed
                if (!leftSidebarOpen) {
                  setLeftSidebarOpen(true);
                }
              }}
            />
          )}
        </main>

        {/* Right sidebar - Artifacts panel */}
        <ArtifactsPanel
          isOpen={rightSidebarOpen}
          threadId={artifactsData.threadId}
          uploads={artifactsData.uploads}
          generatedDocs={artifactsData.generatedDocs}
          generatedImages={artifactsData.generatedImages}
          urlSources={artifactsData.urlSources}
          onRemoveUpload={handleRemoveUpload}
          onRemoveUrlSource={handleRemoveUrlSource}
        />
      </div>

      {/* Full-width footer */}
      <AppFooter />
    </div>
  );
}
