'use client';

/**
 * Podcast Generation Tool Configuration Component
 *
 * Admin UI for configuring the podcast_gen tool:
 * - Provider selection (OpenAI TTS / Gemini TTS)
 * - OpenAI voice, speed, and instructions settings
 * - Gemini multi-speaker configuration with 30 voices
 * - Default style and length preferences
 * - Expiration settings
 */

import React from 'react';
import { Info, Mic, Sparkles, Settings2, Users } from 'lucide-react';

interface PodcastGenConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}

// Voice descriptions for tooltips
const VOICE_INFO: Record<string, { description: string; quality: 'best' | 'good' }> = {
  marin: { description: 'Natural, clear', quality: 'best' },
  cedar: { description: 'Rich, resonant', quality: 'best' },
  nova: { description: 'Warm, friendly', quality: 'good' },
  coral: { description: 'Warm, conversational', quality: 'good' },
  alloy: { description: 'Neutral, balanced', quality: 'good' },
  echo: { description: 'Energetic, upbeat', quality: 'good' },
  onyx: { description: 'Deep, authoritative', quality: 'good' },
  shimmer: { description: 'Clear, bright', quality: 'good' },
  fable: { description: 'Expressive, storytelling', quality: 'good' },
  sage: { description: 'Calm, wise', quality: 'good' },
  ash: { description: 'Soft, gentle', quality: 'good' },
  ballad: { description: 'Musical, flowing', quality: 'good' },
  verse: { description: 'Poetic, rhythmic', quality: 'good' },
};

// Gemini voice options with categories
const GEMINI_VOICES = {
  conversational: [
    { name: 'Aoede', description: 'Breezy' },
    { name: 'Puck', description: 'Upbeat' },
    { name: 'Leda', description: 'Youthful' },
    { name: 'Callirrhoe', description: 'Easy-going' },
    { name: 'Umbriel', description: 'Easy-going' },
    { name: 'Algieba', description: 'Smooth' },
    { name: 'Despina', description: 'Smooth' },
    { name: 'Laomedeia', description: 'Upbeat' },
    { name: 'Achird', description: 'Friendly' },
    { name: 'Zubenelgenubi', description: 'Casual' },
    { name: 'Sulafat', description: 'Warm' },
  ],
  informative: [
    { name: 'Charon', description: 'Informative' },
    { name: 'Kore', description: 'Firm' },
    { name: 'Orus', description: 'Firm' },
    { name: 'Iapetus', description: 'Clear' },
    { name: 'Erinome', description: 'Clear' },
    { name: 'Rasalgethi', description: 'Informative' },
    { name: 'Alnilam', description: 'Firm' },
    { name: 'Schedar', description: 'Even' },
    { name: 'Gacrux', description: 'Mature' },
    { name: 'Sadaltager', description: 'Knowledgeable' },
  ],
  expressive: [
    { name: 'Zephyr', description: 'Bright' },
    { name: 'Fenrir', description: 'Excitable' },
    { name: 'Autonoe', description: 'Bright' },
    { name: 'Enceladus', description: 'Breathy' },
    { name: 'Algenib', description: 'Gravelly' },
    { name: 'Achernar', description: 'Soft' },
    { name: 'Pulcherrima', description: 'Forward' },
    { name: 'Vindemiatrix', description: 'Gentle' },
    { name: 'Sadachbia', description: 'Lively' },
  ],
};

