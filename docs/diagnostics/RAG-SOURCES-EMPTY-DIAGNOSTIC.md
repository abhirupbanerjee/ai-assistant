# RAG Sources Empty — Diagnostic Report

> **Date:** 2026-05-24
> **Workspace:** `qi9ohazo553c3jj2` (IRD Demo)
> **Category:** `gog-ird-public-chatbot` (GoG - IRD Public chatbot, ID 33)

---

## 1. Original Issues Reported

### Issue A: Workspace Category Persistence
- **Symptom:** `category_ids` disappear after every workspace save. Users must re-select categories on every edit.
- **Root Cause:** `updateWorkspace()` in `src/lib/db/compat/workspaces.ts` updates the `workspace_categories` junction table but returns only the base `workspaces` row (without `category_ids`). The frontend replaces its React state with this stripped object.
- **Status:** ✅ **FIXED** in `src/app/api/admin/workspaces/[id]/route.ts` and `src/app/api/superuser/workspaces/[id]/route.ts` — both now call `getWorkspaceWithRelations(id)` after update.

### Issue B: Empty RAG Sources in Workspace Chat
- **Symptom:** `sources_json = "[]"` (2 chars) for **every** assistant message in workspace chat. Sources panel is always empty.
- **Initial Hypothesis:** Workspace lacks `category_ids` → RAG queries wrong collections.
- **Actual Root Cause:** Multi-factor — see Section 3.

### Issue C: Admin "Refresh All" Documents Appears to Fail Silently
- **Symptom:** User clicks Admin → Documents → Refresh All. UI shows "Refresh complete!" but sources remain empty.
- **Root Cause:** The UI alert (`alert()`) only shows `documentsReindexed` count, **never displays `result.errors`**.
- **Status:** ✅ **FIXED** in `src/components/admin/documents/DocumentsManagement.tsx` — now shows errors if any documents failed.

---

## 2. Diagnostic Journey

### Step 1: Verify Workspace Categories
```sql
SELECT w.slug, w.name, c.id AS cat_id, c.slug AS cat_slug, c.name AS cat_name
FROM workspaces w
LEFT JOIN workspace_categories wc ON wc.workspace_id = w.id
LEFT JOIN categories c ON c.id = wc.category_id
WHERE w.slug = 'qi9ohazo553c3jj2';
```
**Result:** ✅ Category `gog-ird-public-chatbot` IS assigned.

### Step 2: Verify Documents in Category
```sql
SELECT c.slug, c.name, COUNT(DISTINCT d.id) AS doc_count
FROM categories c
LEFT JOIN document_categories dc ON dc.category_id = c.id
LEFT JOIN documents d ON d.id = dc.document_id
GROUP BY c.slug, c.name;
```
**Result:** ✅ `gog-ird-public-chatbot` has **21 documents**.

### Step 3: Verify Qdrant Collections
```bash
docker exec app node -e "fetch('http://qdrant:6333/collections').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
```
**Result:** ✅ Collection `category_gog-ird-public-chatbot` **exists**.

### Step 4: Verify Collection Point Count
```bash
docker exec app node -e "fetch('http://qdrant:6333/collections/category_gog-ird-public-chatbot/points/count',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
```
**Result:** ✅ Collection has **148 points** (matches expected chunk count for 21 docs).

### Step 5: Verify Search Mechanics
- Random 3072-dim vector search → returns 5 results (top score ~0.024)
- Scroll points → points are retrievable
- **Conclusion:** Qdrant search infrastructure works.

### Step 6: Verify Embedding Settings
```sql
SELECT key, value FROM settings WHERE key = 'embedding-settings';
```
**Result:**
```json
{"model":"text-embedding-3-large","dimensions":3072,"fallbackModel":"text-embedding-3-large"}
```

### Step 7: Verify Reindex History
```sql
SELECT id, status, target_model, previous_model, total_documents, processed_documents, failed_documents, started_at, completed_at
FROM reindex_jobs ORDER BY started_at DESC NULLS LAST LIMIT 5;
```
**Result:**
| id | status | target_model | previous_model | processed | failed | date |
|---|---|---|---|---|---|---|
| reindex_1778891128419_gldcs91 | completed | text-embedding-3-large | fireworks/qwen3-embedding-8b | 106/107 | 1 | 2026-05-16 |
| reindex_1775359166283_d05deoz | completed | fireworks/qwen3-embedding-8b | text-embedding-3-large | 113/114 | 1 | 2026-04-05 |
| reindex_1774961782486_qefsofr | completed | text-embedding-3-large | fireworks/qwen3-embedding-8b | 99/101 | 2 | 2026-03-31 |
| reindex_1774931621930_vrabq8q | failed | fireworks/qwen3-embedding-8b | text-embedding-3-large | 0/101 | 101 | 2026-03-31 |
| reindex_1773672870922_5v3bigc | completed | text-embedding-3-large | bge-m3 | 125/136 | 11 | 2026-03-16 |

