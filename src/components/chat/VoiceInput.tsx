'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

interface SttClientConfig {
  enabled: boolean;
  minDurationSeconds: number;
  maxDurationSeconds: number;
}

// Module-level cache to avoid re-fetching on every mount
let cachedConfig: SttClientConfig | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchSttConfig(): Promise<SttClientConfig> {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) {
    return cachedConfig;
  }
  try {
    const res = await fetch('/api/transcribe/config');
    if (res.ok) {
      const data = await res.json();
      cachedConfig = data;
      cacheTime = Date.now();
      return data;
    }
  } catch {
    // Fall back to defaults
  }
  return { enabled: true, minDurationSeconds: 3, maxDurationSeconds: 120 };
}

export default function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [sttConfig, setSttConfig] = useState<SttClientConfig | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimeRef = useRef(0);

  useEffect(() => {
    fetchSttConfig().then(setSttConfig);
  }, []);

  const maxDuration = sttConfig?.maxDurationSeconds ?? 120;
  const minDuration = sttConfig?.minDurationSeconds ?? 3;

  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Transcription failed');
      }

      const data = await response.json();
      onTranscript(data.text);
    } catch (error) {
      console.error('Transcription error:', error);
      alert('Failed to transcribe audio. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      // Check minimum duration before stopping
      if (recordingTimeRef.current < minDuration) {
        // Discard too-short recording
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        setIsRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        alert(`Recording too short. Minimum ${minDuration} seconds.`);
        return;
      }

      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording, minDuration]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());

        if (chunksRef.current.length === 0) return;

        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Chunked recording for memory safety
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;

      // Start timer with auto-stop at max duration
      timerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(recordingTimeRef.current);
        if (recordingTimeRef.current >= maxDuration) {
          // Auto-stop at max duration
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
        }
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  }, [transcribeAudio, maxDuration]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Hide if STT is not enabled
  if (sttConfig && !sttConfig.enabled) {
    return null;
  }

  if (isTranscribing) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent-color)' }} />
        <span className="text-sm text-gray-600">Transcribing...</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <button
        onClick={stopRecording}
        className="flex items-center gap-2 px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
      >
        <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
        <span className="text-sm font-medium">
          {formatTime(recordingTime)} / {formatTime(maxDuration)}
        </span>
        <Square size={16} fill="currentColor" />
      </button>
    );
  }

  return (
    <button
      onClick={startRecording}
      disabled={disabled}
      className="p-2 text-gray-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200"
      title="Voice input"
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.color = 'var(--accent-color)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = '';
      }}
    >
      <Mic size={20} />
    </button>
  );
}
