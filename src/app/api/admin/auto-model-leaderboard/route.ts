/**
 * Auto Model Leaderboard API
 *
 * GET /api/admin/auto-model-leaderboard
 *
 * Returns a per-dimension leaderboard showing which model the auto-selector
 * would pick for each capability dimension. Used by the admin diagnostics panel
 * to provide visibility into auto-selection decisions.
 *
 * Each entry includes the winner with full scoring breakdown, the runner-up,
 * and the total number of candidates considered.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { selectBestModelDetailed } from '@/lib/auto-model-selector';
import type { ScoredModel } from '@/lib/auto-model-selector';
import type { CapabilityScores } from '@/lib/db/enabled-models';

interface LeaderboardWinner {
  modelId: string;
  displayName: string;
  score: number;
  breakdown: {
    capability: number;
    contextFit: number;
    cost: number;
    latency: number;
    satisfaction: number;
  };
  dominantFactor: string;
}

interface LeaderboardRunnerUp {
  modelId: string;
  displayName: string;
  score: number;
  breakdown: {
    capability: number;
    contextFit: number;
    cost: number;
    latency: number;
    satisfaction: number;
  };
  dominantFactor: string;
}

interface LeaderboardEntry {
  dimension: keyof CapabilityScores;
  label: string;
  description: string;
  samplePrompt: string;
  winner: LeaderboardWinner | null;
  runnerUp: LeaderboardRunnerUp | null;
  totalCandidates: number;
  error?: string;
}

const DIMENSIONS: Array<{
  dimension: keyof CapabilityScores;
  label: string;
  description: string;
  sample: string;
}> = [
  {
    dimension: 'function_calling',
    label: 'Tools & Function Calling',
    description: 'Document gen, image gen, web search, data sources, spreadsheets',
    sample: 'Search the web for the latest AI news and create a summary report with key findings',
  },
  {
    dimension: 'reasoning',
    label: 'Reasoning & Analysis',
    description: 'Research, policy lookup, data analysis, summarization, translation',
    sample: 'Analyze the pros and cons of microservices vs monolith architecture for a startup',
  },
  {
    dimension: 'code_quality',
    label: 'Code & Technical',
    description: 'Programming, SQL, API design, debugging, code review',
    sample: 'Write a Python function that merges two sorted lists in O(n) time complexity',
  },
  {
    dimension: 'visual_reasoning',
    label: 'Visual Understanding',
    description: 'Image analysis, diagram reading, photo description',
    sample: 'Describe what you see in the attached image',
  },
];

function toWinner(scored: ScoredModel): LeaderboardWinner {
  return {
    modelId: scored.modelId,
    displayName: scored.displayName,
    score: Math.round(scored.score * 1000) / 1000,
    breakdown: {
      capability: Math.round(scored.breakdown.capability * 1000) / 1000,
      contextFit: Math.round(scored.breakdown.contextFit * 1000) / 1000,
      cost: Math.round(scored.breakdown.cost * 1000) / 1000,
      latency: Math.round(scored.breakdown.latency * 1000) / 1000,
      satisfaction: Math.round(scored.breakdown.satisfaction * 1000) / 1000,
    },
    dominantFactor: scored.dominantFactor,
  };
}

export async function GET() {
  try {
    await requireAdmin();

    const results: LeaderboardEntry[] = [];

    for (const dim of DIMENSIONS) {
      try {
        const detailed = await selectBestModelDetailed({
          userMessage: dim.sample,
          categoryIds: [],
          hasImages: dim.dimension === 'visual_reasoning',
          estimatedTokens: 500,
          dimensionOverride: dim.dimension,
        });

        const winner = detailed.allCandidates[0];
        const runnerUp = detailed.allCandidates.length > 1 ? detailed.allCandidates[1] : null;

        results.push({
          dimension: dim.dimension,
          label: dim.label,
          description: dim.description,
          samplePrompt: dim.sample,
          winner: winner ? toWinner(winner) : null,
          runnerUp: runnerUp ? toWinner(runnerUp) : null,
          totalCandidates: detailed.allCandidates.length,
        });
      } catch (err) {
        results.push({
          dimension: dim.dimension,
          label: dim.label,
          description: dim.description,
          samplePrompt: dim.sample,
          winner: null,
          runnerUp: null,
          totalCandidates: 0,
          error: err instanceof Error ? err.message : 'Auto selection failed',
        });
      }
    }

    return NextResponse.json({ leaderboard: results });
  } catch (error) {
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[Auto Model Leaderboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate leaderboard', details: error instanceof Error ? error.message : undefined },
      { status: 500 },
    );
  }
}
