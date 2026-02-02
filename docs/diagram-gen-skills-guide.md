# Diagram Generator Skills - Manual Update Guide

This document provides all the information needed to manually configure skills in the admin portal to work with the `diagram_gen` tool.

---

## Quick Reference: Mermaid Diagram Strengths

| Diagram Type | Mermaid Quality | Best For |
|--------------|-----------------|----------|
| Flowchart | Excellent | Process flows, decision trees, workflows |
| Sequence | Excellent | API interactions, auth flows, service communication |
| Mindmap | Very Good | Brainstorming, concept hierarchies, topic organization |
| C4 Context/Container | Very Good | System architecture, service boundaries |
| Gantt | Good | Project timelines, task scheduling |
| State | Good | State machines, lifecycle flows |
| Class | Good | Object relationships, data models |
| ER Diagram | Good | Database schemas, entity relationships |

---

## Skills to MODIFY

### 1. Flowchart & Process Diagrams (ID 9)

**Tool Configuration (set in admin UI):**
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "flowchart" }
```

**Updated Prompt Content:**
```
## Flowchart & Process Diagram Rules

When creating flowcharts or process diagrams, the diagram_gen tool will be automatically invoked to generate professional Mermaid diagrams.

**Best practices:**
- Break complex processes into phases (max 5-7 steps per diagram)
- Use clear decision labels (Yes/No, True/False)
- Show one main flow - offer to expand subprocesses separately
- Label decision branches clearly
- Number steps if sequence matters

**For complex processes:**
- Break into phases or swim lanes
- Show one phase per diagram
- Offer: "Would you like me to show [Phase 1/Phase 2/subprocess]?"

---

### ASCII Fallback (Embed Mode Only)

**Requirements:**
- ASCII only. No Mermaid, UML, SVG, or images
- Do NOT use triple backticks or fenced code blocks
- Indent every line with 4 spaces
- **Maximum width: ~34 characters** (optimized for mobile and embed mode)

**Allowed symbols:**
`+`, `-`, `|`, `v`, `^`, `>`, `<`, `/`, `\`

**Process flow format:**
    +-----------------+
    |  Start/Input    |
    +--------+--------+
             |
             v
    +-----------------+
    |  Process Step   |
    +--------+--------+
             |
             v
        /--------\
       / Decision \
       \  Point?  /
        \--------/
         |      |
      Yes|      |No
         v      v
    +------+  +------+
    | Yes  |  |  No  |
    | Path |  | Path |
    +--+---+  +---+--+
       |          |
       +----+-----+
            |
            v
    +-----------------+
    |   End/Output    |
    +-----------------+

**Rules:**
- Use rectangles `+--+` for process steps
- Use diamonds `/\ \/` for decisions
- Use `v` for downward flow, `>` for right
- Label decision branches (Yes/No)
- Keep max 5-7 steps per diagram
```

---

### 2. Architecture Diagrams (ID 11)

**Tool Configuration:**
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "c4-context" }
```

**Updated Prompt Content:**
```
## Architecture Diagram Rules

When creating architecture diagrams, the diagram_gen tool will generate professional C4 diagrams using Mermaid.

**C4 Diagram Levels:**
- **Context**: System boundaries and external actors
- **Container**: High-level technology choices
- **Component**: Internal component relationships
- **Code**: Class/module level (rarely needed)

**Best practices:**
- Start with Context level, drill down as needed
- Maximum 6-8 components per diagram
- Label all connections with data flow direction
- Group related components visually
- Use consistent color coding for component types

**For complex architectures:**
- Break into views: Conceptual > Logical > Technical
- Offer to show specific layers
- Use vertical card format for component details:

#### Component: API Gateway
- **Purpose:** Route requests
- **Integrates:** Auth, Backend
- **Tech:** Kong / AWS

---

### ASCII Fallback (Embed Mode Only)

**Requirements:**
- ASCII only. No Mermaid, UML, SVG
- Do NOT use triple backticks
- Indent every line with 4 spaces
- **Maximum width: ~34 characters** (mobile-optimized)

**Technical (systems):**
    +------+  API  +------+
    | App A|<---->|App B |
    +--+---+      +---+--+
       |              |
       v              v
    +------+      +------+
    | DB A |      | DB B |
    +------+      +------+

