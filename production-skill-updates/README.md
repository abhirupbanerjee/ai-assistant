# Production Skill Updates - Manual UI Entry Guide

## 📋 Overview

This directory contains ready-to-paste skill prompts for manual production database entry via admin UI. These updates resolve the embed UI diagram overflow bug and eliminate skill conflicts.

---

## 🎯 Changes Summary

### Actions Required:

| Action | Skill ID | Name | Impact |
|--------|----------|------|--------|
| ❌ **DELETE** | 18 | ASCII Diagram Rules | Eliminates duplicate/conflict |
| ✏️ **UPDATE** | 6 | Diagram Generation | Add mode detection, new keywords |
| ✏️ **UPDATE** | 9 | Flowchart & Process | Add mode detection, fix width |
| ✏️ **UPDATE** | 10 | UI Wireframes | Fix width: 45→34 chars |
| ✏️ **UPDATE** | 11 | Architecture Diagrams | Add mode detection, fix width |
| ✏️ **UPDATE** | 12 | Implementation Plan | Add mode detection, fix width |
| ➕ **INSERT** | NEW | Mindmap & Hierarchy | New skill for org charts |

**Total:** 7 skill changes

---

## 📁 Files in This Directory

1. **SKILL-18-ASCIIDiagram-DELETE.md** - Instructions to delete Skill ID 18
2. **SKILL-06-Diagram-UPDATE.md** - Updated content for Skill ID 6
3. **SKILL-09-Flowchart-UPDATE.md** - Updated content for Skill ID 9
4. **SKILL-10-UIWireframes-UPDATE.md** - Updated content for Skill ID 10
5. **SKILL-11-Architecture-UPDATE.md** - Updated content for Skill ID 11
6. **SKILL-12-ImplementationPlan-UPDATE.md** - Updated content for Skill ID 12
7. **SKILL-NEW-MindmapHierarchy-INSERT.md** - New skill to create
8. **README.md** - This file

---

## 🔧 Manual Update Process

### Step 1: Delete Duplicate Skill (Skill ID 18)

**File:** `SKILL-18-ASCIIDiagram-DELETE.md`

1. Navigate to Admin → Skills Management in production UI
2. Find Skill ID 18 "ASCII Diagram Rules"
3. Click Delete button (or set `is_active = false`)
4. Confirm deletion

**Why:** Eliminates conflict with Skill ID 6

---

### Step 2: Update Skill ID 6 (Diagram Generation)

**File:** `SKILL-06-Diagram-UPDATE.md`

1. Navigate to Skill ID 6 in admin UI
2. Update the following fields:

**Trigger Keywords (change from):**
```
diagram,flowchart,structure,process flow,process map
```

**Trigger Keywords (change to):**
```
diagram,structure,visualize
```

3. Copy entire "Updated Prompt Content" from `SKILL-06-Diagram-UPDATE.md`
4. Paste into the `prompt_content` field
5. Save changes

**Why:** Adds mode detection, removes flowchart keywords (moved to Skill 9)

---

### Step 3: Update Skill ID 9 (Flowchart & Process)

**File:** `SKILL-09-Flowchart-UPDATE.md`

1. Navigate to Skill ID 9 in admin UI
2. Verify trigger keywords (no change needed):
```
flowchart,process diagram,process flow,workflow,process map,business process,sequence diagram
```
3. Copy entire "Updated Prompt Content" from `SKILL-09-Flowchart-UPDATE.md`
4. Paste into the `prompt_content` field
5. Save changes

**Why:** Adds mode detection, fixes width to 34 chars

---

### Step 4: Update Skill ID 10 (UI Wireframes)

**File:** `SKILL-10-UIWireframes-UPDATE.md`

1. Navigate to Skill ID 10 in admin UI
2. Verify trigger keywords (no change needed):
```
wireframe,screen layout,ui design,user interface,mockup,prototype,screen design,page layout
```
3. Copy entire "Updated Prompt Content" from `SKILL-10-UIWireframes-UPDATE.md`
4. Paste into the `prompt_content` field
5. Save changes

**Why:** Fixes width from 45→34 chars (embed UI overflow fix)

---

### Step 5: Update Skill ID 11 (Architecture Diagrams)

**File:** `SKILL-11-Architecture-UPDATE.md`

1. Navigate to Skill ID 11 in admin UI
2. Verify trigger keywords (no change needed):
```
architecture diagram,conceptual diagram,logical diagram,technical diagram,implementation diagram,system architecture,solution architecture,enterprise architecture,component diagram
```
3. Copy entire "Updated Prompt Content" from `SKILL-11-Architecture-UPDATE.md`
4. Paste into the `prompt_content` field
5. Save changes

**Why:** Adds Mermaid C4 support, fixes width to 34 chars

---

### Step 6: Update Skill ID 12 (Implementation Plan)

**File:** `SKILL-12-ImplementationPlan-UPDATE.md`

1. Navigate to Skill ID 12 in admin UI
2. Verify trigger keywords (no change needed):
```
implementation plan,gantt chart,project plan,project schedule,timeline,roadmap,milestones,project phases,delivery plan
```
3. Copy entire "Updated Prompt Content" from `SKILL-12-ImplementationPlan-UPDATE.md`
4. Paste into the `prompt_content` field
5. Save changes

**Why:** Adds Mermaid gantt support, fixes width to 34 chars

---

### Step 7: Create New Skill (Mindmap & Hierarchy)

