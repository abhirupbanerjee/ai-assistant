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
7. For sequence diagrams: never use activate/deactivate inside alt/else/opt/loop/par blocks — place deactivate after the end keyword instead
8. Do NOT add semicolons at the end of lines — Mermaid does not use semicolons
9. Never use "end" as a bare node ID in flowcharts — use "finish", "complete", or "done" instead
10. Do NOT write "title <text>" as a statement inside the diagram body — it is invalid syntax
11. In flowcharts, never start a node ID with lowercase "o" or "x" — they are misread as edge markers; capitalise them (e.g. "OAuth" not "oAuth", "XmlParser" not "xmlParser")

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
- Use --> for arrows, -->|Label| for labeled arrows — NEVER use single -> (invalid in Mermaid)
- Keep max 12-15 nodes
- If a label contains a URL path or forward slash, wrap it in quotes: ["/api/users"] not [/api/users]`,
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
- Use activate/deactivate for lifelines in the main linear flow only — NOT inside alt/else/opt/loop/par blocks
- If a participant is activated before an alt/else block, place its deactivate after the end keyword
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
- Internal elements: Person(alias, "Name", "Desc"), System(alias, "Name", "Desc"), SystemDb(alias, "Name", "Desc")
- External elements use underscore suffix: System_Ext(alias, "Name", "Desc"), SystemDb_Ext(alias, "Name", "Desc"), Person_Ext(alias, "Name", "Desc")
  CRITICAL: NEVER use camelCase — SystemExt, PersonExt are INVALID; always use System_Ext, Person_Ext
- Boundaries: System_Boundary(id, "label") { ... } or Enterprise_Boundary(id, "label") { ... }
- Relationships: Rel(from, to, "label") or BiRel(from, to, "label") for bidirectional`,
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
- People: Person(alias, "Name", "Desc"), Person_Ext(alias, "Name", "Desc") for external users
- Containers: Container(alias, "Name", "Tech", "Desc"), ContainerDb(alias, "Name", "Tech", "Desc"), ContainerQueue(alias, "Name", "Tech", "Desc")
- External systems: System_Ext(alias, "Name", "Desc"), SystemDb_Ext(alias, "Name", "Desc")
  CRITICAL: NEVER use camelCase — SystemExt, ContainerExt, PersonExt, ContainerBoundary are all INVALID
  Always use underscore variants: System_Ext, Container_Ext, Person_Ext, Container_Boundary
- Group containers with: Container_Boundary(id, "label") { ... } — NEVER ContainerBoundary
- Relationships: Rel(from, to, "label") or BiRel(from, to, "label") for bidirectional
- Optional layout: UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`,
    example: `C4Container
    title T-Bills Portal
    Person(user, "User", "Portal user")
    System_Ext(oauth, "OAuth", "Identity provider")
    Container_Boundary(portal, "Portal") {
        Container(web, "Web App", "Next.js", "Frontend and API")
        ContainerDb(db, "Database", "PostgreSQL", "Stores data")
    }
    Rel(user, web, "Uses", "HTTPS")
    Rel(web, db, "Reads/Writes")
    Rel(web, oauth, "Authenticates via")`,
    prefix: 'C4Container',
  },

  gantt: {
    systemPrompt: `Generate a Mermaid Gantt chart.
