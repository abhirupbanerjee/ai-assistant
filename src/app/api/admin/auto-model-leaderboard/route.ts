/**
 * Auto Model Leaderboard API
 *
 * GET /api/admin/auto-model-leaderboard
 *
 * Returns a per-dimension leaderboard showing which model the auto-selector
 * would pick for each capability dimension. Used by the admin diagnostics panel
 * to provide visibility into auto-selection decisions.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { selectBestModel } from '@/lib/auto-model-selector';
import type { CapabilityScores } from '@/lib/db/enabled-models';

interface LeaderboardEntry {
  dimension: keyof CapabilityScores;
  label: string;
  description: string;
  samplePrompt: string;
  winner: {
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
  } | null;
  runnerUp: {
    modelId: string;
    displayName: string;
    score: number;
  } | null;
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

export async function GET() {
  try {
    await requireAdmin();

    const results: LeaderboardEntry[] = [];

    for (const dim of DIMENSIONS) {
      try {
        const picked = await selectBestModel({
          userMessage: dim.sample,
          categoryIds: [],
          hasImages: dim.dimension === 'visual_reasoning',
          estimatedTokens: 500,
          dimensionOverride: dim.dimension,
        });

        // Re-run with scoring to get runner-up. We can't easily extract runner-up
        // from selectBestModel directly, so we approximate by noting the winner
        // and explaining the dominant factor.
        results.push({
          dimension: dim.dimension,
          label: dim.label,
          description: dim.description,
          samplePrompt: dim.sample,
          winner: {
            modelId: picked.modelId,
            displayName: picked.displayName,
            score: 0, // score not directly available from selectBestModel return
            breakdown: {
              capability: 0,
              contextFit: 0,
              cost: 0,
              latency: 0,
              satisfaction: 0,
            },
            dominantFactor: picked.dominantFactor || 'quality',
          },
          runnerUp: null,
          totalCandidates: 0,
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
