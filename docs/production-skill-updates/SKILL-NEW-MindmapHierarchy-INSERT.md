# Production Skill Insert: NEW - "Mindmap & Hierarchy Diagrams"

## Action: CREATE new skill

## Metadata:
- **Name:** Mindmap & Hierarchy Diagrams
- **Description:** Rules for creating mindmaps, org charts, and hierarchical structures
- **Trigger Type:** keyword
- **Trigger Keywords:** `mindmap,mind map,org chart,organization chart,organizational chart,hierarchy,hierarchical,organizational structure,company structure,reporting structure,tree diagram`
- **Priority:** 17
- **Is Active:** true
- **Is Core:** true
- **Category Restricted:** false
- **Is Index:** false

---

## Prompt Content:

## Mindmap & Hierarchy Diagram Rules

**Mode Detection:**
- Standalone mode + Mermaid enabled: Use Mermaid mindmap syntax (preferred)
- Embed mode OR Mermaid disabled: Use nested bullet list format

---

### Mermaid Mindmap Format (Standalone Mode Only, if enabled)

Use Mermaid mindmap syntax for interactive hierarchical visualization:

````mermaid
mindmap
  root((Central Topic))
    Branch 1
      Sub-branch 1a
      Sub-branch 1b
    Branch 2
      Sub-branch 2a
        Detail 2a1
        Detail 2a2
      Sub-branch 2b
    Branch 3
````

**Mermaid mindmap syntax tips:**
- `root((text))` for central node (double parentheses)
- Indentation defines hierarchy levels
- Use `[Square]` for square nodes, `(Round)` for rounded
- Keep node text concise (2-5 words)

**For org charts (organizational hierarchy):**
````mermaid
graph TD
    CEO[CEO/Director]
    CEO --> CTO[CTO]
    CEO --> CFO[CFO]
    CEO --> COO[COO]
    CTO --> Dev[Dev Team]
    CTO --> QA[QA Team]
    CFO --> Acct[Accounting]
    COO --> Ops[Operations]
````

---

### Nested Bullet List Format (Embed Mode or Fallback)

**Requirements:**
- ASCII only. No Mermaid, images, or graphical tools
- Do NOT use triple backticks or fenced code blocks
- **Maximum width: ~34 characters** (mobile-optimized)
- Use standard markdown bullet syntax

**Mindmap format:**
**Central Topic**
- Main Branch 1
  - Sub-branch 1a
    - Detail level
  - Sub-branch 1b
- Main Branch 2
  - Sub-branch 2a
  - Sub-branch 2b
    - Detail A
    - Detail B
- Main Branch 3
  - Sub-branch 3a

**Org chart format:**
**Organization Structure**

**CEO / Director**
- CTO (Technology)
  - Dev Team Lead
    - Frontend Devs
    - Backend Devs
  - QA Team Lead
    - QA Engineers
- CFO (Finance)
  - Accounting Manager
  - Budget Analyst
- COO (Operations)
  - Ops Manager
  - Support Team

**Rules:**
- Use bold for top-level (root)
- Maximum 4-5 hierarchy levels
- Keep labels short (2-4 words)
- Use indentation for parent-child
- Limit to 8-12 total nodes
- Group related items together

**For complex hierarchies:**
- Break into multiple views
- Show one department/section at a time
- Offer: "Would you like to see [specific branch] in detail?"

**Terminology:**
- **Mindmap**: Ideas, concepts, topics radiating from center
- **Org chart**: People, roles, departments in reporting structure
- **Hierarchy**: Any parent-child relationship structure
