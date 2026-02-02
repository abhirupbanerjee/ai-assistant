/**
 * Mermaid Diagram Templates and Prompts
 *
 * Specialized prompts for each diagram type to ensure valid syntax
 */

import type { MermaidDiagramType, FlowDirection } from '@/types/diagram-gen';

// ===== Base System Prompt =====

export const MERMAID_SYSTEM_PROMPT = `You are a Mermaid diagram generator. Your ONLY job is to output valid Mermaid syntax.

RULES:
1. Output ONLY the Mermaid code - no explanations, no markdown fences, no commentary
2. Use proper Mermaid syntax for the requested diagram type
3. Keep diagrams focused - maximum 15 nodes for flowcharts, 10 items for mindmaps
4. Use descriptive but concise labels
5. Escape special characters: use "and" instead of "&", avoid parentheses in labels
6. Do NOT include \`\`\`mermaid or \`\`\` markers

NEVER output anything except valid Mermaid code.`;

// ===== Diagram Type Templates =====

export interface DiagramTemplate {
  /** System prompt addition for this diagram type */
  systemPrompt: string;
  /** Example for few-shot learning */
  example: string;
  /** Mermaid syntax prefix */
  prefix: string;
}

export const DIAGRAM_TEMPLATES: Record<MermaidDiagramType, DiagramTemplate> = {
  flowchart: {
    systemPrompt: `Generate a Mermaid flowchart diagram.
- Use flowchart {DIRECTION} as the first line
- Use [Box] for rectangles, {Decision} for diamonds, ([Rounded]) for stadium shapes
- Use --> for arrows, -->|Label| for labeled arrows
- Keep max 12-15 nodes`,
    example: `flowchart TD
    A[Start] --> B{Is valid?}
    B -->|Yes| C[Process]
    B -->|No| D[Error]
    C --> E[End]
    D --> E`,
    prefix: 'flowchart',
  },

  sequence: {
    systemPrompt: `Generate a Mermaid sequence diagram.
- Start with: sequenceDiagram
- Define participants with: participant Name
- Use ->> for solid arrows, -->> for dashed
- Use activate/deactivate for lifelines
- Use Note over/left of/right of for notes`,
    example: `sequenceDiagram
    participant U as User
    participant S as Server
    participant D as Database
    U->>S: Login request
    activate S
    S->>D: Validate credentials
    D-->>S: Valid
    S-->>U: Login successful
    deactivate S`,
    prefix: 'sequenceDiagram',
  },

  mindmap: {
    systemPrompt: `Generate a Mermaid mindmap diagram.
- Start with: mindmap
- Use indentation for hierarchy (2 spaces per level)
- Root node uses: root((Central Topic))
- Child nodes are plain text with indentation
- Max 3-4 levels deep, max 10 nodes total
- Do NOT use parentheses inside node text
- Use "and" instead of "&"`,
    example: `mindmap
  root((Project Planning))
    Goals
      Short term
      Long term
    Resources
      Team
      Budget
    Timeline
      Phase 1
      Phase 2`,
    prefix: 'mindmap',
  },

  'c4-context': {
    systemPrompt: `Generate a Mermaid C4 Context diagram.
- Start with: C4Context
- Use title for diagram title
- Person(alias, "Name", "Description")
- System(alias, "Name", "Description")
- System_Ext(alias, "Name", "Description") for external
- Rel(from, to, "relationship")`,
    example: `C4Context
    title System Context
    Person(user, "User", "End user")
    System(app, "Application", "Main system")
    System_Ext(ext, "External API", "Third party")
    Rel(user, app, "Uses")
    Rel(app, ext, "Calls")`,
    prefix: 'C4Context',
  },

  'c4-container': {
    systemPrompt: `Generate a Mermaid C4 Container diagram.
- Start with: C4Container
- Use Container(alias, "Name", "Technology")
- Use ContainerDb(alias, "Name", "Technology") for databases
- Use Rel(from, to, "relationship")`,
    example: `C4Container
    title Container Diagram
    Person(user, "User")
    Container(web, "Web App", "React")
    Container(api, "API", "Node.js")
    ContainerDb(db, "Database", "PostgreSQL")
    Rel(user, web, "Uses")
    Rel(web, api, "Calls")
    Rel(api, db, "Reads/Writes")`,
    prefix: 'C4Container',
  },

  gantt: {
    systemPrompt: `Generate a Mermaid Gantt chart.
- Start with: gantt
- Use title for chart title
- Use dateFormat YYYY-MM-DD
- Use section for grouping tasks
- Task format: Task name :id, start, duration`,
    example: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Research      :a1, 2024-01-01, 7d
    Design        :a2, after a1, 5d
    section Phase 2
    Development   :b1, after a2, 14d
    Testing       :b2, after b1, 7d`,
    prefix: 'gantt',
  },

  classDiagram: {
    systemPrompt: `Generate a Mermaid class diagram.
- Start with: classDiagram
- Class definition: class ClassName
- Attributes: +publicAttr, -privateAttr, #protectedAttr
- Methods: +method(), -method()
- Relationships: <|-- inheritance, *-- composition, o-- aggregation`,
    example: `classDiagram
    class Animal {
      +String name
      +int age
      +makeSound()
    }
    class Dog {
      +String breed
      +bark()
    }
    Animal <|-- Dog`,
    prefix: 'classDiagram',
  },

  stateDiagram: {
    systemPrompt: `Generate a Mermaid state diagram.
- Start with: stateDiagram-v2
- Use [*] for start/end states
- Use --> for transitions
- Use state "name" as alias for named states`,
    example: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Start
    Processing --> Success: Complete
    Processing --> Error: Fail
    Success --> [*]
    Error --> Idle: Retry`,
    prefix: 'stateDiagram-v2',
  },

  erDiagram: {
    systemPrompt: `Generate a Mermaid ER diagram.
- Start with: erDiagram
- Entity: ENTITY_NAME
- Relationships: ||--o{ one-to-many, ||--|| one-to-one
- Attributes inside entity block`,
    example: `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    USER {
      int id PK
      string name
      string email
    }
    ORDER {
      int id PK
      date created
    }`,
    prefix: 'erDiagram',
  },

  pie: {
    systemPrompt: `Generate a Mermaid pie chart.
- Start with: pie
- Use title for chart title
- Format: "Label" : value`,
    example: `pie
    title Distribution
    "Category A" : 45
    "Category B" : 30
    "Category C" : 25`,
    prefix: 'pie',
  },

  journey: {
    systemPrompt: `Generate a Mermaid user journey diagram.
- Start with: journey
- Use title for journey title
- Use section for phases
- Format: Task: score: actors`,
    example: `journey
    title User Purchase Journey
    section Discovery
      Visit website: 5: User
      Browse products: 4: User
    section Purchase
      Add to cart: 5: User
      Checkout: 3: User, System
      Payment: 4: User, Payment Gateway`,
    prefix: 'journey',
  },
};

