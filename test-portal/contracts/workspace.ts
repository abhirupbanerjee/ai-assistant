export interface WorkspaceInitResponse {
  workspaceId: string;
  type: string;
  config: Record<string, unknown>;
}

export function parseWorkspaceInitResponse(value: unknown): WorkspaceInitResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("workspace init response must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.workspaceId !== "string") {
    throw new Error("workspace init workspaceId must be a string");
  }
  if (typeof record.type !== "string") {
    throw new Error("workspace init type must be a string");
  }
  if (typeof record.config !== "object" || record.config === null || Array.isArray(record.config)) {
    throw new Error("workspace init config must be an object");
  }
  return {
    workspaceId: record.workspaceId,
    type: record.type,
    config: record.config as Record<string, unknown>,
  };
}
