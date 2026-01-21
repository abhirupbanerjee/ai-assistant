# Production Skill Delete: ID 18 - "ASCII Diagram Rules"

## Action: DELETE existing skill

## Metadata:
- **Skill ID:** 18
- **Name:** ASCII Diagram Rules
- **Current Trigger Keywords:** `diagram,structure,visualize,hierarchy,org chart,organization chart`

---

## Reason for Deletion:

**Conflicts with Skill ID 6:**
- Both trigger on keywords: `diagram`, `structure`
- Skill ID 6 says "Use Mermaid flowchart syntax"
- Skill ID 18 says "ASCII only. No Mermaid..."
- Creates unpredictable diagram output

**Resolution:**
- Delete Skill ID 18
- Skill ID 6 enhanced with mode detection (Mermaid + ASCII fallback)
- New Mindmap skill handles `hierarchy`, `org chart` keywords
- Keywords redistributed:
  - `diagram, structure, visualize` → Skill ID 6
  - `hierarchy, org chart, organization chart` → New Mindmap skill

---

## Steps to Delete via UI:

1. Navigate to Admin → Skills Management
2. Find Skill ID 18 "ASCII Diagram Rules"
3. Click Delete or Set `is_active = false`
4. Confirm deletion

**Alternative SQL:**
```sql
DELETE FROM skills WHERE id = 18;
```

**Or deactivate:**
```sql
UPDATE skills SET is_active = 0 WHERE id = 18;
```

**Impact:**
- Eliminates duplicate diagram skill
- Resolves keyword conflicts
- No functionality loss (coverage moved to Skills 6 + New Mindmap)
