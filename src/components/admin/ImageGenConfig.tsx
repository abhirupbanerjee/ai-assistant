'use client';

/**
 * Image Generation Tool Configuration Component
 *
 * Admin UI for configuring the image_gen tool:
 * - Provider selection (Google Gemini / Google Imagen 4)
 * - Provider-specific settings
 * - Image processing options
 * - Prompt enhancement settings
 */

import React from 'react';
import { Info, Image as ImageIcon, Sparkles, Settings2 } from 'lucide-react';

interface ImageGenConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}

export default function ImageGenConfig({
  config,
  onChange,
  disabled,
}: ImageGenConfigProps) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const handleProviderChange = (
    provider: 'gemini' | 'imagen',
    key: string,
    value: unknown
  ) => {
    const providers = (config.providers as Record<string, Record<string, unknown>>) || {};
    onChange({
      ...config,
      providers: {
        ...providers,
        [provider]: {
          ...providers[provider],
          [key]: value,
        },
      },
    });
  };

  const handleImageProcessingChange = (key: string, value: unknown) => {
    const imageProcessing =
      (config.imageProcessing as Record<string, unknown>) || {};
    onChange({
      ...config,
      imageProcessing: {
        ...imageProcessing,
        [key]: value,
      },
    });
  };

  const providers =
    (config.providers as Record<string, Record<string, unknown>>) || {};
  const geminiConfig = providers.gemini || {};
  const imagenConfig = providers.imagen || {};
  const imageProcessing =
    (config.imageProcessing as Record<string, unknown>) || {};

  return (
    <div className="space-y-6">
      {/* Active Provider */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Default Provider Ecosystem
        </label>
        <select
          value={(config.activeProvider as string) || 'gemini'}
          onChange={(e) => handleChange('activeProvider', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          disabled={disabled}
        >
          <option value="none">Disabled</option>
          <option value="gemini">Google Gemini (Primary)</option>
          <option value="imagen">Google Imagen 4 (Primary)</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Gemini excels at text rendering (infographics, posters). Imagen 4 excels at photorealism.
        </p>
      </div>

      {/* Provider Recommendation Tip */}
      <div className="p-3 bg-blue-50 rounded-lg flex items-start gap-2">
        <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <strong>Smart Routing:</strong> The system automatically routes each
          category to the best model. Infographics and posters use
          Gemini Nano Banana Pro. Photos and product mockups use Imagen 4 Ultra.
          If the primary provider fails, the system falls back to the other.
        </div>
      </div>

      {/* Gemini Settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-purple-600" />
              <h4 className="font-medium text-gray-900">Google Gemini</h4>
            </div>
            <p className="text-xs text-gray-500">
              Nano Banana series — best for text, infographics, posters
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(geminiConfig.enabled as boolean) || false}
              onChange={(e) =>
                handleProviderChange('gemini', 'enabled', e.target.checked)
              }
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Enabled</span>
          </label>
        </div>

        {(geminiConfig.enabled as boolean) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Model (speed)
              </label>
              <select
                value={
                  (geminiConfig.defaultModel as string) || 'gemini-3.1-flash-image-preview'
                }
                onChange={(e) =>
                  handleProviderChange('gemini', 'defaultModel', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="gemini-3.1-flash-image-preview">
                  Nano Banana 2 ($0.067/image)
                </option>
                <option value="gemini-3-pro-image-preview">
                  Nano Banana Pro ($0.134/image)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pro Model (text-heavy)
              </label>
              <select
                value={
                  (geminiConfig.proModel as string) || 'gemini-3-pro-image-preview'
                }
                onChange={(e) =>
                  handleProviderChange('gemini', 'proModel', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="gemini-3-pro-image-preview">
                  Nano Banana Pro ($0.134/image)
                </option>
                <option value="gemini-3.1-flash-image-preview">
                  Nano Banana 2 ($0.067/image)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Aspect Ratio
              </label>
              <select
                value={(geminiConfig.aspectRatio as string) || '16:9'}
                onChange={(e) =>
                  handleProviderChange('gemini', 'aspectRatio', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Presentation)</option>
                <option value="9:16">9:16 (Mobile)</option>
                <option value="4:3">4:3 (Standard)</option>
                <option value="3:4">3:4 (Portrait)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Imagen 4 Settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <ImageIcon size={18} className="text-gray-600" />
              <h4 className="font-medium text-gray-900">Google Imagen 4</h4>
            </div>
            <p className="text-xs text-gray-500">
              Professional image generation — best for photorealism
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(imagenConfig.enabled as boolean) || false}
              onChange={(e) =>
                handleProviderChange('imagen', 'enabled', e.target.checked)
              }
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Enabled</span>
          </label>
        </div>

        {(imagenConfig.enabled as boolean) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fast Model
              </label>
              <select
                value={(imagenConfig.fastModel as string) || 'imagen-4.0-fast-generate-001'}
                onChange={(e) =>
                  handleProviderChange('imagen', 'fastModel', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="imagen-4.0-fast-generate-001">
                  Imagen 4 Fast ($0.02/image)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Standard Model
              </label>
              <select
                value={(imagenConfig.standardModel as string) || 'imagen-4.0-generate-001'}
                onChange={(e) =>
                  handleProviderChange('imagen', 'standardModel', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="imagen-4.0-generate-001">
                  Imagen 4 Standard ($0.04/image)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ultra Model (max quality)
              </label>
              <select
                value={(imagenConfig.ultraModel as string) || 'imagen-4.0-ultra-generate-001'}
                onChange={(e) =>
                  handleProviderChange('imagen', 'ultraModel', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="imagen-4.0-ultra-generate-001">
                  Imagen 4 Ultra ($0.06/image)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Aspect Ratio
              </label>
              <select
                value={(imagenConfig.aspectRatio as string) || '16:9'}
                onChange={(e) =>
                  handleProviderChange('imagen', 'aspectRatio', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Presentation)</option>
                <option value="9:16">9:16 (Mobile)</option>
                <option value="4:3">4:3 (Standard)</option>
                <option value="3:4">3:4 (Portrait)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* General Settings */}
      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Settings2 size={16} />
          General Settings
        </h4>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Style
            </label>
            <select
              value={(config.defaultStyle as string) || 'infographic'}
              onChange={(e) => handleChange('defaultStyle', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            >
              <option value="auto">Auto (System decides)</option>
              <option value="infographic">Infographic</option>

              <option value="poster">Poster</option>
              <option value="illustration">Illustration</option>
              <option value="photo">Photo</option>
              <option value="product-mockup">Product Mockup</option>
              <option value="icon">Icon</option>
              <option value="social-media">Social Media</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Resolution
            </label>
            <select
              value={(config.defaultResolution as string) || '1K'}
              onChange={(e) => handleChange('defaultResolution', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            >
              <option value="512">512px (Preview)</option>
              <option value="1K">1K (Standard)</option>
              <option value="2K">2K (High-Fidelity)</option>
              <option value="4K">4K (Print-Quality)</option>
            </select>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(config.enhancePrompts as boolean) ?? true}
              onChange={(e) => handleChange('enhancePrompts', e.target.checked)}
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Enhance Prompts</span>
            <span className="text-xs text-gray-500">
              (Add style-specific instructions for better results)
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(config.addSafetyPrefixes as boolean) ?? true}
              onChange={(e) =>
                handleChange('addSafetyPrefixes', e.target.checked)
              }
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Add Safety Prefixes</span>
            <span className="text-xs text-gray-500">
              (Workplace-appropriate content)
            </span>
          </label>
        </div>
      </div>

      {/* Image Processing Settings */}
      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-4">
          Image Processing & Optimization
        </h4>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Dimension (pixels)
            </label>
            <input
              type="number"
              min={1024}
              max={4096}
              value={(imageProcessing.maxDimension as number) || 2048}
              onChange={(e) =>
                handleImageProcessingChange(
                  'maxDimension',
                  parseInt(e.target.value) || 2048
                )
              }
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            />
            <p className="text-xs text-gray-500 mt-1">
              Images larger than this will be resized (1024-4096)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Output Format
            </label>
            <select
              value={(imageProcessing.format as string) || 'webp'}
              onChange={(e) =>
                handleImageProcessingChange('format', e.target.value)
              }
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            >
              <option value="webp">WebP (Smallest, recommended)</option>
              <option value="png">PNG (Lossless)</option>
              <option value="jpeg">JPEG (Good compression)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quality (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={(imageProcessing.quality as number) || 85}
              onChange={(e) =>
                handleImageProcessingChange(
                  'quality',
                  parseInt(e.target.value) || 85
                )
              }
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            />
            <p className="text-xs text-gray-500 mt-1">
              WebP/JPEG quality (0-100)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Thumbnail Size (pixels)
            </label>
            <input
              type="number"
              min={100}
              max={800}
              value={(imageProcessing.thumbnailSize as number) || 400}
              onChange={(e) =>
                handleImageProcessingChange(
                  'thumbnailSize',
                  parseInt(e.target.value) || 400
                )
              }
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(imageProcessing.generateThumbnail as boolean) ?? true}
              onChange={(e) =>
                handleImageProcessingChange(
                  'generateThumbnail',
                  e.target.checked
                )
              }
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Generate Thumbnails</span>
            <span className="text-xs text-gray-500">
              (Small previews for faster chat loading)
            </span>
          </label>
        </div>
      </div>

      {/* Cost Estimation Info */}
      <div className="p-3 bg-gray-50 rounded-lg">
        <h5 className="text-sm font-medium text-gray-700 mb-2">
          Estimated Costs per Image
        </h5>
        <div className="text-xs text-gray-600 space-y-1">
          <div className="flex justify-between">
            <span>Gemini Nano Banana 2 (1K)</span>
            <span>$0.067</span>
          </div>
          <div className="flex justify-between">
            <span>Gemini Nano Banana Pro (1K)</span>
            <span>$0.134</span>
          </div>
          <div className="flex justify-between">
            <span>Imagen 4 Fast</span>
            <span>$0.02</span>
          </div>
          <div className="flex justify-between">
            <span>Imagen 4 Standard</span>
            <span>$0.04</span>
          </div>
          <div className="flex justify-between">
            <span>Imagen 4 Ultra</span>
            <span>$0.06</span>
          </div>
        </div>
      </div>
    </div>
  );
}
