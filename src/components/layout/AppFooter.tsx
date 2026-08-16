'use client';

import { AlertTriangle } from 'lucide-react';

export default function AppFooter() {
  return (
    <footer 
      className="shrink-0 bg-amber-50 border-t border-amber-200 px-2 py-2 md:px-4 md:py-3"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex items-center justify-center gap-1.5 md:gap-2">
        <AlertTriangle size={14} className="text-amber-600 shrink-0" />
        <p className="text-[11px] md:text-xs text-amber-700 text-center whitespace-nowrap">
          <span className="md:hidden">AI-generated — verify information.</span>
          <span className="hidden md:inline">This is AI generated response. Please verify the information.</span>
        </p>
      </div>
    </footer>
  );
}
