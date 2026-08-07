'use client';

interface SkeletonArtifactProps {
  variant?: 'document' | 'chart' | 'generic';
}

/**
 * Shimmer skeleton placeholder shown while an artifact is loading
 * (e.g. during Google Drive upload for PPTX/XLSX preview).
 */
export default function SkeletonArtifact({ variant = 'generic' }: SkeletonArtifactProps) {
  if (variant === 'document') {
    return (
      <div className="flex flex-col h-full p-6 gap-3 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3" />
        <div className="space-y-2 mt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-3 bg-gray-200 rounded"
              style={{ width: `${85 - (i % 3) * 12}%` }}
            />
          ))}
        </div>
        <div className="h-4 bg-gray-200 rounded w-2/3 mt-4" />
        <div className="space-y-2 mt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-3 bg-gray-200 rounded"
              style={{ width: `${80 - (i % 3) * 10}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'chart') {
    return (
      <div className="flex flex-col h-full p-6 gap-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/4" />
        <div className="flex-1 flex items-end gap-2 mt-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-gray-200 rounded-t"
              style={{ height: `${40 + ((i * 37) % 50)}%` }}
            />
          ))}
        </div>
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  // Generic
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6 animate-pulse">
      <div className="w-full max-w-md space-y-3">
        <div className="h-6 bg-gray-200 rounded w-1/2 mx-auto" />
        <div className="h-3 bg-gray-200 rounded w-3/4 mx-auto" />
        <div className="h-3 bg-gray-200 rounded w-2/3 mx-auto" />
      </div>
    </div>
  );
}
