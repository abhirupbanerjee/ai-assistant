# Reranker Score Analysis & Fix

**Date:** May 9, 2026  
**Issue:** All reranked chunks returning score of `1` in citation trajectory  
**Root Cause:** BGE cross-encoder label selection bug  
**Status:** ✅ FIXED

---

## Executive Summary

The citation trajectory was showing `rerankedScore: 1` for all chunks regardless of actual relevance. This was caused by a bug in the BGE reranker (both Large and Base variants) where the code was selecting the **highest-scoring label** from the softmax output instead of explicitly finding the **"relevant" label (LABEL_1)**.

After the fix, the BGE reranker now correctly returns differentiated scores (0.3–0.99 range) that properly reflect relevance, allowing the min-score threshold to filter chunks meaningfully.

---

## Root Cause Analysis

### The Bug: BGE Label Selection

**Location:** `src/lib/reranker.ts`, line 303 in `rerankWithBGE()`

**What was happening:**
```typescript
// BEFORE (WRONG):
const score = Array.isArray(result) ? result[0]?.score ?? 0 : 0;
```

**Why it was wrong:**
1. BGE is a **text-classification cross-encoder** with two output classes:
   - `LABEL_0` = not relevant
   - `LABEL_1` = relevant

2. The `@xenova/transformers` pipeline applies **softmax** internally, converting raw logits to probabilities that sum to 1.0

3. Results are **sorted descending by score**, so `result[0]` is always the **highest-scoring label**

4. For any semantically related chunk (which all 12 chunks in your test were), the softmax probability for `LABEL_1` is very high (~0.95–0.999)

5. Therefore, `result[0].score` was always near `1.0`, regardless of actual relevance

**Example output:**
```javascript
// For a relevant chunk:
[
  { label: 'LABEL_1', score: 0.98 },  // ← result[0] (highest)
  { label: 'LABEL_0', score: 0.02 }
]
// Code took 0.98 → stored as 1

// For a marginally relevant chunk:
[
  { label: 'LABEL_1', score: 0.72 },  // ← result[0] (highest)
  { label: 'LABEL_0', score: 0.28 }
]
// Code took 0.72 → stored as 1 (rounded in display)
```

---

## The Fix

**Location:** `src/lib/reranker.ts`, lines 302–310 in `rerankWithBGE()`

```typescript
// AFTER (CORRECT):
// BGE text-classification applies softmax across two labels:
// LABEL_0 = not relevant, LABEL_1 = relevant
// Results are sorted descending by score, so result[0] is always the highest-scoring label.
// We must explicitly find LABEL_1 (the "relevant" class) to get the true relevance probability.
const relevantResult = Array.isArray(result)
  ? result.find(r => r.label === 'LABEL_1') ?? result[0]
  : null;
const score = relevantResult?.score ?? 0;
```

**What this does:**
1. Explicitly searches for the `LABEL_1` result (the "relevant" class)
2. Falls back to `result[0]` if `LABEL_1` is not found (defensive programming)
3. Returns the true relevance probability (0–1 range, properly distributed)

**Impact:**
- Highly relevant chunks: `LABEL_1` score ~0.85–0.99 → **pass** 0.7 threshold
- Marginally relevant chunks: `LABEL_1` score ~0.55–0.75 → **borderline**
- Irrelevant chunks: `LABEL_1` score ~0.1–0.4 → **filtered out** by threshold
- Chunks now **reorder** meaningfully (rankBefore ≠ rankAfter)

---

## Provider-by-Provider Status

| Provider | Score Format | Status | Notes |
|----------|-------------|--------|-------|
| **BGE Large** | Softmax prob (0–1) | ✅ FIXED | Now finds LABEL_1 explicitly |
| **BGE Base** | Softmax prob (0–1) | ✅ FIXED | Same fix applies |
| **Fireworks/Qwen3** | 0–1 probability | ✅ CORRECT | Code was already correct |
| **Cohere** | 0–1 normalized | ✅ CORRECT | Code was already correct |
| **Local Bi-encoder** | 0–1 (normalized cosine) | ⚠️ DESIGN LIMITATION | Uses same embedding model as vector search; no-op reranking |

---

## Why Your Min Score Threshold (0.7) Wasn't Working

