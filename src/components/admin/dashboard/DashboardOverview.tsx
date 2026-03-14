'use client';

import { useState, useEffect, useCallback } from 'react';
import { Cpu, Database, Sparkles, Mic, Layers, FileSearch, Image, Podcast } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface RerankerProviderConfig {
  provider: string;
  enabled: boolean;
}

interface OcrProviderConfig {
  provider: string;
  enabled: boolean;
}

interface ToolConfig {
  enabled: boolean;
  config: {
    activeProvider?: string;
    providers?: Record<string, { enabled?: boolean; model?: string }>;
    [key: string]: unknown;
  };
}

interface OverviewData {
  llm: { model?: string; temperature?: number; maxTokens?: number };
  embedding: { model?: string; dimensions?: number; fallbackModel?: string };
  reranker: {
    enabled?: boolean;
    providers?: RerankerProviderConfig[];
    topKForReranking?: number;
    minRerankerScore?: number;
  };
  rag: {
    chunkingStrategy?: string;
    chunkSize?: number;
    chunkOverlap?: number;
  };
  ocr: {
    providers?: OcrProviderConfig[];
  };
  transcription: string;
  imageGen: ToolConfig | null;
  podcastGen: ToolConfig | null;
}

function getActiveRerankerProvider(providers?: RerankerProviderConfig[]): string {
  if (!providers?.length) return 'None';
  const active = providers.find(p => p.enabled);
  return active?.provider || 'None';
}

function getActiveOcrProviders(providers?: OcrProviderConfig[]): string {
  if (!providers?.length) return 'None';
  const active = providers.filter(p => p.enabled).map(p => p.provider);
  if (active.length === 0) return 'None';
  const names: Record<string, string> = { 'mistral': 'Mistral', 'azure-di': 'Azure DI', 'pdf-parse': 'PDF Parse' };
  return active.map(p => names[p] || p).join(', ');
}

export default function DashboardOverview() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [settingsRes, toolsRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/tools'),
      ]);

      let imageGen: ToolConfig | null = null;
      let podcastGen: ToolConfig | null = null;

      if (toolsRes.ok) {
        const toolsData = await toolsRes.json();
        const tools = toolsData.tools || [];
        const imgTool = tools.find((t: { name: string }) => t.name === 'image_gen');
        const podTool = tools.find((t: { name: string }) => t.name === 'podcast_gen');
        if (imgTool) imageGen = { enabled: imgTool.enabled, config: imgTool.config || {} };
        if (podTool) podcastGen = { enabled: podTool.enabled, config: podTool.config || {} };
      }

      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setData({
          llm: { model: s.llm?.model, temperature: s.llm?.temperature, maxTokens: s.llm?.maxTokens },
          embedding: { model: s.embedding?.model, dimensions: s.embedding?.dimensions, fallbackModel: s.embedding?.fallbackModel },
          reranker: {
            enabled: s.reranker?.enabled,
            providers: s.reranker?.providers,
            topKForReranking: s.reranker?.topKForReranking,
            minRerankerScore: s.reranker?.minRerankerScore,
          },
          rag: {
            chunkingStrategy: s.rag?.chunkingStrategy,
            chunkSize: s.rag?.chunkSize,
            chunkOverlap: s.rag?.chunkOverlap,
          },
          ocr: { providers: s.ocr?.providers },
          transcription: s.models?.transcription || 'whisper-1',
          imageGen,
          podcastGen,
        });
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Active Configuration</h2>
          <p className="text-sm text-gray-500">Currently selected services and models</p>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="py-4 flex justify-center">
              <Spinner size="md" />
            </div>
          ) : data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* LLM */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Cpu size={20} className="text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">LLM</p>
                  <p className="text-sm font-semibold text-gray-900 truncate" title={data.llm.model || 'Not configured'}>
                    {data.llm.model || 'Not configured'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Temp: {data.llm.temperature ?? '-'} | Max: {data.llm.maxTokens ?? '-'}
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
                  <p className="text-sm font-semibold text-gray-900 truncate" title={data.embedding.model || 'Not configured'}>
                    {data.embedding.model || 'Not configured'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Dim: {data.embedding.dimensions ?? '-'}
                    {data.embedding.fallbackModel && ` | FB: ${data.embedding.fallbackModel}`}
                  </p>
                </div>
              </div>

              {/* Reranker */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className={`p-2 rounded-lg ${data.reranker.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                  <Sparkles size={20} className={data.reranker.enabled ? 'text-green-600' : 'text-gray-400'} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Reranker</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {data.reranker.enabled ? (
                      <span className="capitalize">{getActiveRerankerProvider(data.reranker.providers)}</span>
                    ) : (
                      <span className="text-gray-500">Disabled</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {data.reranker.enabled
                      ? `Top-K: ${data.reranker.topKForReranking} | Min: ${data.reranker.minRerankerScore}`
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
                  <p className="text-sm font-semibold text-gray-900 truncate" title={data.transcription}>
                    {data.transcription}
                  </p>
                  <p className="text-xs text-gray-500">OpenAI Whisper</p>
                </div>
              </div>

              {/* RAG / Chunking */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <Layers size={20} className="text-teal-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">RAG / Chunking</p>
                  <p className="text-sm font-semibold text-gray-900 capitalize">
                    {data.rag.chunkingStrategy || 'recursive'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Size: {data.rag.chunkSize ?? '-'} | Overlap: {data.rag.chunkOverlap ?? '-'}
                  </p>
                </div>
              </div>

              {/* OCR / Document Processing */}
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <FileSearch size={20} className="text-yellow-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Doc Processing</p>
                  <p className="text-sm font-semibold text-gray-900 truncate" title={getActiveOcrProviders(data.ocr.providers)}>
                    {getActiveOcrProviders(data.ocr.providers)}
                  </p>
                  <p className="text-xs text-gray-500">OCR extraction</p>
                </div>
              </div>

              {/* Image Generation (only if enabled) */}
              {data.imageGen?.enabled && (
                <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                  <div className="p-2 bg-pink-100 rounded-lg">
                    <Image size={20} className="text-pink-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Image Gen</p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {data.imageGen.config.activeProvider || 'Not set'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {data.imageGen.config.providers?.[data.imageGen.config.activeProvider || '']?.model || 'Default model'}
                    </p>
                  </div>
                </div>
              )}

              {/* Podcast Generation (only if enabled) */}
              {data.podcastGen?.enabled && (
                <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <Podcast size={20} className="text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Podcast Gen</p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {data.podcastGen.config.activeProvider || 'Not set'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {data.podcastGen.config.providers?.[data.podcastGen.config.activeProvider || '']?.model || 'Default model'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 text-center text-gray-500">Failed to load configuration</div>
          )}
        </div>
      </div>
    </div>
  );
}
