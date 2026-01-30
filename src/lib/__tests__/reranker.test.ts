/**
 * Reranker Tests
 *
 * Tests for the reranker module, including boost behavior for follow-up context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies before importing the module
vi.mock('../db/config', () => ({
  getRerankerSettings: vi.fn(() => ({
    enabled: true,
    provider: 'local',
    minRerankerScore: 0.3,
    topKForReranking: 100,
    cacheTTLSeconds: 3600,
  })),
}));

vi.mock('../redis', () => ({
  getCachedQuery: vi.fn(() => null),
  cacheQuery: vi.fn(),
  hashQuery: vi.fn((str: string) => `hash-${str.slice(0, 10)}`),
}));

// Import after mocking
import { rerankChunks } from '../reranker';
import type { RetrievedChunk } from '@/types';

// Helper to create test chunks
function createChunk(
  documentName: string,
  score: number,
  text = 'Sample chunk text'
): RetrievedChunk {
  return {
    id: Math.random().toString(36).substring(7),
    documentId: documentName.replace('.pdf', ''),
    documentName,
    pageNumber: 1,
    text,
    score,
    embedding: [],
  };
}

describe('rerankChunks with boostDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should boost scores for specified documents', async () => {
    // Mock reranker as disabled to test boost logic directly
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false, // Disable reranking to test boost logic
      provider: 'local',
      minRerankerScore: 0.3,
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    // Create chunks where doc2 has higher score initially
    const chunks = [
      createChunk('IN030_Budget.pdf', 0.85),
      createChunk('IN033_Digital_Agriculture.pdf', 0.70),
    ];

    // Without boost, order should be: IN030 (0.85), IN033 (0.70)
    const resultWithoutBoost = await rerankChunks('what is the budget', chunks);
    expect(resultWithoutBoost[0].documentName).toBe('IN030_Budget.pdf');

    // With boost for IN033, it should be: IN033 (0.70 * 1.3 = 0.91), IN030 (0.85)
    const resultWithBoost = await rerankChunks('what is the budget', chunks, {
      boostDocuments: ['IN033_Digital_Agriculture.pdf'],
      boostFactor: 1.3,
    });
    expect(resultWithBoost[0].documentName).toBe('IN033_Digital_Agriculture.pdf');
    expect(resultWithBoost[0].score).toBeCloseTo(0.91, 2);
  });

  it('should cap boosted scores at 1.0', async () => {
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false,
      provider: 'local',
      minRerankerScore: 0.3,
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    const chunks = [createChunk('doc1.pdf', 0.9)];

    // 0.9 * 1.3 = 1.17, should be capped at 1.0
    const result = await rerankChunks('query', chunks, {
      boostDocuments: ['doc1.pdf'],
      boostFactor: 1.3,
    });

    expect(result[0].score).toBe(1.0);
  });

  it('should not boost when no boostDocuments provided', async () => {
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false,
      provider: 'local',
      minRerankerScore: 0.3,
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    const chunks = [
      createChunk('doc1.pdf', 0.8),
      createChunk('doc2.pdf', 0.7),
    ];

    const result = await rerankChunks('query', chunks);

    // Scores should be unchanged
    expect(result[0].documentName).toBe('doc1.pdf');
    expect(result[0].score).toBe(0.8);
    expect(result[1].documentName).toBe('doc2.pdf');
    expect(result[1].score).toBe(0.7);
  });

  it('should use default boost factor of 1.3', async () => {
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false,
      provider: 'local',
      minRerankerScore: 0.3,
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    const chunks = [createChunk('doc1.pdf', 0.5)];

    const result = await rerankChunks('query', chunks, {
      boostDocuments: ['doc1.pdf'],
      // No boostFactor specified, should default to 1.3
    });

    expect(result[0].score).toBeCloseTo(0.65, 2); // 0.5 * 1.3 = 0.65
  });

  it('should only boost matching documents', async () => {
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false,
      provider: 'local',
      minRerankerScore: 0.3,
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    const chunks = [
      createChunk('doc1.pdf', 0.8),
      createChunk('doc2.pdf', 0.7),
      createChunk('doc3.pdf', 0.6),
    ];

    const result = await rerankChunks('query', chunks, {
      boostDocuments: ['doc2.pdf'], // Only boost doc2
    });

    // doc2 boosted: 0.7 * 1.3 = 0.91 (highest now)
    // doc1 unchanged: 0.8
    // doc3 unchanged: 0.6
    expect(result[0].documentName).toBe('doc2.pdf');
    expect(result[0].score).toBeCloseTo(0.91, 2);
    expect(result[1].documentName).toBe('doc1.pdf');
    expect(result[1].score).toBe(0.8);
    expect(result[2].documentName).toBe('doc3.pdf');
    expect(result[2].score).toBe(0.6);
  });

  it('should handle empty boostDocuments array', async () => {
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false,
      provider: 'local',
      minRerankerScore: 0.3,
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    const chunks = [createChunk('doc1.pdf', 0.8)];

    const result = await rerankChunks('query', chunks, {
      boostDocuments: [],
    });

    // Score should be unchanged
    expect(result[0].score).toBe(0.8);
  });

  it('should bypass threshold when option is set', async () => {
    const { getRerankerSettings } = await import('../db/config');
    vi.mocked(getRerankerSettings).mockReturnValue({
      enabled: false,
      provider: 'local',
      minRerankerScore: 0.5, // High threshold
      topKForReranking: 100,
      cacheTTLSeconds: 3600,
    });

    const chunks = [createChunk('doc1.pdf', 0.3)]; // Below threshold

    // Without bypass, chunk should be filtered out
    const resultWithoutBypass = await rerankChunks('query', chunks);
    expect(resultWithoutBypass.length).toBe(0);

    // With bypass, chunk should be included
    const resultWithBypass = await rerankChunks('query', chunks, {
      bypassThreshold: true,
    });
    expect(resultWithBypass.length).toBe(1);
  });
});
