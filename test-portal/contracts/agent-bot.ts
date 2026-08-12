const objectTag = "[object Object]";

export type JsonRecord = Record<string, unknown>;

export interface AgentBotParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface AgentBotSpec {
  name: string;
  slug: string;
  description: string | null;
  baseUrl: string;
  version: { number: number; label: string | null };
  inputSchema: { parameters: AgentBotParameter[] };
  uploadConfig: {
    enabled: boolean;
    maxFiles: number;
    maxSizePerFileMB: number;
    allowedTypes: string[];
    required: boolean;
  };
  outputConfig: {
    enabledTypes: string[];
    defaultType: string;
    supportsFallback: boolean;
  };
  endpoints: Array<{ path: string; method: string; purpose: string }>;
  features: {
    async: boolean;
    sync: boolean;
    webhooks: boolean;
    includeSources: boolean;
  };
}

export interface AsyncInvokeResponse {
  jobId: string;
  status: string;
}

export interface AgentBotUploadResponse {
  fileId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
}

export interface AgentBotOutput {
  type: string;
  content?: unknown;
  filename?: string;
  downloadUrl?: string;
  fileSize?: number;
  mimeType?: string;
}

export interface AgentBotJob {
  jobId: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  outputs?: AgentBotOutput[];
  sources?: unknown;
  tokenUsage?: unknown;
  processingTimeMs?: number;
  error?: { message: string; code: string };
}

function isRecord(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === objectTag;
}

function assertRecord(value: unknown, path: string): asserts value is JsonRecord {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
}

function readString(record: JsonRecord, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${path}.${key} must be a string`);
  return value;
}

function readNumber(record: JsonRecord, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return value;
}

function readBoolean(record: JsonRecord, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`${path}.${key} must be a boolean`);
  return value;
}

function optionalString(record: JsonRecord, key: string, path: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${path}.${key} must be a string`);
  return value;
}

function nullableString(record: JsonRecord, key: string, path: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${path}.${key} must be a string or null`);
  return value;
}

function readStringArray(record: JsonRecord, key: string, path: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${path}.${key} must be an array of strings`);
  }
  return value;
}

export function parseAgentBotSpec(value: unknown): AgentBotSpec {
  assertRecord(value, "spec");
  assertRecord(value.version, "spec.version");
  assertRecord(value.inputSchema, "spec.inputSchema");
  assertRecord(value.uploadConfig, "spec.uploadConfig");
  assertRecord(value.outputConfig, "spec.outputConfig");
  assertRecord(value.features, "spec.features");

  if (!Array.isArray(value.inputSchema.parameters)) {
    throw new Error("spec.inputSchema.parameters must be an array");
  }
  const parameters = value.inputSchema.parameters.map((parameter, index) => {
    const path = `spec.inputSchema.parameters[${index}]`;
    assertRecord(parameter, path);
    return {
      name: readString(parameter, "name", path),
      type: readString(parameter, "type", path),
      description: readString(parameter, "description", path),
      required: readBoolean(parameter, "required", path),
      ...(parameter.default !== undefined ? { default: parameter.default } : {}),
    };
  });

  if (!Array.isArray(value.endpoints)) throw new Error("spec.endpoints must be an array");
  const endpoints = value.endpoints.map((endpoint, index) => {
    const path = `spec.endpoints[${index}]`;
    assertRecord(endpoint, path);
    return {
      path: readString(endpoint, "path", path),
      method: readString(endpoint, "method", path),
      purpose: readString(endpoint, "purpose", path),
    };
  });

  return {
    name: readString(value, "name", "spec"),
    slug: readString(value, "slug", "spec"),
    description: nullableString(value, "description", "spec"),
    baseUrl: readString(value, "baseUrl", "spec"),
    version: {
      number: readNumber(value.version, "number", "spec.version"),
      label: nullableString(value.version, "label", "spec.version"),
    },
    inputSchema: { parameters },
    uploadConfig: {
      enabled: readBoolean(value.uploadConfig, "enabled", "spec.uploadConfig"),
      maxFiles: readNumber(value.uploadConfig, "maxFiles", "spec.uploadConfig"),
      maxSizePerFileMB: readNumber(value.uploadConfig, "maxSizePerFileMB", "spec.uploadConfig"),
      allowedTypes: readStringArray(value.uploadConfig, "allowedTypes", "spec.uploadConfig"),
      required: readBoolean(value.uploadConfig, "required", "spec.uploadConfig"),
    },
    outputConfig: {
      enabledTypes: readStringArray(value.outputConfig, "enabledTypes", "spec.outputConfig"),
      defaultType: readString(value.outputConfig, "defaultType", "spec.outputConfig"),
      supportsFallback: readBoolean(value.outputConfig, "supportsFallback", "spec.outputConfig"),
    },
    endpoints,
    features: {
      async: readBoolean(value.features, "async", "spec.features"),
      sync: readBoolean(value.features, "sync", "spec.features"),
      webhooks: readBoolean(value.features, "webhooks", "spec.features"),
      includeSources: readBoolean(value.features, "includeSources", "spec.features"),
    },
  };
}

export function parseAsyncInvokeResponse(value: unknown): AsyncInvokeResponse {
  assertRecord(value, "invoke");
  return {
    jobId: readString(value, "jobId", "invoke"),
    status: readString(value, "status", "invoke"),
  };
}

export function parseAgentBotUploadResponse(value: unknown): AgentBotUploadResponse {
  assertRecord(value, "upload");
  return {
    fileId: readString(value, "fileId", "upload"),
    filename: readString(value, "filename", "upload"),
    mimeType: readString(value, "mimeType", "upload"),
    fileSize: readNumber(value, "fileSize", "upload"),
  };
}

export function parseAgentBotJob(value: unknown): AgentBotJob {
  assertRecord(value, "job");
  const job: AgentBotJob = {
    jobId: readString(value, "jobId", "job"),
    status: readString(value, "status", "job"),
    createdAt: readString(value, "createdAt", "job"),
  };

  for (const key of ["startedAt", "completedAt"] as const) {
    const parsed = optionalString(value, key, "job");
    if (parsed !== undefined) job[key] = parsed;
  }

  if (value.outputs !== undefined) {
    if (!Array.isArray(value.outputs)) throw new Error("job.outputs must be an array");
    job.outputs = value.outputs.map((output, index) => {
      const path = `job.outputs[${index}]`;
      assertRecord(output, path);
      const parsed: AgentBotOutput = { type: readString(output, "type", path) };
      if (output.content !== undefined) parsed.content = output.content;
      for (const key of ["filename", "downloadUrl", "mimeType"] as const) {
        const field = optionalString(output, key, path);
        if (field !== undefined) parsed[key] = field;
      }
      if (output.fileSize !== undefined) parsed.fileSize = readNumber(output, "fileSize", path);
      return parsed;
    });
  }

  if (value.sources !== undefined) job.sources = value.sources;
  if (value.tokenUsage !== undefined) job.tokenUsage = value.tokenUsage;
  if (value.processingTimeMs !== undefined) {
    job.processingTimeMs = readNumber(value, "processingTimeMs", "job");
  }
  if (value.error !== undefined) {
    assertRecord(value.error, "job.error");
    job.error = {
      message: readString(value.error, "message", "job.error"),
      code: readString(value.error, "code", "job.error"),
    };
  }
  return job;
}
