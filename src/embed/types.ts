/**
 * Embed Widget Types
 */

export interface EmbedConfig {
  workspaceId: string;
  sessionId: string;
  primaryColor: string;
  logoUrl: string | null;
  chatTitle: string | null;
  greetingMessage: string;
  suggestedPrompts: string[] | null;
  footerText: string | null;
  voiceEnabled: boolean;
  fileUploadEnabled: boolean;
  maxFileSizeMb: number;
  sourcesEnabled: boolean;
}

export interface EmbedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: EmbedSource[];
  isStreaming?: boolean;
}

export interface EmbedSource {
  documentName: string;
  pageNumber: number;
  chunkText: string;
  score: number;
}

export interface EmbedRateLimit {
  remaining: number;
  dailyUsed: number;
  dailyLimit: number;
  sessionLimit: number;
  resetAt: string | null;
}

export type EmbedPosition = 'bottom-right' | 'bottom-left';

export interface EmbedWidgetProps {
  workspaceSlug: string;
  apiBaseUrl?: string;
  position?: EmbedPosition;
  offsetX?: number;
  offsetY?: number;
}
