'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import ChatWindow, { type ChatWindowRef } from '@/components/chat/ChatWindow';
import ThreadSidebar, { type ThreadSidebarRef } from '@/components/layout/ThreadSidebar';

import ArtifactsPanel from '@/components/chat/ArtifactsPanel';
import ArtifactCanvas from '@/components/chat/ArtifactCanvas';
import MobileArtifactCanvas from '@/components/mobile/MobileArtifactCanvas';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useCanvasState } from '@/hooks/useCanvasState';
import { MobileMenuProvider, useMobileMenuOptional } from '@/contexts/MobileMenuContext';
import MobileThreadsMenu from '@/components/mobile/MobileThreadsMenu';
import MobileArtifactsMenu from '@/components/mobile/MobileArtifactsMenu';
import MobileFABs from '@/components/mobile/MobileFABs';
import type { Thread, UserSubscription, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, PodcastHint, DiagramHint, StarterPrompt, ArtifactCanvasItem, ArtifactComment } from '@/types';
import { buildDocCanvasItem, buildImageCanvasItem, buildPodcastCanvasItem, buildDiagramCanvasItem, getExpirationVariant } from '@/lib/artifact-builders';

const COLLAPSED_PANEL_WIDTH_PX = 56;

interface WelcomeConfig {
  title?: string;
  message?: string;
}