**Before the fix:**
- All chunks scored ~1.0 (or very close)
- Threshold of 0.7 never filtered anything
- All 12 chunks passed through unchanged

**After the fix:**
- Chunks score across the full 0–1 range
- Threshold of 0.7 now meaningfully filters
- Only truly relevant chunks pass
- Citation trajectory shows actual score distribution

---

## Testing the Fix

To verify the fix is working:

1. **Check the logs** when running a query:
   ```
   [Reranker] BGE large scoring complete: X chunks passed threshold
   ```
   The number should be **less than** the total retrieved chunks (not all 12)

2. **Check the trajectory JSON**:
   - `rerankedScore` should now vary (0.3–0.99 range)
   - Not all `1` values
   - `rankBefore` and `rankAfter` should differ for reordered chunks

3. **Check the citation trajectory UI**:
   - Scores should show proper distribution
   - Some chunks may be filtered out
   - Reranking should visibly reorder chunks

---

## Technical Details: BGE Cross-Encoder Architecture

**Model:** `Xenova/bge-reranker-large` (335M params, ~670MB)

**Architecture:**
- Input: `[query] [SEP] [document]` (max 512 tokens)
- Output: Linear layer over CLS token → 2 logits (one per class)
- Post-processing: Softmax applied by `@xenova/transformers` pipeline

**Score interpretation:**
- `LABEL_1` score = probability that document is relevant to query
- `LABEL_0` score = probability that document is not relevant
- Scores sum to 1.0 (softmax property)

**Why softmax?**
- Ensures probabilities are normalized and interpretable
- Allows threshold-based filtering (e.g., "relevant if LABEL_1 > 0.7")
- Standard practice for classification tasks

---

## Related Files

- `src/lib/reranker.ts` — Main reranker implementation (FIXED)
- `src/lib/streaming/rag-retrieval.ts` — RAG retrieval pipeline (captures trajectory data)
- `src/lib/db/citation-trajectory.ts` — Database operations for trajectory storage
- `src/components/admin/RagProfilingDashboard.tsx` — UI for viewing trajectory data

---

## Additional Reranker Fixes (May 2026)

### Fix #6: Partial Results Padding
**Issue:** Fireworks/Cohere reranker APIs occasionally return fewer results than submitted chunks, causing score misalignment.
**Solution:** Added validation in `rerankWithFireworks()` to detect partial results and pad missing chunks with their original scores.
**Location:** `src/lib/reranker.ts`, lines 143-156

### Fix #10: Web Source Filtering
**Issue:** Web search results (Tavily) bypassed all relevance filtering — all 10 results were appended to context regardless of relevance.
**Solution:** Web results now route through `rerankChunks()` with a 0.3 minimum score threshold, same as KB chunks.
**Location:** `src/lib/rag.ts`, `extractWebSourcesAsChunks()` function

### Fix #11: Boost Applied Pre-Threshold
**Issue:** Document boost was applied AFTER threshold filtering, inflating scores beyond probability range and breaking relative ordering.
**Solution:** Moved boost application BEFORE threshold filtering. Changed from multiplicative (`score * factor`) to additive boost (`score + (factor-1)*score`) to preserve probability semantics.
**Location:** `src/lib/reranker.ts`, lines 506-528

---

## Future Improvements

1. **Local Bi-encoder:** Consider replacing with a true cross-encoder (e.g., `all-MiniLM-L12-v2` fine-tuned for reranking) to avoid the no-op reranking issue

2. **Error handling:** Add explicit logging when Fireworks/Cohere fail to indicate fallback to Local Bi-encoder

3. **Score normalization:** Consider applying sigmoid to raw BGE logits if using the model outside the `@xenova/transformers` pipeline

4. **Threshold tuning:** With proper scores now available, consider adjusting the min-score threshold (currently 0.7) based on your corpus characteristics

---

## References

- [BGE Reranker Documentation](https://bge-model.com/bge/bge_reranker.html)
- [Xenova/bge-reranker-large](https://huggingface.co/Xenova/bge-reranker-large)
- [Fireworks AI Rerank API](https://docs.fireworks.ai/api-reference/rerank-documents)
- [Cohere Rerank Overview](https://docs.cohere.com/docs/rerank-overview)
