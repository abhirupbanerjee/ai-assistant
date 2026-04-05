'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Eye, EyeOff, AlertTriangle, Info, CheckCircle, ExternalLink } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============================================================================
// Types
// ============================================================================

interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  apiBase: string | null;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyFromEnv: boolean;
}

interface SettingsData {
  tavily: {
    hasApiKey: boolean;
    apiKeyFromEnv: boolean;
  };
  reranker: {
    hasCohereApiKey: boolean;
    cohereApiKeyFromEnv: boolean;
  };
  ocr: {
    hasMistralApiKey: boolean;
    mistralFromLlmProvider: boolean;
    mistralOcrApiKeyFromEnv: boolean;
    hasAzureDiCredentials: boolean;
    azureDiFromEnv: boolean;
    azureDiEndpoint?: string;
  };
}

interface WebSearchConfig {
  config: {
    apiKey?: string;
    [key: string]: unknown;
  };
}

type SourceBadge = 'db' | 'env' | 'llm' | 'none';

// Provider capabilities and route classification
const PROVIDER_CAPABILITIES: Record<string, string[]> = {
  openai: ['LLM', 'Embeddings', 'Images', 'TTS'],
  gemini: ['LLM', 'Embeddings', 'Images', 'TTS'],
  mistral: ['LLM', 'Embeddings'],
  fireworks: ['LLM', 'Embeddings', 'Reranker'],
  deepseek: ['LLM'],
  ollama: ['LLM'],
  anthropic: ['LLM'],
};

const ROUTE_1_PROVIDERS = ['openai', 'gemini', 'mistral', 'deepseek'];
const ROUTE_2_PROVIDERS = ['fireworks', 'anthropic'];
const ROUTE_3_PROVIDERS = ['ollama'];
const EMBEDDING_PROVIDERS = ['openai', 'gemini', 'mistral', 'fireworks'];

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ source }: { source: SourceBadge }) {
  switch (source) {
    case 'db':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          DB
        </span>
      );
    case 'env':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          ENV
        </span>
      );
    case 'llm':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          LLM
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          None
        </span>
      );
  }
}

// ============================================================================
// Capability Tags
// ============================================================================

