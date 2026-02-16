'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cpu, Database, Sparkles, Mic, RefreshCw, Search, X, AlertCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface LLMSettings {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface EmbeddingSettings {
  model?: string;
  dimensions?: number;
}

interface RerankerSettings {
  enabled?: boolean;
  provider?: string;
  topKForReranking?: number;
  minRerankerScore?: number;
}

interface TranscriptionSettings {
  model?: string;
}

interface ServiceStatus {
  category: string;
  provider: string;
  name: string;
  model: string;
  available: boolean;
  configured: boolean;
  latency?: number;
  error?: string;
}

interface RerankerStatusItem {
  provider: string;
  configured: boolean;
  available: boolean;
  model?: string;
  error?: string;
  latency?: number;
}

export default function DashboardOverview() {
  // Settings state
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings | null>(null);
  const [rerankerSettings, setRerankerSettings] = useState<RerankerSettings | null>(null);
  const [transcriptionModel, setTranscriptionModel] = useState<string>('whisper-1');

  // Service status state
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus[]>([]);
  const [rerankerStatus, setRerankerStatus] = useState<RerankerStatusItem[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [rerankerStatusLoading, setRerankerStatusLoading] = useState(true);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch settings from the combined /api/admin/settings endpoint
  const fetchSettings = useCallback(async () => {
    try {
      setSettingsLoading(true);
      const res = await fetch('/api/admin/settings');

      if (res.ok) {
        const data = await res.json();

        // Extract LLM settings
        setLlmSettings({
          model: data.llm?.model,
          temperature: data.llm?.temperature,
          maxTokens: data.llm?.maxTokens,
        });

        // Extract Embedding settings
        setEmbeddingSettings({
          model: data.embedding?.model,
          dimensions: data.embedding?.dimensions,
        });

        // Extract Reranker settings
        setRerankerSettings({
          enabled: data.reranker?.enabled,
          provider: data.reranker?.provider,
          topKForReranking: data.reranker?.topKForReranking,
          minRerankerScore: data.reranker?.minRerankerScore,
        });

        // Extract Transcription model
        setTranscriptionModel(data.models?.transcription || 'whisper-1');
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  // Fetch providers
  const fetchProviders = useCallback(async () => {
    try {
      setProvidersLoading(true);
      const res = await fetch('/api/admin/providers');
      if (res.ok) {
        const data = await res.json();
        setServiceStatus(data.services || []);
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  // Fetch reranker status
  const fetchRerankerStatus = useCallback(async () => {
    try {
      setRerankerStatusLoading(true);
      const res = await fetch('/api/admin/reranker-status');
      if (res.ok) {
        const data = await res.json();
        setRerankerStatus(data.providers || []);
      }
    } catch (err) {
      console.error('Failed to fetch reranker status:', err);
    } finally {
      setRerankerStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchProviders();
    fetchRerankerStatus();
  }, [fetchSettings, fetchProviders, fetchRerankerStatus]);

  // Combine services with reranker status
  const allServices = useMemo(() => {
    const rerankerServices: ServiceStatus[] = rerankerStatus.map((r) => ({
      category: 'reranker',
      provider: r.provider,
      name: r.provider,
      model: r.model || '',
      available: r.available,
      configured: r.configured,
      latency: r.latency,
      error: r.error,
    }));
    return [...serviceStatus, ...rerankerServices];
  }, [serviceStatus, rerankerStatus]);

  // Get unique providers
  const providers = useMemo(() => {
    const providerSet = new Set(allServices.map((s) => s.provider));
    return Array.from(providerSet).sort();
  }, [allServices]);

  // Filter services
  const filteredServices = useMemo(() => {
    return allServices.filter((service) => {
      if (categoryFilter !== 'all' && service.category !== categoryFilter) return false;
      if (providerFilter !== 'all' && service.provider.toLowerCase() !== providerFilter) return false;
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        if (
          !service.name.toLowerCase().includes(search) &&
          !service.model.toLowerCase().includes(search) &&
          !service.provider.toLowerCase().includes(search)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [allServices, categoryFilter, providerFilter, searchTerm]);

  const handleRefresh = () => {
    fetchProviders();
    fetchRerankerStatus();
  };

  return (
    <div className="space-y-6">
      {/* Active Configuration Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Active Configuration</h2>
          <p className="text-sm text-gray-500">Currently selected services and models</p>
        </div>
        <div className="p-6">
          {settingsLoading ? (
            <div className="py-4 flex justify-center">
              <Spinner size="md" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* LLM */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Cpu size={20} className="text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">LLM</p>
                  <p className="text-sm font-semibold text-gray-900 truncate" title={llmSettings?.model || 'Not configured'}>
                    {llmSettings?.model || 'Not configured'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Temp: {llmSettings?.temperature ?? '-'} | Max tokens: {llmSettings?.maxTokens ?? '-'}
                  </p>
                </div>
              </div>

              {/* Embedding */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Database size={20} className="text-purple-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Embedding</p>
                  <p className="text-sm font-semibold text-gray-900 truncate" title={embeddingSettings?.model || 'Not configured'}>
                    {embeddingSettings?.model || 'Not configured'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Dimensions: {embeddingSettings?.dimensions ?? '-'}
                  </p>
                </div>
              </div>

              {/* Reranker */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className={`p-2 rounded-lg ${rerankerSettings?.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                  <Sparkles size={20} className={rerankerSettings?.enabled ? 'text-green-600' : 'text-gray-400'} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Reranker</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {rerankerSettings?.enabled ? (
                      <span className="capitalize">{rerankerSettings.provider}</span>
                    ) : (
                      <span className="text-gray-500">Disabled</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {rerankerSettings?.enabled
                      ? `Top-K: ${rerankerSettings.topKForReranking} | Min score: ${rerankerSettings.minRerankerScore}`
                      : 'Enable in Settings'}
                  </p>
                </div>
              </div>

              {/* Transcription */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Mic size={20} className="text-orange-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transcription</p>
                  <p className="text-sm font-semibold text-gray-900 truncate" title={transcriptionModel}>
                    {transcriptionModel}
                  </p>
                  <p className="text-xs text-gray-500">
                    OpenAI Whisper
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* System Status Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">System Status</h2>
              <p className="text-sm text-gray-500">
                {categoryFilter !== 'all' || providerFilter !== 'all' || searchTerm
                  ? `${filteredServices.length} of ${allServices.length} services`
                  : `${allServices.length} services`}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={handleRefresh}
              disabled={providersLoading || rerankerStatusLoading}
            >
              <RefreshCw size={16} className={`mr-2 ${(providersLoading || rerankerStatusLoading) ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
        <div className="p-6">
          {/* Status Legend */}
          <div className="flex gap-6 text-sm mb-4 pb-4 border-b">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />
              Configured (error)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-gray-400 rounded-full" />
              Not Configured
            </span>
          </div>

          {/* Filters and Search */}
          <div className="flex flex-wrap gap-4 mb-4">
            {/* Category Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-600">Category:</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="llm">LLM</option>
                <option value="embedding">Embedding</option>
                <option value="transcribe">Transcribe</option>
                <option value="ocr">OCR</option>
                <option value="reranker">Reranker</option>
              </select>
            </div>

            {/* Provider Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-600">Provider:</label>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                {providers.map(p => (
                  <option key={p} value={p.toLowerCase()}>{p}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search service / model..."
                  className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Status Table */}
          {(providersLoading || rerankerStatusLoading) ? (
            <div className="py-12 flex justify-center">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Provider</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Service / Model</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredServices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        No services match your filters
                      </td>
                    </tr>
                  ) : (
                    filteredServices.map((service, idx) => (
                      <tr key={`${service.category}-${service.model}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 capitalize">{service.category}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 capitalize">{service.provider}</td>
                        <td className="px-4 py-3 text-gray-600">
                          <div>{service.name}</div>
                          <div className="text-xs text-gray-400">{service.model}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                            service.available
                              ? 'bg-green-100 text-green-800'
                              : service.configured
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            <span className={`w-2 h-2 rounded-full ${
                              service.available ? 'bg-green-500' : service.configured ? 'bg-yellow-500' : 'bg-gray-400'
                            }`} />
                            {service.available
                              ? (service.latency ? `${service.latency}ms` : 'Online')
                              : service.configured ? 'Error' : 'N/A'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Error Details */}
          {(() => {
            const errors = filteredServices
              .filter(s => !s.available && s.error)
              .map(s => ({ category: s.category, provider: s.name, error: s.error! }));

            if (errors.length === 0) return null;

            return (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center gap-2 text-sm font-medium text-yellow-700 mb-2">
                  <AlertCircle size={16} />
                  Errors ({errors.length})
                </div>
                <div className="space-y-1 text-sm">
                  {errors.map((err, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-gray-600">
                      <span className="text-gray-400">•</span>
                      <span><span className="font-medium capitalize">{err.category} - {err.provider}:</span> {err.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
