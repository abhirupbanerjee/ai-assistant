'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Check, ChevronDown, Loader2, Wrench, Eye, AlertTriangle, Brain, Sparkles } from 'lucide-react';
import { AUTO_MODEL_SENTINEL } from '@/lib/auto-model-constants';

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  thinkingCapable: boolean;
  maxInputTokens: number | null;
  isDefault: boolean;
  enabled: boolean;
}

interface ModelSelectorProps {
  threadId: string | null;
  disabled?: boolean;
  pendingModelId?: string | null;
  onPendingModelChange?: (modelId: string | null) => void;
  onModelStatusChange?: (ready: boolean) => void;
  onModelInfoChange?: (model: EnabledModel | null, ready: boolean) => void;
  /** Display name of the last model Auto picked — shown as subtitle when Auto is selected */
  lastAutoPick?: string | null;
}

export default function ModelSelector({
  threadId,
  disabled,
  pendingModelId,
  onPendingModelChange,
  onModelStatusChange,
  onModelInfoChange,
  lastAutoPick,
}: ModelSelectorProps) {
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
  const updateModelStatus = useCallback((models: EnabledModel[], isValid: boolean, modelId?: string | null) => {
    // Ready if: models available AND effective model is valid (or no thread yet but models exist)
    const ready = models.length > 0 && isValid;
    onModelStatusChange?.(ready);
    const currentModel = modelId
      ? models.find((m) => m.id === modelId) ?? null
      : models.find((m) => m.isDefault) ?? null;
    onModelInfoChange?.(ready ? currentModel : null, ready);
  }, [onModelInfoChange, onModelStatusChange]);

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
          const defaultModel = models.find((m: EnabledModel) => m.isDefault);
          const pendingModel = pendingModelId
            ? models.find((m: EnabledModel) => m.id === pendingModelId)
            : null;
          // 'auto' sentinel is valid even though it's not in the models list
          const isAuto = pendingModelId === AUTO_MODEL_SENTINEL;
          const nextEffectiveModel = isAuto
            ? AUTO_MODEL_SENTINEL
            : (pendingModel?.id || defaultModel?.id || '');
          const isValid = isAuto
            ? true
            : (nextEffectiveModel
              ? models.some((m: EnabledModel) => m.id === nextEffectiveModel)
              : false);

          setSelectedModel(isAuto ? AUTO_MODEL_SENTINEL : (pendingModel?.id || null));
          setGlobalDefault(defaultModel?.id || '');
          setEffectiveModel(nextEffectiveModel);
          setEffectiveModelValid(isValid);
          updateModelStatus(models, isValid, nextEffectiveModel || null);
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
          updateModelStatus(models, isValid, data.effectiveModel || null);
        }
      }
    } catch (error) {
      console.error('Failed to load thread model:', error);
    } finally {
      setIsLoading(false);
    }
  }, [pendingModelId, threadId, updateModelStatus]);

  useEffect(() => {
    loadThreadModel();
  }, [loadThreadModel]);

  // Handle model change
  const handleModelChange = async (newModelId: string) => {
    if (isChanging) return;

    // Before a thread exists, keep the choice locally and let ChatWindow persist
    // it when the first message creates the thread.
    if (!threadId) {
      const modelToSet = newModelId === 'default' ? null : newModelId;
      // 'auto' sentinel is valid even though it's not in the models list
      const isAuto = modelToSet === AUTO_MODEL_SENTINEL;
      const nextEffectiveModel = isAuto
        ? AUTO_MODEL_SENTINEL
        : (modelToSet || globalDefault || availableModels.find((m) => m.isDefault)?.id || '');
      const isValid = isAuto
        ? true
        : (nextEffectiveModel
          ? availableModels.some((m) => m.id === nextEffectiveModel)
          : false);

      setSelectedModel(modelToSet);
      setEffectiveModel(nextEffectiveModel);
      setEffectiveModelValid(isValid);
      onPendingModelChange?.(modelToSet);
      updateModelStatus(availableModels, isValid, nextEffectiveModel || null);
      setShowDropdown(false);
      return;
    }

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
        // 'auto' sentinel is valid even though it's not in the models list
        const isAuto = data.effectiveModel === AUTO_MODEL_SENTINEL;
        const isValid = isAuto
          ? true
          : availableModels.some(m => m.id === data.effectiveModel);
        setEffectiveModelValid(isValid);
        updateModelStatus(availableModels, isValid, data.effectiveModel || null);
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

    // Auto sentinel — show "Auto" label
    if (selectedModel === AUTO_MODEL_SENTINEL) return 'Auto';

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

  // Check if using non-default model (Auto counts as non-default for styling)
  const isNonDefault = selectedModel !== null;
  const isAutoSelected = selectedModel === AUTO_MODEL_SENTINEL;

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
            : isAutoSelected
            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
            : isNonDefault
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${disabled || isLoading || isChanging ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isLoading || isChanging ? (
          <Loader2 size={16} className="animate-spin" />
        ) : hasModelError ? (
          <AlertTriangle size={16} className="text-red-500" />
        ) : isAutoSelected ? (
          <Sparkles size={16} />
        ) : (
          <Bot size={16} />
        )}
        <span className="hidden sm:inline flex flex-col leading-tight">
          <span className="max-w-[120px] truncate">
            {getCurrentModelDisplay()}
          </span>
          {isAutoSelected && lastAutoPick && (
            <span className="text-[10px] text-purple-500 max-w-[120px] truncate leading-none">
              → {lastAutoPick}
            </span>
          )}
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
              : isAutoSelected ? (lastAutoPick ? `Auto: last picked ${lastAutoPick}` : 'Auto: best model picked per message')
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

          {/* Auto option — always show when models are available */}
          {availableModels.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleModelChange(AUTO_MODEL_SENTINEL)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  isAutoSelected ? 'text-purple-700 bg-purple-50' : 'text-gray-700'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center">
                  <Sparkles size={12} className="text-purple-600" />
                </span>
                <span className="flex-1 truncate font-medium">
                  Auto (recommended)
                </span>
                {isAutoSelected && <Check size={16} className="flex-shrink-0 text-purple-600" />}
              </button>

              {/* Divider */}
              <div className="border-t border-gray-100 my-1" />
            </>
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
                    {model.thinkingCapable && (
                      <span title="Thinking capable">
                        <Brain size={12} className="flex-shrink-0 text-emerald-500" />
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
