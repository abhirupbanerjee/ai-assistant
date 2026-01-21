# Production Skill Update: ID 6 - "Diagram"

## Action: UPDATE existing skill

## Metadata:
- **Skill ID:** 6
- **Name:** Diagram Generation
- **Description:** Rules for creating general diagrams with mode-aware rendering
- **Trigger Type:** keyword
- **Trigger Keywords:** `diagram,structure,visualize`
- **Priority:** 10
- **Is Active:** true
- **Is Core:** true

---

## Updated Prompt Content:

Diagram Generation Rules

**Mode Detection:**
- Standalone mode + Mermaid enabled: Use Mermaid syntax (preferred)
- Embed mode OR Mermaid disabled: Use ASCII format

---

### Mermaid Format (Standalone Mode Only, if enabled)

Use Mermaid flowchart syntax for interactive diagrams:

````mermaid
flowchart TD
    A[Start] --> B[Process]
    B --> C{Decision?}
    C -->|Yes| D[Action A]
    C -->|No| E[Action B]
    D --> F[End]
    E --> F
````

**Mermaid syntax tips:**
- `flowchart TD` = top-down, `flowchart LR` = left-right
- `[Box]` = rectangle, `{Decision}` = diamond, `([Rounded])` = stadium
- `-->` = arrow, `-->|Label|` = labeled arrow
- Keep diagrams focused - maximum 12-15 nodes

**For hierarchies and structures:**
````mermaid
flowchart TD
    Root[Central Concept]
    Root --> Branch1[Category 1]
    Root --> Branch2[Category 2]
    Branch1 --> Item1a[Item A]
    Branch1 --> Item1b[Item B]
    Branch2 --> Item2a[Item C]
````

---

### ASCII Format (Embed Mode or Fallback)

**Requirements:**
- ASCII only. No Mermaid, UML, SVG, or images
- Do NOT use triple backticks or fenced code blocks
- Indent every line with 4 spaces
- **Maximum width: ~34 characters** (mobile-optimized)

**Allowed symbols:**
`+`, `-`, `|`, `v`, `^`, `/`, `\`

**Basic structure:**
    +-------------------+
    |  Start/Input      |
    +--------+----------+
             |
             v
    +-------------------+
    |  Process Step     |
    +--------+----------+
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
    +------+  +------+

**Hierarchy structure:**
    +-----------------+
    | Central Concept |
    +--------+--------+
             |
        +----+----+
        |         |
        v         v
    +-------+ +-------+
    | Cat 1 | | Cat 2 |
    +-------+ +-------+

**Rules:**
- Use `+-----+` for borders
- Use `| ... |` for content
- Use single `v` arrow between levels
- Keep max 6-8 boxes per diagram
- Maintain alignment

**If diagram is too complex, respond:**
"This diagram is complex. Would you like me to break it down by [section/category/phase]?"