// Inner component that uses the mobile menu context
function HomeContent() {
  const { data: session } = useSession();
  const chatWindowRef = useRef<ChatWindowRef>(null);
  const sidebarRef = useRef<ThreadSidebarRef>(null);
  const threadSidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const chatMainPanelRef = useRef<ImperativePanelHandle>(null);
  const artifactsPanelRef = useRef<ImperativePanelHandle>(null);
  const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const desktopLayoutRef = useRef<HTMLDivElement>(null);

  // Phase 2.3: read a shared payload from the Android share sheet
  // (redirected here by /api/share-target). Memoize so the value is stable
  // across re-renders; the MessageInput only consumes it once.
  const searchParams = useSearchParams();
  const shareDraft = useMemo(
    () => {
      const raw = searchParams.get('share');
      return raw && raw.trim().length > 0 ? raw.trim() : undefined;
    },
    [searchParams]
  );
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [userSubscriptions, setUserSubscriptions] = useState<UserSubscription[]>([]);
  const [brandingName, setBrandingName] = useState<string>('AI Assistant');
  const [brandingBotIcon, setBrandingBotIcon] = useState<string>('policy');
  const [brandingSubtitle, setBrandingSubtitle] = useState<string>('Ask questions about policy documents');
  const [globalWelcome, setGlobalWelcome] = useState<WelcomeConfig>({});
  const [globalStarterPrompts, setGlobalStarterPrompts] = useState<StarterPrompt[]>([]);
  const [threadCount, setThreadCount] = useState(0);
  const [isThreadSidebarCollapsed, setIsThreadSidebarCollapsed] = useState(false);
  const [isArtifactsPanelCollapsed, setIsArtifactsPanelCollapsed] = useState(false);
  const [collapsedPanelSize, setCollapsedPanelSize] = useState(3);
  const isMobile = useIsMobile();
  const mobileMenu = useMobileMenuOptional();
  const canvasState = useCanvasState();
  // Destructure openCanvas for a stable dependency in handleOpenCanvas below.
  // Depending on the whole canvasState object (a fresh literal every render)
  // would recreate handleOpenCanvas each render and break MessageBubble's
  // memoization. openCanvas is individually stable (useCallback with []).
  const { openCanvas } = canvasState;

  const [pendingArtifactComments, setPendingArtifactComments] = useState<ArtifactComment[]>([]);

  // react-resizable-panels uses percentages. Convert the fixed icon-rail width
  // to a responsive percentage so both collapsed panels remain about 56px.
  useEffect(() => {
    const layout = desktopLayoutRef.current;
    if (!layout || isMobile) return;

    const updateCollapsedSize = () => {
      const width = layout.getBoundingClientRect().width;
      if (width <= 0) return;

      setCollapsedPanelSize((current) => {
        const next = (COLLAPSED_PANEL_WIDTH_PX / width) * 100;
        return Math.abs(current - next) > 0.01 ? next : current;
      });
    };

    updateCollapsedSize();
    const resizeObserver = new ResizeObserver(updateCollapsedSize);
    resizeObserver.observe(layout);
    return () => resizeObserver.disconnect();
  }, [isMobile]);

  // Re-apply collapse when the viewport changes so the percentage continues
  // to resolve to the fixed-width icon rail.
  useEffect(() => {
    if (isThreadSidebarCollapsed) threadSidebarPanelRef.current?.collapse();
    if (isArtifactsPanelCollapsed) artifactsPanelRef.current?.collapse();
  }, [collapsedPanelSize, isThreadSidebarCollapsed, isArtifactsPanelCollapsed]);

  const logPanelCollapseResult = useCallback((
    panel: 'threads' | 'artifacts',
    collapsed: boolean,
    panelRef: React.RefObject<ImperativePanelHandle | null>
  ) => {
    if (process.env.NODE_ENV === 'production') return;

    window.requestAnimationFrame(() => {
      console.debug('[ChatLayout] collapse result', {
        panel,
        collapsed,
        targetWidthPx: COLLAPSED_PANEL_WIDTH_PX,
        actualPanelSizePercent: panelRef.current?.getSize(),
      });
    });
  }, []);

  const handleThreadSidebarCollapseChange = useCallback((collapsed: boolean) => {
    if (collapsed) {
      threadSidebarPanelRef.current?.collapse();
    } else {
      threadSidebarPanelRef.current?.expand();
    }
  }, []);

  const handleArtifactsPanelCollapseChange = useCallback((collapsed: boolean) => {
    if (collapsed) {
      artifactsPanelRef.current?.collapse();
    } else {
      artifactsPanelRef.current?.expand();
    }
  }, []);

  const handleThreadSidebarCollapsed = useCallback(() => {
    setIsThreadSidebarCollapsed(true);
    logPanelCollapseResult('threads', true, threadSidebarPanelRef);
  }, [logPanelCollapseResult]);

  const handleThreadSidebarExpanded = useCallback(() => {
    setIsThreadSidebarCollapsed(false);
    logPanelCollapseResult('threads', false, threadSidebarPanelRef);
  }, [logPanelCollapseResult]);

  const handleArtifactsPanelCollapsed = useCallback(() => {
    setIsArtifactsPanelCollapsed(true);
    logPanelCollapseResult('artifacts', true, artifactsPanelRef);
  }, [logPanelCollapseResult]);

  const handleArtifactsPanelExpanded = useCallback(() => {
    setIsArtifactsPanelCollapsed(false);
    logPanelCollapseResult('artifacts', false, artifactsPanelRef);
  }, [logPanelCollapseResult]);

  // Imperatively collapse/expand panels when canvas mode changes
  useEffect(() => {
    if (isMobile) return;

    if (canvasState.mode === 'canvas') {
      threadSidebarPanelRef.current?.collapse();
      artifactsPanelRef.current?.resize(66);
    } else {
      threadSidebarPanelRef.current?.expand();
      artifactsPanelRef.current?.resize(25);
    }
  }, [canvasState.mode, isMobile]);

  // Swipe gestures for mobile navigation
  useSwipeGesture({
    onSwipeLeft: () => {
      // Left swipe → open artifacts menu (right edge)
      mobileMenu?.openArtifactsMenu();
    },
    onSwipeRight: () => {
      // Right swipe → open threads menu (left edge)
      mobileMenu?.openThreadsMenu();
    },
    rightEdgeOnly: false, // Allow swipes from anywhere
    disabled: (mobileMenu?.isThreadsMenuOpen || mobileMenu?.isArtifactsMenuOpen) || !isMobile || canvasState.mode === 'canvas',
  });

  // Artifacts state (lifted from ChatWindow)
  const [artifactsData, setArtifactsData] = useState<{
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    generatedPodcasts: PodcastHint[];
    generatedDiagrams: DiagramHint[];
    urlSources: UrlSource[];
  }>({
    threadId: null,
    uploads: [],
    generatedDocs: [],
    generatedImages: [],
    generatedPodcasts: [],
    generatedDiagrams: [],
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

        // Load full branding data
        const brandingResponse = await fetch('/api/branding');
        if (brandingResponse.ok) {
          const brandingData = await brandingResponse.json();
          setBrandingName(brandingData.botName || 'AI Assistant');
          setBrandingBotIcon(brandingData.botIcon || 'policy');
          setBrandingSubtitle(brandingData.subtitle || 'Ask questions about policy documents');
          setGlobalWelcome({
            title: brandingData.welcomeTitle || undefined,
            message: brandingData.welcomeMessage || undefined,
          });
          setGlobalStarterPrompts(brandingData.starterPrompts || []);
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
    generatedDiagrams: DiagramHint[];
    urlSources: UrlSource[];
  }) => {
    setArtifactsData(data);
  }, []);

  // Viewable artifacts for canvas navigation siblings — built from the
  // page-level artifactsData (docs → images → podcasts, excluding expired).
  // Diagrams/charts live per-message inside ChatWindow and are not included
  // here, but docs/images/podcasts cover the common cases opened from chat.
  const viewableCanvasSiblings = useMemo<ArtifactCanvasItem[]>(() => {
    const items: ArtifactCanvasItem[] = [];
    for (const doc of artifactsData.generatedDocs) {
      if (getExpirationVariant(doc.expiresAt) !== 'expired') items.push(buildDocCanvasItem(doc));
    }
    for (const img of artifactsData.generatedImages) {
      if (getExpirationVariant(img.expiresAt) !== 'expired') items.push(buildImageCanvasItem(img));
    }
    for (const podcast of artifactsData.generatedPodcasts) {
      if (getExpirationVariant(podcast.expiresAt) !== 'expired') items.push(buildPodcastCanvasItem(podcast));
    }
    artifactsData.generatedDiagrams.forEach((diagram, idx) => {
      items.push(buildDiagramCanvasItem(diagram, idx));
    });
    return items;
  }, [artifactsData.generatedDocs, artifactsData.generatedImages, artifactsData.generatedPodcasts, artifactsData.generatedDiagrams]);

  // Keep a ref to the latest siblings so handleOpenCanvas identity stays stable
  // and MessageBubble memoization isn't invalidated every time a new artifact is generated.
  const viewableCanvasSiblingsRef = useRef(viewableCanvasSiblings);
  useEffect(() => {
    viewableCanvasSiblingsRef.current = viewableCanvasSiblings;
  }, [viewableCanvasSiblings]);

  // Open a chat artifact in the Canvas side panel. Diagram cards provide their
  // message-local siblings; other artifact cards use the page-level list.
  const handleOpenCanvas = useCallback((item: ArtifactCanvasItem, siblings?: ArtifactCanvasItem[]) => {
    const requestedSiblings = siblings?.length ? siblings : viewableCanvasSiblingsRef.current;
    const canvasSiblings = requestedSiblings.some((sibling) => sibling.artifactId === item.artifactId)
      ? requestedSiblings
      : [...requestedSiblings, item];
    openCanvas(item, canvasSiblings);
  }, [openCanvas]);

  const handleSendComments = useCallback((comments: ArtifactComment[]) => {
    setPendingArtifactComments(prev => [...prev, ...comments]);
  }, []);

  const handleRemoveArtifactComment = useCallback((commentId: string) => {
    setPendingArtifactComments(prev => prev.filter(c => c.commentId !== commentId));
  }, []);

  const handleClearArtifactComments = useCallback(() => {
    setPendingArtifactComments([]);
  }, []);

  // Clear pending comments once the user sends a message.
  useEffect(() => {
    if (pendingArtifactComments.length === 0) return;
    // We only know the message was sent if the canvas closes (comments were
    // attached). For simplicity, rely on the send path clearing via ChatWindow
    // sending artifactComments. As a safety net, clear when thread changes.
    return () => {
      setPendingArtifactComments([]);
    };
  }, [activeThread?.id]);

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

  // Calculate artifact count for FAB badge
  const artifactCount = artifactsData.generatedDocs.length +
    artifactsData.generatedImages.length +
    artifactsData.generatedPodcasts.length +
    artifactsData.uploads.length +
    artifactsData.urlSources.length;

  // Handler for creating new thread from mobile header
  const handleNewThreadFromHeader = useCallback(() => {
    setActiveThread(null);
  }, []);

  return (
    <div className="fixed-layout bg-gray-50">
      {/* Header - shows help link */}
      <AppHeader
        title={getHeaderTitle()}
        botIcon={brandingBotIcon}
        isMobile={isMobile}
        activeThread={activeThread}
        onOpenThreadsMenu={mobileMenu?.openThreadsMenu}
        onNewThread={handleNewThreadFromHeader}
        onHomeClick={handleNewThreadFromHeader}
      />

      {/* Content area */}
      <div ref={desktopLayoutRef} className="flex flex-1 min-h-0 overflow-hidden">
        <PanelGroup
          direction="horizontal"
          autoSaveId="chat-layout"
          ref={panelGroupRef}
          className="flex-1"
        >
          {!isMobile && (
            <>
              <Panel
                ref={threadSidebarPanelRef}
                id="thread-sidebar"
                defaultSize={20}
                minSize={15}
                maxSize={35}
                collapsible
                collapsedSize={collapsedPanelSize}
                onCollapse={handleThreadSidebarCollapsed}
                onExpand={handleThreadSidebarExpanded}
              >
                <ThreadSidebar
                  ref={sidebarRef}
                  onThreadSelect={handleThreadSelect}
                  onThreadCreated={handleThreadCreated}
                  selectedThreadId={activeThread?.id}
                  collapsed={isThreadSidebarCollapsed}
                  onCollapseChange={handleThreadSidebarCollapseChange}
                />
              </Panel>
              <PanelResizeHandle
                className="group relative w-1.5 bg-gray-200 hover:bg-blue-500 active:bg-blue-600 transition-colors cursor-col-resize hidden md:flex items-center justify-center z-10"
                onDoubleClick={() => panelGroupRef.current?.setLayout([20, 55, 25])}
              >
                <div className="w-0.5 h-6 bg-gray-400/60 rounded-full group-hover:bg-white/80 pointer-events-none" />
              </PanelResizeHandle>
            </>
          )}

          <Panel
            ref={chatMainPanelRef}
            id="chat-main"
            defaultSize={isMobile ? 100 : 55}
            minSize={25}
          >
            <main className="flex flex-col min-h-0 h-full overflow-hidden bg-white">
              <ErrorBoundary moduleName="ChatWindow">
                <ChatWindow
                  ref={chatWindowRef}
                  activeThread={activeThread}
                  onThreadCreated={handleThreadCreated}
                  userSubscriptions={userSubscriptions}
                  brandingName={brandingName}
                  brandingSubtitle={brandingSubtitle}
                  globalWelcome={globalWelcome}
                  globalStarterPrompts={globalStarterPrompts}
                  onArtifactsChange={handleArtifactsChange}
                  onInputFocus={handleInputFocus}
                  onInputBlur={handleInputBlur}
                  initialDraft={shareDraft}
                  onOpenCanvas={handleOpenCanvas}
                  artifactComments={pendingArtifactComments}
                  onRemoveArtifactComment={handleRemoveArtifactComment}
                  onClearArtifactComments={handleClearArtifactComments}
                />
              </ErrorBoundary>
            </main>
          </Panel>

          {!isMobile && (
            <>
              <PanelResizeHandle
                className="group relative w-1.5 bg-gray-200 hover:bg-blue-500 active:bg-blue-600 transition-colors cursor-col-resize hidden md:flex items-center justify-center z-10"
                onDoubleClick={() => panelGroupRef.current?.setLayout([20, 55, 25])}
              >
                <div className="w-0.5 h-6 bg-gray-400/60 rounded-full group-hover:bg-white/80 pointer-events-none" />
              </PanelResizeHandle>
              <Panel
                ref={artifactsPanelRef}
                id="artifacts-panel"
                defaultSize={25}
                minSize={15}
                maxSize={75}
                collapsible
                collapsedSize={collapsedPanelSize}
                onCollapse={handleArtifactsPanelCollapsed}
                onExpand={handleArtifactsPanelExpanded}
              >
                {canvasState.mode === 'canvas' && canvasState.artifact ? (
                  <ArtifactCanvas
                    artifact={canvasState.artifact}
                    onClose={canvasState.closeCanvas}
                    threadId={artifactsData.threadId}
                    siblings={canvasState.siblings}
                    onNavigate={canvasState.navigateTo}
                    onSendComments={handleSendComments}
                  />
                ) : (
                  <ArtifactsPanel
                    threadId={artifactsData.threadId}
                    uploads={artifactsData.uploads}
                    generatedDocs={artifactsData.generatedDocs}
                    generatedImages={artifactsData.generatedImages}
                    generatedPodcasts={artifactsData.generatedPodcasts}
                    generatedDiagrams={artifactsData.generatedDiagrams}
                    urlSources={artifactsData.urlSources}
                    onRemoveUpload={handleRemoveUpload}
                    onRemoveUrlSource={handleRemoveUrlSource}
                    onArtifactClick={(item: ArtifactCanvasItem, siblings: ArtifactCanvasItem[]) =>
                      canvasState.openCanvas(item, siblings)
                    }
                    collapsed={isArtifactsPanelCollapsed}
                    onCollapseChange={handleArtifactsPanelCollapseChange}
                  />
                )}
              </Panel>
            </>
          )}
        </PanelGroup>
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
          {canvasState.mode === 'canvas' && canvasState.artifact ? (
            <MobileArtifactCanvas
              artifact={canvasState.artifact}
              onClose={canvasState.closeCanvas}
              siblings={canvasState.siblings}
              onNavigate={canvasState.navigateTo}
              onSendComments={handleSendComments}
            />
          ) : (
            <MobileArtifactsMenu
              threadId={artifactsData.threadId}
              uploads={artifactsData.uploads}
              generatedDocs={artifactsData.generatedDocs}
              generatedImages={artifactsData.generatedImages}
              generatedPodcasts={artifactsData.generatedPodcasts}
              urlSources={artifactsData.urlSources}
              onRemoveUpload={handleRemoveUpload}
              onRemoveUrlSource={handleRemoveUrlSource}
              onArtifactClick={(item: ArtifactCanvasItem, siblings: ArtifactCanvasItem[]) =>
                canvasState.openCanvas(item, siblings)
              }
            />
          )}
        </>
      )}

      {/* Full-width footer */}
      <AppFooter />
    </div>
  );
}

// Main export wraps content in MobileMenuProvider + Suspense.
// Suspense is required by Next.js App Router because HomeContent now calls
// useSearchParams() (Phase 2.3 share-target prefill).
export default function Home() {
  return (
    <MobileMenuProvider>
      <Suspense fallback={null}>
        <HomeContent />
      </Suspense>
    </MobileMenuProvider>
  );
}
