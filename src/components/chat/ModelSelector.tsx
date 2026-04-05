'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Check, ChevronDown, Loader2, Wrench, Eye, AlertTriangle } from 'lucide-react';

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  maxInputTokens: number | null;
  isDefault: boolean;
  enabled: boolean;
}

interface ModelSelectorProps {
  threadId: string | null;
  disabled?: boolean;
  onModelStatusChange?: (ready: boolean) => void;
}

export default function ModelSelector({ threadId, disabled, onModelStatusChange }: ModelSelectorProps) {
  const [availableModels, setAvailableModels] = useState<EnabledModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [effectiveModel, setEffectiveModel] = useState<string>('');
  const [effectiveModelValid, setEffectiveModelValid] = useState<boolean>(true);
  const [globalDefault, setGlobalDefault] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Notify parent of model readiness
  const updateModelStatus = useCallback((models: EnabledModel[], isValid: boolean) => {
    // Ready if: models available AND effective model is valid (or no thread yet but models exist)
    const ready = models.length > 0 && isValid;
    onModelStatusChange?.(ready);
  }, [onModelStatusChange]);

  // Load thread model when thread changes
  const loadThreadModel = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!threadId) {
        // No thread yet (welcome screen) — just load the available model list
        const response = await fetch('/api/models');
        if (response.ok) {
          const data = await response.json();
          const models = data.models || [];
          setAvailableModels(models);
          // No thread = no effective model to validate, but need at least 1 model
          const hasDefault = models.some((m: EnabledModel) => m.isDefault);
          setEffectiveModelValid(models.length > 0 && hasDefault);
          updateModelStatus(models, models.length > 0 && hasDefault);
        }
      } else {
        const response = await fetch(`/api/threads/${threadId}/model`);
        if (response.ok) {
          const data = await response.json();
          const models = data.availableModels || [];
          const isValid = data.effectiveModelValid ?? true;
          setAvailableModels(models);
          setSelectedModel(data.selectedModel);
          setEffectiveModel(data.effectiveModel || '');
          setEffectiveModelValid(isValid);
          setGlobalDefault(data.globalDefault || '');
          updateModelStatus(models, isValid);
        }
      }
    } catch (error) {
      console.error('Failed to load thread model:', error);
    } finally {
      setIsLoading(false);
    }
  }, [threadId, updateModelStatus]);

  useEffect(() => {
    loadThreadModel();
  }, [loadThreadModel]);

  // Handle model change
  const handleModelChange = async (newModelId: string) => {
    if (!threadId || isChanging) return;

    setIsChanging(true);
    try {
      // 'default' means null (use global default)
      const modelToSet = newModelId === 'default' ? null : newModelId;

      const response = await fetch(`/api/threads/${threadId}/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: modelToSet }),
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedModel(data.selectedModel);
        setEffectiveModel(data.effectiveModel || '');
        // After changing model, check if the new effective model is in available list
        const isValid = availableModels.some(m => m.id === data.effectiveModel);
        setEffectiveModelValid(isValid);
        updateModelStatus(availableModels, isValid);
      } else {
        const error = await response.json();
        console.error('Failed to change model:', error);
      }
    } catch (error) {
      console.error('Error changing model:', error);
    } finally {
      setIsChanging(false);
      setShowDropdown(false);
    }
  };

  // Determine if model is in an error state
  const hasModelError = !isLoading && (!effectiveModelValid || availableModels.length === 0);

  // Get display name for the current model
  const getCurrentModelDisplay = () => {
    if (isLoading) return 'Loading...';

    if (availableModels.length === 0) return 'No models';

    if (!effectiveModel) {
      // No thread yet — show the default model name if available
      const defaultModel = availableModels.find((m) => m.isDefault);
      if (defaultModel) {
        const name = defaultModel.displayName || defaultModel.id;
        return name.length > 20 ? name.substring(0, 17) + '...' : name;
      }
      return 'Select model';
    }

    if (!effectiveModelValid) return 'Invalid model';

    const model = availableModels.find((m) => m.id === effectiveModel);
    if (model) {
      // Shorten display name for button
      const name = model.displayName || model.id;
      return name.length > 20 ? name.substring(0, 17) + '...' : name;
    }

    return effectiveModel.length > 20
      ? effectiveModel.substring(0, 17) + '...'
      : effectiveModel;
  };

  // Check if using non-default model
  const isNonDefault = selectedModel !== null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={disabled || isLoading || isChanging}
        onMouseEnter={() => !showDropdown && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${
          hasModelError
            ? 'bg-red-50 text-red-600 hover:bg-red-100'
            : isNonDefault
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${disabled || isLoading || isChanging ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isLoading || isChanging ? (
          <Loader2 size={16} className="animate-spin" />
        ) : hasModelError ? (
          <AlertTriangle size={16} className="text-red-500" />
        ) : (
          <Bot size={16} />
        )}
        <span className="hidden sm:inline max-w-[120px] truncate">
          {getCurrentModelDisplay()}
        </span>
        <ChevronDown size={14} className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {/* Tooltip */}
      {showTooltip && !showDropdown && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          <span className="font-medium">Select model</span>
          <p className="text-gray-400 mt-0.5">
            {hasModelError
              ? 'Current model unavailable — select a valid model'
              : isNonDefault ? `Using: ${effectiveModel}` : 'Using default model'}
          </p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && !isLoading && (
        <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[260px] max-w-[320px] py-1">
          <div className="px-3 py-1.5 text-xs text-gray-500 font-medium border-b border-gray-100">
            Select Model
          </div>

          {/* Warning if effective model is invalid */}
          {hasModelError && (
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                {availableModels.length === 0
                  ? 'No models available for the active route. Configure models in Admin Settings.'
                  : 'Current model belongs to a disabled route. Select a valid model below.'}
              </span>
            </div>
          )}

          {/* Default option — only show if global default is in the available list */}
          {availableModels.some(m => m.id === globalDefault) && (
            <>
              <button
                type="button"
                onClick={() => handleModelChange('default')}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  !selectedModel ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                  D
                </span>
                <span className="flex-1 truncate">
                  Default ({globalDefault || 'system default'})
                </span>
                {!selectedModel && <Check size={16} className="flex-shrink-0" />}
              </button>

              {/* Divider */}
              <div className="border-t border-gray-100 my-1" />
            </>
          )}

          {/* Available models */}
          <div className="max-h-[300px] overflow-y-auto">
            {availableModels.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => handleModelChange(model.id)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  selectedModel === model.id ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                }`}
              >
                <Bot size={16} className="flex-shrink-0 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{model.displayName || model.id}</span>
                    {model.toolCapable && (
                      <span title="Tool capable">
                        <Wrench size={12} className="flex-shrink-0 text-amber-500" />
                      </span>
                    )}
                    {model.visionCapable && (
                      <span title="Vision capable">
                        <Eye size={12} className="flex-shrink-0 text-purple-500" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{model.providerId}</div>
                </div>
                {selectedModel === model.id && <Check size={16} className="flex-shrink-0" />}
              </button>
            ))}
          </div>

          {availableModels.length === 0 && (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              No models available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
