/**
 * Working Memory Layer for Autonomous Mode
 *
 * Saves per-wave task summaries and keywords to PostgreSQL for cross-wave recall.
 * Designed for 8 GB RAM / 20 concurrent users:
 * - No embeddings, no pgvector, no Qdrant
 * - Summaries ≤ 500 chars (heuristic, no LLM call)
 * - Keywords via cheap regex/heuristic extraction
 * - Injects only last 2 waves into executor prompts
 */

import { savePlanMemory, getRecentPlanMemories } from '@/lib/db/compat/task-plans';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'this',
  'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'us', 'i', 'me',
  'my', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'than', 'then', 'also', 'only', 'just',
  'now', 'here', 'there', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'so', 'up', 'out', 'if', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'again', 'further', 'once', 'down', 'off', 'over',
  'own', 'same', 'until', 'while', 'because', 'until', 'although', 'unless', 'whether',
]);

/**
 * Cheap heuristic keyword extractor.
 * Pulls significant words from task descriptions, types, and tool names.
 * No LLM call — pure regex + frequency sorting.
 */
export function extractKeywords(tasks: { description: string; type: string; tool_name?: string }[]): string[] {
  const text = tasks
    .map((t) => `${t.description} ${t.type} ${t.tool_name || ''}`)
    .join(' ');

  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq = new Map<string, number>();

  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Build a heuristic summary of a wave's completed tasks.
 * Concatenates truncated task results — no LLM call.
 * Always returns ≤ 500 characters.
 */
function buildWaveSummary(
  tasks: { id: number; description: string; result?: string }[]
): string {
  const parts: string[] = [];
  let remaining = 500;

  for (const task of tasks) {
    const header = `Task ${task.id}: ${task.description}`;
    const result = (task.result || 'No result').replace(/\s+/g, ' ').trim();
    const truncatedResult = result.length > 120 ? result.slice(0, 120) + '...' : result;
    const chunk = `${header} → ${truncatedResult}`;

    if (chunk.length + 2 > remaining) {
      parts.push(`... ${tasks.length - parts.length} more tasks`);
      break;
    }
    parts.push(chunk);
    remaining -= chunk.length + 2; // +2 for '\n\n'
  }

  return parts.join('\n');
}

/**
 * Save a wave's memory snapshot for cross-wave recall.
 */
export async function saveWaveMemory(
  planId: string,
  wave: number,
  completedTasks: { id: number; description: string; type: string; result?: string; tool_name?: string }[]
): Promise<void> {
  if (completedTasks.length === 0) return;

  const taskIds = completedTasks.map((t) => t.id);
  const summary = buildWaveSummary(completedTasks);
  const keywords = extractKeywords(completedTasks);

  await savePlanMemory(planId, wave, taskIds, summary, keywords);
}

/**
 * Retrieve formatted working memory for prompt injection.
 * Returns the last 2 waves, capped at maxChars (default 1500).
 */
export async function getWorkingMemory(
  planId: string,
  currentWave?: number,
  maxChars: number = 1500
): Promise<string | null> {
  const memories = await getRecentPlanMemories(planId, 2);
  if (memories.length === 0) return null;

  // Exclude the current wave (if specified) to avoid self-reference
  const relevant = currentWave !== undefined
    ? memories.filter((m) => m.wave !== currentWave)
    : memories;

  if (relevant.length === 0) return null;

  const lines: string[] = [];
  let remaining = maxChars;

  for (const memory of relevant) {
    const header = `Wave ${memory.wave}:`;
    const body = memory.summary;
    const chunk = `${header}\n${body}`;

    if (chunk.length + 2 > remaining) {
      if (lines.length === 0) {
        // Even the first chunk is too big — truncate aggressively
        return chunk.slice(0, maxChars);
      }
      break;
    }

    lines.push(chunk);
    remaining -= chunk.length + 2;
  }

  return lines.join('\n\n');
}
