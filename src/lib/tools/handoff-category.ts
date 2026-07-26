/**
 * Handoff-to-Category Tool — Phase 2.2 single-agent routing
 *
 * See plans/phase_2_2_implementation_plan.md §1 decision (c).
 *
 * `handoff_to_category` is the LLM-driven category-transfer trigger. When the
 * LLM detects that the user's request belongs to a *different* category than
 * the current conversation, it calls this tool with either a target category
 * slug or id. The tool executor resolves the target category and returns a
 * **handoff-request envelope** — it does NOT mutate thread ownership.
 *
 * Why the executor is side-effect-free: `executeTool` (src/lib/tools.ts) is
 * invoked from generateResponseWithTools (src/lib/openai.ts) with only the
 * tool name + arguments + a config override — it has no thread id, user id,
 * or current category context. The stream route (which owns those) performs
 * the actual `transferThreadCategory` call, emits the `handoff` SSE event,
 * and ends the current turn. This keeps the tool executor pure and testable,
 * and avoids needing to thread thread context through the entire tool-call
 * loop.
 *
 * Envelope shape (returned to the LLM as the tool result):
 *   - Success: `{ handoff: true, targetCategoryId, targetCategoryName,
 *     targetCategorySlug, reason? }`
 *   - Failure (unresolved target, both/neither slug+id given):
 *     `{ handoff: false, error, errorCode }` — the LLM can retry or answer
 *     in-category.
 *
 * The route layer inspects the tool result for `handoff === true` to decide
 * whether to perform the transfer + end the turn.
 */
import { getCategoryBySlug, getCategoryById } from '@/lib/db/compat';
import type { ToolDefinition, ValidationResult } from '../tools';
import { toolsLogger as logger } from '../logger';

// ============ Tool Definition ============

/**
 * Handoff-to-Category tool definition.
 *
 * Category: 'autonomous' — the LLM invokes it via OpenAI function calling.
 * Unlike most autonomous tools it produces no user-facing artifact; its tool
 * result is a control signal the route layer acts on.
 */
export const handoffToCategoryTool: ToolDefinition = {
  name: 'handoff_to_category',
  displayName: 'Hand Off to Category',
  description:
    'Transfer this conversation to a different category when the user\'s request belongs to a category other than the current one. Provide either target_category_slug or target_category_id. This ends the current response; the next turn continues in the new category\'s context. Use only when the request is clearly out of scope for the current category.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'handoff_to_category',
      description:
        'Transfer conversation ownership to a different category. Call this when the user\'s request belongs to a different category than the current conversation. Ends the current response — the conversation continues in the target category on the next turn.',
      parameters: {
        type: 'object',
        properties: {
          target_category_slug: {
            type: 'string',
            description:
              'Slug of the target category (e.g., "finance", "operations"). Use this when you know the category by name.',
          },
          target_category_id: {
            type: 'number',
            description:
              'Numeric id of the target category. Use this when you reference a category by its id.',
          },
          reason: {
            type: 'string',
            description: 'Short explanation of why the handoff is appropriate.',
          },
        },
        // One of slug/id is required — enforced in execute() since JSON Schema
        // can't express "exactly one of" cleanly without oneOf.
        required: [],
      },
    },
  },

  execute: async (args: {
    target_category_slug?: string;
    target_category_id?: number;
    reason?: string;
  }): Promise<string> => {
    const slug = args?.target_category_slug;
    const id = args?.target_category_id;
    const reason = typeof args?.reason === 'string' ? args.reason : undefined;

    // Validate: exactly one of slug / id must be provided.
    if (!slug && (id === undefined || id === null)) {
      return JSON.stringify({
        handoff: false,
        error:
          'Either target_category_slug or target_category_id must be provided.',
        errorCode: 'MISSING_TARGET',
      });
    }
    if (slug && (id !== undefined && id !== null)) {
      return JSON.stringify({
        handoff: false,
        error:
          'Provide only one of target_category_slug or target_category_id, not both.',
        errorCode: 'AMBIGUOUS_TARGET',
      });
    }

    try {
      let category;
      if (slug) {
        category = await getCategoryBySlug(slug);
      } else {
        category = await getCategoryById(Number(id));
      }

      if (!category) {
        return JSON.stringify({
          handoff: false,
          error: slug
            ? `No category found with slug "${slug}".`
            : `No category found with id ${id}.`,
          errorCode: 'CATEGORY_NOT_FOUND',
        });
      }

      // Return a handoff-request envelope. The stream route performs the
      // actual transferThreadCategory + emits the handoff SSE event + ends
      // the turn. We do NOT mutate thread ownership here.
      return JSON.stringify({
        handoff: true,
        targetCategoryId: category.id,
        targetCategoryName: category.name,
        targetCategorySlug: category.slug,
        reason,
      });
    } catch (error) {
      logger.error('handoff_to_category resolution failed', error);
      return JSON.stringify({
        handoff: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to resolve target category.',
        errorCode: 'RESOLUTION_ERROR',
      });
    }
  },

  validateConfig: (): ValidationResult => ({ valid: true, errors: [] }),

  defaultConfig: {},

  configSchema: { type: 'object', properties: {} },
};

export default handoffToCategoryTool;