- Start with: gantt
- Use title for chart title
- Use dateFormat YYYY-MM-DD (default; change only if needed)
- Use section for grouping tasks — every task must be inside a section
- Task format: Task name :id, start, duration
- Valid duration units: d (days), w (weeks), h (hours), m (minutes)
- Valid task modifiers (must come first if used): done, active, crit, milestone — NEVER use "critical"
- Do NOT include colons inside task names — the first colon in a line is the separator
- Use "after taskId" for sequential dependencies: :t2, after t1, 3d`,
    example: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Research      :a1, 2024-01-01, 7d
    Design        :a2, after a1, 5d
    section Phase 2
    Development   :crit, b1, after a2, 14d
    Testing       :b2, after b1, 7d`,
    prefix: 'gantt',
  },

  classDiagram: {
    systemPrompt: `Generate a Mermaid class diagram.
- Start with: classDiagram
- Class definition: class ClassName { }
- Attributes: +publicAttr : Type, -privateAttr : Type, #protectedAttr : Type
- Methods: +method() ReturnType (space before return type, NO colon)
- Relationships: <|-- inheritance, *-- composition, o-- aggregation, --> association
- Annotations go INSIDE the class body on their own line: <<interface>>, <<abstract>>, <<service>>
- Do NOT write annotations inline on the class definition line (e.g. "class Foo <<interface>>" is invalid)
- Do NOT use nested namespaces
- Avoid generic type parameters in relationship lines — use the plain class name`,
    example: `classDiagram
    class Animal {
      <<abstract>>
      +String name
      +int age
      +makeSound() void
    }
    class Dog {
      +String breed
      +bark() void
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
- Entity names: UPPERCASE, no spaces (use _ instead), no dots, no reserved words (ONE, MANY, TO, U)
- Relationships require a label: ENTITY_A ||--o{ ENTITY_B : "label"
- Cardinality notation: ||--|| (one-to-one), ||--o{ (one-to-many), o{--o{ (many-to-many), ||--|{ (one-to-one-or-more)
- Attributes go inside entity blocks: TYPE name, TYPE name PK, TYPE name FK
- One attribute per line — no semicolons, no %% comments inside entity blocks`,
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
- Use title for journey title (required)
- Use lowercase "section" (not "Section") for phases — no colon after section name
- Task format: Task name: score: Actor1, Actor2
- Score must be an integer from 1 to 5 (1 = very negative, 5 = very positive)
- Multiple actors are comma-separated after the second colon
- All tasks must be inside a section
- Do NOT use angle brackets or special characters in task or actor names`,
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

  timeline: {
    systemPrompt: `Generate a Mermaid timeline diagram.
- Start with: timeline
- Use title for chart title (optional)
- Use section to group time periods under a heading
- Each time period: Period : Event description
- Multiple events on the same period: add ": Event" on the same or continuation line
- No arrows, no IDs — pure text structure
- Do NOT use Gantt syntax here — timeline is a separate diagram type`,
    example: `timeline
    title Project Phases
    section Planning
        Jan 2024 : Requirements gathering
                 : Stakeholder review
    section Delivery
        Feb 2024 : Design
        Mar 2024 : Development
        Apr 2024 : Testing : Deployment`,
    prefix: 'timeline',
  },

  block: {
    systemPrompt: `Generate a Mermaid block diagram.
- Start with: block-beta
- Optional: columns N (set grid column count)
- Node shapes: id["label"] rectangle, id("label") round, id{label} diamond, id[(label)] cylinder
- Span columns: id["label"]:N for multi-column width
- Empty cells: space or space:N
- Links: A --> B or A -->|label| B (same syntax as flowchart)
- Nested composite blocks: block:id ... end
- No automatic layout — left-to-right column order determines position`,
    example: `block-beta
    columns 3
    A["Frontend"]:1
    B["API Gateway"]:1
    C["Backend"]:1
    D["Database"]:1
    space:2
    E["Cache"]:1
    A --> B
    B --> C
    C --> D
    C --> E`,
    prefix: 'block-beta',
  },

  quadrant: {
    systemPrompt: `Generate a Mermaid quadrant chart.
- Start with: quadrantChart
- title: chart title (optional but recommended)
- Axes: x-axis LeftLabel --> RightLabel
        y-axis BottomLabel --> TopLabel
- Quadrant labels: quadrant-1 TopRight, quadrant-2 TopLeft, quadrant-3 BottomLeft, quadrant-4 BottomRight
- Points: PointName: [x, y] — x and y MUST be decimal values strictly between 0 and 1 (e.g. 0.25, 0.75)
- Never use values outside 0–1 range`,
    example: `quadrantChart
    title Feature Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Value --> High Value
    quadrant-1 Quick Wins
    quadrant-2 Major Projects
    quadrant-3 Fill-ins
    quadrant-4 Hard Slogs
    Feature A: [0.2, 0.8]
    Feature B: [0.7, 0.9]
    Feature C: [0.3, 0.3]
    Feature D: [0.8, 0.4]`,
    prefix: 'quadrantChart',
  },

  architecture: {
    systemPrompt: `Generate a Mermaid architecture diagram (beta feature).
- Start with: architecture-beta
- Services: service id(icon)[Label] — valid icons: cloud, database, disk, internet, server
- Groups: group id(icon)[Label]
- Nest a service/group inside a group: add "in parentGroupId" after the definition
- Junctions (for multi-way connections): junction id
- Edges: id:Direction -- Direction:id  (ALWAYS use -- double dash, NEVER -->)
  Directions: T (top), B (bottom), L (left), R (right)
  Labeled edge: id:Direction -[Label]- Direction:id
STRICT LABEL RULES — labels inside [...] may ONLY contain letters, numbers, underscores, and spaces.
  NO dots, NO apostrophes, NO hyphens, NO slashes, NO special characters.
  Write "NextJS 16" not "Next.js 16"; write "Lets Encrypt" not "Let's Encrypt"
STRICT ID RULES — IDs may ONLY contain letters, numbers, underscores, and hyphens. NO dots.`,
    example: `architecture-beta
    group api(cloud)[API Layer]
    service web(server)[Web Server] in api
    service db(database)[Database] in api
    service cache(disk)[Cache] in api
    web:R -- L:db
    web:B -- T:cache`,
    prefix: 'architecture-beta',
  },

  'c4-component': {
    systemPrompt: `Generate a Mermaid C4 Component diagram (experimental — syntax may change).
- Start with: C4Component
- Internal components: Component(alias, "Name", "Tech", "Desc"), ComponentDb(...), ComponentQueue(...)
- External (underscore suffix): Component_Ext(alias, "Name", "Tech", "Desc"), ComponentDb_Ext(...)
  CRITICAL: NEVER use camelCase — ComponentExt is INVALID; always use Component_Ext
- Boundaries: Container_Boundary(id, "label") { ... }
- Relationships: Rel(from, to, "label") or BiRel(from, to, "label") for bidirectional`,
    example: `C4Component
    title Component Diagram
    Container_Boundary(api, "API Container") {
        Component(auth, "Auth Service", "Node.js", "Handles auth")
        Component(orders, "Order Service", "Node.js", "Manages orders")
        ComponentDb(db, "Database", "PostgreSQL", "Stores data")
    }
    Rel(auth, db, "Reads/Writes")
    Rel(orders, db, "Reads/Writes")`,
    prefix: 'C4Component',
  },

  'c4-dynamic': {
    systemPrompt: `Generate a Mermaid C4 Dynamic diagram (experimental — syntax may change).
- Start with: C4Dynamic
- Shows runtime message flow with numbered steps
- Same container/person elements as C4Container
- Numbered relationships: RelIndex("1", from, to, "label")
- Regular Rel(from, to, "label") also supported
- Use title for diagram title`,
    example: `C4Dynamic
    title Dynamic: Login Flow
    Person(user, "User")
    Container(web, "Web App", "Next.js")
    Container(auth, "Auth Service", "Node.js")
    ContainerDb(db, "Database", "PostgreSQL")
    RelIndex("1", user, web, "Submit credentials")
    RelIndex("2", web, auth, "Validate token")
    RelIndex("3", auth, db, "Lookup user")
    RelIndex("4", db, auth, "User record")
    RelIndex("5", auth, web, "Token issued")
    RelIndex("6", web, user, "Login success")`,
    prefix: 'C4Dynamic',
  },

  'c4-deployment': {
    systemPrompt: `Generate a Mermaid C4 Deployment diagram (experimental — syntax may change).
- Start with: C4Deployment
- Deployment nodes: Deployment_Node(alias, "Name", "Type", "Desc")
  Alias: Node() also accepted; Node_L() and Node_R() for layout hints
- Software elements inside nodes: Container(alias, "Name", "Tech", "Desc"), ContainerDb(...)
- Nest elements with: Deployment_Node(inner, "Name") { ... }
- Boundaries and Rel(from, to, "label") same as C4Container
- Use title for diagram title`,
    example: `C4Deployment
    title Deployment Diagram
    Deployment_Node(cloud, "AWS", "Cloud") {
        Deployment_Node(vpc, "VPC", "Network") {
            Container(web, "Web App", "EC2", "Frontend")
            ContainerDb(db, "Database", "RDS PostgreSQL", "Data store")
        }
    }
    Rel(web, db, "Reads/Writes", "TCP/5432")`,
    prefix: 'C4Deployment',
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
  'c4 component': 'c4-component',
  'c4 dynamic': 'c4-dynamic',
  'c4 deployment': 'c4-deployment',
  'architecture diagram': 'architecture',
  'infrastructure diagram': 'architecture',
  'system diagram': 'c4-context',

  // Gantt
  gantt: 'gantt',
  'gantt chart': 'gantt',
  schedule: 'gantt',

  // Timeline
  timeline: 'timeline',
  'project timeline': 'timeline',
  'event timeline': 'timeline',

  // Block
  block: 'block',
  'block diagram': 'block',

  // Quadrant
  quadrant: 'quadrant',
  'quadrant chart': 'quadrant',
  'priority matrix': 'quadrant',
  '2x2 matrix': 'quadrant',

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
