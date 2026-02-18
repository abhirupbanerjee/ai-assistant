'use client';

import { useState, useCallback } from 'react';
import { Copy, Check, RefreshCw, Volume2, VolumeX } from 'lucide-react';

interface MessageActionsProps {
  content: string;
  onRegenerate?: () => void;
}

export default function MessageActions({ content, onRegenerate }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

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

  return (
    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-1">
      <button
        onClick={handleCopy}
        className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
        title={copied ? 'Copied!' : 'Copy'}
      >
        {copied ? (
          <Check size={13} className="text-green-600" />
        ) : (
          <Copy size={13} className="text-gray-400 hover:text-gray-600" />
        )}
      </button>

      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
          title="Regenerate response"
        >
          <RefreshCw size={13} className="text-gray-400 hover:text-gray-600" />
        </button>
      )}

      <button
        onClick={handleReadAloud}
        className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
        title={isSpeaking ? 'Stop reading' : 'Read aloud'}
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