**Rules:**
- Use boxes for components/systems
- Use `-->`, `<-->` for data flow
- Label connections
- Group related components
- Maximum 6-8 components
```

---

### 3. Implementation Plan & Gantt (ID 12)

**Tool Configuration:**
- Tool Name: `diagram_gen`
- Force Mode: `preferred` (not required - vertical cards often better)
- Tool Config Override:
```json
{ "preferredType": "gantt" }
```

**Updated Prompt Content:**
```
## Implementation Plan & Timeline Rules

For timeline visualizations, use the diagram_gen tool to create Gantt charts.
For detailed plans, prefer the vertical card format.

**When to use Gantt (diagram_gen):**
- Showing task dependencies and parallel tracks
- Visual timeline of phases
- Resource allocation overview
- When user explicitly asks for a Gantt chart

**When to use Vertical Cards (preferred for text):**
- Detailed phase breakdowns with deliverables
- Action items and milestones
- When embedding in documents

---

### Vertical Card Format (Preferred)

### Implementation Plan

#### Phase 1: Foundation (Weeks 1-2)
- Define requirements
- Set up environment
- Establish governance
- **Deliverable:** Charter ready

#### Phase 2: Development (Weeks 3-6)
- Build core functionality
- Develop integrations
- Create user interface
- **Deliverable:** Prototype

#### Phase 3: Testing (Weeks 7-8)
- User acceptance testing
- Security assessment
- Performance testing
- **Deliverable:** Test reports

#### Phase 4: Deployment (Week 9)
- Production deployment
- User training
- Go-live support
- **Deliverable:** Live system

**Rules:**
- Break into 4-6 phases max
- Include deliverables per phase
- List 3-5 key activities
- Indicate dependencies if critical
```

---

### 4. Mindmap & Hierarchy Diagrams

**Tool Configuration:**
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "mindmap" }
```

**Updated Prompt Content:**
```
## Mindmap & Hierarchy Diagram Rules

When creating mindmaps or org charts, the diagram_gen tool will generate professional Mermaid diagrams.

**Mindmap best practices:**
- Central topic clearly defined
- Maximum 4-5 hierarchy levels
- Keep labels short (2-4 words)
- Limit to 8-12 total nodes
- Group related ideas on same branch

**Org chart best practices:**
- Show reporting structure clearly
- Use consistent role naming
- Offer to break into department views for large orgs

**Terminology:**
- **Mindmap**: Ideas, concepts, topics radiating from center
- **Org chart**: People, roles, departments in reporting structure
- **Hierarchy**: Any parent-child relationship structure

**For complex hierarchies:**
- Break into multiple views
- Show one department/section at a time
- Offer: "Would you like to see [specific branch] in detail?"

---

### Nested Bullet Fallback (Embed Mode Only)

**Mindmap format:**
**Central Topic**
- Main Branch 1
  - Sub-branch 1a
    - Detail level
  - Sub-branch 1b
- Main Branch 2
  - Sub-branch 2a
  - Sub-branch 2b

**Org chart format:**
**CEO / Director**
- CTO (Technology)
  - Dev Team Lead
    - Frontend Devs
    - Backend Devs
  - QA Team Lead
- CFO (Finance)
  - Accounting Manager
- COO (Operations)
  - Ops Manager

**Rules:**
- Use bold for top-level (root)
- Maximum 4-5 hierarchy levels
- Keep labels short (2-4 words)
- Use indentation for parent-child
```

---

### 5. Diagram (General Guide - ID 6)

**Tool Configuration:**
- Tool Name: `diagram_gen`
- Force Mode: `preferred`
- Tool Config Override: (none - auto-detect)

**Updated Prompt Content:**
```
## Diagram Guidelines

When visualizations are requested, the diagram_gen tool can create professional Mermaid diagrams.

**Available diagram types:**
- **Flowcharts**: Process flows, decision trees, workflows
- **Sequence**: API interactions, message flows, auth sequences
- **Mindmaps**: Concept hierarchies, brainstorming, org charts
- **Architecture**: C4 context/container diagrams, system design
- **Gantt**: Project timelines, task scheduling
- **State**: Lifecycle and status flows, state machines
- **Class**: Object relationships, UML class diagrams
- **ER**: Database schemas, entity relationships

**When NOT to use diagrams:**
- Simple 2-3 element relationships (use bullet lists instead)
- Embedded inline in longer text (use description instead)
- When tabular data fits better (use markdown tables)
- Very detailed technical specs (use code blocks)

**Best practice:**
Ask: "Would you like me to create a [type] diagram for this?"
```