// ===== Helper Functions =====

/**
 * Build the full prompt for diagram generation
 */
export function buildGenerationPrompt(
  diagramType: MermaidDiagramType,
  description: string,
  direction?: FlowDirection,
  title?: string
): { system: string; user: string } {
  const template = DIAGRAM_TEMPLATES[diagramType];

  let systemPrompt = MERMAID_SYSTEM_PROMPT + '\n\n' + template.systemPrompt;

  // Add direction for flowcharts
  if (diagramType === 'flowchart' && direction) {
    systemPrompt = systemPrompt.replace('{DIRECTION}', direction);
  } else if (diagramType === 'flowchart') {
    systemPrompt = systemPrompt.replace('{DIRECTION}', 'TD');
  }

  const userPrompt = `Generate a ${diagramType} diagram for:
${description}
${title ? `\nTitle: ${title}` : ''}

Example of valid ${diagramType} syntax:
${template.example}

Now generate the diagram. Output ONLY the Mermaid code:`;

  return { system: systemPrompt, user: userPrompt };
}

/**
 * Map user keywords to diagram types
 */
export const KEYWORD_TO_DIAGRAM_TYPE: Record<string, MermaidDiagramType> = {
  // Flowchart variations
  flowchart: 'flowchart',
  'process flow': 'flowchart',
  workflow: 'flowchart',
  'process diagram': 'flowchart',
  'flow diagram': 'flowchart',

  // Sequence
  'sequence diagram': 'sequence',
  sequence: 'sequence',
  'interaction diagram': 'sequence',

  // Mindmap
  mindmap: 'mindmap',
  'mind map': 'mindmap',
  brainstorm: 'mindmap',

  // Architecture
  'c4 diagram': 'c4-context',
  'c4 context': 'c4-context',
  'c4 container': 'c4-container',
  'architecture diagram': 'c4-context',
  'system diagram': 'c4-context',

  // Gantt
  gantt: 'gantt',
  'gantt chart': 'gantt',
  timeline: 'gantt',
  schedule: 'gantt',
  'project timeline': 'gantt',

  // Class
  'class diagram': 'classDiagram',
  'uml class': 'classDiagram',

  // State
  'state diagram': 'stateDiagram',
  'state machine': 'stateDiagram',

  // ER
  'er diagram': 'erDiagram',
  'entity relationship': 'erDiagram',
  'database diagram': 'erDiagram',

  // Pie
  'pie chart': 'pie',
  pie: 'pie',

  // Journey
  'user journey': 'journey',
  'journey map': 'journey',
  'customer journey': 'journey',
};
