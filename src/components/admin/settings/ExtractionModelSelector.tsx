'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Sparkles, Wrench, Eye, Check } from 'lucide-react';

interface EnabledModel {
  id: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  isDefault: boolean;
}

interface ExtractionModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
}

export default function ExtractionModelSelector({ value, onChange }: ExtractionModelSelectorProps) {
  const [models, setModels] = useState<EnabledModel[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch enabled models
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.ok ? res.json() : { models: [] })
      .then(data => {
        setModels(data.models || []);
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isAuto = !value || value === '';
  const selectedModel = models.find(m => m.id === value);

  const displayLabel = isAuto
    ? 'Auto (system default with fallback)'
    : selectedModel
      ? selectedModel.displayName
      : value;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white text-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        disabled={loading}
      >
        <span className="flex items-center gap-2 truncate">
          {isAuto && <Sparkles size={14} className="text-blue-500" />}
          <span className={isAuto ? 'text-blue-700 font-medium' : 'text-gray-900'}>
            {loading ? 'Loading models...' : displayLabel}
          </span>
        </span>
        <ChevronDown size={16} className="text-gray-400 shrink-0" />
      </button>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          {/* Auto option */}
          <button
            type="button"
            onClick={() => { onChange(''); setShowDropdown(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-blue-50 border-b border-gray-100"
          >
            <Sparkles size={14} className="text-blue-500" />
            <div className="flex-1 text-left">
              <div className="font-medium text-blue-700">Auto (default)</div>
              <div className="text-xs text-gray-500">Uses system default model with fallback chain</div>
            </div>
            {isAuto && <Check size={16} className="text-blue-600" />}
          </button>

          {/* Model list */}
          <div className="max-h-[250px] overflow-y-auto">
            {models.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">
                No models available. Configure models in Admin Settings.
              </div>
            ) : (
              models.map(model => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => { onChange(model.id); setShowDropdown(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <div className="flex-1 text-left">
                    <div className="text-gray-900">{model.displayName}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                      <span>{model.id}</span>
                      {model.toolCapable && (
                        <span className="flex items-center gap-0.5 text-amber-600"><Wrench size={10} /> tools</span>
                      )}
                      {model.visionCapable && (
                        <span className="flex items-center gap-0.5 text-purple-600"><Eye size={10} /> vision</span>
                      )}
                    </div>
                  </div>
                  {value === model.id && <Check size={16} className="text-blue-600" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 mt-1">
        {isAuto
          ? 'Extraction uses the default chat model; falls back to cheapest available on failure'
          : `If "${selectedModel?.displayName || value}" fails, falls back to system default then cheapest available`
        }
      </div>
    </div>
  );
}
