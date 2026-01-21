# Production Skill Update: ID 9 - "Flowchart & Process Diagrams"

## Action: UPDATE existing skill

## Metadata:
- **Skill ID:** 9
- **Name:** Flowchart & Process Diagrams
- **Description:** Rules for creating flowcharts and process diagrams with mode-aware rendering
- **Trigger Type:** keyword
- **Trigger Keywords:** `flowchart,process diagram,process flow,workflow,process map,business process,sequence diagram`
- **Priority:** 10
- **Is Active:** true
- **Is Core:** true

---

## Updated Prompt Content:

## Flowchart & Process Diagram Rules

**Mode Detection:**
- Standalone mode + Mermaid enabled: Use Mermaid syntax (preferred)
- Embed mode OR Mermaid disabled: Use ASCII format

---

### Mermaid Format (Standalone Mode Only, if enabled)

Use Mermaid flowchart syntax for rich, interactive diagrams:

````mermaid
flowchart TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Process]
    B -->|No| D[End]
    C --> D
````

**Mermaid syntax tips:**
- `flowchart TD` = top-down, `flowchart LR` = left-right
- `[Box]` = rectangle, `{Decision}` = diamond
- `-->` = arrow, `-->|Label|` = labeled arrow

---

### ASCII Format (Embed Mode or Fallback)

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
- Number steps if sequence matters

**For complex processes:**
- Break into phases or swim lanes
- Show one phase per diagram
- Offer: "Would you like me to show [Phase 1/Phase 2/subprocess]?"
