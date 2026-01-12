/**
 * Planner Agent
 *
 * Creates task breakdowns from user requests with:
 * - Dependency validation (no circular dependencies)
 * - JSON schema validation
 * - DAG (Directed Acyclic Graph) structure
 */

import type { AgentTask, AgentModelConfig, PlannerResponse } from '@/types/agent';
import { generateWithModel, getModelForRole } from './llm-router';
import { parsePlannerResponse } from './json-parser';
import { validateDependencyGraph } from './dependency-validator';

/**
 * Create a task plan from user request
 *
 * @param userRequest - The user's autonomous mode request
 * @param context - Additional context (RAG results, conversation history, etc.)
 * @param modelConfig - Model configuration for agent roles
 * @returns Array of tasks with validated dependencies
 */
export async function createPlan(
  userRequest: string,
  context: {
    ragContext?: string;
    conversationHistory?: string;
    categoryContext?: string;
  },
  modelConfig: AgentModelConfig
): Promise<{ tasks: AgentTask[]; title: string; error?: string }> {
  const prompt = buildPlannerPrompt(userRequest, context);

  try {
    // Get planner model
    const plannerModel = getModelForRole('planner', modelConfig);

    // Generate plan
    const response = await generateWithModel(plannerModel, prompt, {
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      temperature: 0.3, // Moderate creativity for planning
    });

    // Parse with schema validation
    const parseResult = await parsePlannerResponse(response.content, plannerModel);

    if (!parseResult.success) {
      console.error('[Planner] Parse failed:', parseResult.error);
      return {
        tasks: [],
        title: 'Failed to create plan',
        error: `Failed to parse plan: ${parseResult.error}`,
      };
    }

    const { title, tasks: rawTasks } = parseResult.data;

    // Convert to AgentTask format
    const tasks: AgentTask[] = rawTasks.map((t) => ({
      id: t.id,
      type: t.type,
      target: t.target,
      description: t.description,
      status: 'pending',
      priority: t.priority || 1,
      dependencies: t.dependencies || [],
      state_history: [],
    }));

    // Validate dependency graph
    const validation = validateDependencyGraph(tasks);

    if (!validation.valid) {
      console.error('[Planner] Dependency validation failed:', validation.errors);
      return {
        tasks: [],
        title,
        error: `Invalid dependencies: ${validation.errors.join('; ')}`,
      };
    }

    // Log warnings (non-fatal)
    if (validation.warnings.length > 0) {
      console.warn('[Planner] Dependency warnings:', validation.warnings);
    }

    return { tasks, title };
  } catch (error) {
    console.error('[Planner] Error creating plan:', error);
    return {
      tasks: [],
      title: 'Error',
      error: `Planning error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Build planner prompt
 */
function buildPlannerPrompt(
  userRequest: string,
  context: {
    ragContext?: string;
    conversationHistory?: string;
    categoryContext?: string;
  }
): string {
  let prompt = `Break down this user request into a structured task plan.

**User Request:**
${userRequest}
`;

  // Add conversation history so planner can see data from previous turns
  if (context.conversationHistory) {
    prompt += `\n**Recent Conversation (for context - may contain data referenced by user):**
${context.conversationHistory}

**IMPORTANT:** The conversation history above is ONLY for extracting DATA (lists, names, numbers, entities).
- Do NOT copy task types from previous messages (search, generate, image, document, infographic)
- Only create tasks that are EXPLICITLY requested in the CURRENT user request above
- If the user doesn't ask for web search, don't create search tasks
- If the user doesn't ask for images/infographics, don't create image tasks
`;
  }

  if (context.ragContext) {
    prompt += `\n**Available Knowledge:**
${context.ragContext.substring(0, 1000)}...
`;
  }

  if (context.categoryContext) {
    prompt += `\n**Category Context:**
${context.categoryContext}
`;
  }

  prompt += `
**CRITICAL INSTRUCTIONS:**

1. **FIRST: Check if the user has provided data in their message OR in the recent conversation.**
   - Look in BOTH the user request AND the recent conversation for lists/data
   - If the user references "the above list" or "each item", look in the conversation history
   - If you find a list of items, structured data, or specific information - use it!

2. **DO NOT search the web** for data that is already in the message or conversation history.

3. **PER-ITEM PROCESSING:** When the user asks for SEPARATE/INDIVIDUAL outputs for multiple items:
   - If user says "for each", "individual reports", "separate analysis", etc.
   - Create a SEPARATE task for EACH item in the list
   - You may create up to 50 tasks if needed for per-item processing
   - Example: 20 SOEs = 20 analyze tasks + 20 generate tasks
   - **LARGE LISTS (25+ items):** If the list has more than 25 items, process the FIRST 25 items only.
     Include a final "summarize" task explaining: "Processed 25 of X items. The bot has limitations to execute a large query as it requires multiple LLM calls which generates huge number of tokens and blocks server and APIs. To continue with remaining items, please make another request."

4. For consolidated outputs (single report covering all items): Create 3-10 tasks

5. Each task should be specific and measurable
6. Use dependencies to define execution order (task IDs)
7. Ensure no circular dependencies

**Task Types:**
- **extract**: Pull out specific information from the user's provided data - USE THIS FIRST if user provided data
- **analyze**: Examine and interpret information (LLM-based analysis)
- **search**: Find information - ONLY use target "web search" if user needs external information not in their message
- **compare**: Compare multiple items or options
- **generate**: Create new content - TRIGGERS TOOLS based on target:
  - Target contains "document", "report", "Word", "PDF", "docx" → Creates downloadable Word/PDF document
  - Target contains "infographic", "image", "visual", "diagram", "chart" → Creates AI-generated image
  - Otherwise → LLM text generation
- **summarize**: Condense information into a summary
- **validate**: Check correctness or compliance

**Example 1: User provides data in message**
User: "Analyze these SOEs and create a report: SOE-001 ABC Corp, SOE-002 XYZ Inc, SOE-003 DEF Ltd"

Correct response:
{
  "title": "SOE Analysis Report",
  "tasks": [
    {
      "id": 1,
      "type": "extract",
      "target": "SOE list from user message",
      "description": "Extract the SOE list provided by the user: SOE-001 ABC Corp, SOE-002 XYZ Inc, SOE-003 DEF Ltd",
      "priority": 1,
      "dependencies": []
    },
    {
      "id": 2,
      "type": "analyze",
      "target": "SOE assessment",
      "description": "Analyze each SOE based on the extracted information",
      "priority": 1,
      "dependencies": [1]
    },
    {
      "id": 3,
      "type": "generate",
      "target": "Word document report",
      "description": "Generate a Word document with the SOE analysis report",
      "priority": 1,
      "dependencies": [2]
    }
  ]
}

**Example 2: User asks for INDIVIDUAL reports (per-item processing)**
Previous conversation: "Here are the SOEs: 1. T&TEC, 2. WASA, 3. NGC"
User: "Create a separate assessment report for each SOE in the above list"

Correct response (creates per-item tasks):
{
  "title": "Individual SOE Assessment Reports",
  "tasks": [
    {
      "id": 1,
      "type": "extract",
      "target": "SOE list from conversation",
      "description": "Extract the 3 SOEs from conversation: T&TEC, WASA, NGC",
      "priority": 1,
      "dependencies": []
    },
    {
      "id": 2,
      "type": "analyze",
      "target": "T&TEC assessment",
      "description": "Analyze T&TEC (Trinidad and Tobago Electricity Commission)",
      "priority": 1,
      "dependencies": [1]
    },
    {
      "id": 3,
      "type": "generate",
      "target": "Word document report for T&TEC",
      "description": "Generate Word document assessment report for T&TEC",
      "priority": 1,
      "dependencies": [2]
    },
    {
      "id": 4,
      "type": "analyze",
      "target": "WASA assessment",
      "description": "Analyze WASA (Water and Sewerage Authority)",
      "priority": 1,
      "dependencies": [1]
    },
    {
      "id": 5,
      "type": "generate",
      "target": "Word document report for WASA",
      "description": "Generate Word document assessment report for WASA",
      "priority": 1,
      "dependencies": [4]
    },
    {
      "id": 6,
      "type": "analyze",
      "target": "NGC assessment",
      "description": "Analyze NGC (National Gas Company)",
      "priority": 1,
      "dependencies": [1]
    },
    {
      "id": 7,
      "type": "generate",
      "target": "Word document report for NGC",
      "description": "Generate Word document assessment report for NGC",
      "priority": 1,
      "dependencies": [6]
    }
  ]
}

**Example 3: User asks for external information**
User: "Research the latest compliance regulations for financial services"

Correct response (uses web search):
{
  "title": "Compliance Regulations Research",
  "tasks": [
    {
      "id": 1,
      "type": "search",
      "target": "web search financial services compliance regulations 2024",
      "description": "Search the web for latest compliance regulations",
      "priority": 1,
      "dependencies": []
    },
    ...
  ]
}

Respond with JSON only.`;

  return prompt;
}

/**
 * System prompt for the planner agent
 */
const PLANNER_SYSTEM_PROMPT = `You are an expert task planner. You break down complex requests into structured, executable task plans.

Key principles:
- Create clear, specific tasks
- Define proper dependencies (no circular references)
- Use appropriate task types
- Look for data in BOTH the user message AND recent conversation history
- For per-item requests ("for each", "individual", "separate"): create separate tasks per item (up to 50 tasks)
- For consolidated requests: keep plans concise (3-10 tasks)
- Ensure logical execution order

Output valid JSON matching the schema provided.`;
