import { Suspense } from 'react';
import HelpCenter from '@/components/help/HelpCenter';

export default function HelpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          Loading Help Center...
        </div>
      }
    >
      <HelpCenter />
    </Suspense>
  );
}
