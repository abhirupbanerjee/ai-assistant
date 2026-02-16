'use client';

/**
 * Translation Tool Configuration Component
 *
 * Admin UI for configuring the translation tool:
 * - Provider selection (OpenAI / Gemini / Mistral)
 * - Provider-specific model and temperature settings
 * - Language enable/disable toggles
 * - Formal style toggle
 */

import React, { useEffect, useState } from 'react';
import { Info, Languages, Sparkles, Bot, Wind } from 'lucide-react';

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
}

interface TranslationConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}

// Language definitions
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
];

// Fallback provider model options (used if API unavailable)
const FALLBACK_PROVIDER_MODELS: Record<string, { id: string; name: string }[]> = {
  openai: [
    { id: 'gpt-4.1', name: 'GPT-4.1 (Best quality)' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini (Balanced)' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano (Fastest)' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Best quality)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Balanced)' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (Fastest)' },
  ],
  mistral: [
    { id: 'mistral-large-3', name: 'Mistral Large 3 (Best quality)' },
    { id: 'mistral-small-3.2', name: 'Mistral Small 3.2 (Fastest)' },
  ],
};

export default function TranslationConfig({
  config,
  onChange,
  disabled,
}: TranslationConfigProps) {
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);

  // Fetch available models from API on mount
  useEffect(() => {
    fetch('/api/admin/settings')
      .then(res => res.json())
      .then(data => {
        if (data.availableModels && Array.isArray(data.availableModels)) {
          setAvailableModels(data.availableModels);
        }
      })
      .catch(err => {
        console.error('Failed to fetch available models:', err);
      });
  }, []);

  // Get models for a specific provider (from API or fallback)
  const getModelsForProvider = (provider: 'openai' | 'gemini' | 'mistral') => {
    if (availableModels.length > 0) {
      const filtered = availableModels.filter(m => m.provider === provider);
      if (filtered.length > 0) {
        return filtered.map(m => ({ id: m.id, name: m.name }));
      }
    }
    return FALLBACK_PROVIDER_MODELS[provider] || [];
  };

  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const handleProviderChange = (
    provider: 'openai' | 'gemini' | 'mistral',
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

  const handleLanguageChange = (langCode: string, enabled: boolean) => {
    const languages = (config.languages as Record<string, boolean>) || {};
    onChange({
      ...config,
      languages: {
        ...languages,
        [langCode]: enabled,
      },
    });
  };

  const providers = (config.providers as Record<string, Record<string, unknown>>) || {};
  const openaiConfig = providers.openai || {};
  const geminiConfig = providers.gemini || {};
  const mistralConfig = providers.mistral || {};
  const languages = (config.languages as Record<string, boolean>) || {};

  // Count enabled providers for validation hint
  const enabledProviderCount = [
    openaiConfig.enabled,
    geminiConfig.enabled,
    mistralConfig.enabled,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Active Provider */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Active Provider
        </label>
        <select
          value={(config.activeProvider as string) || 'openai'}
          onChange={(e) => handleChange('activeProvider', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          disabled={disabled}
        >
          <option value="openai">OpenAI (GPT-4.1)</option>
          <option value="gemini">Google Gemini</option>
          <option value="mistral">Mistral AI</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Primary provider for translations. Falls back to other enabled providers if unavailable.
        </p>
      </div>

      {/* Provider validation hint */}
      {enabledProviderCount === 0 && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
          <Info size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-yellow-800">
            <strong>Warning:</strong> No providers are enabled. Enable at least one provider below for translation to work.
          </div>
        </div>
      )}

      {/* OpenAI Settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-green-600" />
            <h4 className="font-medium text-gray-900">OpenAI</h4>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(openaiConfig.enabled as boolean) ?? true}
              onChange={(e) =>
                handleProviderChange('openai', 'enabled', e.target.checked)
              }
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Enabled</span>
          </label>
        </div>

        {(openaiConfig.enabled as boolean) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model
              </label>
              <select
                value={(openaiConfig.model as string) || 'gpt-4.1-mini'}
                onChange={(e) =>
                  handleProviderChange('openai', 'model', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                {getModelsForProvider('openai').map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={(openaiConfig.temperature as number) ?? 0.3}
                onChange={(e) =>
                  handleProviderChange('openai', 'temperature', parseFloat(e.target.value))
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              />
              <p className="text-xs text-gray-500 mt-1">
                Lower = more consistent translations
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Gemini Settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600" />
            <h4 className="font-medium text-gray-900">Google Gemini</h4>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(geminiConfig.enabled as boolean) ?? true}
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
                Model
              </label>
              <select
                value={(geminiConfig.model as string) || 'gemini-2.5-flash'}
                onChange={(e) =>
                  handleProviderChange('gemini', 'model', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                {getModelsForProvider('gemini').map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={(geminiConfig.temperature as number) ?? 0.3}
                onChange={(e) =>
                  handleProviderChange('gemini', 'temperature', parseFloat(e.target.value))
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              />
              <p className="text-xs text-gray-500 mt-1">
                Lower = more consistent translations
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Mistral Settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wind size={18} className="text-orange-600" />
            <h4 className="font-medium text-gray-900">Mistral AI</h4>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(mistralConfig.enabled as boolean) ?? true}
              onChange={(e) =>
                handleProviderChange('mistral', 'enabled', e.target.checked)
              }
              disabled={disabled}
              className="rounded"
            />
            <span className="text-sm">Enabled</span>
          </label>
        </div>

        {(mistralConfig.enabled as boolean) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model
              </label>
              <select
                value={(mistralConfig.model as string) || 'mistral-small-3.2'}
                onChange={(e) =>
                  handleProviderChange('mistral', 'model', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              >
                {getModelsForProvider('mistral').map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={(mistralConfig.temperature as number) ?? 0.3}
                onChange={(e) =>
                  handleProviderChange('mistral', 'temperature', parseFloat(e.target.value))
                }
                className="w-full px-3 py-2 border rounded-lg"
                disabled={disabled}
              />
              <p className="text-xs text-gray-500 mt-1">
                Lower = more consistent translations
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Language Settings */}
      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Languages size={16} />
          Enabled Languages
        </h4>
        <p className="text-sm text-gray-500 mb-4">
          Select which languages are available for translation. Users can only translate to/from enabled languages.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {LANGUAGES.map((lang) => (
            <label
              key={lang.code}
              className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={languages[lang.code] !== false}
                onChange={(e) => handleLanguageChange(lang.code, e.target.checked)}
                disabled={disabled}
                className="rounded"
              />
              <span className="text-sm font-medium">{lang.name}</span>
              <span className="text-xs text-gray-400">({lang.code})</span>
            </label>
          ))}
        </div>
      </div>

      {/* Translation Style */}
      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-4">Translation Style</h4>

        <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
          <input
            type="checkbox"
            checked={(config.formalStyle as boolean) ?? true}
            onChange={(e) => handleChange('formalStyle', e.target.checked)}
            disabled={disabled}
            className="rounded"
          />
          <div>
            <span className="text-sm font-medium">Formal/Official Style</span>
            <p className="text-xs text-gray-500">
              Use formal language appropriate for government and legal communications.
              Recommended for policy documents.
            </p>
          </div>
        </label>
      </div>

      {/* Info Box */}
      <div className="p-3 bg-blue-50 rounded-lg flex items-start gap-2">
        <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <strong>How it works:</strong> When a user requests translation, the LLM will
          automatically call the translation tool with the appropriate source and target
          languages. The active provider will be used first, with fallback to other
          enabled providers if needed.
        </div>
      </div>
    </div>
  );
}
