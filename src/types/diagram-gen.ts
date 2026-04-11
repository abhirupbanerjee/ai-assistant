/**
 * Diagram Generation Tool Types
 *
 * Types for the diagram_gen tool that generates Mermaid diagrams via LLM.
 */

// ===== Diagram Types =====

export type MermaidDiagramType =
  | 'flowchart'
  | 'sequence'
  | 'mindmap'
  | 'c4-context'
  | 'c4-container'
  | 'c4-component'
  | 'c4-dynamic'
  | 'c4-deployment'
  | 'gantt'
  | 'classDiagram'
  | 'stateDiagram'
  | 'erDiagram'
  | 'pie'
  | 'journey'
  | 'timeline'
  | 'block'
  | 'quadrant'
  | 'architecture';

export type FlowDirection = 'TD' | 'LR' | 'BT' | 'RL';

// ===== Tool Arguments (from LLM function call) =====

export interface DiagramGenToolArgs {
  /** Type of diagram to generate */
  diagram_type: MermaidDiagramType;
  /** Description of what the diagram should show */
  description: string;
  /** Direction for flowcharts (default: TD) */
  direction?: FlowDirection;
  /** Title for the diagram (optional) */
  title?: string;
}

// ===== Configuration =====

export interface DiagramGenConfig {
  /** Temperature for generation (lower = more deterministic) */
  temperature: number;
  /** Maximum tokens for generated diagram */
  maxTokens: number;
  /** Whether to validate syntax before returning */
  validateSyntax: boolean;
  /** Maximum retry attempts on validation failure */
  maxRetries: number;
  /** Enable debug logging */
  debugMode: boolean;
}

// ===== Generation Result =====

export interface DiagramGenerationResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated Mermaid code */
  code?: string;
  /** Diagram type that was generated */
  diagramType?: MermaidDiagramType;
  /** Error information */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

// ===== Tool Response =====

export interface DiagramHint {
  /** Mermaid code for rendering */
  code: string;
  /** Diagram type */
  type: MermaidDiagramType;
  /** Optional title */
  title?: string;
}

export interface DiagramGenResponse {
  /** Whether generation succeeded */
  success: boolean;
  /** Status message for LLM context */
  message?: string;
  /** Diagram hint for frontend rendering */
  diagramHint?: DiagramHint;
  /** Generation metadata */
  metadata?: {
    model: string;
    diagramType: MermaidDiagramType;
    processingTimeMs: number;
    retryCount: number;
  };
  /** Error information */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

// ===== Validation Result =====

export interface DiagramValidationResult {
  valid: boolean;
  errors: string[];
  suggestions?: string[];
}
