'use client';

import { useState } from 'react';
import {
  Menu,
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
} from 'lucide-react';

type TabType = 'dashboard' | 'categories' | 'users' | 'documents' | 'prompts' | 'workspaces' | 'skills' | 'agent-bots' | 'settings';
type PromptsSection = 'global-prompt' | 'category-prompts';
type SkillsSection = 'tools' | 'skills';
type SettingsSection = 'rag-tuning' | 'backup';

interface SuperuserSidebarMenuProps {
  activeTab: TabType;
  promptsSection: PromptsSection;
  skillsSection: SkillsSection;
  settingsSection: SettingsSection;
  onTabChange: (tab: TabType) => void;
  onPromptsChange: (section: PromptsSection) => void;
  onSkillsChange: (section: SkillsSection) => void;
  onSettingsChange: (section: SettingsSection) => void;
}

const MAIN_TABS: { id: TabType; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'categories', label: 'Categories', icon: FolderOpen },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare },
  { id: 'workspaces', label: 'Workspaces', icon: Layers },
  { id: 'skills', label: 'Skill Library', icon: Sparkles },
  { id: 'agent-bots', label: 'Agent Bots', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const PROMPTS_SUBMENU: { id: PromptsSection; label: string }[] = [
  { id: 'global-prompt', label: 'Global Prompt' },
  { id: 'category-prompts', label: 'Category Prompts' },
];

const SKILLS_SUBMENU: { id: SkillsSection; label: string }[] = [
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
];

const SETTINGS_SUBMENU: { id: SettingsSection; label: string }[] = [
  { id: 'rag-tuning', label: 'RAG Tuning' },
  { id: 'backup', label: 'Backup' },
];

export default function SuperuserSidebarMenu({
  activeTab,
  promptsSection,
  skillsSection,
  settingsSection,
  onTabChange,
  onPromptsChange,
  onSkillsChange,
  onSettingsChange,
}: SuperuserSidebarMenuProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedMenu, setExpandedMenu] = useState<'prompts' | 'skills' | 'settings' | null>(
    activeTab === 'prompts' ? 'prompts' : activeTab === 'skills' ? 'skills' : activeTab === 'settings' ? 'settings' : null
  );

  const handleTabClick = (tabId: TabType) => {
    if (tabId === 'prompts' || tabId === 'skills' || tabId === 'settings') {
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

  const handleSkillsSubClick = (section: SkillsSection) => {
    onTabChange('skills');
    onSkillsChange(section);
    setIsMobileOpen(false);
  };

  const handleSettingsSubClick = (section: SettingsSection) => {
    onTabChange('settings');
    onSettingsChange(section);
    setIsMobileOpen(false);
  };

  const getCurrentLabel = () => {
    if (activeTab === 'prompts') {
      const sub = PROMPTS_SUBMENU.find(s => s.id === promptsSection);
      return `Prompts > ${sub?.label || ''}`;
    }
    if (activeTab === 'skills') {
      const sub = SKILLS_SUBMENU.find(s => s.id === skillsSection);
      return `Skill Library > ${sub?.label || ''}`;
    }
    if (activeTab === 'settings') {
      const sub = SETTINGS_SUBMENU.find(s => s.id === settingsSection);
      return `Settings > ${sub?.label || ''}`;
    }
    return MAIN_TABS.find(t => t.id === activeTab)?.label || '';
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
        {MAIN_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasSubmenu = tab.id === 'prompts' || tab.id === 'skills' || tab.id === 'settings';
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

              {/* Skills Submenu */}
              {tab.id === 'skills' && isExpanded && (
                <div className="bg-gray-50/80">
                  {SKILLS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleSkillsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'skills' && skillsSection === sub.id
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
          const hasSubmenu = tab.id === 'prompts' || tab.id === 'skills' || tab.id === 'settings';
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

              {/* Skills Submenu - only show when expanded and not collapsed */}
              {tab.id === 'skills' && isExpanded && (
                <div className="bg-gray-50/80">
                  {SKILLS_SUBMENU.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleSkillsSubClick(sub.id)}
                      className={`w-full pl-11 pr-4 py-2 text-left text-sm transition-colors ${
                        activeTab === 'skills' && skillsSection === sub.id
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
      {/* Mobile: Icons-only strip + expandable drawer */}
      <div className="md:hidden flex flex-col shrink-0 bg-white border-r h-[calc(100vh-64px)] w-14">
        <nav className="py-2 overflow-y-auto flex-1">
          {MAIN_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setIsMobileOpen(true);
                  // If has submenu, expand it
                  if (tab.id === 'prompts' || tab.id === 'skills' || tab.id === 'settings') {
                    setExpandedMenu(tab.id);
                  }
                }}
                className={`w-full flex justify-center py-3 transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                    : 'text-gray-700 hover:bg-gray-50 border-l-4 border-transparent'
                }`}
                title={tab.label}
                aria-label={tab.label}
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
          className="md:hidden fixed inset-0 bg-black/30 z-30"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer - slides over the icons strip */}
      <div
        className={`md:hidden fixed top-16 left-0 h-[calc(100vh-64px)] w-64 bg-white shadow-xl z-40 transform transition-transform duration-200 flex flex-col ${
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