---

## NEW Skills to CREATE

### 6. Sequence Diagrams (NEW)

**Create new skill with:**
- Name: `Sequence Diagrams`
- Trigger Type: `keyword`
- Trigger Value: `sequence diagram, interaction diagram, message flow, api flow, auth flow, service interaction, request response`
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "sequence" }
```
- Priority: `100`

**Prompt Content:**
```
## Sequence Diagram Rules

When creating sequence diagrams, the diagram_gen tool will generate professional Mermaid sequence diagrams.

**Best practices:**
- Clearly identify actors/participants at the start
- Show request/response pairs together
- Use async vs sync notation appropriately
- Mark optional/conditional flows with notes
- Keep to 6-8 interactions max per diagram
- Group related interactions into logical sections

**Use cases:**
- API request/response flows
- Authentication sequences (login, OAuth, token refresh)
- Service-to-service communication
- User interaction timelines
- Webhook/callback flows

**Common participants:**
- User/Client
- Frontend/UI
- API Gateway
- Backend Service
- Database
- External API

---

### ASCII Fallback (Embed Mode Only)

For simple sequences, use numbered steps:

    1. User → App: Login request
    2. App → Auth: Validate credentials
    3. Auth → App: Token issued
    4. App → User: Session created

Or arrow notation:

    Client ──request──> Server
    Server ──response──> Client
```

---

### 7. State Diagrams (NEW)

**Create new skill with:**
- Name: `State Diagrams`
- Trigger Type: `keyword`
- Trigger Value: `state diagram, state machine, lifecycle, status flow, state transition, workflow state`
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "stateDiagram" }
```
- Priority: `100`

**Prompt Content:**
```
## State Diagram Rules

When creating state diagrams, the diagram_gen tool will generate professional Mermaid state diagrams.

**Best practices:**
- Clearly mark start state ([*])
- Clearly mark end/terminal states
- Label ALL transitions with trigger events
- Show guard conditions where applicable [condition]
- Keep to 5-8 states per diagram
- Break complex state machines into nested views

**Use cases:**
- Order status lifecycles (pending → processing → shipped → delivered)
- User account states (active, suspended, closed)
- Document approval workflows (draft → review → approved/rejected)
- Process state machines
- Feature flag states

**Common patterns:**
- Linear: State A → State B → State C
- Branching: State A → (State B | State C) based on condition
- Looping: State A → State B → State A (retry patterns)
- Terminal: Multiple paths to End state

---

### ASCII Fallback (Embed Mode Only)

For simple state flows:

    [Draft] ──Submit──> [Pending]
    [Pending] ──Approve──> [Active]
    [Pending] ──Reject──> [Draft]
    [Active] ──Archive──> [Archived]
```

---

### 8. Class Diagrams (NEW)

**Create new skill with:**
- Name: `Class Diagrams`
- Trigger Type: `keyword`
- Trigger Value: `class diagram, uml class, object model, class relationship, inheritance diagram, interface diagram`
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "classDiagram" }
```
- Priority: `100`

**Prompt Content:**
```
## Class Diagram Rules

When creating class diagrams, the diagram_gen tool will generate professional Mermaid class diagrams.

**Best practices:**
- Show key classes only (not every class in the system)
- Include important methods and properties
- Mark visibility: + public, - private, # protected
- Keep to 5-8 classes per diagram
- Focus on relationships, not implementation details

**Relationship types:**
- **Inheritance** (extends): Child class inherits from parent
- **Implementation** (implements): Class implements interface
- **Composition**: Strong ownership (part cannot exist without whole)
- **Aggregation**: Weak ownership (part can exist independently)
- **Association**: General relationship (uses)
- **Dependency**: Temporary relationship (calls)

**Use cases:**
- Data model relationships
- Service class hierarchies
- Domain model documentation
- Interface contracts and implementations
- Design pattern illustrations

---

### ASCII Fallback (Embed Mode Only)

