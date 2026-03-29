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
import { getPlannerSystemPrompt } from '../db/compat/agent-config';

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
    skillCatalog?: { id: number; name: string; description: string | null; trigger_value: string | null; tool_name: string | null; force_mode: string | null }[];
    resolvedSkillContext?: {
      matchedSkills: { id: number; name: string; prompt_summary: string }[];
      toolHints: { tool_name: string; force_mode: string; skill_name: string }[];
    };
    availableTools?: { name: string; description: string }[];
    planningFeedback?: string;
    replanContext?: Array<{ id: number; description: string; type: string; error?: string }>;
  },
  modelConfig: AgentModelConfig
): Promise<{ tasks: AgentTask[]; title: string; error?: string }> {
  const prompt = buildPlannerPrompt(userRequest, context);

  try {
    // Get planner model
    const plannerModel = getModelForRole('planner', modelConfig);

    // Load configurable system prompt (falls back to default)
    const systemPrompt = await getPlannerSystemPrompt();

    // Generate plan
    const response = await generateWithModel(plannerModel, prompt, {
      systemPrompt,
      temperature: 0.3, // Moderate creativity for planning
    });

    // Parse with schema validation
    const parseResult = await parsePlannerResponse(response.content, plannerModel);

    if (!parseResult.success) {
      console.error('[Planner] Parse failed:', parseResult.error);
      // Fallback: create a single-task plan so execution can still proceed
      return {
        tasks: [{
          id: 1,
          type: 'analyze' as const,
          target: 'user request',
          description: userRequest.substring(0, 200),
          expected_output: 'Analysis of the user request',
          status: 'pending' as const,
          priority: 1,
          dependencies: [],
          state_history: [],
          retry_count: 0,
        }],
        title: 'Analysis Plan',
      };
    }

    const { title, tasks: rawTasks } = parseResult.data;

    // Convert to AgentTask format
    const tasks: AgentTask[] = rawTasks.map((t) => ({
      id: t.id,
      type: t.type,
      target: t.target,
      description: t.description,
      expected_output: t.expected_output,
      status: 'pending',
      priority: t.priority || 1,
      dependencies: t.dependencies || [],
      state_history: [],
      retry_count: 0,
      execution_hint: t.execution_hint,
      skill_ids: t.skill_ids,
      tool_name: t.tool_name,
    }));

    // Self-reflection: check plan quality for complex plans (≥4 tasks)
    let finalTasks = tasks;
    if (tasks.length >= 4) {
      const reflectionResult = await reflectOnPlan(userRequest, parseResult.data, modelConfig);
      if (reflectionResult) {
        // Reflection returned a corrected plan — use it
        finalTasks = reflectionResult.tasks.map((t) => ({
          id: t.id,
          type: t.type,
          target: t.target,
          description: t.description,
          expected_output: t.expected_output,
          status: 'pending' as const,
          priority: t.priority || 1,
          dependencies: t.dependencies || [],
          state_history: [],
          retry_count: 0,
          execution_hint: t.execution_hint,
          skill_ids: t.skill_ids,
          tool_name: t.tool_name,
        }));
        console.log(`[Planner] Reflection refined plan: ${tasks.length} → ${finalTasks.length} tasks`);
      }
    }

    // Validate dependency graph
    const validation = validateDependencyGraph(finalTasks);

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

    return { tasks: finalTasks, title };
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
 * Reflect on a generated plan using a 7-point checklist
 * Returns corrected plan if any checks fail, or null if plan passes
 *
 * @param userRequest - The original user request
 * @param plan - The generated plan to reflect on
 * @param modelConfig - Model configuration
 * @returns Corrected PlannerResponse or null if plan passes reflection
 */
async function reflectOnPlan(
  userRequest: string,
  plan: PlannerResponse,
  modelConfig: AgentModelConfig
): Promise<PlannerResponse | null> {
  const plannerModel = getModelForRole('planner', modelConfig);

  const prompt = `Reflect on this generated plan. For each check, answer PASS or FAIL with a brief reason:

**Original User Request:**
${userRequest}

**Generated Plan:**
${JSON.stringify(plan, null, 2)}

**Reflection Checklist:**
1. COMPLETENESS: Does every user-requested deliverable have a corresponding task?
2. TASK TYPES: Are tool types (document, image, chart, spreadsheet, presentation, podcast, diagram) used instead of generic "generate" where a specific output format is needed?
3. DEPENDENCIES: Does every output task depend on an analysis/processing task (not directly on search)?
4. IMPLICIT ITEMS: If the user mentioned multiple items (explicitly or implicitly), are they all covered with separate tasks?
5. SEARCH CHAIN: Are search→analyze→output chains properly structured?
6. SYNTHESIS: For multi-item analysis, is there a final synthesize/compare/summarize task?
7. REDUNDANCY: Are there duplicate or unnecessary tasks?
8. UNNECESSARY SEARCH: Are there search tasks when the user already provided the data in their message? User-provided lists/features/content should use "extract" not "search".

If ANY check is FAIL, provide the corrected JSON plan (full plan with title and tasks).
If ALL checks PASS, respond with: {"reflection": "pass"}`;

  try {
    const response = await generateWithModel(plannerModel, prompt, {
      systemPrompt: 'You are a plan quality reviewer. Check the plan against the checklist and either confirm it passes or provide a corrected plan.',
      temperature: 0.2,
    });

    // Check if reflection passed
    if (response.content.includes('"reflection"') && response.content.includes('"pass"')) {
      console.log('[Planner] Reflection passed — plan is good');
      return null;
    }

    // Try to parse corrected plan
    const correctedResult = await parsePlannerResponse(response.content, plannerModel);
    if (correctedResult.success) {
      console.log('[Planner] Reflection returned corrected plan');
      return correctedResult.data;
    }

    // Parse failed — use original plan
    console.warn('[Planner] Reflection parse failed, keeping original plan:', correctedResult.error);
    return null;
  } catch (error) {
    console.error('[Planner] Reflection error, keeping original plan:', error);
    return null;
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
    skillCatalog?: { id: number; name: string; description: string | null; trigger_value: string | null; tool_name: string | null; force_mode: string | null }[];
    resolvedSkillContext?: {
      matchedSkills: { id: number; name: string; prompt_summary: string }[];
      toolHints: { tool_name: string; force_mode: string; skill_name: string }[];
    };
    availableTools?: { name: string; description: string }[];
    planningFeedback?: string;
    replanContext?: Array<{ id: number; description: string; type: string; error?: string }>;
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

  if (context.skillCatalog && context.skillCatalog.length > 0) {
    prompt += `\n**Available Skills (tag applicable skill IDs in each task):**
${JSON.stringify(context.skillCatalog, null, 2)}

For each task, include a "skill_ids" array with the IDs of skills that should be activated for that task. Only tag skills whose description or keywords are relevant to the specific task. Use an empty array [] if no skills apply.
`;
  }

  // Add pre-resolved skill matches and tool routing hints
  if (context.resolvedSkillContext?.matchedSkills?.length) {
    prompt += `\n**Skills Matched Against User Request:**\n`;
    for (const skill of context.resolvedSkillContext.matchedSkills) {
      prompt += `- "${skill.name}" (ID: ${skill.id}): ${skill.prompt_summary}\n`;
    }
    prompt += `\nThese skills matched the user's keywords. Tag their IDs on relevant tasks.\n`;
  }

  if (context.resolvedSkillContext?.toolHints?.length) {
    prompt += `\n**Tool Routing from Skills:**\n`;
    for (const hint of context.resolvedSkillContext.toolHints) {
      prompt += `- Skill "${hint.skill_name}" routes to tool "${hint.tool_name}" (${hint.force_mode})\n`;
    }
    prompt += `\nWhen a skill routes to a specific tool, create tasks with matching types (e.g., "web_search" → "search" type task, "document" → "document" type task). For "required" force mode, you MUST include a task using that tool type.\n`;
  }

  // Inject available tools so planner can assign tool_name on tasks
  if (context.availableTools?.length) {
    prompt += `\n**Available Tools (set "tool_name" on tasks when applicable):**\n`;
    for (const tool of context.availableTools) {
      prompt += `- \`${tool.name}\`: ${tool.description}\n`;
    }
    prompt += `\nWhen a task directly maps to one of these tools, include "tool_name": "<name>" in the task JSON. The executor will call the tool automatically. Only set tool_name for tasks that need a specific tool — analytical tasks (analyze, search, compare, summarize) should NOT have tool_name.\n`;
    prompt += `If a matched skill's prompt mentions specific tool names (e.g., "security_scan(url)"), create separate tasks for each tool with the corresponding tool_name.\n`;
  }

  prompt += `
**CRITICAL INSTRUCTIONS:**

1. **FIRST: Check if the user has provided data in their message OR in the recent conversation.**
   - Look in BOTH the user request AND the recent conversation for lists/data
   - If the user references "the above list" or "each item", look in the conversation history
   - If you find a list of items, structured data, or specific information - use it!

2. **DO NOT search the web** for data that is already in the message or conversation history.

2.5 **SEARCH → ANALYZE → OUTPUT CHAIN (CRITICAL):**
   - Web search returns RAW data (URLs, titles, snippets) - NOT usable directly for outputs
   - ALWAYS create an "analyze" task to PROCESS and INTERPRET search results
   - ALL outputs (documents, images, charts) MUST depend on ANALYZE task, NOT search task
   - Correct: search → analyze → generate (doc/image/chart)
   - WRONG: search → generate (skipping analysis - outputs will just list URLs!)

2.6 **OUTPUT GENERATION FROM PROCESSED DATA:**
   - Documents should summarize ANALYSIS findings, not list raw search URLs
   - Images/infographics should visualize ANALYZED insights, not raw search snippets
   - Charts should plot ANALYZED metrics, not search result counts
   - The analyze task transforms raw data into meaningful content for visualization

3. **PER-ITEM PROCESSING:** When the user asks for SEPARATE/INDIVIDUAL outputs for multiple items:
   - If user says "for each", "individual reports", "separate analysis", etc.
   - Create a SEPARATE task for EACH item in the list
   - You may create up to 50 tasks if needed for per-item processing
   - Example: 20 SOEs = 20 analyze tasks + 20 generate tasks
   - **LARGE LISTS (25+ items):** If the list has more than 25 items, process the FIRST 25 items only.
     Include a final "summarize" task explaining: "Processed 25 of X items. The bot has limitations to execute a large query as it requires multiple LLM calls which generates huge number of tokens and blocks server and APIs. To continue with remaining items, please make another request."

3.5. **IMPLICIT PER-ITEM DETECTION:** Even without explicit "for each" wording, detect multiple items:
   - Comma-separated lists: "AWS, Azure, and GCP" → 3 items
   - "all of our [X]" / "each of the [N] [X]" → per-item processing
   - "the [N] departments/regions/vendors" → per-item
   - "across all [X]" → per-item analysis with consolidated output
   - Numbered lists: "1. X 2. Y 3. Z" → per-item
   Create separate tasks for each detected item.

4. For consolidated outputs (single report covering all items): Create 3-10 tasks

5. Each task should be specific and measurable
6. Use dependencies to define execution order (task IDs)
7. Ensure no circular dependencies
8. **Priority (1-10):** Assign meaningful priorities to tasks:
   - **10**: Critical — must run first (e.g., extract user-provided data)
   - **7-9**: High — important tasks like analysis, search
   - **4-6**: Medium — generation, comparison
   - **1-3**: Low — summaries, final assembly
   When multiple tasks have no dependency ordering between them, priority determines which runs first.

**Task Types:**

*Core types (LLM-based):*
- **extract**: Pull out specific information from the user's provided data - USE THIS FIRST if user provided data
- **analyze**: Examine and interpret information (LLM-based analysis)
- **search**: Find information via web search - ONLY if user needs external information not in their message
- **compare**: Compare multiple items or options (produces structured comparison)
- **synthesize**: Consolidate findings from multiple analysis branches into cross-cutting themes and insights — use AFTER parallel analysis tasks
- **generate**: Generic LLM text generation (use specific types below when a tool output is needed)
- **summarize**: Condense information into a summary
- **validate**: Check correctness or compliance

*Tool types (trigger specialized tools — use these instead of "generate" when applicable):*
- **document**: Generate a downloadable Word/PDF document (report, memo, brief, letter)
- **image**: Generate an AI image or infographic (visual, illustration, graphic)
- **chart**: Generate a data chart or graph (bar chart, line chart, pie chart, plot)
- **spreadsheet**: Generate an Excel/XLSX file (data export, tabular data)
- **presentation**: Generate a PowerPoint/PPTX slide deck
- **podcast**: Generate an audio podcast from content
- **diagram**: Generate a diagram (flowchart, architecture, process flow, mindmap, mermaid)

**IMPORTANT:** Each task MUST include an "expected_output" field — a one-line description of what good output looks like.
Example: "expected_output": "A 2-page Word document summarizing AWS security findings with key recommendations"

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
      "priority": 10,
      "dependencies": []
    },
    {
      "id": 2,
      "type": "analyze",
      "target": "SOE assessment",
      "description": "Analyze each SOE based on the extracted information",
      "priority": 7,
      "dependencies": [1]
    },
    {
      "id": 3,
      "type": "document",
      "target": "Word document report",
      "description": "Generate a Word document with the SOE analysis report",
      "priority": 5,
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
      "priority": 10,
      "dependencies": []
    },
    {
      "id": 2,
      "type": "analyze",
      "target": "T&TEC assessment",
      "description": "Analyze T&TEC (Trinidad and Tobago Electricity Commission)",
      "priority": 8,
      "dependencies": [1]
    },
    {
      "id": 3,
      "type": "document",
      "target": "Word document report for T&TEC",
      "description": "Generate Word document assessment report for T&TEC",
      "priority": 5,
      "dependencies": [2]
    },
    {
      "id": 4,
      "type": "analyze",
      "target": "WASA assessment",
      "description": "Analyze WASA (Water and Sewerage Authority)",
      "priority": 8,
      "dependencies": [1]
    },
    {
      "id": 5,
      "type": "document",
      "target": "Word document report for WASA",
      "description": "Generate Word document assessment report for WASA",
      "priority": 5,
      "dependencies": [4]
    },
    {
      "id": 6,
      "type": "analyze",
      "target": "NGC assessment",
      "description": "Analyze NGC (National Gas Company)",
      "priority": 8,
      "dependencies": [1]
    },
    {
      "id": 7,
      "type": "document",
      "target": "Word document report for NGC",
      "description": "Generate Word document assessment report for NGC",
      "priority": 5,
      "dependencies": [6]
    }
  ]
}

**Example 3: User asks for external information (search → analyze → output)**
User: "Research the latest compliance regulations for financial services and create a summary report"

Correct response (search THEN analyze THEN generate):
{
  "title": "Compliance Regulations Research",
  "tasks": [
    {
      "id": 1,
      "type": "search",
      "target": "web search financial services compliance regulations 2024",
      "description": "Search the web for latest compliance regulations",
      "priority": 9,
      "dependencies": []
    },
    {
      "id": 2,
      "type": "analyze",
      "target": "compliance regulations analysis",
      "description": "Analyze search results and extract key compliance requirements, deadlines, and implications",
      "priority": 7,
      "dependencies": [1]
    },
    {
      "id": 3,
      "type": "document",
      "target": "Word document summary report",
      "description": "Generate a summary report document with the analyzed compliance findings",
      "priority": 5,
      "dependencies": [2]
    }
  ]
}

**Example 4: Per-item with web search AND visual outputs (search → analyze → outputs)**
User: "Research each SOE and create an assessment with an infographic for each: T&TEC, WASA, NGC"

Correct response (per-item: search → analyze → multiple outputs):
{
  "title": "SOE Research and Visual Assessments",
  "tasks": [
    {
      "id": 1,
      "type": "extract",
      "target": "SOE list from user message",
      "description": "Extract the 3 SOEs: T&TEC, WASA, NGC",
      "priority": 10,
      "dependencies": []
    },
    {
      "id": 2,
      "type": "search",
      "target": "web search T&TEC Trinidad assessment data",
      "description": "Search for T&TEC company information and performance data",
      "priority": 9,
      "dependencies": [1]
    },
    {
      "id": 3,
      "type": "analyze",
      "target": "T&TEC assessment",
      "description": "Analyze T&TEC search results - extract key metrics, performance indicators, and insights",
      "priority": 7,
      "dependencies": [2]
    },
    {
      "id": 4,
      "type": "image",
      "target": "infographic for T&TEC",
      "description": "Create infographic visualizing T&TEC assessment findings",
      "priority": 5,
      "dependencies": [3]
    },
    {
      "id": 5,
      "type": "search",
      "target": "web search WASA Trinidad assessment data",
      "description": "Search for WASA company information and performance data",
      "priority": 9,
      "dependencies": [1]
    },
    {
      "id": 6,
      "type": "analyze",
      "target": "WASA assessment",
      "description": "Analyze WASA search results - extract key metrics, performance indicators, and insights",
      "priority": 7,
      "dependencies": [5]
    },
    {
      "id": 7,
      "type": "image",
      "target": "infographic for WASA",
      "description": "Create infographic visualizing WASA assessment findings",
      "priority": 5,
      "dependencies": [6]
    },
    {
      "id": 8,
      "type": "search",
      "target": "web search NGC Trinidad assessment data",
      "description": "Search for NGC company information and performance data",
      "priority": 9,
      "dependencies": [1]
    },
    {
      "id": 9,
      "type": "analyze",
      "target": "NGC assessment",
      "description": "Analyze NGC search results - extract key metrics, performance indicators, and insights",
      "priority": 7,
      "dependencies": [8]
    },
    {
      "id": 10,
      "type": "image",
      "target": "infographic for NGC",
      "description": "Create infographic visualizing NGC assessment findings",
      "priority": 5,
      "dependencies": [9]
    }
  ]
}

CRITICAL: In Example 4, note that each "image" task (ids 4, 7, 10) depends on its ANALYZE task (ids 3, 6, 9), NOT on the search task. This ensures the output is generated from processed analysis, not raw search URLs. Use explicit tool types (document, image, chart, spreadsheet, presentation, podcast, diagram) instead of "generate" when a specific tool output is needed.

**Example 5: Security assessment (search-heavy, implicit per-item)**
User: "Assess our organization's cloud security posture across AWS, Azure, and GCP"

Correct response (detects 3 items implicitly, search → analyze each → synthesize → document):
{
  "title": "Cloud Security Posture Assessment",
  "tasks": [
    { "id": 1, "type": "search", "target": "AWS cloud security best practices 2024", "description": "Search for AWS security posture assessment criteria and best practices", "expected_output": "5+ search results covering AWS security frameworks, IAM, encryption, and compliance", "priority": 9, "dependencies": [] },
    { "id": 2, "type": "search", "target": "Azure cloud security best practices 2024", "description": "Search for Azure security posture assessment criteria", "expected_output": "5+ search results covering Azure security center, identity management, and compliance", "priority": 9, "dependencies": [] },
    { "id": 3, "type": "search", "target": "GCP cloud security best practices 2024", "description": "Search for GCP security posture assessment criteria", "expected_output": "5+ search results covering GCP security command center and IAM", "priority": 9, "dependencies": [] },
    { "id": 4, "type": "analyze", "target": "AWS security assessment", "description": "Analyze AWS security posture based on search results", "expected_output": "Detailed assessment of AWS security covering IAM, encryption, network, and compliance", "priority": 7, "dependencies": [1] },
    { "id": 5, "type": "analyze", "target": "Azure security assessment", "description": "Analyze Azure security posture based on search results", "expected_output": "Detailed assessment of Azure security covering identity, data protection, and compliance", "priority": 7, "dependencies": [2] },
    { "id": 6, "type": "analyze", "target": "GCP security assessment", "description": "Analyze GCP security posture based on search results", "expected_output": "Detailed assessment of GCP security covering IAM, encryption, and compliance", "priority": 7, "dependencies": [3] },
    { "id": 7, "type": "synthesize", "target": "Cross-platform security findings", "description": "Synthesize findings across AWS, Azure, and GCP - identify common gaps, platform-specific risks, and cross-cutting recommendations", "expected_output": "Cross-platform analysis highlighting shared vulnerabilities, unique risks per cloud, and unified recommendations", "priority": 5, "dependencies": [4, 5, 6] },
    { "id": 8, "type": "document", "target": "Cloud security assessment report", "description": "Generate comprehensive security assessment document", "expected_output": "Professional Word document with executive summary, per-cloud findings, cross-platform analysis, and recommendations", "priority": 3, "dependencies": [7] }
  ]
}

**Example 6: Product roadmap (no search, user-provided data, presentation)**
User: "Create a product roadmap presentation for Q2-Q4 based on these features: auth system, dashboard redesign, API v2, mobile app, analytics"

Correct response (extract user data → analyze → presentation):
{
  "title": "Product Roadmap Q2-Q4",
  "tasks": [
    { "id": 1, "type": "extract", "target": "Feature list from user message", "description": "Extract the 5 features: auth system, dashboard redesign, API v2, mobile app, analytics", "expected_output": "Structured list of 5 features with names extracted from user request", "priority": 10, "dependencies": [] },
    { "id": 2, "type": "analyze", "target": "Feature prioritization and timeline", "description": "Prioritize features into Q2, Q3, Q4 buckets based on dependencies and complexity", "expected_output": "Timeline allocation with rationale for each feature's quarter assignment", "priority": 7, "dependencies": [1] },
    { "id": 3, "type": "presentation", "target": "Product roadmap slide deck", "description": "Generate PowerPoint presentation with quarterly roadmap, feature descriptions, and timeline", "expected_output": "Professional PPTX slide deck with title slide, quarterly breakdown, and feature detail slides", "priority": 5, "dependencies": [2] }
  ]
}

**Example 7: Competitive comparison (search + chart + document)**
User: "Compare the top 3 project management tools and create a comparison report with charts"

Correct response (search each → analyze → compare → chart + document):
{
  "title": "Project Management Tools Comparison",
  "tasks": [
    { "id": 1, "type": "search", "target": "Asana project management features pricing 2024", "description": "Search for Asana features, pricing, and reviews", "expected_output": "Search results covering Asana features, pricing tiers, and user reviews", "priority": 9, "dependencies": [] },
    { "id": 2, "type": "search", "target": "Monday.com project management features pricing 2024", "description": "Search for Monday.com features, pricing, and reviews", "expected_output": "Search results covering Monday.com features, pricing tiers, and user reviews", "priority": 9, "dependencies": [] },
    { "id": 3, "type": "search", "target": "Jira project management features pricing 2024", "description": "Search for Jira features, pricing, and reviews", "expected_output": "Search results covering Jira features, pricing tiers, and user reviews", "priority": 9, "dependencies": [] },
    { "id": 4, "type": "analyze", "target": "Tool analysis - Asana", "description": "Analyze Asana based on search results", "expected_output": "Structured analysis of Asana covering features, pricing, pros/cons", "priority": 7, "dependencies": [1] },
    { "id": 5, "type": "analyze", "target": "Tool analysis - Monday.com", "description": "Analyze Monday.com based on search results", "expected_output": "Structured analysis of Monday.com covering features, pricing, pros/cons", "priority": 7, "dependencies": [2] },
    { "id": 6, "type": "analyze", "target": "Tool analysis - Jira", "description": "Analyze Jira based on search results", "expected_output": "Structured analysis of Jira covering features, pricing, pros/cons", "priority": 7, "dependencies": [3] },
    { "id": 7, "type": "compare", "target": "Side-by-side comparison", "description": "Compare all three tools across features, pricing, ease of use, and integrations", "expected_output": "Structured comparison table with ratings across multiple dimensions", "priority": 5, "dependencies": [4, 5, 6] },
    { "id": 8, "type": "chart", "target": "Comparison chart", "description": "Create visual comparison chart of the three tools", "expected_output": "Bar or radar chart comparing tools across key dimensions", "priority": 4, "dependencies": [7] },
    { "id": 9, "type": "document", "target": "Comparison report", "description": "Generate Word document with full comparison analysis and recommendations", "expected_output": "Professional comparison report with executive summary, detailed comparison, charts reference, and recommendation", "priority": 3, "dependencies": [7, 8] }
  ]
}

**Example 8: Software architecture design (no search, diagram + document)**
User: "Design a microservices architecture for our e-commerce platform with user service, product catalog, order management, and payment processing"

Correct response (extract → analyze → diagram → document):
{
  "title": "E-Commerce Microservices Architecture Design",
  "tasks": [
    { "id": 1, "type": "extract", "target": "Service list from user request", "description": "Extract the 4 services: user service, product catalog, order management, payment processing", "expected_output": "Structured list of 4 microservices with their implied responsibilities", "priority": 10, "dependencies": [] },
    { "id": 2, "type": "analyze", "target": "Service boundaries and data flows", "description": "Define service boundaries, data ownership, and inter-service communication patterns", "expected_output": "Detailed analysis of each service's responsibilities, data models, and API contracts", "priority": 8, "dependencies": [1] },
    { "id": 3, "type": "analyze", "target": "API contracts and infrastructure", "description": "Design API contracts between services, define message bus patterns, and infrastructure requirements", "expected_output": "API specifications, event-driven patterns, and infrastructure components (API gateway, message queue, databases)", "priority": 7, "dependencies": [2] },
    { "id": 4, "type": "diagram", "target": "Architecture diagram", "description": "Create architecture diagram showing services, data flows, API gateway, and infrastructure", "expected_output": "Mermaid architecture diagram with services, databases, API gateway, and communication paths", "priority": 5, "dependencies": [3] },
    { "id": 5, "type": "document", "target": "Architecture design document", "description": "Generate comprehensive architecture design document", "expected_output": "Professional design document with overview, service specs, API contracts, data models, and deployment considerations", "priority": 3, "dependencies": [3, 4] }
  ]
}

**Example 9: Code analysis / technical audit (knowledge-base, per-concern analysis)**
User: "Analyze our API endpoints for security vulnerabilities, performance bottlenecks, and compliance with REST best practices"

Correct response (extract from context → per-concern analyze → synthesize → spreadsheet + document):
{
  "title": "API Endpoint Technical Audit",
  "tasks": [
    { "id": 1, "type": "extract", "target": "API endpoints from knowledge base", "description": "Extract API endpoint information from the available knowledge base and conversation context", "expected_output": "List of API endpoints with methods, paths, and descriptions", "priority": 10, "dependencies": [] },
    { "id": 2, "type": "analyze", "target": "Security vulnerability assessment", "description": "Analyze API endpoints for security vulnerabilities: authentication, authorization, input validation, injection risks", "expected_output": "Per-endpoint security assessment with severity ratings and remediation recommendations", "priority": 8, "dependencies": [1] },
    { "id": 3, "type": "analyze", "target": "Performance bottleneck analysis", "description": "Analyze API endpoints for performance issues: N+1 queries, missing pagination, heavy payloads, caching opportunities", "expected_output": "Performance analysis with identified bottlenecks and optimization recommendations", "priority": 8, "dependencies": [1] },
    { "id": 4, "type": "analyze", "target": "REST best practices compliance", "description": "Evaluate API endpoints against REST conventions: HTTP methods, status codes, naming, versioning, HATEOAS", "expected_output": "Compliance checklist with pass/fail per endpoint and recommendations for non-compliant areas", "priority": 8, "dependencies": [1] },
    { "id": 5, "type": "synthesize", "target": "Cross-cutting audit findings", "description": "Synthesize findings across security, performance, and REST compliance — identify systemic patterns and prioritize fixes", "expected_output": "Unified findings with cross-cutting patterns, priority matrix, and phased remediation plan", "priority": 5, "dependencies": [2, 3, 4] },
    { "id": 6, "type": "spreadsheet", "target": "Vulnerability and compliance matrix", "description": "Generate Excel spreadsheet with per-endpoint findings across all three dimensions", "expected_output": "XLSX file with endpoints as rows, assessment dimensions as columns, severity ratings, and status", "priority": 4, "dependencies": [5] },
    { "id": 7, "type": "document", "target": "API audit report", "description": "Generate comprehensive audit report document", "expected_output": "Professional audit report with executive summary, per-dimension findings, priority matrix, and remediation roadmap", "priority": 3, "dependencies": [5, 6] }
  ]
}

Respond with JSON only.`;

  if (context.planningFeedback) {
    prompt += `\n\n**User Feedback on Previous Plan:**\n${context.planningFeedback}\nRevise the plan to address this feedback while keeping the original request intent.\n`;
  }

  if (context.replanContext && context.replanContext.length > 0) {
    prompt += `\n\n**Re-Planning Required:**\n${context.replanContext.length} tasks failed quality checks:\n`;
    prompt += context.replanContext.map(t =>
      `- Task "${t.description}" (${t.type}): ${t.error || 'Low confidence'}`
    ).join('\n');
    prompt += `\n\nFor each failed task above, provide an improved replacement task with a better approach. Return exactly one replacement per failed task, in the same order. If you need additional supporting tasks, add them after the replacements.\n`;
  }

  return prompt;
}

/**
 * System prompt for the planner agent
 */
export const DEFAULT_PLANNER_SYSTEM_PROMPT = `You are an expert task planner. You break down complex requests into structured, executable task plans.

Before generating the JSON plan, analyze the request step by step:
1. DOMAIN: What domain is this? (policy, security, finance, technology, comparison, architecture, code analysis, etc.)
2. ENTITIES: What specific items/entities are mentioned or implied?
3. SCOPE: Is this per-item (separate outputs) or consolidated (single output)?
4. DATA SOURCE: Is data provided by user, in conversation history, in the knowledge base, or does it need web search?
5. OUTPUTS: What deliverables are expected? (report, chart, presentation, diagram, spreadsheet, etc.)
6. COMPLEXITY: Simple (≤3 tasks) or complex (requires analysis chains)?

Then generate the JSON plan.

Key principles:
- Create clear, specific tasks with measurable outcomes
- Define proper dependencies (no circular references)
- Use explicit tool types (document, image, chart, spreadsheet, presentation, podcast, diagram) when a specific output format is needed — do NOT use "generate" when a tool type applies
- Look for data in BOTH the user message AND recent conversation history
- CRITICAL: Do NOT create search tasks when the user has provided the data in their message. If the user lists items, features, or content, use "extract" to capture it. Web search is ONLY for finding NEW information not in the user's message or conversation history.
- For per-item requests ("for each", "individual", "separate"): create separate tasks per item (up to 50 tasks)
- For consolidated requests: keep plans concise (3-10 tasks)
- For multi-item analysis, always include a synthesize or summarize task at the end
- Include expected_output for each task — a one-line description of what good output looks like
- Ensure logical execution order
- If available skills are listed in the context, tag each task with applicable skill IDs by including a "skill_ids" array. Only tag skills whose keywords or description match the specific task. Use an empty array if no skills apply.

Output valid JSON matching the schema provided.`;
