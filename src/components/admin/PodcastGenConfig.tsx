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

// Gemini voice options with categories and gender
type VoiceGender = 'female' | 'male';
type VoiceCategory = 'conversational' | 'informative' | 'expressive';

interface VoiceInfo {
  name: string;
  description: string;
  gender: VoiceGender;
  category: VoiceCategory;
}

const GEMINI_VOICES: VoiceInfo[] = [
  // Female Conversational
  { name: 'Aoede', description: 'Breezy', gender: 'female', category: 'conversational' },
  { name: 'Leda', description: 'Youthful', gender: 'female', category: 'conversational' },
  { name: 'Callirrhoe', description: 'Easy-going', gender: 'female', category: 'conversational' },
  { name: 'Despina', description: 'Smooth', gender: 'female', category: 'conversational' },
  { name: 'Laomedeia', description: 'Upbeat', gender: 'female', category: 'conversational' },
  { name: 'Sulafat', description: 'Warm', gender: 'female', category: 'conversational' },
  // Male Conversational
  { name: 'Puck', description: 'Upbeat', gender: 'male', category: 'conversational' },
  { name: 'Umbriel', description: 'Easy-going', gender: 'male', category: 'conversational' },
  { name: 'Algieba', description: 'Smooth', gender: 'male', category: 'conversational' },
  { name: 'Achird', description: 'Friendly', gender: 'male', category: 'conversational' },
  { name: 'Zubenelgenubi', description: 'Casual', gender: 'male', category: 'conversational' },
  // Female Informative
  { name: 'Kore', description: 'Firm', gender: 'female', category: 'informative' },
  { name: 'Erinome', description: 'Clear', gender: 'female', category: 'informative' },
  { name: 'Gacrux', description: 'Mature', gender: 'female', category: 'informative' },
  // Male Informative
  { name: 'Charon', description: 'Informative', gender: 'male', category: 'informative' },
  { name: 'Orus', description: 'Firm', gender: 'male', category: 'informative' },
  { name: 'Iapetus', description: 'Clear', gender: 'male', category: 'informative' },
  { name: 'Rasalgethi', description: 'Informative', gender: 'male', category: 'informative' },
  { name: 'Alnilam', description: 'Firm', gender: 'male', category: 'informative' },
  { name: 'Schedar', description: 'Even', gender: 'male', category: 'informative' },
  { name: 'Sadaltager', description: 'Knowledgeable', gender: 'male', category: 'informative' },
  // Female Expressive
  { name: 'Zephyr', description: 'Bright', gender: 'female', category: 'expressive' },
  { name: 'Autonoe', description: 'Bright', gender: 'female', category: 'expressive' },
  { name: 'Achernar', description: 'Soft', gender: 'female', category: 'expressive' },
  { name: 'Pulcherrima', description: 'Forward', gender: 'female', category: 'expressive' },
  { name: 'Vindemiatrix', description: 'Gentle', gender: 'female', category: 'expressive' },
  // Male Expressive
  { name: 'Fenrir', description: 'Excitable', gender: 'male', category: 'expressive' },
  { name: 'Enceladus', description: 'Breathy', gender: 'male', category: 'expressive' },
  { name: 'Algenib', description: 'Gravelly', gender: 'male', category: 'expressive' },
  { name: 'Sadachbia', description: 'Lively', gender: 'male', category: 'expressive' },
];

// Filter voices by gender and category
function filterVoices(
  voices: VoiceInfo[],
  genderFilter: VoiceGender | 'all',
  categoryFilter: VoiceCategory | 'all'
): VoiceInfo[] {
  return voices.filter(v => {
    if (genderFilter !== 'all' && v.gender !== genderFilter) return false;
    if (categoryFilter !== 'all' && v.category !== categoryFilter) return false;
    return true;
  });
}

