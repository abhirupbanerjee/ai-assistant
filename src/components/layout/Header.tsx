'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Settings, LogOut, User, ChevronDown } from 'lucide-react';

export default function Header() {
  const { data: session } = useSession();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Use authoritative role from session (set by /api/auth/me)
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  const handleSignOut = () => {
    signOut({ callbackUrl: '/' });
  };

  return (
    <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
      <Link href="/chat" className="text-xl font-bold text-gray-900">
        AI Assistant
      </Link>

      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100"
        >
          <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center">
            {session?.user?.name?.[0] || <User size={16} />}
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:inline">
            {session?.user?.name || 'User'}
          </span>
          <ChevronDown size={16} className="text-gray-500" />
        </button>

        {isDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsDropdownOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border z-20">
              <div className="px-4 py-3 border-b">
                <p className="text-sm font-medium text-gray-900">
                  {session?.user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {session?.user?.email || 'dev@localhost'}
                </p>
              </div>

              <div className="py-1">
                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <Settings size={16} />
                    Admin Dashboard
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full"
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
