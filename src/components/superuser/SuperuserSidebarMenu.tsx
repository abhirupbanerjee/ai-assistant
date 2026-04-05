'use client';

import { useState, useEffect } from 'react';
import {
  X,
  LayoutDashboard,
  FolderOpen,
  Users,
  FileText,
  MessageSquare,
  Sparkles,
  Settings,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Bot,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

// ============================================================================
// Type Definitions
// ============================================================================

type TabType = 'dashboard' | 'categories' | 'users' | 'documents' | 'prompts' | 'tools' | 'skills' | 'workspaces' | 'agent-bots' | 'settings';
type SettingsSection = 'llm' | 'rag' | 'reranker' | 'ocr' | 'speech' | 'cache' | 'backup';

// Generic submenu item type
interface SubmenuItem {
  id: string;
  label: string;
}

// Menu configuration item type
interface MenuConfigItem {
  id: TabType;
  label: string;
  icon: LucideIcon;
  expandable: boolean;
  submenu?: SubmenuItem[];
}

// ============================================================================
// Menu Configuration (Single Source of Truth)
// ============================================================================

const MENU_CONFIG: MenuConfigItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, expandable: false },
  { id: 'categories', label: 'Categories', icon: FolderOpen, expandable: false },
  { id: 'users', label: 'Users', icon: Users, expandable: false },
  { id: 'documents', label: 'Documents', icon: FileText, expandable: false },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare, expandable: false },
  { id: 'tools', label: 'Tools', icon: Wrench, expandable: false },
  { id: 'skills', label: 'Skills', icon: Sparkles, expandable: false },
  { id: 'workspaces', label: 'Workspaces', icon: Layers, expandable: false },
  { id: 'agent-bots', label: 'Agent Bots', icon: Bot, expandable: false },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    expandable: true,
    submenu: [
      { id: 'llm', label: 'LLM' },
      { id: 'rag', label: 'RAG' },
      { id: 'reranker', label: 'Reranker' },
      { id: 'ocr', label: 'Document Processing' },
      { id: 'speech', label: 'Speech' },
      { id: 'cache', label: 'Cache' },
      { id: 'backup', label: 'Backup' },
    ]
  },
];

// Helper to get expandable menu IDs
const EXPANDABLE_MENU_IDS = MENU_CONFIG.filter(m => m.expandable).map(m => m.id);

// Helper to check if a menu is expandable
const isExpandableMenu = (menuId: TabType): boolean => EXPANDABLE_MENU_IDS.includes(menuId);

// Helper to get menu config by ID
const getMenuConfig = (menuId: TabType): MenuConfigItem | undefined =>
  MENU_CONFIG.find(m => m.id === menuId);

// ============================================================================
// Legacy exports for backward compatibility
// ============================================================================

export const SETTINGS_SUBMENU: { id: SettingsSection; label: string }[] =
  getMenuConfig('settings')?.submenu as { id: SettingsSection; label: string }[] || [];

// ============================================================================
// Component Props
// ============================================================================

interface SuperuserSidebarMenuProps {
  activeTab: TabType;
  settingsSection: SettingsSection;
  onTabChange: (tab: TabType) => void;
  onSettingsChange: (section: SettingsSection) => void;
}

// ============================================================================
// Component
// ============================================================================