// Group voices by category for optgroup display
function groupByCategory(voices: VoiceInfo[]): Record<VoiceCategory, VoiceInfo[]> {
  const grouped: Record<VoiceCategory, VoiceInfo[]> = {
    conversational: [],
    informative: [],
    expressive: [],
  };
  voices.forEach(v => grouped[v.category].push(v));
  return grouped;
}

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

            {/* Auto-Select Voice Toggle */}
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
              <input
                type="checkbox"
                id="autoSelectVoices"
                checked={(geminiConfig.autoSelectVoices as boolean) || false}
                onChange={(e) =>
                  handleProviderChange('gemini', 'autoSelectVoices', e.target.checked)
                }
                className="w-4 h-4 text-blue-600 rounded"
                disabled={disabled}
              />
              <label htmlFor="autoSelectVoices" className="text-sm">
                <span className="font-medium text-gray-800">Auto-select voices based on character description</span>
                <p className="text-xs text-gray-600 mt-0.5">
                  LLM will pick the best voice matching &quot;Host Accent&quot; (e.g., &quot;Indian mother aged 40&quot; → female voice)
                </p>
              </label>
            </div>

            {/* Voice Selection */}
            <div className="grid grid-cols-2 gap-4">
              {/* Host Voice Section */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Host Voice
                </label>
                {/* Filter Dropdowns */}
                <div className="flex gap-2">
                  <select
                    value={(geminiConfig.hostGenderPreference as string) || 'any'}
                    onChange={(e) =>
                      handleProviderChange('gemini', 'hostGenderPreference', e.target.value)
                    }
                    className="flex-1 px-2 py-1 text-xs border rounded"
                    disabled={disabled}
                  >
                    <option value="any">Any Gender</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                  <select
                    value={(geminiConfig.hostCategoryPreference as string) || 'any'}
                    onChange={(e) =>
                      handleProviderChange('gemini', 'hostCategoryPreference', e.target.value)
                    }
                    className="flex-1 px-2 py-1 text-xs border rounded"
                    disabled={disabled}
                  >
                    <option value="any">Any Tone</option>
                    <option value="conversational">Conversational</option>
                    <option value="informative">Informative</option>
                    <option value="expressive">Expressive</option>
                  </select>
                </div>
                {/* Voice Select */}
                <select
                  value={(geminiConfig.hostVoice as string) || 'Aoede'}
                  onChange={(e) =>
                    handleProviderChange('gemini', 'hostVoice', e.target.value)
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled || (geminiConfig.autoSelectVoices as boolean)}
                >
                  {(() => {
                    const filtered = filterVoices(
                      GEMINI_VOICES,
                      ((geminiConfig.hostGenderPreference as string) || 'all') as VoiceGender | 'all',
                      ((geminiConfig.hostCategoryPreference as string) || 'all') as VoiceCategory | 'all'
                    );
                    const grouped = groupByCategory(filtered.length > 0 ? filtered : GEMINI_VOICES);
                    return (
                      <>
                        {grouped.conversational.length > 0 && (
                          <optgroup label="Conversational">
                            {grouped.conversational.map((v) => (
                              <option key={v.name} value={v.name}>
                                {v.name} - {v.description} ({v.gender === 'female' ? 'F' : 'M'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {grouped.informative.length > 0 && (
                          <optgroup label="Informative">
                            {grouped.informative.map((v) => (
                              <option key={v.name} value={v.name}>
                                {v.name} - {v.description} ({v.gender === 'female' ? 'F' : 'M'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {grouped.expressive.length > 0 && (
                          <optgroup label="Expressive">
                            {grouped.expressive.map((v) => (
                              <option key={v.name} value={v.name}>
                                {v.name} - {v.description} ({v.gender === 'female' ? 'F' : 'M'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    );
                  })()}
                </select>
                <p className="text-xs text-gray-500">
                  {(geminiConfig.autoSelectVoices as boolean)
                    ? 'Voice will be auto-selected based on Host Accent'
                    : 'Guides the conversation'}
                </p>
              </div>

              {/* Expert Voice Section */}
              {(geminiConfig.multiSpeaker as boolean) && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Expert Voice
                  </label>
                  {/* Filter Dropdowns */}
                  <div className="flex gap-2">
                    <select
                      value={(geminiConfig.expertGenderPreference as string) || 'any'}
                      onChange={(e) =>
                        handleProviderChange('gemini', 'expertGenderPreference', e.target.value)
                      }
                      className="flex-1 px-2 py-1 text-xs border rounded"
                      disabled={disabled}
                    >
                      <option value="any">Any Gender</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                    <select
                      value={(geminiConfig.expertCategoryPreference as string) || 'any'}
                      onChange={(e) =>
                        handleProviderChange('gemini', 'expertCategoryPreference', e.target.value)
                      }
                      className="flex-1 px-2 py-1 text-xs border rounded"
                      disabled={disabled}
                    >
                      <option value="any">Any Tone</option>
                      <option value="conversational">Conversational</option>
                      <option value="informative">Informative</option>
                      <option value="expressive">Expressive</option>
                    </select>
                  </div>
                  {/* Voice Select */}
                  <select
                    value={(geminiConfig.expertVoice as string) || 'Charon'}
                    onChange={(e) =>
                      handleProviderChange('gemini', 'expertVoice', e.target.value)
                    }
                    className="w-full px-3 py-2 border rounded-lg"
                    disabled={disabled || (geminiConfig.autoSelectVoices as boolean)}
                  >
                    {(() => {
                      const filtered = filterVoices(
                        GEMINI_VOICES,
                        ((geminiConfig.expertGenderPreference as string) || 'all') as VoiceGender | 'all',
                        ((geminiConfig.expertCategoryPreference as string) || 'all') as VoiceCategory | 'all'
                      );
                      const grouped = groupByCategory(filtered.length > 0 ? filtered : GEMINI_VOICES);
                      return (
                        <>
                          {grouped.informative.length > 0 && (
                            <optgroup label="Informative (Recommended)">
                              {grouped.informative.map((v) => (
                                <option key={v.name} value={v.name}>
                                  {v.name} - {v.description} ({v.gender === 'female' ? 'F' : 'M'})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {grouped.conversational.length > 0 && (
                            <optgroup label="Conversational">
                              {grouped.conversational.map((v) => (
                                <option key={v.name} value={v.name}>
                                  {v.name} - {v.description} ({v.gender === 'female' ? 'F' : 'M'})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {grouped.expressive.length > 0 && (
                            <optgroup label="Expressive">
                              {grouped.expressive.map((v) => (
                                <option key={v.name} value={v.name}>
                                  {v.name} - {v.description} ({v.gender === 'female' ? 'F' : 'M'})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                  <p className="text-xs text-gray-500">
                    {(geminiConfig.autoSelectVoices as boolean)
                      ? 'Voice will be auto-selected based on Expert Accent'
                      : 'Provides detailed explanations'}
                  </p>
                </div>
              )}
            </div>

            {/* Character Descriptions / Accents */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Host Character
                  <span className="text-xs text-gray-400 ml-2">(for auto-select)</span>
                </label>
                <input
                  type="text"
                  value={(geminiConfig.hostAccent as string) || ''}
                  onChange={(e) =>
                    handleProviderChange('gemini', 'hostAccent', e.target.value)
                  }
                  placeholder="e.g., Indian mother aged 40, British child aged 10"
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={disabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Describe gender, age, accent for best voice matching
                </p>
              </div>

              {(geminiConfig.multiSpeaker as boolean) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expert Character
                    <span className="text-xs text-gray-400 ml-2">(for auto-select)</span>
                  </label>
                  <input
                    type="text"
                    value={(geminiConfig.expertAccent as string) || ''}
                    onChange={(e) =>
                      handleProviderChange('gemini', 'expertAccent', e.target.value)
                    }
                    placeholder="e.g., British professor aged 55, American doctor"
                    className="w-full px-3 py-2 border rounded-lg"
                    disabled={disabled}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Describe gender, age, accent for best voice matching
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
