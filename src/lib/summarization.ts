/**
 * Thread Summarization System
 *
 * Automatically compresses long conversations to reduce token usage
 * and API costs while preserving conversation context.
 */

import { getDb, transaction } from './db/kysely';
import { sql } from 'kysely';
import { getSummarizationSettings, getLlmSettings } from './db/compat/config';
import { createInternalCompletion } from './llm-client';

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
export async function getThreadSummary(threadId: string): Promise<ThreadSummary | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('thread_summaries')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

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
export async function getThreadSummaryHistory(threadId: string): Promise<ThreadSummary[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('thread_summaries')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'desc')
    .execute();

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
export async function getArchivedMessages(threadId: string): Promise<ArchivedMessage[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('archived_messages')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute();

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
async function createSummaryAndArchive(
  threadId: string,
  summary: string,
  messagesToArchive: Array<{ id: string; role: string; content: string; sources_json: string | null; created_at: string }>,
  tokensBefore: number,
  tokensAfter: number
): Promise<number> {
  return transaction(async (trx) => {
    // Create summary record
    const result = await trx
      .insertInto('thread_summaries')
      .values({
        thread_id: threadId,
        summary,
        messages_summarized: messagesToArchive.length,
        tokens_before: tokensBefore,
        tokens_after: tokensAfter,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const summaryId = result.id;

    // Archive messages
    for (const msg of messagesToArchive) {
      await trx
        .insertInto('archived_messages')
        .values({
          id: msg.id,
          thread_id: threadId,
          role: msg.role as 'user' | 'assistant' | 'tool',
          content: msg.content,
          sources_json: msg.sources_json || null,
          created_at: msg.created_at,
          summary_id: summaryId,
        })
        .execute();
    }

    // Delete archived messages from main messages table
    const messageIds = messagesToArchive.map((m) => m.id);
    if (messageIds.length > 0) {
      await trx
        .deleteFrom('messages')
        .where('id', 'in', messageIds)
        .execute();
    }

    // Update thread to mark as summarized
    await trx
      .updateTable('threads')
      .set({ is_summarized: 1 })
      .where('id', '=', threadId)
      .execute();

    return summaryId;
  });
}

/**
 * Get summarization statistics for admin dashboard
 */
export async function getSummarizationStats(): Promise<SummarizationStats> {
  const db = await getDb();

  const threadsSummarizedResult = await db
    .selectFrom('thread_summaries')
    .select(sql<number>`COUNT(DISTINCT thread_id)`.as('count'))
    .executeTakeFirst();
  const threadsSummarized = Number(threadsSummarizedResult?.count ?? 0);

  const tokenStats = await db
    .selectFrom('thread_summaries')
    .select([
      sql<number>`COALESCE(SUM(tokens_before), 0)`.as('total_before'),
      sql<number>`COALESCE(SUM(tokens_after), 0)`.as('total_after'),
    ])
    .executeTakeFirst();

  const totalTokensSaved = (Number(tokenStats?.total_before) || 0) - (Number(tokenStats?.total_after) || 0);

  const avgCompression = tokenStats?.total_before && Number(tokenStats.total_before) > 0
    ? Math.round((1 - (Number(tokenStats.total_after) || 0) / Number(tokenStats.total_before)) * 100)
    : 0;

  const archivedMessagesResult = await db
    .selectFrom('archived_messages')
    .select(db.fn.countAll().as('count'))
    .executeTakeFirst();
  const archivedMessages = Number(archivedMessagesResult?.count ?? 0);

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
export async function shouldSummarize(threadId: string): Promise<boolean> {
  const settings = await getSummarizationSettings();
  if (!settings.enabled) return false;

  const db = await getDb();
  const result = await db
    .selectFrom('threads')
    .select('total_tokens')
    .where('id', '=', threadId)
    .executeTakeFirst();

  const totalTokens = result?.total_tokens || 0;

  return totalTokens >= settings.tokenThreshold;
}

/**
 * Update thread token count
 */
export async function updateThreadTokenCount(threadId: string, tokenCount: number): Promise<void> {
  const db = await getDb();
  await sql`UPDATE threads SET total_tokens = total_tokens + ${tokenCount} WHERE id = ${threadId}`.execute(db);
}

/**
 * Get messages for a thread that would be summarized
 */
async function getMessagesToSummarize(threadId: string, keepRecent: number): Promise<Array<{
  id: string;
  role: string;
  content: string;
  sources_json: string | null;
  created_at: string;
}>> {
  const db = await getDb();

  // First count total non-tool messages
  const countResult = await db
    .selectFrom('messages')
    .select(db.fn.countAll().as('count'))
    .where('thread_id', '=', threadId)
    .where('role', '!=', 'tool')
    .executeTakeFirst();

  const total = Number(countResult?.count ?? 0);
  const limit = Math.max(0, total - keepRecent);

  if (limit <= 0) return [];

  // Get all messages except the most recent ones
  const rows = await db
    .selectFrom('messages')
    .select(['id', 'role', 'content', 'sources_json', 'created_at'])
    .where('thread_id', '=', threadId)
    .where('role', '!=', 'tool')
    .orderBy('created_at', 'asc')
    .limit(limit)
    .execute();

  return rows.map(r => ({
    id: r.id,
    role: r.role,
    content: r.content,
    sources_json: r.sources_json,
    created_at: r.created_at,
  }));
}

/**
 * Summarize a thread
 */
export async function summarizeThread(threadId: string): Promise<ThreadSummary | null> {
  const settings = await getSummarizationSettings();
  if (!settings.enabled) {
    return null;
  }

  // Get messages to summarize
  const messagesToSummarize = await getMessagesToSummarize(threadId, settings.keepRecentMessages);

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
    const llmSettings = await getLlmSettings();

    const summary = await createInternalCompletion({
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
      maxTokens: settings.summaryMaxTokens,
    });

    if (!summary) {
      console.error('[Summarization] Empty summary returned');
      return null;
    }

    // Calculate tokens after
    const tokensAfter = countTokens(summary);

    // Archive messages if configured
    if (settings.archiveOriginalMessages) {
      await createSummaryAndArchive(
        threadId,
        summary,
        messagesToSummarize,
        tokensBefore,
        tokensAfter
      );

      console.log(`[Summarization] Thread ${threadId}: Summarized ${messagesToSummarize.length} messages, ${tokensBefore} -> ${tokensAfter} tokens`);

      return await getThreadSummary(threadId);
    } else {
      // Just create summary without archiving (delete messages)
      await transaction(async (trx) => {
        await trx
          .insertInto('thread_summaries')
          .values({
            thread_id: threadId,
            summary,
            messages_summarized: messagesToSummarize.length,
            tokens_before: tokensBefore,
            tokens_after: tokensAfter,
          })
          .execute();

        // Delete old messages
        const messageIds = messagesToSummarize.map((m) => m.id);
        if (messageIds.length > 0) {
          await trx
            .deleteFrom('messages')
            .where('id', 'in', messageIds)
            .execute();
        }

        await trx
          .updateTable('threads')
          .set({ is_summarized: 1 })
          .where('id', '=', threadId)
          .execute();
      });

      return await getThreadSummary(threadId);
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
  const summaryRecord = await getThreadSummary(threadId);
  const summary = summaryRecord?.summary || null;

  // Get messages (after summary, or all if no summary)
  const db = await getDb();
  const messages = await db
    .selectFrom('messages')
    .select(['role', 'content', 'created_at'])
    .where('thread_id', '=', threadId)
    .where('role', '!=', 'tool')
    .orderBy('created_at', 'asc')
    .execute();

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
