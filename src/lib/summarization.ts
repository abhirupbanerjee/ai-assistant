/**
 * Thread Summarization System
 *
 * Automatically compresses long conversations to reduce token usage
 * and API costs while preserving conversation context.
 */

import { execute, queryOne, queryAll, transaction } from './db';
import { getSummarizationSettings, getLlmSettings } from './db/config';
import OpenAI from 'openai';
import { getApiKey } from '@/lib/provider-helpers';

// ============ Types ============

export interface ThreadSummary {
  id: number;
  threadId: string;
  summary: string;
  messagesSummarized: number;
  tokensBefore: number | null;
  tokensAfter: number | null;
  createdAt: string;
}

interface DbThreadSummary {
  id: number;
  thread_id: string;
  summary: string;
  messages_summarized: number;
  tokens_before: number | null;
  tokens_after: number | null;
  created_at: string;
}

export interface ArchivedMessage {
  id: string;
  threadId: string;
  role: string;
  content: string;
  sourcesJson: string | null;
  createdAt: string;
  archivedAt: string;
  summaryId: number | null;
}

interface DbArchivedMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  sources_json: string | null;
  created_at: string;
  archived_at: string;
  summary_id: number | null;
}

export interface SummarizationStats {
  threadsSummarized: number;
  totalTokensSaved: number;
  avgCompression: number;
  archivedMessages: number;
}

// ============ Summarization Prompt ============

const SUMMARIZATION_PROMPT = `Summarize the following conversation, preserving:
1. Key questions asked and answers provided
2. Important decisions or conclusions reached
3. Any action items or follow-ups mentioned
4. Relevant document references or sources cited

Keep the summary concise but comprehensive enough to continue the conversation naturally.

Conversation:
{messages}

Provide a summary in 2-3 paragraphs. Focus on the most important information that would help continue this conversation.`;

// ============ Token Counting ============

/**
 * Estimate token count using character-based heuristics.
 * This is a reliable fallback that works in all environments.
 *
 * Average ratios:
 * - English text: ~4 characters per token
 * - Code: ~3.5 characters per token
 * - Mixed content: ~3.75 characters per token
 */
// Model parameter reserved for future use with model-specific tokenizers
export function countTokens(text: string, model?: string): number {
  void model; // Suppress unused warning - reserved for future model-specific counting
  if (!text) return 0;

  // Use a slightly conservative estimate (3.5 chars per token)
  // This accounts for code, punctuation, and special characters
  const charCount = text.length;

  // Count words as an additional heuristic
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  // Estimate: average of char-based and word-based estimates
  // Words average ~1.3 tokens each (accounting for subword tokenization)
  const charBasedEstimate = Math.ceil(charCount / 3.5);
  const wordBasedEstimate = Math.ceil(wordCount * 1.3);

  // Use the average of both estimates for better accuracy
  return Math.ceil((charBasedEstimate + wordBasedEstimate) / 2);
}

/**
 * Count total tokens in a list of messages
 */
export function countMessagesTokens(messages: Array<{ role: string; content: string }>, model?: string): number {
  // Each message has overhead (~4 tokens for role, etc.)
  const overhead = messages.length * 4;
  const contentTokens = messages.reduce((sum, msg) => sum + countTokens(msg.content, model), 0);
  return overhead + contentTokens;
}

// ============ Database Operations ============

/**
 * Get the latest summary for a thread
 */
export function getThreadSummary(threadId: string): ThreadSummary | null {
  const row = queryOne<DbThreadSummary>(
    'SELECT * FROM thread_summaries WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1',
    [threadId]
  );

  if (!row) return null;

  return {
    id: row.id,
    threadId: row.thread_id,
    summary: row.summary,
    messagesSummarized: row.messages_summarized,
    tokensBefore: row.tokens_before,
    tokensAfter: row.tokens_after,
    createdAt: row.created_at,
  };
}

/**
 * Get all summaries for a thread (history)
 */
export function getThreadSummaryHistory(threadId: string): ThreadSummary[] {
  const rows = queryAll<DbThreadSummary>(
    'SELECT * FROM thread_summaries WHERE thread_id = ? ORDER BY created_at DESC',
    [threadId]
  );

  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    summary: row.summary,
    messagesSummarized: row.messages_summarized,
    tokensBefore: row.tokens_before,
    tokensAfter: row.tokens_after,
    createdAt: row.created_at,
  }));
}

