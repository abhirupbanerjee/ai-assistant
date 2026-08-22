import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  ORG_ID_PAYLOAD_KEY,
  stampOrganizationId,
  buildOrgAwareFilter,
  buildOrgAwareScrollFilter,
} from './qdrant';

// ============================================================================
// Ingest stamping (payload metadata only — no re-embedding)
// ============================================================================

test('stampOrganizationId adds the org id without touching other payload fields', () => {
  const payload = { documentId: 'doc-1', text: 'hello' };
  const stamped = stampOrganizationId(payload, 42);

  assert.equal(stamped[ORG_ID_PAYLOAD_KEY], 42);
  assert.equal(stamped.documentId, 'doc-1');
  assert.equal(stamped.text, 'hello');
});

test('stampOrganizationId leaves the payload unchanged when org id is null', () => {
  const payload = { documentId: 'doc-1' };
  const stamped = stampOrganizationId(payload, null);

  assert.deepEqual(stamped, payload);
  assert.equal(ORG_ID_PAYLOAD_KEY in stamped, false);
});

// ============================================================================
// Filter injection (tenant isolation + category scoping composition)
// ============================================================================

test('buildOrgAwareFilter composes org filter with existing category scoping', () => {
  const filter = buildOrgAwareFilter(1, { categoryId: 7 });
  assert.deepEqual(filter, { [ORG_ID_PAYLOAD_KEY]: 1, categoryId: 7 });
});

test('buildOrgAwareFilter returns undefined when nothing to filter on', () => {
  assert.equal(buildOrgAwareFilter(null, undefined), undefined);
  assert.equal(buildOrgAwareFilter(null, {}), undefined);
});

test('tenant isolation: ingest as org A, search as org B → non-matching org filter', () => {
  const orgA = 100;
  const orgB = 200;

  const ingested = stampOrganizationId({ documentId: 'd' }, orgA);
  const searchFilter = buildOrgAwareFilter(orgB, { categoryId: 5 });

  assert.notEqual(ingested[ORG_ID_PAYLOAD_KEY], searchFilter![ORG_ID_PAYLOAD_KEY]);
});

test('category scoping: ingest as org A in category C, search as org A keeps category filter', () => {
  const filter = buildOrgAwareFilter(1, { categoryId: 9 });

  assert.equal(filter![ORG_ID_PAYLOAD_KEY], 1);
  assert.equal(filter!.categoryId, 9);
});

// ============================================================================
// Full-document reads are org-scoped (getDocumentChunksByDocId / ByDocName)
// ============================================================================

test('full-document scroll filter by documentName includes the org condition', () => {
  const filter = buildOrgAwareScrollFilter(42, { documentName: 'Q3_Report.pdf' });

  const must = filter.must!;
  assert.equal(must.some((c) => c.key === 'documentName' && (c.match as { value?: unknown }).value === 'Q3_Report.pdf'), true);
  assert.equal(must.some((c) => c.key === ORG_ID_PAYLOAD_KEY && (c.match as { value?: unknown }).value === 42), true);
});

test('full-document scroll filter by documentId includes the org condition', () => {
  const filter = buildOrgAwareScrollFilter(7, { documentId: 'doc-99' });

  const must = filter.must!;
  assert.equal(must.some((c) => c.key === 'documentId' && (c.match as { value?: unknown }).value === 'doc-99'), true);
  assert.equal(must.some((c) => c.key === ORG_ID_PAYLOAD_KEY && (c.match as { value?: unknown }).value === 7), true);
});

test('full-document scroll filter preserves tenant isolation across orgs', () => {
  const asA = buildOrgAwareScrollFilter(100, { documentName: 'shared.pdf' });
  const asB = buildOrgAwareScrollFilter(200, { documentName: 'shared.pdf' });

  const orgCondA = asA.must!.find((c) => c.key === ORG_ID_PAYLOAD_KEY);
  const orgCondB = asB.must!.find((c) => c.key === ORG_ID_PAYLOAD_KEY);
  assert.notEqual(orgCondA, undefined);
  assert.notEqual(orgCondB, undefined);
  assert.notEqual((orgCondA!.match as { value?: unknown }).value, (orgCondB!.match as { value?: unknown }).value);
});

test('full-document scroll filter keeps only the document filter when org is null', () => {
  const filter = buildOrgAwareScrollFilter(null, { documentName: 'Q3_Report.pdf' });
  assert.equal(filter.must!.length, 1);
  assert.equal(filter.must![0].key, 'documentName');
});

// ============================================================================
// Static check: no raw qdrant.search() outside the org-filtered wrapper
// ============================================================================

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
}

test('no raw qdrant.search() outside the org-filtered wrapper', () => {
  const files: string[] = [];
  walkTsFiles('src', files);

  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith('.test.ts')) continue;
    if (file.replace(/\\/g, '/').endsWith('vector-store/qdrant.ts')) continue;
    const content = readFileSync(file, 'utf-8');
    // Build the needle so this test file does not self-match.
    const needle = 'qdrant' + '.search(';
    if (content.includes(needle)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