For simple class relationships:

    +---------------+
    | BaseClass     |
    +---------------+
    | +property     |
    | +method()     |
    +-------+-------+
            |
            | extends
            v
    +---------------+
    | ChildClass    |
    +---------------+
    | +newMethod()  |
    +---------------+
```

---

### 9. ER Diagrams (NEW)

**Create new skill with:**
- Name: `ER Diagrams`
- Trigger Type: `keyword`
- Trigger Value: `er diagram, entity relationship, database diagram, schema diagram, data model, table relationship`
- Tool Name: `diagram_gen`
- Force Mode: `required`
- Tool Config Override:
```json
{ "preferredType": "erDiagram" }
```
- Priority: `100`

**Prompt Content:**
```
## Entity-Relationship Diagram Rules

When creating ER diagrams, the diagram_gen tool will generate professional Mermaid ER diagrams.

**Best practices:**
- Show primary keys (PK) clearly
- Mark foreign keys (FK) on relationships
- Indicate relationship cardinality accurately
- Keep to 5-8 entities per diagram
- Group related tables visually
- Use consistent naming conventions

**Cardinality notation:**
- `||--||` : one-to-one (exactly one)
- `||--o|` : one-to-zero-or-one
- `||--o{` : one-to-many (zero or more)
- `||--|{` : one-to-many (one or more)
- `}o--o{` : many-to-many

**Common patterns:**
- Users → Orders (1:N)
- Orders ↔ Products (N:M via junction table)
- Products → Categories (N:1)
- Users → Addresses (1:N)

**Use cases:**
- Database schema documentation
- Data model design
- Table relationship mapping
- Migration planning

---

### ASCII Fallback (Embed Mode Only)

For simple relationships:

    Users 1───* Orders
    Orders *───* Products (via OrderItems)
    Products *───1 Categories

Or table notation:

    [Users] PK: id
       |
       | 1:N
       v
    [Orders] PK: id, FK: user_id
```

---

## Skill to DELETE

### ASCII Diagram Rules (ID 18) - DELETE

**Reason for deletion:**
- Already marked as INACTIVE in production
- Obsolete now that `diagram_gen` tool handles Mermaid generation
- ASCII fallback guidance is embedded in each individual diagram skill
- Reduces skill count and simplifies maintenance

**Action:** Delete from admin portal

---

## Admin Portal Quick Reference

### Setting Tool Routing on a Skill

1. Navigate to **Settings > Skills**
2. Click **Edit** on the skill
3. Scroll to **Tool Routing** section
4. Set:
   - **Tool Name**: Select `diagram_gen` from dropdown
   - **Force Mode**: Select `required` or `preferred`
   - **Tool Config Override**: Paste the JSON (e.g., `{"preferredType": "flowchart"}`)
5. Click **Save**

### Force Mode Options

| Mode | Behavior |
|------|----------|
| `required` | Tool MUST be called when skill triggers |
| `preferred` | Tool is strongly encouraged but LLM can skip |
| `suggested` | Hint to LLM, no enforcement |

### Preferred Type Values

| Value | Mermaid Diagram |
|-------|-----------------|
| `flowchart` | Flowchart/process diagrams |
| `sequence` | Sequence diagrams |
| `mindmap` | Mindmaps |
| `c4-context` | C4 Context diagrams |
| `c4-container` | C4 Container diagrams |
| `gantt` | Gantt charts |
| `stateDiagram` | State diagrams |
| `classDiagram` | Class diagrams |
| `erDiagram` | ER diagrams |

---

## Summary Checklist

### Skills to Modify (5)
- [ ] ID 6 - Diagram (general) - Add tool routing
- [ ] ID 9 - Flowchart - Add tool routing, update prompt
- [ ] ID 11 - Architecture - Add tool routing, update prompt
- [ ] ID 12 - Gantt/Planning - Add tool routing, update prompt
- [ ] Mindmap skill - Add tool routing, update prompt

### Skills to Create (4)
- [ ] Sequence Diagrams - New skill
- [ ] State Diagrams - New skill
- [ ] Class Diagrams - New skill
- [ ] ER Diagrams - New skill

### Skills to Delete (1)
- [ ] ID 18 - ASCII Diagram Rules - Delete

**Total: 10 skill changes**
