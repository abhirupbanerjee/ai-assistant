import { sql, type Kysely } from 'kysely';
import type { DB } from './db-types';

export const ARTIFACT_PREVIEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS artifact_previews (
  cache_key TEXT PRIMARY KEY,
  upload_id INTEGER REFERENCES thread_uploads(id) ON DELETE CASCADE,
  output_id INTEGER REFERENCES thread_outputs(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partition_key TEXT NOT NULL, source_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','active','ready','failed')),
  token TEXT NOT NULL, lease_until TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  render_version TEXT, page_count INTEGER, byte_size INTEGER NOT NULL DEFAULT 0,
  converted BOOLEAN NOT NULL,
  CHECK ((upload_id IS NOT NULL)::integer + (output_id IS NOT NULL)::integer = 1)
);
CREATE INDEX IF NOT EXISTS artifact_previews_expiry ON artifact_previews(expires_at);
CREATE TABLE IF NOT EXISTS artifact_preview_converter (
  id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT, lease_until TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO artifact_preview_converter(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS artifact_preview_comments (
  id TEXT PRIMARY KEY,
  upload_id INTEGER REFERENCES thread_uploads(id) ON DELETE CASCADE,
  output_id INTEGER REFERENCES thread_outputs(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partition_key TEXT NOT NULL, source_version TEXT NOT NULL, render_version TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('general','page','selection')),
  comment_text TEXT NOT NULL, selected_text TEXT, surrounding_context TEXT, page_number INTEGER,
  client_token TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((upload_id IS NOT NULL)::integer + (output_id IS NOT NULL)::integer = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS artifact_comment_upload_token ON artifact_preview_comments(owner_id, upload_id, source_version, client_token) WHERE upload_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS artifact_comment_output_token ON artifact_preview_comments(owner_id, output_id, source_version, client_token) WHERE output_id IS NOT NULL;
`;
export async function migrateArtifactPreviews(db: Kysely<DB>) {
  await sql.raw(ARTIFACT_PREVIEW_SCHEMA).execute(db);
}
