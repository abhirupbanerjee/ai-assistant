'use client';

import { X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => {
        const bgColor = {
          success: 'bg-green-50 text-green-700 border-green-200',
          error: 'bg-red-50 text-red-700 border-red-200',
          info: 'bg-blue-50 text-blue-700 border-blue-200',
        }[toast.type];

        return (
          <div
            key={toast.id}
            className={`p-4 rounded-lg border ${bgColor} shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300`}
            role="alert"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium">{toast.message}</p>
              <button
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 hover:opacity-70 transition-opacity"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
