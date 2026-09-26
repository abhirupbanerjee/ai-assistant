/** Pure, conservative retry policy. Never import SDK clients or runtime settings here. */
export type RecoverableFallbackReason =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'model_unavailable'
  | 'api_error';

type ErrorRecord = Record<string, unknown>;

/** SDK errors may wrap their status/code and replay-safety flags in cause/error. */
function errorRecords(error: unknown): ErrorRecord[] {
  const records: ErrorRecord[] = [];
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length && records.length < 16) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as ErrorRecord;
    records.push(record);
    pending.push(record.cause, record.error);
  }
  return records;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}

export function fallbackErrorMessage(error: unknown): string {
  return messageOf(error) || 'Unknown LLM failure';
}

/** Preserve the original SDK error as cause while making partial output terminal. */
export function guardFallbackAfterOutput(error: unknown, outputStarted: boolean): unknown {
  return outputStarted
    ? Object.assign(new Error(fallbackErrorMessage(error), { cause: error }), { outputStarted: true })
    : error;
}

function statusOf(record: ErrorRecord): number | undefined {
  const status = record.status ?? record.statusCode;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d{3}$/.test(status)) return Number(status);
  // Legacy wrappers sometimes retain only an SDK's message. Do not match model
  // IDs, token counts, request IDs, etc. merely containing a status number.
  const match = messageOf(record).match(/^(?:error:\s*)?([45]\d{2})\b|\b(?:http|status(?: code)?)\s*[:=]?\s*([45]\d{2})\b/i);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

/** Terminal/replay guards take precedence over any transient status or wording. */
export function classifyFallbackError(error: unknown): RecoverableFallbackReason | null {
  const records = errorRecords(error);
  const messages = [messageOf(error), ...records.map(messageOf)].join('\n').toLowerCase();
  const codes = records.flatMap(record => [record.code, record.type])
    .filter((code): code is string => typeof code === 'string').map(code => code.toLowerCase());
  const statuses = records.map(statusOf).filter((status): status is number => status !== undefined);
  // Also handle thrown strings without inventing an Error (which loses identity).
  if (typeof error === 'string') {
    const status = statusOf({ message: error });
    if (status !== undefined) statuses.push(status);
  }

  if (records.some(record => record.outputStarted === true || record.outputEmitted === true
    || record.toolsExecuted === true || record.toolExecuted === true
    || (typeof record.toolsExecuted === 'number' && record.toolsExecuted > 0)
    || record.recoverable === false || record.name === 'AbortError')) return null;

  if (codes.some(code => /^(?:aborted|abort_err|authentication_error|permission_error|invalid_api_key|unauthorized|forbidden|refusal|content_filter|content_policy_violation|safety|invalid_request_error|bad_request|invalid_argument|invalid_tool_call|unsupported_output|incomplete_output|max_output_tokens|max_tokens|pause_turn|invalid_response)$/.test(code))) return null;
  if (/\b(?:unauthorized|forbidden|authentication|authorization|unauthenticated|refusal|refused|declined to respond|content[_ ]filter|content policy|safety policy)\b|invalid (?:api key|key|token)|(?:token|jwt) expired|expired token|permission denied|access denied|insufficient permissions/.test(messages)) return null;

  // Request construction and native history errors are not model outages. In
  // particular, a deprecated Opus temperature 400 must never poison health.
  if (/schema validation failed|json parse error|no json found|unknown llm provider|invalid input:|invalid request|unsupported (?:parameter|param)|(?:temperature|top_p|top_k|reasoning_effort).*(?:deprecated|not supported|unsupported|invalid)|(?:deprecated|unsupported|invalid).*\b(?:temperature|top_p|top_k|reasoning_effort)\b|claude native|claude.*prefill|incomplete claude|orphaned claude|missing claude/.test(messages)) return null;
  if (records.some(record => ['SyntaxError', 'ReferenceError', 'RangeError'].includes(String(record.name)))) return null;
  // fetch() uses TypeError for network failures; other TypeErrors are local bugs.
  if (records.some(record => record.name === 'TypeError' && !/^(?:fetch failed|failed to fetch|networkerror when attempting to fetch resource\.?)$/i.test(messageOf(record)))) return null;

  // All other client errors are terminal, even when their message mentions an
  // outage/rate limit. Only explicit model-not-found 404s are eligible below.
  if (statuses.some(status => status >= 400 && status < 500 && ![402, 404, 408, 429].includes(status))) return null;
  const modelUnavailable = codes.includes('model_not_found') || codes.includes('deployment_not_found')
    || /\bmodel\b.*(?:not found|does not exist|unavailable|not available|not deployed)|deployment not found/.test(messages);
  if (statuses.includes(404)) return modelUnavailable ? 'model_unavailable' : null;

  if (codes.includes('insufficient_quota') || codes.includes('quota_exceeded') || statuses.includes(402)
    || /\bquota\b|\bbilling\b|insufficient_quota|payment required/.test(messages)) return 'quota_exceeded';
  if (statuses.includes(429) || codes.includes('rate_limit_exceeded') || codes.includes('rate_limit_error')
    || /\brate limit\b|too many requests/.test(messages)) return 'rate_limit';
  if (modelUnavailable) return 'model_unavailable';
  if (statuses.some(status => status === 408 || (status >= 500 && status <= 599))
    || codes.some(code => /^(?:timeout|etimedout|econnrefused|econnreset|enotfound|eai_again|server_error|internal_server_error|overloaded_error|interrupted)$/.test(code))
    || /\btimeout\b|timed out|network (?:error|failure|request failed)|fetch failed|failed to fetch|\b(?:econnrefused|econnreset|enotfound|eai_again)\b|socket hang up|service unavailable|temporarily unavailable|bad gateway|gateway timeout|internal server error|\boverloaded?\b|api unavailable/.test(messages)) return 'api_error';
  return null;
}
