'use client';

/**
 * Skeleton loading placeholder shown while the LLM response is being generated.
 * Mimics the layout of a real MessageBubble with shimmer animation.
 */
export default function SkeletonMessage() {
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-full sm:max-w-[80%] rounded-2xl px-4 py-4 bg-gray-100 w-full animate-pulse-slow">
        {/* Simulated paragraph lines */}
        <div className="space-y-2.5 mb-3">
          <div className="h-3 bg-gray-200 rounded w-full" />
          <div className="h-3 bg-gray-200 rounded w-5/6" />
          <div className="h-3 bg-gray-200 rounded w-4/6" />
          <div className="h-3 bg-gray-200 rounded w-3/6" />
        </div>

        {/* Simulated sub-heading + more lines */}
        <div className="space-y-2.5 mb-3">
          <div className="h-3 bg-gray-200 rounded w-2/6" />
          <div className="h-3 bg-gray-200 rounded w-full" />
          <div className="h-3 bg-gray-200 rounded w-5/6" />
          <div className="h-3 bg-gray-200 rounded w-4/6" />
        </div>

        {/* Simulated timestamp line */}
        <div className="h-2.5 bg-gray-200 rounded w-16 mt-3" />
      </div>
    </div>
  );
}

/**
 * Compact skeleton used inside the isolated streaming area while the first
 * tokens are arriving. Shows only 2-3 lines for minimal layout shift.
 */
export function CompactSkeletonMessage() {
  return (
    <div className="flex justify-start">
      <div className="max-w-full sm:max-w-[80%] rounded-2xl px-4 py-3 bg-gray-100 w-full animate-pulse-slow">
        <div className="space-y-2.5">
          <div className="h-3 bg-gray-200 rounded w-full" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}