/**
 * Get archived messages for a thread
 */
export function getArchivedMessages(threadId: string): ArchivedMessage[] {
  const rows = queryAll<DbArchivedMessage>(
    'SELECT * FROM archived_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [threadId]
  );

  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    sourcesJson: row.sources_json,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    summaryId: row.summary_id,
  }));
}

/**
 * Create a summary and archive messages
 */
function createSummaryAndArchive(
  threadId: string,
  summary: string,
  messagesToArchive: Array<{ id: string; role: string; content: string; sources_json: string | null; created_at: string }>,
  tokensBefore: number,
  tokensAfter: number
): number {
  return transaction(() => {
    // Create summary record
    const result = execute(
      `INSERT INTO thread_summaries (thread_id, summary, messages_summarized, tokens_before, tokens_after)
       VALUES (?, ?, ?, ?, ?)`,
      [threadId, summary, messagesToArchive.length, tokensBefore, tokensAfter]
    );

    const summaryId = Number(result.lastInsertRowid);

    // Archive messages
    for (const msg of messagesToArchive) {
      execute(
        `INSERT INTO archived_messages (id, thread_id, role, content, sources_json, created_at, summary_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [msg.id, threadId, msg.role, msg.content, msg.sources_json || null, msg.created_at, summaryId]
      );
    }

    // Delete archived messages from main messages table
    const messageIds = messagesToArchive.map((m) => m.id);
    if (messageIds.length > 0) {
      execute(
        `DELETE FROM messages WHERE id IN (${messageIds.map(() => '?').join(',')})`,
        messageIds
      );
    }

    // Update thread to mark as summarized
    execute(
      'UPDATE threads SET is_summarized = 1 WHERE id = ?',
      [threadId]
    );

    return summaryId;
  });
}

/**
 * Get summarization statistics for admin dashboard
 */
export function getSummarizationStats(): SummarizationStats {
  const threadsSummarized = queryOne<{ count: number }>(
    'SELECT COUNT(DISTINCT thread_id) as count FROM thread_summaries'
  )?.count || 0;

  const tokenStats = queryOne<{ total_before: number; total_after: number }>(
    'SELECT COALESCE(SUM(tokens_before), 0) as total_before, COALESCE(SUM(tokens_after), 0) as total_after FROM thread_summaries'
  );

  const totalTokensSaved = (tokenStats?.total_before || 0) - (tokenStats?.total_after || 0);

  const avgCompression = tokenStats?.total_before && tokenStats.total_before > 0
    ? Math.round((1 - (tokenStats.total_after || 0) / tokenStats.total_before) * 100)
    : 0;

  const archivedMessages = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM archived_messages'
  )?.count || 0;

  return {
    threadsSummarized,
    totalTokensSaved,
    avgCompression,
    archivedMessages,
  };
}

// ============ Summarization Logic ============

/**
 * Check if a thread should be summarized
 */
export function shouldSummarize(threadId: string): boolean {
  const settings = getSummarizationSettings();
  if (!settings.enabled) return false;

  // Get total tokens in thread
  const totalTokens = queryOne<{ total_tokens: number }>(
    'SELECT total_tokens FROM threads WHERE id = ?',
    [threadId]
  )?.total_tokens || 0;

  return totalTokens >= settings.tokenThreshold;
}

/**
 * Update thread token count
 */
export function updateThreadTokenCount(threadId: string, tokenCount: number): void {
  execute(
    'UPDATE threads SET total_tokens = total_tokens + ? WHERE id = ?',
    [tokenCount, threadId]
  );
}

/**
 * Get messages for a thread that would be summarized
 */
function getMessagesToSummarize(threadId: string, keepRecent: number): Array<{
  id: string;
  role: string;
  content: string;
  sources_json: string | null;
  created_at: string;
}> {
  // Get all messages except the most recent ones
  return queryAll<{
    id: string;
    role: string;
    content: string;
    sources_json: string | null;
    created_at: string;
  }>(
    `SELECT id, role, content, sources_json, created_at FROM messages
     WHERE thread_id = ? AND role != 'tool'
     ORDER BY created_at ASC
     LIMIT (SELECT COUNT(*) FROM messages WHERE thread_id = ? AND role != 'tool') - ?`,
    [threadId, threadId, keepRecent]
  );
}

/**
 * Summarize a thread
 */
export async function summarizeThread(threadId: string): Promise<ThreadSummary | null> {
  const settings = getSummarizationSettings();
  if (!settings.enabled) {
    return null;
  }

  // Get messages to summarize
  const messagesToSummarize = getMessagesToSummarize(threadId, settings.keepRecentMessages);

  if (messagesToSummarize.length < 2) {
    console.log(`[Summarization] Not enough messages to summarize for thread ${threadId}`);
    return null;
  }

  // Calculate tokens before
  const tokensBefore = countMessagesTokens(
    messagesToSummarize.map((m) => ({ role: m.role, content: m.content }))
  );

  // Format messages for summarization
  const formattedMessages = messagesToSummarize
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const prompt = SUMMARIZATION_PROMPT.replace('{messages}', formattedMessages);

  try {
    const llmSettings = getLlmSettings();
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const baseURL = process.env.OPENAI_BASE_URL || undefined;
    const apiKey = process.env.OPENAI_BASE_URL
      ? (process.env.LITELLM_MASTER_KEY || getApiKey('openai'))
      : getApiKey('openai');

    const client = new OpenAI({
      baseURL,
      apiKey: apiKey || '',
    });

    const response = await client.chat.completions.create({
      model: llmSettings.model,
      messages: [
        {
          role: 'system',
          content: 'You are a conversation summarizer. Create concise but comprehensive summaries that preserve important context.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: settings.summaryMaxTokens,
    });

    const summary = response.choices[0]?.message?.content?.trim() || '';

    if (!summary) {
      console.error('[Summarization] Empty summary returned');
      return null;
    }

    // Calculate tokens after
    const tokensAfter = countTokens(summary);

    // Archive messages if configured
    if (settings.archiveOriginalMessages) {
      createSummaryAndArchive(
        threadId,
        summary,
        messagesToSummarize,
        tokensBefore,
        tokensAfter
      );

      console.log(`[Summarization] Thread ${threadId}: Summarized ${messagesToSummarize.length} messages, ${tokensBefore} -> ${tokensAfter} tokens`);

      return getThreadSummary(threadId);
    } else {
      // Just create summary without archiving (delete messages)
      transaction(() => {
        execute(
          `INSERT INTO thread_summaries (thread_id, summary, messages_summarized, tokens_before, tokens_after)
           VALUES (?, ?, ?, ?, ?)`,
          [threadId, summary, messagesToSummarize.length, tokensBefore, tokensAfter]
        );

        // Delete old messages
        const messageIds = messagesToSummarize.map((m) => m.id);
        if (messageIds.length > 0) {
          execute(
            `DELETE FROM messages WHERE id IN (${messageIds.map(() => '?').join(',')})`,
            messageIds
          );
        }

        execute('UPDATE threads SET is_summarized = 1 WHERE id = ?', [threadId]);
      });

      return getThreadSummary(threadId);
    }
  } catch (error) {
    console.error('[Summarization] Failed to summarize thread:', error);
    return null;
  }
}

/**
 * Get thread with summary context for chat
 * Returns the summary (if exists) and recent messages
 */
export async function getThreadContext(
  threadId: string,
  maxTokens: number = 8000
): Promise<{
  summary: string | null;
  messages: Array<{ role: string; content: string }>;
  totalTokens: number;
}> {
  // Get latest summary
  const summaryRecord = getThreadSummary(threadId);
  const summary = summaryRecord?.summary || null;

  // Get messages (after summary, or all if no summary)
  const messages = queryAll<{ role: string; content: string; created_at: string }>(
    `SELECT role, content, created_at FROM messages
     WHERE thread_id = ? AND role != 'tool'
     ORDER BY created_at ASC`,
    [threadId]
  );

  // Calculate token budget
  let tokenCount = summary ? countTokens(summary) : 0;
  const contextMessages: Array<{ role: string; content: string }> = [];

  // Add messages from most recent, working backwards until we hit the limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = countTokens(messages[i].content);
    if (tokenCount + msgTokens > maxTokens) break;
    contextMessages.unshift({ role: messages[i].role, content: messages[i].content });
    tokenCount += msgTokens;
  }

  return {
    summary,
    messages: contextMessages,
    totalTokens: tokenCount,
  };
}

/**
 * Format summary for injection into conversation
 */
export function formatSummaryForContext(summary: string): string {
  return `## Previous Conversation Summary
The following is a summary of earlier parts of this conversation:

${summary}

---
Continue the conversation based on this context.`;
}
