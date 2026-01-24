'use client';

import { Bot } from 'lucide-react';
import Link from 'next/link';

interface AppHeaderProps {
  title: string;
}

export default function AppHeader({ title }: AppHeaderProps) {
  return (
    <header className="shrink-0 bg-white border-b px-4 py-3 shadow-sm">
      <div className="flex items-center justify-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors cursor-pointer"
        >
          <Bot size={24} className="text-blue-600" />
          <span>{title}</span>
        </Link>
      </div>
    </header>
  );
}
