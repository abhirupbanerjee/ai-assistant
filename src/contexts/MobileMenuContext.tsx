'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface MobileMenuContextValue {
  // Menu visibility state
  isThreadsMenuOpen: boolean;
  isArtifactsMenuOpen: boolean;

  // Input expanded state
  isInputExpanded: boolean;

  // Computed independently so the primary Threads navigation remains
  // reachable while secondary artifact navigation may auto-hide.
  hideThreadsFAB: boolean;
  hideArtifactsFAB: boolean;

  // Computed: should hide input (scrolling down, not typing)
  shouldHideInput: boolean;

  // Scroll state (for FAB hiding)
  isScrollingDown: boolean;

  // Menu actions
  openThreadsMenu: () => void;
  closeThreadsMenu: () => void;
  openArtifactsMenu: () => void;
  closeArtifactsMenu: () => void;
  closeAllMenus: () => void;

  // Input state actions
  setInputExpanded: (expanded: boolean) => void;

  // Scroll state actions
  setScrollingDown: (scrolling: boolean) => void;
}

const MobileMenuContext = createContext<MobileMenuContextValue | null>(null);

interface MobileMenuProviderProps {
  children: ReactNode;
}

export function MobileMenuProvider({ children }: MobileMenuProviderProps) {
  const [isThreadsMenuOpen, setIsThreadsMenuOpen] = useState(false);
  const [isArtifactsMenuOpen, setIsArtifactsMenuOpen] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [isScrollingDown, setIsScrollingDown] = useState(false);

  // Open threads menu (close artifacts if open)
  const openThreadsMenu = useCallback(() => {
    setIsArtifactsMenuOpen(false);
    setIsThreadsMenuOpen(true);
  }, []);

  const closeThreadsMenu = useCallback(() => {
    setIsThreadsMenuOpen(false);
  }, []);

  // Open artifacts menu (close threads if open)
  const openArtifactsMenu = useCallback(() => {
    setIsThreadsMenuOpen(false);
    setIsArtifactsMenuOpen(true);
  }, []);

  const closeArtifactsMenu = useCallback(() => {
    setIsArtifactsMenuOpen(false);
  }, []);

  const closeAllMenus = useCallback(() => {
    setIsThreadsMenuOpen(false);
    setIsArtifactsMenuOpen(false);
  }, []);

  const setInputExpanded = useCallback((expanded: boolean) => {
    setIsInputExpanded(expanded);
  }, []);

  const setScrollingDown = useCallback((scrolling: boolean) => {
    setIsScrollingDown(scrolling);
  }, []);

  // Threads is the only persistent mobile navigation after removing the
  // contextual header, so never hide it merely because the user is typing or
  // scrolling. Artifacts remains a secondary action and may auto-hide.
  const isAnyMenuOpen = isThreadsMenuOpen || isArtifactsMenuOpen;
  const hideThreadsFAB = isAnyMenuOpen;
  const hideArtifactsFAB = isInputExpanded || isScrollingDown || isAnyMenuOpen;

  // Compute shouldHideInput: hide when scrolling down (but not when input is expanded/typing)
  const shouldHideInput = isScrollingDown && !isInputExpanded;

  const value: MobileMenuContextValue = {
    isThreadsMenuOpen,
    isArtifactsMenuOpen,
    isInputExpanded,
    hideThreadsFAB,
    hideArtifactsFAB,
    shouldHideInput,
    isScrollingDown,
    openThreadsMenu,
    closeThreadsMenu,
    openArtifactsMenu,
    closeArtifactsMenu,
    closeAllMenus,
    setInputExpanded,
    setScrollingDown,
  };

  return (
    <MobileMenuContext.Provider value={value}>
      {children}
    </MobileMenuContext.Provider>
  );
}

export function useMobileMenu() {
  const context = useContext(MobileMenuContext);
  if (!context) {
    throw new Error('useMobileMenu must be used within a MobileMenuProvider');
  }
  return context;
}

// Optional hook that doesn't throw - useful for components that may render outside provider
export function useMobileMenuOptional() {
  return useContext(MobileMenuContext);
}
