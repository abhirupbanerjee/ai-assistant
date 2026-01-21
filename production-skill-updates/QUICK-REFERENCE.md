# Quick Reference: Production Skill Updates

## 🎯 Goal
Fix embed UI diagram overflow + eliminate skill conflicts

---

## 📋 7 Actions Required

### 1. DELETE Skill ID 18
**File:** SKILL-18-ASCIIDiagram-DELETE.md
- Find Skill ID 18 in admin UI
- Click Delete button
- **Why:** Conflicts with Skill ID 6

### 2. UPDATE Skill ID 6 - Diagram
**File:** SKILL-06-Diagram-UPDATE.md
- **Change keywords TO:** `diagram,structure,visualize`
- **Copy prompt from file, paste to UI**
- **Why:** Add mode detection, remove flowchart overlap

### 3. UPDATE Skill ID 9 - Flowchart
**File:** SKILL-09-Flowchart-UPDATE.md
- **Keywords:** No change
- **Copy prompt from file, paste to UI**
- **Why:** Add mode detection, fix width

### 4. UPDATE Skill ID 10 - UI Wireframes
**File:** SKILL-10-UIWireframes-UPDATE.md
- **Keywords:** No change
- **Copy prompt from file, paste to UI**
- **Why:** Fix width 45→34 chars

### 5. UPDATE Skill ID 11 - Architecture
**File:** SKILL-11-Architecture-UPDATE.md
- **Keywords:** No change
- **Copy prompt from file, paste to UI**
- **Why:** Add Mermaid C4, fix width

### 6. UPDATE Skill ID 12 - Implementation Plan
**File:** SKILL-12-ImplementationPlan-UPDATE.md
- **Keywords:** No change
- **Copy prompt from file, paste to UI**
- **Why:** Add Mermaid gantt, fix width

### 7. INSERT NEW Skill - Mindmap & Hierarchy
**File:** SKILL-NEW-MindmapHierarchy-INSERT.md
- **Click "Create New Skill"**
- **Name:** Mindmap & Hierarchy Diagrams
- **Priority:** 17
- **Keywords:** `mindmap,mind map,org chart,organization chart,organizational chart,hierarchy,hierarchical,organizational structure,company structure,reporting structure,tree diagram`
- **Copy prompt from file, paste to UI**
- **Why:** Handle org charts after deleting Skill 18

---

## ✅ Result

**Before:**
- Diagrams overflow embed UI ❌
- Skills 6 & 18 conflict ❌
- No mode detection ❌

**After:**
- All diagrams fit (34 chars) ✅
- Zero conflicts ✅
- Mode-aware (Mermaid in standalone, ASCII in embed) ✅

---

## 🧪 Quick Test

1. **Embed mode:** Ask "Show me a flowchart"
   - Should see ASCII diagram within UI bounds
2. **Standalone mode:** Ask "Show me a flowchart"
   - Should see Mermaid SVG diagram
3. **Keywords:** Try "diagram", "flowchart", "org chart"
   - Should route to correct skills (no conflicts)

---

## 📊 Keyword Distribution After Updates

| User Says | Routes To |
|-----------|-----------|
| "diagram" | Skill 6 (General diagrams) |
| "flowchart" | Skill 9 (Process flows) |
| "org chart" | NEW Mindmap skill |
| "architecture" | Skill 11 (Architecture) |
| "timeline" | Skill 12 (Implementation plan) |
| "wireframe" | Skill 10 (UI layouts) |
| "chart" (data) | Skill 17 (Data visualizer) |

**Zero overlaps!** ✅