**File:** `SKILL-NEW-MindmapHierarchy-INSERT.md`

1. Navigate to Admin → Skills Management
2. Click "Create New Skill" button
3. Fill in the form with the following:

**Basic Info:**
- **Name:** `Mindmap & Hierarchy Diagrams`
- **Description:** `Rules for creating mindmaps, org charts, and hierarchical structures`
- **Priority:** `17`
- **Is Active:** `true`
- **Is Core:** `true`
- **Is Index:** `false`
- **Category Restricted:** `false`

**Trigger Settings:**
- **Trigger Type:** `keyword`
- **Trigger Keywords:**
```
mindmap,mind map,org chart,organization chart,organizational chart,hierarchy,hierarchical,organizational structure,company structure,reporting structure,tree diagram
```

**Prompt Content:**
- Copy entire "Prompt Content" section from `SKILL-NEW-MindmapHierarchy-INSERT.md`
- Paste into the `prompt_content` field

4. Save to create the new skill

**Why:** Fills gap for org charts and hierarchies after deleting Skill ID 18

---

## ✅ Expected Results After Updates

### Keyword Distribution (Zero Overlaps):

| Skill ID | Name | Keywords |
|----------|------|----------|
| 6 | Diagram | `diagram,structure,visualize` |
| 7 | Table Formatting | `table,compare,comparison,matrix,versus,vs,...` |
| 9 | Flowchart & Process | `flowchart,process diagram,process flow,...` |
| 10 | UI Wireframes | `wireframe,screen layout,ui design,...` |
| 11 | Architecture | `architecture diagram,conceptual diagram,...` |
| 12 | Implementation Plan | `implementation plan,gantt chart,timeline,...` |
| 17 | Data Visualiser | `chart,graph,pie,bar,radar,stacked bar` |
| **NEW** | Mindmap & Hierarchy | `mindmap,org chart,hierarchy,...` |

### Behavior Changes:

**Before (Production):**
- Diagrams overflow embed UI (45-50 char widths)
- Skill ID 6 + 18 conflict on keywords
- Unpredictable diagram output
- No mode detection (Mermaid in embed mode fails)

**After (Updated):**
- ✅ All diagrams fit embed UI (34 char width)
- ✅ Zero keyword conflicts
- ✅ Predictable diagram output
- ✅ Mode-aware rendering:
  - Standalone + Mermaid enabled → Mermaid diagrams
  - Embed mode → ASCII diagrams
- ✅ Clean separation of concerns:
  - General diagrams → Skill 6
  - Process flows → Skill 9
  - Hierarchies → New Mindmap skill
  - Data charts → Skill 17 (unchanged)

---

## 🧪 Testing After Updates

### Test 1: Embed UI Width
1. Open embed workspace bot
2. Ask: "Show me a flowchart"
3. **Expected:** ASCII diagram fits within UI width (no overflow)

### Test 2: Keyword Routing
1. Ask: "Create a diagram"
2. **Expected:** Skill ID 6 triggers (general diagrams)
3. Ask: "Show me a flowchart"
4. **Expected:** Skill ID 9 triggers (process flows)
5. Ask: "Create an org chart"
6. **Expected:** New Mindmap skill triggers

### Test 3: Mode Detection
1. In standalone mode, ask: "Show me a flowchart"
2. **Expected:** Mermaid diagram renders as SVG
3. In embed mode, ask: "Show me a flowchart"
4. **Expected:** ASCII box diagram

---

## 📊 Impact Summary

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Diagram width spec | 45-50 chars | 34 chars | ✅ 31% narrower |
| Duplicate skills | 2 (ID 6 + 18) | 0 | ✅ Eliminated |
| Keyword conflicts | 4 overlaps | 0 overlaps | ✅ Zero conflicts |
| Mode detection | ❌ None | ✅ Enabled | ✅ Embed-aware |
| Embed UI overflow | ❌ Occurs | ✅ Fixed | ✅ Bug resolved |

---

## 🚨 Important Notes

1. **Order matters:** Delete Skill ID 18 FIRST to avoid conflicts during updates
2. **Keyword changes:** Only Skill ID 6 keywords change (remove flowchart keywords)
3. **Backup:** Consider exporting current skills before updating
4. **Testing:** Test in staging/dev environment first if available
5. **DiagramSettings backend:** These skill updates work with or without the DiagramSettings admin toggle (that's a separate deployment)

---

## 📞 Support

If you encounter issues during manual entry:
1. Check that Skill ID 18 was deleted first
2. Verify trigger keywords match exactly (comma-separated, no spaces)
3. Ensure prompt_content copied completely (check for truncation)
4. Test one skill at a time to isolate issues

---

## 🎉 Completion Checklist

- [ ] Step 1: Deleted Skill ID 18
- [ ] Step 2: Updated Skill ID 6 (Diagram)
- [ ] Step 3: Updated Skill ID 9 (Flowchart)
- [ ] Step 4: Updated Skill ID 10 (UI Wireframes)
- [ ] Step 5: Updated Skill ID 11 (Architecture)
- [ ] Step 6: Updated Skill ID 12 (Implementation Plan)
- [ ] Step 7: Created New Mindmap & Hierarchy skill
- [ ] Test 1: Verified embed UI width (no overflow)
- [ ] Test 2: Verified keyword routing (no conflicts)
- [ ] Test 3: Verified mode detection (Mermaid vs ASCII)

**All done! 🎊** The embed UI diagram overflow bug should now be resolved.
