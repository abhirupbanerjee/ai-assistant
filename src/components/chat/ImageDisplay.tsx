'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Download, Maximize2, X, ImageIcon, Sparkles, Cpu } from 'lucide-react';
import type { GeneratedImageInfo } from '@/types';

interface ImageDisplayProps {
  image: GeneratedImageInfo;
}

/**
 * Get provider icon and label
 */
function getProviderInfo(provider?: string): { icon: React.ReactNode; label: string } {
  switch (provider) {
    case 'openai':
      return {
        icon: <ImageIcon size={12} className="text-emerald-600" />,
        label: 'DALL-E',
      };
    case 'gemini':
      return {
        icon: <Sparkles size={12} className="text-purple-600" />,
        label: 'Gemini',
      };
    default:
      return {
        icon: <Cpu size={12} className="text-gray-600" />,
        label: 'AI Generated',
      };
  }
}

export default function ImageDisplay({ image }: ImageDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [modalImageError, setModalImageError] = useState(false);

  const providerInfo = getProviderInfo(image.provider);

  // Use thumbnail for preview, full URL for expanded view
  const previewUrl = image.thumbnailUrl || image.url;
  const fullUrl = image.url;

  const handleDownload = () => {
    // Open download URL in new tab
    window.open(fullUrl, '_blank');
  };

  const handleExpand = () => {
    setModalImageError(false); // Reset modal error state when opening
    setIsExpanded(true);
  };

  const handleClose = () => {
    setIsExpanded(false);
  };

  // Calculate display dimensions while maintaining aspect ratio
  const maxPreviewWidth = 400;
  const aspectRatio = image.width / image.height;
  const displayWidth = Math.min(maxPreviewWidth, image.width);
  const displayHeight = displayWidth / aspectRatio;

  return (
    <>
      {/* Preview Card */}
      <div className="bg-purple-50 rounded-lg border border-purple-200 p-4 mt-3">
        <div className="flex flex-col gap-3">
          {/* Image Preview */}
          <div
            className="relative group cursor-pointer rounded-lg overflow-hidden bg-white"
            onClick={handleExpand}
            style={{
              maxWidth: `${displayWidth}px`,
            }}
          >
            {imageError ? (
              <div
                className="flex items-center justify-center bg-gray-100"
                style={{
                  width: `${displayWidth}px`,
                  height: `${displayHeight}px`,
                }}
              >
                <div className="text-center text-gray-500">
                  <ImageIcon size={32} className="mx-auto mb-2" />
                  <p className="text-sm">Image unavailable</p>
                </div>
              </div>
            ) : (
              <>
                <Image
                  src={previewUrl}
                  alt={image.alt}
                  width={displayWidth}
                  height={displayHeight}
                  className="w-full h-auto"
                  onError={() => setImageError(true)}
                  unoptimized // Since these are dynamically generated
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-white/90 rounded-full p-2 shadow-lg">
                      <Maximize2 size={20} className="text-gray-700" />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Info and Actions */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-purple-700">
              <div className="flex items-center gap-1">
                {providerInfo.icon}
                <span>{providerInfo.label}</span>
              </div>
              {image.model && (
                <>
                  <span className="text-purple-400">•</span>
                  <span className="text-xs text-purple-600">{image.model}</span>
                </>
              )}
              <span className="text-purple-400">•</span>
              <span className="text-xs">
                {image.width}×{image.height}
              </span>
            </div>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
            >
              <Download size={14} />
              Download
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Modal */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={handleClose}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>

            {/* Full size image */}
            {modalImageError ? (
              <div
                className="flex items-center justify-center bg-gray-800 rounded-lg"
                style={{
                  width: Math.min(image.width, window.innerWidth * 0.9),
                  height: Math.min(image.height, window.innerHeight * 0.85),
                  maxWidth: '90vw',
                  maxHeight: '85vh',
                }}
              >
                <div className="text-center text-gray-400">
                  <ImageIcon size={48} className="mx-auto mb-3" />
                  <p>Image no longer available</p>
                </div>
              </div>
            ) : (
              <Image
                src={fullUrl}
                alt={image.alt}
                width={image.width}
                height={image.height}
                className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
                unoptimized
                onError={() => setModalImageError(true)}
              />
            )}

            {/* Caption */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 rounded-b-lg">
              <p className="text-white text-sm line-clamp-2">{image.alt}</p>
              <div className="flex items-center gap-2 mt-1 text-white/70 text-xs">
                <span>{providerInfo.label}</span>
                {image.model && (
                  <>
                    <span>•</span>
                    <span>{image.model}</span>
                  </>
                )}
                <span>•</span>
                <span>
                  {image.width}×{image.height}
                </span>
              </div>
            </div>

            {/* Download button */}
            <button
              onClick={handleDownload}
              className="absolute top-4 right-4 flex items-center gap-2 px-3 py-2 bg-white/90 text-gray-800 rounded-lg hover:bg-white transition-colors text-sm font-medium shadow-lg"
            >
              <Download size={16} />
              Download
            </button>
          </div>
        </div>
      )}
    </>
  );
}
