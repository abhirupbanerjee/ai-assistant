/**
 * Structural repair for truncated JSON tool-call arguments.
 *
 * Streaming truncation (maxTokens hit mid-arguments, dropped SSE chunks) cuts
 * JSON mid-element. The old blind close-quote + bracket-count repair could
 * not recover these: a dangling value where a key is expected, or a partial
 * string in an array, fail JSON.parse even after closing all open brackets.
 *
 * The algorithm here:
 *  1. Fast path — if the input already parses, return it unchanged.
 *  2. Token-scan the string, tracking a bracket stack and the last
 *     "safe boundary" — an offset where the JSON so far is structurally
 *     complete (a closed element followed by a comma, or a closed
 *     container).
 *  3. On truncation, rewind to the last safe boundary, strip the trailing
 *     comma/colon, then close the bracket stack in reverse open order.
 *  4. Validate with JSON.parse; return null on failure (caller decides
 *     the error shape).
 *
 * Pure module — no imports, no DB, no SDK clients. Safe for node:test.
 */

/** Type of each entry on the repair scanner's bracket stack. */
type BracketKind = '{' | '[';

interface ScanState {
  /** Open bracket stack, innermost last. */
  stack: BracketKind[];
  /** 1 = outside string, 2 = in string, 3 = in string after backslash. */
  inString: 1 | 2 | 3;
  /** Set when the scan detected malformed content it cannot repair. */
  malformed: boolean;
  /** Offsets (end-exclusive) of structurally complete prefixes. */
  safeEnds: number[];
}

/**
 * Scan the raw JSON text, recording every prefix boundary after which the
 * accumulated content is a structurally complete JSON prefix (closed element
 * followed by `,`, or a fully closed container).
 */
function scanBoundaries(raw: string): ScanState {
  const state: ScanState = { stack: [], inString: 1, malformed: false, safeEnds: [] };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (state.inString === 3) {
      // Previous char was an escaping backslash — this char is literal.
      state.inString = 2;
      continue;
    }
    switch (ch) {
      case '\\':
        if (state.inString === 2) state.inString = 3;
        break;
      case '"':
        state.inString = state.inString === 2 ? 1 : 2;
        break;
      case '{':
      case '[':
        if (state.inString === 1) state.stack.push(ch as BracketKind);
        break;
      case '}':
      case ']':
        if (state.inString === 1) {
          const expected = ch === '}' ? '{' : '[';
          if (state.stack.pop() !== expected) {
            state.malformed = true; // unbalanced close — not truncation
            return state;
          }
          if (state.stack.length === 0) {
            // Fully closed container — everything before is complete.
            state.safeEnds.push(i + 1);
          }
        }
        break;
      case ',':
        if (state.inString === 1 && state.stack.length > 0) {
          // Element just closed; prefix up to (not including) the comma is
          // repairable by closing the stack. Record boundary after a complete
          // key/value pair — the comma itself separates elements, so the
          // boundary at i (before comma) is only safe if we can also handle
          // "key": (colon then truncation). Simpler and equally correct:
          // mark the position of the comma as a rewind target and, once the
          // NEXT element completes, a stronger boundary. For repair purposes
          // the comma position works: rewinding to it means dropping the
          // partial element that follows.
          state.safeEnds.push(i);
        }
        break;
      default:
        break;
    }
  }
  return state;
}

/** Trim a repaired prefix so it ends at a valid JSON close, with no dangling separator. */
function trimToBoundary(raw: string, end: number): string {
  let cut = raw.slice(0, end).replace(/[\s,]+$/, '');
  // If the boundary cut left a dangling key (e.g. `"slides": [` trimmed to
  // `"slides":`), keep rewinding over earlier boundaries until the trimmed
  // prefix ends with `}` or `]` (a closed container) or is empty.
  while (cut && !/[\}\]"]$/.test(cut)) {
    cut = cut.slice(0, -1).replace(/[\s,]+$/, '');
  }
  return cut;
}

/**
 * Repair truncated JSON arguments. Returns valid JSON text, or null when the
 * input is malformed rather than truncated (caller should surface the parse
 * error to the LLM with position context).
 *
 * Exported for tests and for tools that receive raw LLM JSON bodies.
 */
export function repairTruncatedJson(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Fast path — intact JSON needs no repair.
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    /* fall through to repair */
  }

  // Only objects and arrays are repairable targets (tool arguments shape).
  if (!/^[{[]/.test(raw)) return null;

  const state = scanBoundaries(raw);
  if (state.malformed) return null;
  if (state.stack.length === 0) {
    // Balanced brackets but still invalid — genuine syntax error (bad escape,
    // literal newline in string, etc.). Not truncation; do not guess.
    return null;
  }

  // Truncated. Take the strongest boundary: the last fully-closed container
  // end if present, otherwise the last comma boundary.
  const boundary =
    state.safeEnds.findLastIndex((end) => raw[end - 1] === '}') !== -1
      ? Math.max(
          ...state.safeEnds.filter((end) => raw[end - 1] === '}'),
        )
      : state.safeEnds.at(-1);

  // Trim to a clean prefix.
  const trimmed = boundary !== undefined ? trimToBoundary(raw, boundary) : raw;
  if (!trimmed) return null;

  // Close the remaining bracket stack in reverse open order.
  // Re-scan the trimmed prefix to get its exact stack and string state.
  const trimmedState = scanBoundaries(trimmed);
  if (trimmedState.malformed) return null;
  // If the prefix ends inside an open string, close the quote first.
  const quoteCloser = trimmedState.inString >= 2 ? '"' : '';
  const closer = quoteCloser + trimmedState.stack
    .slice()
    .reverse()
    .map((b) => (b === '{' ? '}' : ']'))
    .join('');

  const candidate = trimmed + closer;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}
