'use client';

import { useCallback } from 'react';

interface ResizeHandleProps {
  side: 'left' | 'right';
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing?: boolean;
}

export default function ResizeHandle({ side, onMouseDown, isResizing }: ResizeHandleProps) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onMouseDown(e);
  }, [onMouseDown]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        absolute top-0 bottom-0 w-1 z-10
        cursor-col-resize
        transition-colors duration-150
        hover:bg-blue-400
        ${isResizing ? 'bg-blue-500' : 'bg-transparent hover:bg-blue-400/50'}
        ${side === 'left' ? 'left-0' : 'right-0'}
        group
      `}
      title="Drag to resize"
    >
      {/* Wider hit area for easier grabbing */}
      <div
        className={`
          absolute top-0 bottom-0 w-3
          ${side === 'left' ? '-left-1' : '-right-1'}
        `}
      />
      {/* Visual indicator on hover */}
      <div
        className={`
          absolute top-1/2 -translate-y-1/2 w-1 h-8 rounded-full
          bg-gray-300 opacity-0 group-hover:opacity-100 transition-opacity
          ${side === 'left' ? 'left-0' : 'right-0'}
        `}
      />
    </div>
  );
}
