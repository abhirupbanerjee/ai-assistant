'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Copy, Download, Check } from 'lucide-react';
import type { ViewableArtifact } from '@/types';

interface ArtifactMenuButtonProps {
  artifact: ViewableArtifact;
}

/**
 * Three-dot menu with Copy and Download actions for artifacts.
 */
export default function ArtifactMenuButton({ artifact }: ArtifactMenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Copy content to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setIsOpen(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Download as file
  const handleDownload = () => {
    // If we have a download URL, use it directly
    if (artifact.downloadUrl) {
      window.open(artifact.downloadUrl, '_blank');
      setIsOpen(false);
      return;
    }

    // Otherwise create a blob and download
    const mimeType = artifact.type === 'markdown'
      ? 'text/markdown'
      : artifact.type === 'code'
        ? 'text/plain'
        : 'text/plain';

    const blob = new Blob([artifact.content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setIsOpen(false);
  };

  return (
    <div ref={menuRef} className="relative">
      {/* Menu trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label="Artifact options"
      >
        <MoreVertical size={18} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {/* Copy option */}
          <button
            onClick={handleCopy}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check size={16} className="text-green-500" />
                <span className="text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={16} />
                <span>Copy content</span>
              </>
            )}
          </button>

          {/* Download option */}
          <button
            onClick={handleDownload}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Download size={16} />
            <span>Download</span>
          </button>
        </div>
      )}
    </div>
  );
}
