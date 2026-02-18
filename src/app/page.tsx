'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import ChatWindow, { type ChatWindowRef } from '@/components/chat/ChatWindow';
import ThreadSidebar, { type ThreadSidebarRef } from '@/components/layout/ThreadSidebar';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import ArtifactsPanel from '@/components/chat/ArtifactsPanel';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import WelcomeScreen from '@/components/chat/WelcomeScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { Thread, UserSubscription, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource } from '@/types';

export default function Home() {
  const { data: session } = useSession();
  const chatWindowRef = useRef<ChatWindowRef>(null);
  const sidebarRef = useRef<ThreadSidebarRef>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [userSubscriptions, setUserSubscriptions] = useState<UserSubscription[]>([]);
  const [brandingName, setBrandingName] = useState<string>('Policy Bot');
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareThread, setShareThread] = useState<Thread | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isMobile = useIsMobile();

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

  const handleShareThread = useCallback((thread: Thread) => {
    setShareThread(thread);
    setActiveThread(thread); // Select the thread
    setShowShareModal(true);
  }, []);

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
        // Update ChatWindow's internal state via ref
        chatWindowRef.current?.removeUpload(filename);
        // Also update local artifacts state (for immediate UI feedback)
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
        // Update ChatWindow's internal state via ref
        chatWindowRef.current?.removeUrlSource(filename);
        // Also update local artifacts state (for immediate UI feedback)
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

  // Swipe gestures for mobile: swipe right from edge to open sidebar, swipe left to close
  useSwipeGesture({
    onSwipeRight: () => sidebarRef.current?.setCollapsed(false),
    onSwipeLeft: () => sidebarRef.current?.setCollapsed(true),
  });

  // Input focus handlers for hiding sidebars on mobile
  const handleInputFocus = useCallback(() => {
    setIsInputFocused(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    setIsInputFocused(false);
  }, []);

  // Determine if sidebars should be hidden (mobile + input focused)
  const hideSidebars = isMobile && isInputFocused;

  // Header always shows the bot name (branding)
  const getHeaderTitle = () => brandingName;

  // Get user role for WelcomeScreen
  const userRole = (session?.user as { role?: string })?.role as 'user' | 'superuser' | 'admin' | undefined;

  return (
    <div className="fixed-layout bg-gray-50">
      {/* Full-width header - clean, only bot icon and name */}
      <AppHeader title={getHeaderTitle()} />

      {/* Content area with sidebars */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar - Thread list (manages its own collapsed state) */}
        <ThreadSidebar
          ref={sidebarRef}
          onThreadSelect={handleThreadSelect}
          onThreadCreated={handleThreadCreated}
          selectedThreadId={activeThread?.id}
          onShareThread={handleShareThread}
          hidden={hideSidebars}
        />

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
                showShareModal={showShareModal}
                onCloseShareModal={() => setShowShareModal(false)}
                onArtifactsChange={handleArtifactsChange}
                onInputFocus={handleInputFocus}
                onInputBlur={handleInputBlur}
              />
            </ErrorBoundary>
          ) : (
            <WelcomeScreen
              userRole={userRole || 'user'}
              brandingName={brandingName}
            />
          )}
        </main>

        {/* Right sidebar - Artifacts panel (manages its own collapsed state) */}
        <ArtifactsPanel
          threadId={artifactsData.threadId}
          uploads={artifactsData.uploads}
          generatedDocs={artifactsData.generatedDocs}
          generatedImages={artifactsData.generatedImages}
          urlSources={artifactsData.urlSources}
          onRemoveUpload={handleRemoveUpload}
          onRemoveUrlSource={handleRemoveUrlSource}
          hidden={hideSidebars}
        />
      </div>

      {/* Full-width footer */}
      <AppFooter />
    </div>
  );
}
