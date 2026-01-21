# Production Skill Update: ID 11 - "Architecture Diagrams"

## Action: UPDATE existing skill

## Metadata:
- **Skill ID:** 11
- **Name:** Architecture Diagrams
- **Description:** Rules for conceptual, logical, technical, and implementation architecture diagrams
- **Trigger Type:** keyword
- **Trigger Keywords:** `architecture diagram,conceptual diagram,logical diagram,technical diagram,implementation diagram,system architecture,solution architecture,enterprise architecture,component diagram`
- **Priority:** 12
- **Is Active:** true
- **Is Core:** true

---

## Updated Prompt Content:

## Architecture Diagram Rules

**Mode Detection:**
- Standalone mode + Mermaid enabled: Use Mermaid C4 syntax (preferred)
- Embed mode OR Mermaid disabled: Use ASCII format

---

### Mermaid C4 Format (Standalone Mode Only, if enabled)

Use Mermaid C4 diagrams for professional architecture visualization:

**C4 Context Diagram:**
````mermaid
C4Context
    title System Context
    Person(user, "User")
    System(app, "Application")
    System_Ext(ext, "External API")
    Rel(user, app, "Uses")
    Rel(app, ext, "Calls")
````

**C4 Container Diagram:**
````mermaid
C4Container
    title Container Diagram
    Person(user, "User")
    Container(web, "Web App", "React")
    Container(api, "API", "Node.js")
    ContainerDb(db, "Database", "PostgreSQL")
    Rel(user, web, "Uses")
    Rel(web, api, "Calls")
    Rel(api, db, "Reads/Writes")
````

**C4 levels:** Context → Container → Component → Code

---

### ASCII Format (Embed Mode or Fallback)

**Requirements:**
- ASCII only. No Mermaid, UML, SVG
- Do NOT use triple backticks
- Indent every line with 4 spaces
- **Maximum width: ~34 characters** (mobile-optimized)

**Diagram types:**

**Conceptual (high-level):**
    +-------------+
    |   Users     |
    +------+------+
           |
           v
    +-------------+
    |   System    |
    +------+------+
           |
           v
    +-------------+
    |  Outcomes   |
    +-------------+

**Logical (components):**
    +---------------+
    | Presentation  |
    +-------+-------+
            |
            v
    +---------------+
    | Business      |
    | Logic         |
    +-------+-------+
            |
            v
    +---------------+
    | Data Layer    |
    +---------------+

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
- Show layers top-to-bottom

**For complex architectures:**
- Break into views: Conceptual > Logical > Technical
- Offer to show specific layers
- Use vertical card format for details:

#### Component: API Gateway
- **Purpose:** Route requests
- **Integrates:** Auth, Backend
- **Tech:** Kong / AWS
