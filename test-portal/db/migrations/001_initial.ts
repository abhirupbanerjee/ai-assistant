export const initialMigration = {
  id: "001_initial",
  sql: `
    CREATE TABLE IF NOT EXISTS registration_audit_events (
      id uuid PRIMARY KEY,
      actor_object_id text NOT NULL,
      actor_email text,
      actor_role text NOT NULL CHECK (actor_role IN ('admin', 'user')),
      action text NOT NULL,
      registration_type text NOT NULL CHECK (registration_type IN ('workspace', 'agent_bot')),
      registration_id uuid,
      metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS registration_audit_events_created_at_idx
      ON registration_audit_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS registration_audit_events_registration_idx
      ON registration_audit_events (registration_type, registration_id);
  `,
} as const;