export default function SuperuserSidebarMenu({
  activeTab,
  settingsSection,
  onTabChange,
  onSettingsChange,
}: SuperuserSidebarMenuProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobileOpen]);
  const [expandedMenu, setExpandedMenu] = useState<TabType | null>(
    isExpandableMenu(activeTab) ? activeTab : null
  );

  // Get current active section for a menu
  const getActiveSection = (menuId: TabType): string => {
    switch (menuId) {
      case 'settings': return settingsSection;
      default: return '';
    }
  };

  // Generic submenu click handler
  const handleSubClick = (menuId: TabType, sectionId: string) => {
    onTabChange(menuId);

    // Route to appropriate section handler
    switch (menuId) {
      case 'settings':
        onSettingsChange(sectionId as SettingsSection);
        break;
    }

    setIsMobileOpen(false);
  };

  // Handle main tab click
  const handleTabClick = (tabId: TabType) => {
    if (isExpandableMenu(tabId)) {
      // If collapsed, expand sidebar first and show submenu
      if (isCollapsed) {
        setIsCollapsed(false);
        setExpandedMenu(tabId);
      } else {
        setExpandedMenu(expandedMenu === tabId ? null : tabId);
      }
    } else {
      onTabChange(tabId);
      setIsMobileOpen(false);
    }
  };

  // Render submenu items for a given menu
  const renderSubmenu = (menuConfig: MenuConfigItem, isExpanded: boolean) => {
    if (!menuConfig.expandable || !menuConfig.submenu || !isExpanded) {
      return null;
    }

    const activeSection = getActiveSection(menuConfig.id);

    return (
      <div className="bg-gray-50/80">
        {menuConfig.submenu.map(sub => (
          <button
            key={sub.id}
            onClick={() => handleSubClick(menuConfig.id, sub.id)}
            className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
              activeTab === menuConfig.id && activeSection === sub.id
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {sub.label}
          </button>
        ))}
      </div>
    );
  };

  // Shared menu content for mobile (always expanded)
  const MobileMenuContent = ({ showHeader = false, onClose }: { showHeader?: boolean; onClose?: () => void }) => (
    <>
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-gray-900">Superuser Menu</span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-gray-700"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          )}
        </div>
      )}
      <nav className="py-2 overflow-y-auto flex-1">
        {MENU_CONFIG.map(menuItem => {
          const Icon = menuItem.icon;
          const isActive = activeTab === menuItem.id;
          const isExpanded = expandedMenu === menuItem.id;

          return (
            <div key={menuItem.id}>
              <button
                onClick={() => handleTabClick(menuItem.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                  isActive && !menuItem.expandable
                    ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                    : isActive && menuItem.expandable
                    ? 'text-blue-700 border-l-4 border-blue-600 bg-blue-50/50'
                    : 'text-gray-700 hover:bg-gray-50 border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} />
                  <span className="font-medium text-sm">{menuItem.label}</span>
                </div>
                {menuItem.expandable && (
                  isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                )}
              </button>

              {/* Render submenu dynamically */}
              {renderSubmenu(menuItem, isExpanded)}
            </div>
          );
        })}
      </nav>
    </>
  );

  // Desktop menu content (supports collapsed state)
  const DesktopMenuContent = () => (
    <>
      {/* Collapse/Expand Toggle */}
      <div className="flex items-center justify-end px-2 py-2 border-b">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label={isCollapsed ? 'Expand menu' : 'Collapse menu'}
          title={isCollapsed ? 'Expand menu' : 'Collapse menu'}
        >
          {isCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
      <nav className="py-2 overflow-y-auto flex-1">
        {MENU_CONFIG.map(menuItem => {
          const Icon = menuItem.icon;
          const isActive = activeTab === menuItem.id;
          const isExpanded = expandedMenu === menuItem.id && !isCollapsed;

          return (
            <div key={menuItem.id}>
              <button
                onClick={() => handleTabClick(menuItem.id)}
                className={`w-full flex items-center ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'} py-2.5 text-left transition-colors ${
                  isActive && !menuItem.expandable
                    ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                    : isActive && menuItem.expandable
                    ? 'text-blue-700 border-l-4 border-blue-600 bg-blue-50/50'
                    : 'text-gray-700 hover:bg-gray-50 border-l-4 border-transparent'
                }`}
                title={isCollapsed ? menuItem.label : undefined}
              >
                <div className={`flex items-center ${isCollapsed ? '' : 'gap-3'}`}>
                  <Icon size={18} />
                  {!isCollapsed && <span className="font-medium text-sm">{menuItem.label}</span>}
                </div>
                {menuItem.expandable && !isCollapsed && (
                  isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                )}
              </button>

              {/* Render submenu dynamically - only when expanded and not collapsed */}
              {!isCollapsed && renderSubmenu(menuItem, isExpanded)}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Mobile: Icons-only strip + expandable drawer */}
      <div className="md:hidden flex flex-col shrink-0 bg-white border-r h-[calc(100vh-64px)] w-14">
        <nav className="py-2 overflow-y-auto flex-1">
          {MENU_CONFIG.map(menuItem => {
            const Icon = menuItem.icon;
            const isActive = activeTab === menuItem.id;
            return (
              <button
                key={menuItem.id}
                onClick={() => {
                  setIsMobileOpen(true);
                  // If has submenu, expand it
                  if (menuItem.expandable) {
                    setExpandedMenu(menuItem.id);
                  }
                }}
                className={`w-full flex justify-center py-3 transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                    : 'text-gray-700 hover:bg-gray-50 border-l-4 border-transparent'
                }`}
                title={menuItem.label}
                aria-label={menuItem.label}
              >
                <Icon size={20} />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Mobile Overlay - shown when drawer is open */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-50"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer - slides over the icons strip */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 w-full max-w-sm bg-white shadow-xl z-50 transform transition-transform duration-200 ease-out flex flex-col ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <MobileMenuContent showHeader onClose={() => setIsMobileOpen(false)} />
      </div>

      {/* Desktop: Fixed Sidebar with collapse support */}
      <div
        className={`hidden md:flex md:flex-col md:shrink-0 bg-white border-r h-[calc(100vh-64px)] sticky top-16 transition-all duration-200 ${
          isCollapsed ? 'md:w-14' : 'md:w-56'
        }`}
      >
        <DesktopMenuContent />
      </div>
    </>
  );
}

// Export types for use in superuser/page.tsx
export type { TabType, SettingsSection };