**Conclusion:** Most recent completed reindex (2026-05-16) switched FROM `fireworks/qwen3-embedding-8b` TO `text-embedding-3-large`. Current vectors should be `text-embedding-3-large`.

### Step 8: Verify Embedding API Works
```bash
docker exec app node -e "
const apiKey = process.env.LITELLM_MASTER_KEY || process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const res = await fetch(baseUrl + '/embeddings', {
  method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
  body: JSON.stringify({model: 'text-embedding-3-large', input: ['test']})
});
const data = await res.json();
console.log('Status:', res.status, 'Dims:', data.data[0].embedding.length);
"
```
**Result:** ✅ Status 200, Dimensions 3072.

### Step 9: Check Reranker Logs (The Breakthrough)
```bash
docker logs policy-bot-app | grep -i "\[Reranker\]" | tail -20
```
**Result:**
```
[Reranker] Reranking 10 chunks (2 providers available)
[Reranker] Trying bge-base...
[Reranker] BGE base scoring complete: 0 chunks passed threshold
[Reranker] After reranking: 0 chunks passed threshold
```
**This repeats for EVERY query.**

### Step 10: Test BGE Reranker Directly
```bash
docker exec app node -e "
const { pipeline, env } = await import('@xenova/transformers');
env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp/transformers_cache';
const reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base', { quantized: true });
const query = 'What are the income tax rates in Grenada?';
const passage = 'Income Tax is charged on the income of individuals...';
const result = await reranker(query + ' [SEP] ' + passage);
console.log(JSON.stringify(result));
"
```
**Result:**
```json
[
  {
    "label": "LABEL_0",
    "score": 1
  }
]
```
**Only LABEL_0 is returned. LABEL_1 is never present.** `score = 0` for all chunks.

---

## 3. Issues Identified

### 🔴 Issue 1: BGE Reranker Returns Only LABEL_0 (CRITICAL)
- **Location:** `src/lib/reranker.ts` → `rerankWithBGE()`
- **Behavior:** Transformers.js `text-classification` pipeline for `Xenova/bge-reranker-base` returns only `LABEL_0` (not relevant) with score 1. `LABEL_1` is never present.
- **Impact:** `relevantResult?.score ?? 0` evaluates to **0 for every chunk**. All chunks are filtered out by `minScore >= 0.7`.
- **Why this broke recently:** Unknown. Possible causes:
  1. **Model cache corruption:** `/tmp/transformers_cache` (mounted to `./data/transformers_cache`) may contain corrupted ONNX files.
  2. **Transformers.js version change:** A dependency update changed pipeline behavior.
  3. **Quantization artifact:** The `{ quantized: true }` option may produce degenerate outputs for this model.
  4. **Wrong model class:** `bge-reranker-base` may need `feature-extraction` or a custom pipeline, not `text-classification`.
  5. **Input format mismatch:** `[SEP]` separator may be wrong for the Xenova port.

### 🟡 Issue 2: Reranker Threshold Too Aggressive (0.7)
- **Location:** DB `settings` → `reranker-settings.minRerankerScore = 0.7`
- **Behavior:** Even if BGE worked correctly, 0.7 is a very high threshold. Cross-encoder scores for BGE typically range 0.0-1.0, with 0.5-0.6 being "relevant" and 0.7+ being "highly relevant."
- **Impact:** When rerankers fail (Issue 1), fallback uses `chunks.filter(c => c.score >= 0.7)`. Original Qdrant similarity scores (typically 0.2-0.5 for good matches) are all filtered out.

### 🟡 Issue 3: Sparse Search Failure in Qdrant
- **Location:** `src/lib/vector-store/qdrant.ts`
- **Behavior:** `[Qdrant] Sparse search failed for category_gog-ird-public-chatbot, falling back to dense only: Bad Request`
- **Impact:** Fallback to dense-only search works, but hybrid search benefits are lost.
- **Root Cause:** Collection was created **without sparse vector configuration**. The `createCollection` code adds `sparse_vectors: { text: { ... } }`, but the collection config shows no `sparse_vectors` field.
- **Why:** The collection may have been created by an older version of the code, or by a reindex path that skipped sparse vector creation.

