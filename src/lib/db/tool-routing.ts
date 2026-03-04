/**
 * Tool Routing Database Operations
 *
 * CRUD operations for the tool_routing_rules table.
 * Manages keyword/regex patterns that force specific tool calls.
 */

import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne, queryAll, transaction } from './index';
import type {
  ToolRoutingRule,
  ToolRoutingRuleInput,
  ForceMode,
  RuleType,
} from '../../types/tool-routing';

// ============ Database Row Types ============

interface DbToolRoutingRule {
  id: string;
  tool_name: string;
  rule_name: string;
  rule_type: string;
  patterns: string;
  force_mode: string;
  priority: number;
  category_ids: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

// ============ Mappers ============

function mapDbToRoutingRule(row: DbToolRoutingRule): ToolRoutingRule {
  return {
    id: row.id,
    toolName: row.tool_name,
    ruleName: row.rule_name,
    ruleType: row.rule_type as RuleType,
    patterns: JSON.parse(row.patterns),
    forceMode: row.force_mode as ForceMode,
    priority: row.priority,
    categoryIds: row.category_ids ? JSON.parse(row.category_ids) : null,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

// ============ Read Operations ============

/**
 * Get all active routing rules, optionally filtered by category
 */
export function getActiveRoutingRules(categoryIds?: number[]): ToolRoutingRule[] {
  const rows = queryAll<DbToolRoutingRule>(
    `SELECT * FROM tool_routing_rules
     WHERE is_active = 1
     ORDER BY priority ASC, created_at ASC`
  );

  let rules = rows.map(mapDbToRoutingRule);

  // Filter by category if provided
  if (categoryIds && categoryIds.length > 0) {
    rules = rules.filter((rule) => {
      // null means all categories
      if (rule.categoryIds === null) return true;
      // Check if any category matches
      return rule.categoryIds.some((id) => categoryIds.includes(id));
    });
  }

  return rules;
}

/**
 * Get all routing rules (for admin)
 */
export function getAllRoutingRules(): ToolRoutingRule[] {
  const rows = queryAll<DbToolRoutingRule>(
    `SELECT * FROM tool_routing_rules ORDER BY tool_name, priority ASC`
  );
  return rows.map(mapDbToRoutingRule);
}

/**
 * Get routing rule by ID
 */
export function getRoutingRuleById(id: string): ToolRoutingRule | undefined {
  const row = queryOne<DbToolRoutingRule>(
    `SELECT * FROM tool_routing_rules WHERE id = ?`,
    [id]
  );
  return row ? mapDbToRoutingRule(row) : undefined;
}

/**
 * Get routing rules by tool name
 */
export function getRoutingRulesByTool(toolName: string): ToolRoutingRule[] {
  const rows = queryAll<DbToolRoutingRule>(
    `SELECT * FROM tool_routing_rules WHERE tool_name = ? ORDER BY priority ASC`,
    [toolName]
  );
  return rows.map(mapDbToRoutingRule);
}

// ============ Write Operations ============

/**
 * Create a new routing rule
 */
export function createRoutingRule(
  input: ToolRoutingRuleInput,
  createdBy: string
): ToolRoutingRule {
  const id = uuidv4();

  execute(
    `INSERT INTO tool_routing_rules (
      id, tool_name, rule_name, rule_type, patterns, force_mode,
      priority, category_ids, is_active, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.toolName,
      input.ruleName,
      input.ruleType,
      JSON.stringify(input.patterns),
      input.forceMode || 'required',
      input.priority || 100,
      input.categoryIds ? JSON.stringify(input.categoryIds) : null,
      input.isActive !== false ? 1 : 0,
      createdBy,
      createdBy,
    ]
  );

  return getRoutingRuleById(id)!;
}

/**
 * Update a routing rule
 */
export function updateRoutingRule(
  id: string,
  updates: Partial<ToolRoutingRuleInput>,
  updatedBy: string
): ToolRoutingRule | undefined {
  const existing = getRoutingRuleById(id);
  if (!existing) return undefined;

  const fields: string[] = ['updated_at = CURRENT_TIMESTAMP', 'updated_by = ?'];
  const values: unknown[] = [updatedBy];

  if (updates.toolName !== undefined) {
    fields.push('tool_name = ?');
    values.push(updates.toolName);
  }
  if (updates.ruleName !== undefined) {
    fields.push('rule_name = ?');
    values.push(updates.ruleName);
  }
  if (updates.ruleType !== undefined) {
    fields.push('rule_type = ?');
    values.push(updates.ruleType);
  }
  if (updates.patterns !== undefined) {
    fields.push('patterns = ?');
    values.push(JSON.stringify(updates.patterns));
  }
  if (updates.forceMode !== undefined) {
    fields.push('force_mode = ?');
    values.push(updates.forceMode);
  }
  if (updates.priority !== undefined) {
    fields.push('priority = ?');
    values.push(updates.priority);
  }
  if (updates.categoryIds !== undefined) {
    fields.push('category_ids = ?');
    values.push(updates.categoryIds ? JSON.stringify(updates.categoryIds) : null);
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  values.push(id);

  execute(
    `UPDATE tool_routing_rules SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  return getRoutingRuleById(id);
}

/**
 * Delete a routing rule
 */
export function deleteRoutingRule(id: string): boolean {
  const result = execute(`DELETE FROM tool_routing_rules WHERE id = ?`, [id]);
  return result.changes > 0;
}

// ============ Seed Default Rules ============

export const DEFAULT_ROUTING_RULES: ToolRoutingRuleInput[] = [
  // Chart Generator
  {
    toolName: 'chart_gen',
    ruleName: 'Chart Visualization Keywords',
    ruleType: 'keyword',
    patterns: [
      'chart',
      'graph',
      'plot',
      'visualize',
      'visualization',
      'bar chart',
      'pie chart',
      'line graph',
      'histogram',
      'create a chart',
      'show me a chart',
      'generate a chart',
      'draw a graph',
    ],
    forceMode: 'required',
    priority: 10,
  },
  // Document Generator
  {
    toolName: 'doc_gen',
    ruleName: 'Document Generation Keywords',
    ruleType: 'keyword',
    patterns: [
      'generate report',
      'create pdf',
      'export to pdf',
      'download as pdf',
      'save as pdf',
      'formal document',
      'create document',
      'word document',
      'docx',
    ],
    forceMode: 'required',
    priority: 20,
  },
  // Web Search
  {
    toolName: 'web_search',
    ruleName: 'Web Search Keywords',
    ruleType: 'keyword',
    patterns: [
      'search the web',
      'look up online',
      'find online',
      'latest news',
      'current information',
      'recent updates',
      'search online',
    ],
    forceMode: 'preferred',
    priority: 30,
  },
  // Diagram Generator - Flowcharts
  {
    toolName: 'diagram_gen',
    ruleName: 'Diagram Flowchart Keywords',
    ruleType: 'keyword',
    patterns: [
      'flowchart',
      'process flow',
      'workflow',
      'flow diagram',
      'process diagram',
      'mermaid diagram',
      'mermaid flowchart',
    ],
    forceMode: 'required',
    priority: 15,
  },
  // Diagram Generator - Mindmaps
  {
    toolName: 'diagram_gen',
    ruleName: 'Diagram Mindmap Keywords',
    ruleType: 'keyword',
    patterns: [
      'mindmap',
      'mind map',
      'brainstorm diagram',
      'concept map',
    ],
    forceMode: 'required',
    priority: 15,
  },
  // Diagram Generator - Sequence
  {
    toolName: 'diagram_gen',
    ruleName: 'Diagram Sequence Keywords',
    ruleType: 'keyword',
    patterns: [
      'sequence diagram',
      'interaction diagram',
      'message flow',
    ],
    forceMode: 'required',
    priority: 15,
  },
  // Diagram Generator - Architecture
  {
    toolName: 'diagram_gen',
    ruleName: 'Diagram Architecture Keywords',
    ruleType: 'keyword',
    patterns: [
      'architecture diagram',
      'c4 diagram',
      'system diagram',
      'c4 context',
      'c4 container',
    ],
    forceMode: 'required',
    priority: 15,
  },
  // Diagram Generator - Other
  {
    toolName: 'diagram_gen',
    ruleName: 'Diagram Other Keywords',
    ruleType: 'keyword',
    patterns: [
      'gantt chart',
      'timeline diagram',
      'class diagram',
      'uml class',
      'state diagram',
      'state machine',
      'er diagram',
      'entity relationship',
      'database diagram',
      'user journey',
      'journey map',
    ],
    forceMode: 'required',
    priority: 15,
  },
  // Spreadsheet Generator
  {
    toolName: 'xlsx_gen',
    ruleName: 'Spreadsheet Keywords',
    ruleType: 'keyword',
    patterns: [
      'create spreadsheet',
      'create a spreadsheet',
      'make excel',
      'create excel',
      'generate spreadsheet',
      'xlsx',
      'excel file',
      'build a tracker',
      'create a budget',
      'financial model',
      'export to excel',
    ],
    forceMode: 'required',
    priority: 15,
  },
  // Presentation Generator
  {
    toolName: 'pptx_gen',
    ruleName: 'Presentation Keywords',
    ruleType: 'keyword',
    patterns: [
      'create presentation',
      'create a presentation',
      'make slides',
      'create slides',
      'generate presentation',
      'slide deck',
      'pitch deck',
      'powerpoint',
      'pptx',
      'make a deck',
      'presentation about',
    ],
    forceMode: 'required',
    priority: 15,
  },
];

/**
 * Seed default routing rules if none exist
 * Skips seeding if migration to skills has already happened
 */
export function seedDefaultRoutingRules(createdBy: string = 'system'): void {
  // Check if migration to skills has happened (skills with tool_name exist)
  const skillsWithToolRouting = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM skills WHERE tool_name IS NOT NULL`
  );

  if ((skillsWithToolRouting?.count || 0) > 0) {
    console.log('[ToolRouting] Skipping seed - tool routing has been migrated to skills');
    return;
  }

  transaction(() => {
    for (const rule of DEFAULT_ROUTING_RULES) {
      // Check if rule with same name already exists
      const existing = queryOne<{ id: string }>(
        `SELECT id FROM tool_routing_rules WHERE rule_name = ?`,
        [rule.ruleName]
      );

      if (!existing) {
        createRoutingRule(rule, createdBy);
        console.log(`[ToolRouting] Created default rule: ${rule.ruleName}`);
      }
    }
  });
}

/**
 * Check if any routing rules exist
 */
export function hasRoutingRules(): boolean {
  const row = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM tool_routing_rules`
  );
  return (row?.count || 0) > 0;
}
