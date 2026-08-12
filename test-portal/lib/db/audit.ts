import { randomUUID } from "node:crypto";

import type { PortalPrincipal } from "../auth/principal";
import { runMigrations } from "./migrate";
import { getPool } from "./pool";

export type RegistrationType = "workspace" | "agent_bot";

export interface AuditEventInput {
  actor: PortalPrincipal;
  action: string;
  registrationType: RegistrationType;
  registrationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  await runMigrations();
  const id = randomUUID();
  const pool = await getPool();
  await pool.query(
    `INSERT INTO registration_audit_events
      (id, actor_object_id, actor_email, actor_role, action, registration_type, registration_id, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      input.actor.objectId,
      input.actor.email,
      input.actor.role,
      input.action,
      input.registrationType,
      input.registrationId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}