export default function PodcastGenConfig({
  config,
  onChange,
  disabled,
}: PodcastGenConfigProps) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const handleProviderChange = (
    provider: 'openai' | 'gemini',
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

  const providers =
    (config.providers as Record<string, Record<string, unknown>>) || {};
  const openaiConfig = providers.openai || {};
  const geminiConfig = providers.gemini || {};

  return (
    <div className="space-y-6">
      {/* Active Provider */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Active TTS Provider
        </label>
        <select
          value={(config.activeProvider as string) || 'none'}
          onChange={(e) => handleChange('activeProvider', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          disabled={disabled}
        >
          <option value="none">Disabled</option>
          <option value="openai">OpenAI (gpt-4o-mini-tts) - Single Speaker, MP3</option>
          <option value="gemini">Google Gemini TTS - Multi-Speaker, WAV</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Select the text-to-speech provider to use
        </p>
      </div>

      {/* Provider Tip */}
      <div className="p-3 bg-purple-50 rounded-lg flex items-start gap-2">
        <Info size={16} className="text-purple-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-purple-800">
          {(config.activeProvider as string) === 'gemini' ? (
            <>
              <strong>Gemini TTS:</strong> Supports multi-speaker podcasts with Host/Expert dialogue format.
              Choose from 30 voices across conversational, informative, and expressive styles.
              Output format: <strong>WAV</strong>.
            </>
          ) : (
            <>
              <strong>OpenAI TTS:</strong> High-quality single-speaker narration.
              The <strong>marin</strong> and <strong>cedar</strong> voices are recommended.
              Output format: <strong>MP3</strong>.
            </>
          )}
        </div>
      </div>

      {/* OpenAI Settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Mic size={18} className="text-green-600" />
            <h4 className="font-medium text-gray-900">OpenAI TTS</h4>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
              gpt-4o-mini-tts
            </span>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(openaiConfig.enabled as boolean) || false}
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
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Voice
                </label>
                <select
                  value={(openaiConfig.voice as string) || 'marin'}
                  onChange={(e) =>
                    handleProviderChange('openai', 'voice', e.target.value)
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled}
                >
                  <optgroup label="Best Quality">
                    <option value="marin">marin - Natural, clear ⭐</option>
                    <option value="cedar">cedar - Rich, resonant ⭐</option>
                  </optgroup>
                  <optgroup label="Standard Voices">
                    <option value="nova">nova - Warm, friendly</option>
                    <option value="coral">coral - Warm, conversational</option>
                    <option value="alloy">alloy - Neutral, balanced</option>
                    <option value="echo">echo - Energetic, upbeat</option>
                    <option value="onyx">onyx - Deep, authoritative</option>
                    <option value="shimmer">shimmer - Clear, bright</option>
                    <option value="fable">fable - Expressive, storytelling</option>
                    <option value="sage">sage - Calm, wise</option>
                    <option value="ash">ash - Soft, gentle</option>
                    <option value="ballad">ballad - Musical, flowing</option>
                    <option value="verse">verse - Poetic, rhythmic</option>
                  </optgroup>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {VOICE_INFO[(openaiConfig.voice as string) || 'marin']?.description || ''}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Speed
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0.25}
                    max={4.0}
                    step={0.25}
                    value={(openaiConfig.speed as number) || 1.0}
                    onChange={(e) =>
                      handleProviderChange('openai', 'speed', parseFloat(e.target.value))
                    }
                    className="flex-1"
                    disabled={disabled}
                  />
                  <span className="text-sm font-mono w-12 text-right">
                    {((openaiConfig.speed as number) || 1.0).toFixed(2)}x
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  0.25x (slow) to 4.0x (fast), default 1.0x
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Voice Instructions
                <span className="text-xs text-gray-400 ml-2">(optional)</span>
              </label>
              <textarea
                value={(openaiConfig.instructions as string) || ''}
                onChange={(e) =>
                  handleProviderChange('openai', 'instructions', e.target.value)
                }
                placeholder="e.g., Speak in a calm, professional tone suitable for corporate training..."
                className="w-full px-3 py-2 border rounded-lg h-20 resize-none"
                disabled={disabled}
              />
              <p className="text-xs text-gray-500 mt-1">
                Control voice style with natural language instructions
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
            <h4 className="font-medium text-gray-900">Google Gemini TTS</h4>
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
              Multi-Speaker
            </span>
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
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  value={(geminiConfig.model as string) || 'gemini-2.5-flash-preview-tts'}
                  onChange={(e) =>
                    handleProviderChange('gemini', 'model', e.target.value)
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled}
                >
                  <option value="gemini-2.5-flash-preview-tts">Flash (faster, lower cost)</option>
                  <option value="gemini-2.5-pro-preview-tts">Pro (higher quality)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                  <Users size={14} />
                  Multi-Speaker Mode
                </label>
                <select
                  value={(geminiConfig.multiSpeaker as boolean) ? 'true' : 'false'}
                  onChange={(e) =>
                    handleProviderChange('gemini', 'multiSpeaker', e.target.value === 'true')
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled}
                >
                  <option value="true">Host + Expert Dialogue</option>
                  <option value="false">Single Speaker</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Multi-speaker creates natural conversations
                </p>
              </div>
            </div>

            {/* Voice Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Host Voice
                </label>
                <select
                  value={(geminiConfig.hostVoice as string) || 'Aoede'}
                  onChange={(e) =>
                    handleProviderChange('gemini', 'hostVoice', e.target.value)
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled}
                >
                  <optgroup label="Conversational">
                    {GEMINI_VOICES.conversational.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} - {v.description}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Informative">
                    {GEMINI_VOICES.informative.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} - {v.description}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Expressive">
                    {GEMINI_VOICES.expressive.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} - {v.description}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Guides the conversation
                </p>
              </div>

              {(geminiConfig.multiSpeaker as boolean) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expert Voice
                  </label>
                  <select
                    value={(geminiConfig.expertVoice as string) || 'Charon'}
                    onChange={(e) =>
                      handleProviderChange('gemini', 'expertVoice', e.target.value)
                    }
                    className="w-full px-3 py-2 border rounded-lg"
                    disabled={disabled}
                  >
                    <optgroup label="Informative (Recommended)">
                      {GEMINI_VOICES.informative.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} - {v.description}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Conversational">
                      {GEMINI_VOICES.conversational.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} - {v.description}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Expressive">
                      {GEMINI_VOICES.expressive.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} - {v.description}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Provides detailed explanations
                  </p>
                </div>
              )}
            </div>

            {/* Optional Accents */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Host Accent
                  <span className="text-xs text-gray-400 ml-2">(optional)</span>
                </label>
                <input
                  type="text"
                  value={(geminiConfig.hostAccent as string) || ''}
                  onChange={(e) =>
                    handleProviderChange('gemini', 'hostAccent', e.target.value)
                  }
                  placeholder="e.g., British English from London"
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Be specific for best results
                </p>
              </div>

              {(geminiConfig.multiSpeaker as boolean) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expert Accent
                    <span className="text-xs text-gray-400 ml-2">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={(geminiConfig.expertAccent as string) || ''}
                    onChange={(e) =>
                      handleProviderChange('gemini', 'expertAccent', e.target.value)
                    }
                    placeholder="e.g., American English from New York"
                    className="w-full px-3 py-2 border rounded-lg"
                    disabled={disabled}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Different from host for variety
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* General Settings */}
      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Settings2 size={16} />
          Default Settings
        </h4>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Style
            </label>
            <select
              value={(config.defaultStyle as string) || 'conversational'}
              onChange={(e) => handleChange('defaultStyle', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            >
              <option value="formal">Formal</option>
              <option value="conversational">Conversational</option>
              <option value="news">News</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Narration style
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Length
            </label>
            <select
              value={(config.defaultLength as string) || 'medium'}
              onChange={(e) => handleChange('defaultLength', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            >
              <option value="short">Short (1-2 min)</option>
              <option value="medium">Medium (3-5 min)</option>
              <option value="long">Long (8-10 min)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Target duration
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiration (days)
            </label>
            <input
              type="number"
              min={0}
              max={365}
              value={(config.expirationDays as number) || 30}
              onChange={(e) =>
                handleChange('expirationDays', parseInt(e.target.value) || 30)
              }
              className="w-full px-3 py-2 border rounded-lg"
              disabled={disabled}
            />
            <p className="text-xs text-gray-500 mt-1">
              0 = never expire
            </p>
          </div>
        </div>
      </div>

      {/* API Info */}
      <div className="p-3 bg-gray-50 rounded-lg">
        <h5 className="text-sm font-medium text-gray-700 mb-2">
          API Information
        </h5>
        <div className="text-xs text-gray-600 space-y-2">
          <div className="pb-2 border-b border-gray-200">
            <div className="font-medium text-gray-700 mb-1">OpenAI TTS</div>
            <div className="flex justify-between">
              <span>Price</span>
              <span>~$0.015 per 1K characters</span>
            </div>
            <div className="flex justify-between">
              <span>Output format</span>
              <span>MP3</span>
            </div>
          </div>
          <div>
            <div className="font-medium text-gray-700 mb-1">Gemini TTS (Preview)</div>
            <div className="flex justify-between">
              <span>Flash model</span>
              <span>~$0.01 per 1K characters</span>
            </div>
            <div className="flex justify-between">
              <span>Pro model</span>
              <span>~$0.04 per 1K characters</span>
            </div>
            <div className="flex justify-between">
              <span>Output format</span>
              <span>WAV (larger files)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
