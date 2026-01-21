'use client';

import { useState } from 'react';
import {
  Menu,
  X,
  LayoutDashboard,
  BarChart3,
  FolderOpen,
  FileText,
  Users,
  MessageSquare,
  Globe,
  Settings,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
} from 'lucide-react';

type TabType = 'dashboard' | 'documents' | 'categories' | 'users' | 'settings' | 'stats' | 'prompts' | 'tools' | 'workspaces';
type SettingsSection = 'rag' | 'rag-tuning' | 'llm' | 'reranker' | 'memory' | 'summarization' | 'limits' | 'backup' | 'branding' | 'cache' | 'superuser' | 'agent';
type PromptsSection = 'system-prompt' | 'category-prompts' | 'acronyms' | 'skills';
type ToolsSection = 'management' | 'dependencies' | 'routing' | 'conflicts';

interface AdminSidebarMenuProps {
  activeTab: TabType;
  settingsSection: SettingsSection;
  promptsSection: PromptsSection;
  toolsSection: ToolsSection;
  onTabChange: (tab: TabType) => void;
  onSettingsChange: (section: SettingsSection) => void;
  onPromptsChange: (section: PromptsSection) => void;
  onToolsChange: (section: ToolsSection) => void;
}

const MAIN_TABS: { id: TabType; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'categories', label: 'Categories', icon: FolderOpen },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare },
  { id: 'tools', label: 'Tools', icon: Globe },
  { id: 'workspaces', label: 'Workspaces', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const PROMPTS_SUBMENU: { id: PromptsSection; label: string }[] = [
  { id: 'system-prompt', label: 'System Prompt' },
  { id: 'category-prompts', label: 'Category Prompts' },
  { id: 'acronyms', label: 'Acronyms' },
  { id: 'skills', label: 'Skills' },
];

const SETTINGS_SUBMENU: { id: SettingsSection; label: string }[] = [
  { id: 'llm', label: 'LLM' },
  { id: 'rag', label: 'RAG' },
  { id: 'rag-tuning', label: 'RAG Tuning' },
  { id: 'reranker', label: 'Reranker' },
  { id: 'memory', label: 'Memory' },
  { id: 'summarization', label: 'Summarization' },
  { id: 'limits', label: 'Limits' },
  { id: 'agent', label: 'Autonomous Agent' },
  { id: 'superuser', label: 'Superuser' },
  { id: 'backup', label: 'Backup' },
  { id: 'branding', label: 'Branding' },
  { id: 'cache', label: 'Cache' },
];

const TOOLS_SUBMENU: { id: ToolsSection; label: string }[] = [
  { id: 'management', label: 'Tools Management' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'routing', label: 'Tool Routing' },
  { id: 'conflicts', label: 'Keyword Conflicts' },
];

export default function AdminSidebarMenu({
  activeTab,
  settingsSection,
  promptsSection,
  toolsSection,
  onTabChange,
  onSettingsChange,
  onPromptsChange,
  onToolsChange,
}: AdminSidebarMenuProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedMenu, setExpandedMenu] = useState<'prompts' | 'settings' | 'tools' | null>(
    activeTab === 'prompts' ? 'prompts' : activeTab === 'settings' ? 'settings' : activeTab === 'tools' ? 'tools' : null
  );

  const handleTabClick = (tabId: TabType) => {
    if (tabId === 'prompts' || tabId === 'settings' || tabId === 'tools') {
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

  const handlePromptsSubClick = (section: PromptsSection) => {
    onTabChange('prompts');
    onPromptsChange(section);
    setIsMobileOpen(false);
  };

  const handleSettingsSubClick = (section: SettingsSection) => {
    onTabChange('settings');
    onSettingsChange(section);
    setIsMobileOpen(false);
  };

  const handleToolsSubClick = (section: ToolsSection) => {
    onTabChange('tools');
    onToolsChange(section);
    setIsMobileOpen(false);
  };

  const getCurrentLabel = () => {
    if (activeTab === 'prompts') {
      const sub = PROMPTS_SUBMENU.find(s => s.id === promptsSection);
      return `Prompts > ${sub?.label || ''}`;
    }
    if (activeTab === 'settings') {
      const sub = SETTINGS_SUBMENU.find(s => s.id === settingsSection);
      return `Settings > ${sub?.label || ''}`;
    }
    if (activeTab === 'tools') {
      const sub = TOOLS_SUBMENU.find(s => s.id === toolsSection);
      return `Tools > ${sub?.label || ''}`;
    }
    return MAIN_TABS.find(t => t.id === activeTab)?.label || '';
  };

  // Shared menu content for mobile (always expanded)
  const MobileMenuContent = ({ showHeader = false, onClose }: { showHeader?: boolean; onClose?: () => void }) => (
    <>
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-gray-900">Admin Menu</span>
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
        {MAIN_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasSubmenu = tab.id === 'prompts' || tab.id === 'settings' || tab.id === 'tools';
          const isExpanded = expandedMenu === tab.id;

          return (
            <div key={tab.id}>
              <button
                onClick={() => handleTabClick(tab.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                  isActive && !hasSubmenu
                    ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                    : isActive && hasSubmenu
                    ? 'text-blue-700 border-l-4 border-blue-600 bg-blue-50/50'
                    : 'text-gray-700 hover:bg-gray-50 border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} />
                  <span className="font-medium text-sm">{tab.label}</span>
                </div>
                {hasSubmenu && (
                  isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                )}
              </button>

              {/* Prompts Submenu */}
              {tab.id === 'prompts' && isExpanded && (
                <div className="bg-gray-50/80">
                  {PROMPTS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handlePromptsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'prompts' && promptsSection === sub.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Tools Submenu */}
              {tab.id === 'tools' && isExpanded && (
                <div className="bg-gray-50/80">
                  {TOOLS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleToolsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'tools' && toolsSection === sub.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Settings Submenu */}
              {tab.id === 'settings' && isExpanded && (
                <div className="bg-gray-50/80">
                  {SETTINGS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleSettingsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'settings' && settingsSection === sub.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
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
        {MAIN_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasSubmenu = tab.id === 'prompts' || tab.id === 'settings' || tab.id === 'tools';
          const isExpanded = expandedMenu === tab.id && !isCollapsed;

          return (
            <div key={tab.id}>
              <button
                onClick={() => handleTabClick(tab.id)}
                className={`w-full flex items-center ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'} py-2.5 text-left transition-colors ${
                  isActive && !hasSubmenu
                    ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                    : isActive && hasSubmenu
                    ? 'text-blue-700 border-l-4 border-blue-600 bg-blue-50/50'
                    : 'text-gray-700 hover:bg-gray-50 border-l-4 border-transparent'
                }`}
                title={isCollapsed ? tab.label : undefined}
              >
                <div className={`flex items-center ${isCollapsed ? '' : 'gap-3'}`}>
                  <Icon size={18} />
                  {!isCollapsed && <span className="font-medium text-sm">{tab.label}</span>}
                </div>
                {hasSubmenu && !isCollapsed && (
                  isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                )}
              </button>

              {/* Prompts Submenu - only show when expanded and not collapsed */}
              {tab.id === 'prompts' && isExpanded && (
                <div className="bg-gray-50/80">
                  {PROMPTS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handlePromptsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'prompts' && promptsSection === sub.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Tools Submenu - only show when expanded and not collapsed */}
              {tab.id === 'tools' && isExpanded && (
                <div className="bg-gray-50/80">
                  {TOOLS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleToolsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'tools' && toolsSection === sub.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Settings Submenu - only show when expanded and not collapsed */}
              {tab.id === 'settings' && isExpanded && (
                <div className="bg-gray-50/80">
                  {SETTINGS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleSettingsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'settings' && settingsSection === sub.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Mobile: Hamburger Button */}
      <div className="md:hidden">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="flex items-center gap-2 p-2 text-gray-600 hover:text-gray-900"
          aria-label="Open menu"
        >
          <Menu size={24} />
          <span className="text-sm font-medium truncate max-w-[200px]">{getCurrentLabel()}</span>
        </button>

        {/* Mobile Overlay */}
        {isMobileOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30"
            onClick={() => setIsMobileOpen(false)}
          />
        )}

        {/* Mobile Drawer */}
        <div
          className={`fixed top-0 left-0 h-full w-64 bg-white shadow-xl z-40 transform transition-transform duration-200 flex flex-col ${
            isMobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <MobileMenuContent showHeader onClose={() => setIsMobileOpen(false)} />
        </div>
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
