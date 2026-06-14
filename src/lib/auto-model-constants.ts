/**
 * Auto Model Selection Constants — Client-Safe
 *
 * This module is isolated from `constants.ts` because that module re-exports
 * `config-loader.ts` (which uses `fs`, `path`, `crypto`) — server-only Node.js
 * APIs that cannot be bundled into client components.
 *
 * Client components (e.g., ModelSelector.tsx) must import `AUTO_MODEL_SENTINEL`
 * from HERE, not from `@/lib/constants`, to avoid pulling `fs` into the browser bundle.
 *
 * Server-side code can continue importing from `@/lib/constants` which re-exports
 * this value for backward compatibility.
 */

/**
 * Sentinel value stored as `selected_model` in the threads table when the user
 * chooses "Auto" mode. Resolved to a concrete model id at request time by
 * `selectBestModel()` — never passed to any LLM API or `buildModelsToTry()`.
 */
export const AUTO_MODEL_SENTINEL = 'auto';