### 🟡 Issue 4: Reindex Job Deletes Collections Before Verifying Files
- **Location:** `src/lib/reindex-job.ts`
- **Behavior:** The reindex job deletes ALL Qdrant collections **before** checking if document source files exist on disk. If files are missing, vectors are permanently lost.
- **Status:** ✅ **FIXED** — added Step 0 that verifies all files exist before deleting any collections.

### 🟡 Issue 5: Refresh UI Hides Errors
- **Location:** `src/components/admin/documents/DocumentsManagement.tsx`
- **Behavior:** "Refresh All" shows `alert("Refresh complete! X documents reindexed.")` even if all documents failed. `result.errors` is never displayed.
- **Status:** ✅ **FIXED** — now shows error count and first 5 errors in the alert.

### 🟢 Issue 6: Workspace Category Persistence
- **Location:** `src/app/api/admin/workspaces/[id]/route.ts` and `src/app/api/superuser/workspaces/[id]/route.ts`
- **Behavior:** PATCH returned workspace without `category_ids` after update.
- **Status:** ✅ **FIXED** — both routes now call `getWorkspaceWithRelations(id)` after updating.

---

## 4. Probable Root Cause of Empty Sources

**The immediate cause is Issue 1 (BGE Reranker bug).**

Flow:
1. User asks question → query embedding generated ✅
2. Qdrant searches `category_gog-ird-public-chatbot` → returns top-k chunks with scores ~0.2-0.5 ✅
3. `rerankChunks()` called with `minScore = 0.7`
4. BGE reranker loads successfully ✅
5. BGE scores every chunk → returns only `LABEL_0`, so `score = 0` 🔴
6. `score >= 0.7` fails for all chunks → `rerankedGlobalChunks = []`
7. `extractSources([])` → `sources = []`
8. `sources_json = "[]"` saved to DB

**Even if Issue 1 is resolved, Issue 2 (threshold 0.7) may still filter out legitimate matches.**

---

## 5. Recommended Fixes

### Fix 1: Diagnose and Fix BGE Reranker (HIGHEST PRIORITY)
**Options:**
- **Option A:** Clear the Transformers.js cache and re-download the model:
  ```bash
  docker compose exec app rm -rf /tmp/transformers_cache/models/Xenova/bge-reranker-base
  docker compose restart app
  ```
- **Option B:** Test with `{ quantized: false }` to see if quantization is the cause.
- **Option C:** Check if the model needs `top_k: -1` or a different pipeline configuration.
- **Option D:** Switch to `feature-extraction` pipeline instead of `text-classification` — BGE rerankers may output a single relevance score, not classification labels.
- **Option E:** Replace with Fireworks reranker (already configured and enabled in settings).

### Fix 2: Lower Reranker Threshold
- Go to **Admin → Settings → Reranker**
- Change **Minimum Reranker Score** from `0.7` to `0.3`
- This ensures that even if BGE produces lower scores, relevant chunks survive.

### Fix 3: Fix Sparse Vector Support
- Recreate Qdrant collections with sparse vectors, OR
- Disable hybrid search in RAG settings until collections are recreated.

### Fix 4: Verify Document Files Exist
- Some documents fail refresh with `Document file not found`. Check which files are missing:
  ```bash
  docker compose exec postgres psql -U policybot -d policybot -c "
  SELECT id, filename, filepath, status FROM documents WHERE status = 'error';
  "
  ```

---

## 6. Quick Verification Test

After applying Fix 1 and/or Fix 2, verify sources work:

```bash
# Check reranker logs after a workspace chat query
docker compose logs app --tail=50 | grep -i "\[Reranker\]"

# You should see:
# [Reranker] BGE base scoring complete: N chunks passed threshold  (N > 0)
# [Reranker] After reranking: M chunks passed threshold             (M > 0)
```

---

## 7. Files Modified During This Investigation

| File | Change | Status |
|------|--------|--------|
| `src/app/api/admin/workspaces/[id]/route.ts` | PATCH returns `getWorkspaceWithRelations(id)` | ✅ Fixed |
| `src/app/api/superuser/workspaces/[id]/route.ts` | PATCH returns `getWorkspaceWithRelations(id)` | ✅ Fixed |
| `src/components/admin/documents/DocumentsManagement.tsx` | Refresh alert shows `result.errors` | ✅ Fixed |
| `src/lib/reindex-job.ts` | Step 0: verify files exist before deleting collections | ✅ Fixed |
| `src/lib/reranker.ts` | **BGE pipeline issue** — needs fix | 🔴 Pending |

---

*Report prepared during live diagnostic session on 2026-05-24.*
