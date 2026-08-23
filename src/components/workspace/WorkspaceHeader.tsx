'use client';

/**
 * Workspace Header
 *
 * Branded header for standalone workspace mode.
 * Simpler than main app header - no settings menu.
 * Includes login/logout button for authenticated users.
 */

import { useState, useRef, useEffect } from 'react';
import { Menu, LogIn, LogOut, User, ChevronDown } from 'lucide-react';
import OrganizationSwitcher from '@/components/org/OrganizationSwitcher';

interface WorkspaceHeaderProps {
  title: string;
  logoUrl?: string | null;
  primaryColor: string;
  showMenuButton?: boolean;
  onMenuClick?: () => void;
  user?: { id: string; email: string; name: string } | null;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function WorkspaceHeader({
  title,
  logoUrl,
  primaryColor,
  showMenuButton = false,
  onMenuClick,
  user,
  onLogin,
  onLogout,
}: WorkspaceHeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header
      className="flex items-center justify-between px-4 py-3 text-white"
      style={{ backgroundColor: primaryColor }}
    >
      <div className="flex items-center gap-3">
        {showMenuButton && (
          <button
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors lg:hidden"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="w-8 h-8 rounded-lg object-cover"
          />
        )}

        <h1 className="text-lg font-semibold">{title}</h1>
      </div>

      {/* User section */}
      <div className="flex items-center gap-2">
        {user && <OrganizationSwitcher variant="on-dark" />}
        {user ? (
          // Logged in - show user menu
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium hidden sm:inline max-w-[120px] truncate">
                {user.name || user.email}
              </span>
              <ChevronDown className="w-4 h-4 hidden sm:block" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px] z-50">
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    onLogout?.();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        ) : (
          // Not logged in - show login button
          <button
            onClick={onLogin}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            <span className="text-sm font-medium">Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}
