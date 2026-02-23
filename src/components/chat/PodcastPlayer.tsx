'use client';

/**
 * Podcast Player Component
 *
 * Simple audio player for generated podcasts.
 * Displays play controls, duration, and download button.
 */

import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Volume2, VolumeX, Podcast } from 'lucide-react';
import type { PodcastHint } from '@/types';

interface PodcastPlayerProps {
  podcast: PodcastHint;
  compact?: boolean;
}

/**
 * Format seconds into MM:SS
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function PodcastPlayer({ podcast, compact = false }: PodcastPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(podcast.duration || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || podcast.duration);
      setIsLoaded(true);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [podcast.duration]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(!isMuted);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (compact) {
    // Compact version for ArtifactsPanel
    return (
      <div className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 group">
        <audio ref={audioRef} src={podcast.streamUrl} preload="metadata" />
        <button
          onClick={togglePlay}
          className="p-1 rounded-full bg-purple-100 text-purple-600 hover:bg-purple-200 transition-colors"
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
        </button>
        <Podcast size={14} className="text-purple-500 flex-shrink-0" />
        <span className="text-xs text-gray-700 truncate flex-1" title={podcast.filename}>
          {podcast.filename}
        </span>
        <span className="text-[10px] text-gray-400">
          {formatDuration(duration)}
        </span>
        <a
          href={podcast.downloadUrl}
          download
          className="p-0.5 text-gray-400 hover:text-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Download podcast"
        >
          <Download size={12} />
        </a>
      </div>
    );
  }

  // Full version for MessageBubble
  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-4 border border-purple-100">
      <audio ref={audioRef} src={podcast.streamUrl} preload="metadata" />

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 bg-purple-100 rounded-lg">
          <Podcast size={20} className="text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-900 truncate">{podcast.filename}</h4>
          <p className="text-xs text-gray-500">Audio Podcast</p>
        </div>
        <a
          href={podcast.downloadUrl}
          download
          className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
          title="Download podcast"
        >
          <Download size={18} />
        </a>
      </div>

      {/* Player controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="p-2.5 rounded-full bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-sm"
          disabled={!isLoaded}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        {/* Progress bar */}
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-purple-200 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:bg-purple-600
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-sm"
            style={{
              background: `linear-gradient(to right, rgb(147, 51, 234) ${progress}%, rgb(233, 213, 255) ${progress}%)`,
            }}
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Volume toggle */}
        <button
          onClick={toggleMute}
          className="p-2 text-gray-400 hover:text-purple-600 transition-colors"
        >
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
    </div>
  );
}
