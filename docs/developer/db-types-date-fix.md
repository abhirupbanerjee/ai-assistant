# db:types Date → string Fix — Resolution

**Date:** 2026-06-28
**Issue:** `npm run db:types` regenerates `db-types.ts` with `Date | null` for PostgreSQL `TIMESTAMP` columns, causing cascading `next build` TypeScript failures.

## Root Cause

`kysely-codegen` introspects PostgreSQL `TIMESTAMP` → TypeScript `Date`. The entire codebase expects `string`. After regeneration, 68 tables × multiple timestamp columns = hundreds of `Date | null` → `string` mismatches.

## What We Tried (and Why Each Failed)

| Attempt | Approach | Why It Failed |
|---------|----------|---------------|
| 1 | Fix each file individually | 55+ files affected, 5-min build cycle, endless whack-a-mole |
| 2 | `pgTypes.setTypeParser` in `kysely.ts` | Fixed runtime only, TypeScript types still `Date` |
| 3 | `sed` in `db:types` script | Only runs manually, Docker build never invokes it |
| 4 | `prebuild` with `sed` | `sed` patterns didn't match `kysely-codegen` output format |
| 5 | `prebuild` with `sed s/\bDate\b/string/g` | Produced `Generated<string\|null>` → `string\|null` after `Selectable`, but interfaces expect `string` |

## What Worked

**Two-step Node.js script** in both `prebuild` and `db:types`:

```javascript
const fs = require('fs');
let f = fs.readFileSync('src/lib/db/db-types.ts', 'utf8');
f = f.replace(/\bDate\b/g, 'string')                                    // Step 1
     .replace(/Generated<string\s*\|\s*null>/g, 'Generated<string>');    // Step 2
fs.writeFileSync('src/lib/db/db-types.ts', f);
```

### Why This Works

Step 1 converts ALL `Date` → `string` regardless of `kysely-codegen` formatting:

| Regenerated | After Step 1 |
|---|---|
| `Generated<Date \| null>` | `Generated<string \| null>` |
| `Generated<Date>` | `Generated<string>` |
| `Date \| null` | `string \| null` |
| `Date` | `string` |

Step 2 collapses `Generated<string | null>` → `Generated<string>` because `Generated<T>` implies the column always has a value (via `DEFAULT`), so `| null` is incorrect after `Selectable`:

| After Step 1 | After Step 2 | After `Selectable` |
|---|---|---|
| `Generated<string \| null>` | `Generated<string>` | `string` ✅ |
| `string \| null` | `string \| null` (no-op) | `string \| null` ✅ |

### Why `prebuild` (Not Just `db:types`)

npm automatically runs `prebuild` before `build`. The Docker build runs `npm run build`, so the fix fires inside every Docker build without manual intervention.

## Files Modified

| File | Change |
|------|--------|
| [`src/lib/db/kysely.ts`](../../src/lib/db/kysely.ts) | Added `pgTypes.setTypeParser(1114/1184)` — runtime strings |
| [`package.json`](../../package.json) | `prebuild` + `db:types` → two-step Node.js script |
| [`src/lib/db/db-types.ts`](../../src/lib/db/db-types.ts) | 6 pre-existing `Generated<string\|null>` → `Generated<string>` fixes |

## Key Lessons

1. **`prebuild` is the correct hook for build-time type fixes** — `db:types` alone doesn't run in Docker.
2. **`Generated<string | null>` is semantically wrong** — `Generated<T>` means "always has a value via DEFAULT", so `| null` should never appear inside `Generated<>`.
3. **Don't use `sed` for structured code transforms** — whitespace/formatting variations break patterns. Node.js regex is more reliable.
4. **`pgTypes.setTypeParser` is still needed** — ensures runtime strings even if `db-types.ts` somehow has `Date`.

## Recovery on VM After Future `db:types` Regeneration

```bash
git checkout -- src/lib/db/db-types.ts   # discard stale types
git pull                                  # get latest
docker compose up -d --build              # prebuild fixes types automatically
```