function CapabilityTags({ capabilities }: { capabilities: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {capabilities.map((cap) => (
        <span
          key={cap}
          className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
        >
          {cap}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// Key Input Row
// ============================================================================

function KeyInputRow({
  label,
  value,
  source,
  onChange,
  placeholder,
  capabilities,
  hint,
  isUrl,
}: {
  label: string;
  value: string;
  source: SourceBadge;
  onChange: (val: string) => void;
  placeholder?: string;
  capabilities?: string[];
  hint?: string;
  isUrl?: boolean;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex-shrink-0 w-32">
        <div className="font-medium text-sm text-gray-900">{label}</div>
        {capabilities && <CapabilityTags capabilities={capabilities} />}
      </div>
      <div className="flex-1 relative">
        <input
          type={showKey || isUrl ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || (isUrl ? 'https://...' : 'Enter API key...')}
          className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8 font-mono"
        />
        {!isUrl && (
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      <div className="flex-shrink-0 w-16 flex justify-end">
        <StatusBadge source={source} />
      </div>
      {hint && (
        <div className="flex-shrink-0">
          <span className="text-xs text-amber-600" title={hint}>
            <AlertTriangle size={14} />
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Read-only Key Row (for Fireworks reranker reference, etc.)
// ============================================================================

function ReadOnlyKeyRow({ label, message }: { label: string; message: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg">
      <div className="flex-shrink-0 w-32">
        <div className="font-medium text-sm text-gray-900">{label}</div>
      </div>
      <div className="flex-1">
        <span className="text-sm text-gray-500 italic">{message}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Section Header
// ============================================================================

function SectionHeader({
  title,
  subtitle,
  optional,
}: {
  title: string;
  subtitle?: string;
  optional?: boolean;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold text-gray-900">
        {title}
        {optional && (
          <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            Optional
          </span>
        )}
      </h3>
      {subtitle && (
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ApiKeysSettings() {
  // Loading / saving state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Data from API
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig | null>(null);

  // Edited key values (only populated when user changes something)
  const [editedLLMKeys, setEditedLLMKeys] = useState<Record<string, { apiKey?: string; apiBase?: string }>>({});
  const [editedTavilyKey, setEditedTavilyKey] = useState<string | null>(null);
  const [editedOcr, setEditedOcr] = useState<{ mistralApiKey?: string; azureDiKey?: string; azureDiEndpoint?: string }>({});
  const [editedCohereKey, setEditedCohereKey] = useState<string | null>(null);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providersRes, settingsRes, webSearchRes] = await Promise.all([
        fetch('/api/admin/llm/providers'),
        fetch('/api/admin/settings'),
        fetch('/api/admin/tools/web_search'),
      ]);

      if (!providersRes.ok || !settingsRes.ok) {
        throw new Error('Failed to fetch configuration');
      }

      const providersData = await providersRes.json();
      const settingsData = await settingsRes.json();

      setProviders(providersData.providers || []);
      setSettings({
        tavily: {
          hasApiKey: settingsData.tavily?.hasApiKey ?? false,
          apiKeyFromEnv: settingsData.tavily?.apiKeyFromEnv ?? false,
        },
        reranker: {
          hasCohereApiKey: settingsData.reranker?.hasCohereApiKey ?? false,
          cohereApiKeyFromEnv: settingsData.reranker?.cohereApiKeyFromEnv ?? false,
        },
        ocr: {
          hasMistralApiKey: settingsData.ocr?.hasMistralApiKey ?? false,
          mistralFromLlmProvider: settingsData.ocr?.mistralFromLlmProvider ?? false,
          mistralOcrApiKeyFromEnv: settingsData.ocr?.mistralOcrApiKeyFromEnv ?? false,
          hasAzureDiCredentials: settingsData.ocr?.hasAzureDiCredentials ?? false,
          azureDiFromEnv: settingsData.ocr?.azureDiFromEnv ?? false,
        },
      });

      // Web search config may 404 if not yet configured
      if (webSearchRes.ok) {
        const wsData = await webSearchRes.json();
        setWebSearchConfig(wsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ============================================================================
  // Source Badge Logic
  // ============================================================================

  function getProviderSource(provider: LLMProvider): SourceBadge {
    if (provider.apiKeyConfigured) return 'db';
    if (provider.apiKeyFromEnv) return 'env';
    return 'none';
  }

  function getTavilySource(): SourceBadge {
    if (!settings) return 'none';
    // Check if the tool_configs table has it (webSearchConfig)
    const wsKey = webSearchConfig?.config?.apiKey;
    const hasWsKey = wsKey && typeof wsKey === 'string' && !wsKey.includes('••');
    if (settings.tavily.hasApiKey && !settings.tavily.apiKeyFromEnv) return 'db';
    if (hasWsKey) return 'db';
    if (settings.tavily.apiKeyFromEnv) return 'env';
    if (settings.tavily.hasApiKey) return 'db';
    return 'none';
  }

  function getOcrMistralSource(): SourceBadge {
    if (!settings) return 'none';
    if (settings.ocr.hasMistralApiKey) return 'db';
    if (settings.ocr.mistralFromLlmProvider) return 'llm';
    if (settings.ocr.mistralOcrApiKeyFromEnv) return 'env';
    return 'none';
  }

  function getOcrAzureSource(): SourceBadge {
    if (!settings) return 'none';
    if (settings.ocr.hasAzureDiCredentials) return 'db';
    if (settings.ocr.azureDiFromEnv) return 'env';
    return 'none';
  }

  function getCohereSource(): SourceBadge {
    if (!settings) return 'none';
    if (settings.reranker.hasCohereApiKey && !settings.reranker.cohereApiKeyFromEnv) return 'db';
    if (settings.reranker.cohereApiKeyFromEnv) return settings.reranker.hasCohereApiKey ? 'db' : 'env';
    if (settings.reranker.hasCohereApiKey) return 'db';
    return 'none';
  }

  // ============================================================================
  // Warning Logic
  // ============================================================================

  function getConfiguredProviderIds(): Set<string> {
    const configured = new Set<string>();
    for (const p of providers) {
      if (p.apiKeyConfigured || p.apiKeyFromEnv) {
        configured.add(p.id);
      }
    }
    return configured;
  }

  const configuredIds = getConfiguredProviderIds();
  const hasAnyLLM = configuredIds.size > 0;
  const hasEmbeddingProvider = EMBEDDING_PROVIDERS.some((id) => configuredIds.has(id));
  const onlyAnthropicConfigured =
    configuredIds.size === 1 && configuredIds.has('anthropic');

  // ============================================================================
  // Provider Key Editing
  // ============================================================================

  function getLLMKeyValue(provider: LLMProvider): string {
    const edited = editedLLMKeys[provider.id];
    if (provider.id === 'ollama') {
      return edited?.apiBase ?? provider.apiBase ?? '';
    }
    return edited?.apiKey ?? (provider.apiKeyConfigured ? provider.apiKey : '');
  }

  function handleLLMKeyChange(providerId: string, value: string, isBase?: boolean) {
    setEditedLLMKeys((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        [isBase ? 'apiBase' : 'apiKey']: value,
      },
    }));
  }

  // ============================================================================
  // Save
  // ============================================================================

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const promises: Promise<Response>[] = [];

      // Save changed LLM provider keys
      for (const [providerId, changes] of Object.entries(editedLLMKeys)) {
        const body: Record<string, string> = {};
        if (changes.apiKey !== undefined && !changes.apiKey.includes('••')) {
          body.apiKey = changes.apiKey;
        }
        if (changes.apiBase !== undefined) {
          body.apiBase = changes.apiBase;
        }
        if (Object.keys(body).length > 0) {
          promises.push(
            fetch(`/api/admin/llm/providers/${providerId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          );
        }
      }

      // Save Tavily key via tool config endpoint
      if (editedTavilyKey !== null) {
        const existingConfig = webSearchConfig?.config || {};
        promises.push(
          fetch('/api/admin/tools/web_search', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: { ...existingConfig, apiKey: editedTavilyKey },
            }),
          })
        );
      }

      // Save OCR settings
      if (editedOcr.mistralApiKey !== undefined || editedOcr.azureDiKey !== undefined || editedOcr.azureDiEndpoint !== undefined) {
        const ocrBody: Record<string, string> = {};
        if (editedOcr.mistralApiKey !== undefined) ocrBody.mistralApiKey = editedOcr.mistralApiKey;
        if (editedOcr.azureDiKey !== undefined) ocrBody.azureDiKey = editedOcr.azureDiKey;
        if (editedOcr.azureDiEndpoint !== undefined) ocrBody.azureDiEndpoint = editedOcr.azureDiEndpoint;
        promises.push(
          fetch('/api/admin/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ocr', ...ocrBody }),
          })
        );
      }

      // Save Cohere key via reranker settings
      if (editedCohereKey !== null) {
        promises.push(
          fetch('/api/admin/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'reranker', cohereApiKey: editedCohereKey }),
          })
        );
      }

      if (promises.length === 0) {
        setSaving(false);
        return;
      }

      const results = await Promise.all(promises);
      const failed = results.filter((r) => !r.ok);

      if (failed.length > 0) {
        throw new Error(`${failed.length} save operation(s) failed`);
      }

      // Reset edited state and reload
      setEditedLLMKeys({});
      setEditedTavilyKey(null);
      setEditedOcr({});
      setEditedCohereKey(null);
      setSuccessMessage('API keys saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ============================================================================
  // Test Provider Connection
  // ============================================================================

  const handleTestProvider = async (providerId: string) => {
    setTestingProvider(providerId);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

    try {
      const res = await fetch(`/api/admin/llm/providers/${providerId}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          success: res.ok && data.success,
          message: data.message || (res.ok ? 'Connection successful' : 'Connection failed'),
        },
      }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { success: false, message: 'Network error' },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  // ============================================================================
  // Dirty check
  // ============================================================================

  const hasChanges =
    Object.keys(editedLLMKeys).length > 0 ||
    editedTavilyKey !== null ||
    Object.keys(editedOcr).length > 0 ||
    editedCohereKey !== null;

  // ============================================================================
  // Render helpers
  // ============================================================================

  function renderProviderRow(provider: LLMProvider) {
    const source = getProviderSource(provider);
    const isOllama = provider.id === 'ollama';
    const capabilities = PROVIDER_CAPABILITIES[provider.id] || ['LLM'];
    const testResult = testResults[provider.id];

    return (
      <div key={provider.id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
        <div className="flex-shrink-0 w-32">
          <div className="font-medium text-sm text-gray-900">{provider.name}</div>
          <CapabilityTags capabilities={capabilities} />
        </div>
        <div className="flex-1 relative">
          <KeyInput
            value={getLLMKeyValue(provider)}
            onChange={(val) => handleLLMKeyChange(provider.id, val, isOllama)}
            placeholder={isOllama ? 'http://localhost:11434' : 'Enter API key...'}
            isUrl={isOllama}
          />
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          <StatusBadge source={source} />
          {(source !== 'none') && (
            <button
              type="button"
              onClick={() => handleTestProvider(provider.id)}
              disabled={testingProvider === provider.id}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
            >
              {testingProvider === provider.id ? (
                <Spinner size="sm" />
              ) : (
                'Test'
              )}
            </button>
          )}
          {testResult && (
            <span className={`text-xs ${testResult.success ? 'text-green-600' : 'text-red-600'}`} title={testResult.message}>
              {testResult.success ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
            </span>
          )}
        </div>
        {provider.id === 'anthropic' && source !== 'none' && (
          <div className="flex-shrink-0">
            <span className="text-xs text-amber-600" title="No embeddings — pair with OpenAI or Fireworks">
              <AlertTriangle size={14} />
            </span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // Loading state
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  // ============================================================================
  // Group providers by route
  // ============================================================================

  const route1Providers = providers.filter((p) => ROUTE_1_PROVIDERS.includes(p.id));
  const route2Providers = providers.filter((p) => ROUTE_2_PROVIDERS.includes(p.id));
  const route3Providers = providers.filter((p) => ROUTE_3_PROVIDERS.includes(p.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">API Keys &amp; Credentials</h2>
          <p className="text-sm text-gray-500">Configure all API keys in one place</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          variant="primary"
          size="sm"
        >
          {saving ? <Spinner size="sm" /> : <Save size={16} />}
          <span className="ml-1.5">Save</span>
        </Button>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800">{successMessage}</p>
        </div>
      )}

      {/* Warnings */}
      {!loading && !hasAnyLLM && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800 font-medium">
            No LLM provider configured — chat won&apos;t work.
          </p>
        </div>
      )}
      {!loading && hasAnyLLM && (onlyAnthropicConfigured || !hasEmbeddingProvider) && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            No embedding provider configured. Cloud embeddings require OpenAI, Gemini, Mistral, or Fireworks. Local models (BGE, MixedBread) work without keys.
          </p>
        </div>
      )}

      {/* ================================================================ */}
      {/* LLM Providers */}
      {/* ================================================================ */}
      <div className="bg-white border rounded-xl p-5">
        <SectionHeader
          title="LLM Providers"
          subtitle="Route 1 via LiteLLM proxy · Route 2 direct"
        />

        <div className="flex items-center gap-1.5 mb-4 text-xs text-gray-500">
          <Info size={12} />
          <span>
            Route 1 providers go via LiteLLM proxy. Route 2 providers connect directly.{' '}
            <a href="/admin?tab=settings&section=routes" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
              See Routes <ExternalLink size={10} />
            </a>
          </span>
        </div>

        {/* Route 1 */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-3">
            Route 1 — LiteLLM Proxy
          </div>
          <div className="divide-y divide-gray-100">
            {route1Providers.map(renderProviderRow)}
          </div>
        </div>

        {/* Route 2 */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-3">
            Route 2 — Direct Providers
          </div>
          <div className="divide-y divide-gray-100">
            {route2Providers.map(renderProviderRow)}
          </div>
        </div>

        {/* Route 3 */}
        <div className="mb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-3">
            Route 3 — Local / Ollama
          </div>
          <div className="divide-y divide-gray-100">
            {route3Providers.map(renderProviderRow)}
          </div>
        </div>

        {/* Footer note */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400 px-3 mt-2">
          <Info size={12} />
          <span>Image generation, podcasts, and translation automatically use OpenAI or Gemini keys.</span>
        </div>
      </div>

      {/* ================================================================ */}
      {/* Web Search */}
      {/* ================================================================ */}
      <div className="bg-white border rounded-xl p-5">
        <SectionHeader title="Web Search" />
        <KeyInputRow
          label="Tavily"
          value={editedTavilyKey ?? ''}
          source={getTavilySource()}
          onChange={(val) => setEditedTavilyKey(val)}
          placeholder="Enter Tavily API key..."
        />
      </div>

      {/* ================================================================ */}
      {/* Document Processing */}
      {/* ================================================================ */}
      <div className="bg-white border rounded-xl p-5">
        <SectionHeader
          title="Document Processing"
          subtitle="Local parsers handle PDF, DOCX, XLSX, and PPTX without API keys. OCR keys improve accuracy for scanned documents."
          optional
        />
        <div className="divide-y divide-gray-100">
          <KeyInputRow
            label="Mistral OCR"
            value={editedOcr.mistralApiKey ?? ''}
            source={getOcrMistralSource()}
            onChange={(val) => setEditedOcr((prev) => ({ ...prev, mistralApiKey: val }))}
            placeholder="Enter Mistral API key..."
          />
          <KeyInputRow
            label="Azure DI Key"
            value={editedOcr.azureDiKey ?? ''}
            source={getOcrAzureSource()}
            onChange={(val) => setEditedOcr((prev) => ({ ...prev, azureDiKey: val }))}
            placeholder="Enter Azure Document Intelligence key..."
          />
          <KeyInputRow
            label="Azure DI URL"
            value={editedOcr.azureDiEndpoint ?? ''}
            source={getOcrAzureSource()}
            onChange={(val) => setEditedOcr((prev) => ({ ...prev, azureDiEndpoint: val }))}
            placeholder="https://your-resource.cognitiveservices.azure.com"
            isUrl
          />
        </div>
      </div>

      {/* ================================================================ */}
      {/* Reranker */}
      {/* ================================================================ */}
      <div className="bg-white border rounded-xl p-5">
        <SectionHeader
          title="Reranker"
          subtitle="Local rerankers (BGE) work without API keys."
          optional
        />
        <div className="divide-y divide-gray-100">
          <KeyInputRow
            label="Cohere"
            value={editedCohereKey ?? ''}
            source={getCohereSource()}
            onChange={(val) => setEditedCohereKey(val)}
            placeholder="Enter Cohere API key..."
          />
          <ReadOnlyKeyRow
            label="Fireworks AI"
            message="Uses LLM Fireworks key above"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Inline KeyInput (for provider rows)
// ============================================================================

function KeyInput({
  value,
  onChange,
  placeholder,
  isUrl,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  isUrl?: boolean;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="relative">
      <input
        type={showKey || isUrl ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8 font-mono"
      />
      {!isUrl && (
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
    </div>
  );
}
