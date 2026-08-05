'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Check, RefreshCw, Volume2, VolumeX, GitBranch, ChevronDown } from 'lucide-react';

interface ThreadModelOption {
  id: string;
  displayName?: string | null;
}

interface MessageActionsProps {
  content: string;
  onRegenerate?: () => void;
  /** Regenerate with a specific model (ChatGPT-style). Requires threadId to fetch available models. */
  onRegenerateWithModel?: (modelId: string) => void;
  /** Fork the conversation into a new thread up to this message */
  onFork?: () => void;
  /** Thread ID — used to lazy-fetch available models for the regenerate model picker */
  threadId?: string | null;
}

export default function MessageActions({ content, onRegenerate, onRegenerateWithModel, onFork, threadId }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [models, setModels] = useState<ThreadModelOption[] | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Close the model menu on outside click
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [modelMenuOpen]);

  const toggleModelMenu = useCallback(async () => {
    const next = !modelMenuOpen;
    setModelMenuOpen(next);
    // Lazy-fetch available models on first open
    if (next && !models && !modelsLoading && threadId) {
      setModelsLoading(true);
      try {
        const res = await fetch(`/api/threads/${threadId}/model`);
        if (res.ok) {
          const data = await res.json();
          setModels(data.availableModels || []);
          setCurrentModel(data.effectiveModel || data.selectedModel || null);
        } else {
          console.error('Failed to load models:', await res.text());
          setModelMenuOpen(false);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
        setModelMenuOpen(false);
      } finally {
        setModelsLoading(false);
      }
    }
  }, [modelMenuOpen, models, modelsLoading, threadId]);

  const handlePickModel = useCallback((modelId: string) => {
    setModelMenuOpen(false);
    onRegenerateWithModel?.(modelId);
  }, [onRegenerateWithModel]);

  const handleReadAloud = useCallback(() => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    // Strip common markdown syntax for cleaner speech
    const plainText = content
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .trim();

    const utterance = new SpeechSynthesisUtterance(plainText);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [content, isSpeaking]);

  const showModelPicker = Boolean(onRegenerateWithModel && threadId);

  return (
    <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-1">
      <button
        onClick={handleCopy}
        className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
        title={copied ? 'Copied!' : 'Copy'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy message to clipboard'}
      >
        {copied ? (
          <Check size={13} className="text-green-600" />
        ) : (
          <Copy size={13} className="text-gray-400 hover:text-gray-600" />
        )}
      </button>

      {onRegenerate && (
        <div className="relative flex items-center" ref={modelMenuRef}>
          <button
            onClick={onRegenerate}
            className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
            title="Regenerate response"
            aria-label="Regenerate response"
          >
            <RefreshCw size={13} className="text-gray-400 hover:text-gray-600" />
          </button>

          {showModelPicker && (
            <button
              onClick={toggleModelMenu}
              className="p-0.5 rounded-md hover:bg-gray-200 transition-colors"
              title="Regenerate with a different model"
              aria-label="Choose model and regenerate"
              aria-expanded={modelMenuOpen}
            >
              <ChevronDown size={11} className="text-gray-400 hover:text-gray-600" />
            </button>
          )}

          {modelMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 z-50 w-52 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
              {modelsLoading && (
                <div className="px-3 py-2 text-xs text-gray-400">Loading models…</div>
              )}
              {!modelsLoading && models && models.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">No models available</div>
              )}
              {!modelsLoading && models?.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handlePickModel(m.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="flex-1 truncate">{m.displayName || m.id}</span>
                  {m.id === currentModel && (
                    <Check size={13} className="text-blue-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {onFork && (
        <button
          onClick={onFork}
          className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
          title="Fork chat into a new thread from here"
          aria-label="Fork chat into a new thread from this message"
        >
          <GitBranch size={13} className="text-gray-400 hover:text-gray-600" />
        </button>
      )}

      <button
        onClick={handleReadAloud}
        className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
        title={isSpeaking ? 'Stop reading' : 'Read aloud'}
        aria-label={isSpeaking ? 'Stop reading aloud' : 'Read message aloud'}
      >
        {isSpeaking ? (
          <VolumeX size={13} className="text-blue-500" />
        ) : (
          <Volume2 size={13} className="text-gray-400 hover:text-gray-600" />
        )}
      </button>
    </div>
  );
}
