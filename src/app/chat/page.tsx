'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import ChatWindow, { type ChatWindowRef } from '@/components/chat/ChatWindow';
import ThreadSidebar, { type ThreadSidebarRef } from '@/components/layout/ThreadSidebar';

import ArtifactsPanel from '@/components/chat/ArtifactsPanel';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import WelcomeScreen from '@/components/chat/WelcomeScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobileMenuProvider, useMobileMenuOptional } from '@/contexts/MobileMenuContext';
import MobileThreadsMenu from '@/components/mobile/MobileThreadsMenu';
import MobileArtifactsMenu from '@/components/mobile/MobileArtifactsMenu';
import MobileFABs from '@/components/mobile/MobileFABs';
import type { Thread, UserSubscription, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, PodcastHint } from '@/types';

// Inner component that uses the mobile menu context
function HomeContent() {
  const { data: session } = useSession();
  const chatWindowRef = useRef<ChatWindowRef>(null);
  const sidebarRef = useRef<ThreadSidebarRef>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [userSubscriptions, setUserSubscriptions] = useState<UserSubscription[]>([]);
  const [brandingName, setBrandingName] = useState<string>('Policy Bot');
  const [threadCount, setThreadCount] = useState(0);
  const isMobile = useIsMobile();
  const mobileMenu = useMobileMenuOptional();

  // Artifacts state (lifted from ChatWindow)
  const [artifactsData, setArtifactsData] = useState<{
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    generatedPodcasts: PodcastHint[];
    urlSources: UrlSource[];
  }>({
    threadId: null,
    uploads: [],
    generatedDocs: [],
    generatedImages: [],
    generatedPodcasts: [],
    urlSources: [],
  });

  // Load user subscriptions, branding, and thread count on mount
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

        // Load thread count for mobile FAB badge
        const threadsResponse = await fetch('/api/threads');
        if (threadsResponse.ok) {
          const threadsData = await threadsResponse.json();
          setThreadCount(threadsData.threads?.length || 0);
        }
      } catch (err) {
        console.error('Failed to load user data:', err);
      }
    };
    loadData();
  }, []);

  const handleThreadSelect = useCallback((thread: Thread | null) => {
    setActiveThread(thread);
  }, []);

  const handleThreadCreated = useCallback((thread: Thread) => {
    setActiveThread(thread);
    setThreadCount(prev => prev + 1);
  }, []);

  const handleArtifactsChange = useCallback((data: {
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    generatedPodcasts: PodcastHint[];
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
        chatWindowRef.current?.removeUpload(filename);
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
        chatWindowRef.current?.removeUrlSource(filename);
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

  // Input focus handlers - update mobile menu context
  const handleInputFocus = useCallback(() => {
    mobileMenu?.setInputExpanded(true);
  }, [mobileMenu]);

  const handleInputBlur = useCallback(() => {
    mobileMenu?.setInputExpanded(false);
  }, [mobileMenu]);

  // Header always shows the bot name (branding)
  const getHeaderTitle = () => brandingName;

  // Get user role for WelcomeScreen
  const userRole = (session?.user as { role?: string })?.role as 'user' | 'superuser' | 'admin' | undefined;

  // Calculate artifact count for FAB badge
  const artifactCount = artifactsData.generatedDocs.length +
    artifactsData.generatedImages.length +
    artifactsData.generatedPodcasts.length +
    artifactsData.uploads.length +
    artifactsData.urlSources.length;

  // Handler for creating new thread from mobile header
  const handleNewThreadFromHeader = useCallback(async () => {
    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const thread = await response.json();
        const newThread = {
          ...thread,
          createdAt: new Date(thread.createdAt),
          updatedAt: new Date(thread.updatedAt),
        };
        setActiveThread(newThread);
        setThreadCount(prev => prev + 1);
      }
    } catch (err) {
      console.error('Failed to create thread:', err);
    }
  }, []);

  return (
    <div className="fixed-layout bg-gray-50">
      {/* Header - shows MobileHeader on mobile when thread active */}
      <AppHeader
        title={getHeaderTitle()}
        isMobile={isMobile}
        activeThread={activeThread}
        onOpenThreadsMenu={mobileMenu?.openThreadsMenu}
        onNewThread={handleNewThreadFromHeader}
        onHomeClick={() => setActiveThread(null)}
      />

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar - Desktop only */}
        {!isMobile && (
          <ThreadSidebar
            ref={sidebarRef}
            onThreadSelect={handleThreadSelect}
            onThreadCreated={handleThreadCreated}
            selectedThreadId={activeThread?.id}
          />
        )}

        {/* Main content area */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {activeThread ? (
            <ErrorBoundary moduleName="ChatWindow">
              <ChatWindow
                ref={chatWindowRef}
                activeThread={activeThread}
                onThreadCreated={handleThreadCreated}
                userSubscriptions={userSubscriptions}
                brandingName={brandingName}
                onArtifactsChange={handleArtifactsChange}
                onInputFocus={handleInputFocus}
                onInputBlur={handleInputBlur}
              />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary moduleName="WelcomeScreen">
              <WelcomeScreen
                userRole={userRole || 'user'}
                brandingName={brandingName}
                onNewThread={handleNewThreadFromHeader}
              />
            </ErrorBoundary>
          )}
        </main>

        {/* Right sidebar - Desktop only */}
        {!isMobile && (
          <ArtifactsPanel
            threadId={artifactsData.threadId}
            uploads={artifactsData.uploads}
            generatedDocs={artifactsData.generatedDocs}
            generatedImages={artifactsData.generatedImages}
            generatedPodcasts={artifactsData.generatedPodcasts}
            urlSources={artifactsData.urlSources}
            onRemoveUpload={handleRemoveUpload}
            onRemoveUrlSource={handleRemoveUrlSource}
          />
        )}
      </div>

      {/* Mobile-only: FABs and full-page menus */}
      {isMobile && (
        <>
          <MobileFABs
            threadCount={threadCount}
            artifactCount={artifactCount}
            hasActiveThread={!!activeThread}
          />
          <MobileThreadsMenu
            onThreadSelect={handleThreadSelect}
            onThreadCreated={handleThreadCreated}
            selectedThreadId={activeThread?.id}
          />
          <MobileArtifactsMenu
            threadId={artifactsData.threadId}
            uploads={artifactsData.uploads}
            generatedDocs={artifactsData.generatedDocs}
            generatedImages={artifactsData.generatedImages}
            generatedPodcasts={artifactsData.generatedPodcasts}
            urlSources={artifactsData.urlSources}
            onRemoveUpload={handleRemoveUpload}
            onRemoveUrlSource={handleRemoveUrlSource}
          />
        </>
      )}

      {/* Full-width footer */}
      <AppFooter />
    </div>
  );
}

// Main export wraps content in MobileMenuProvider
export default function Home() {
  return (
    <MobileMenuProvider>
      <HomeContent />
    </MobileMenuProvider>
  );
}
