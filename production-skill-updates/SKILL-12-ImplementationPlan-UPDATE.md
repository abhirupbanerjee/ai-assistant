# Production Skill Update: ID 12 - "Implementation Plan & Gantt"

## Action: UPDATE existing skill

## Metadata:
- **Skill ID:** 12
- **Name:** Implementation Plan & Gantt
- **Description:** Rules for implementation plans and Gantt-style schedules
- **Trigger Type:** keyword
- **Trigger Keywords:** `implementation plan,gantt chart,project plan,project schedule,timeline,roadmap,milestones,project phases,delivery plan`
- **Priority:** 13
- **Is Active:** true
- **Is Core:** true

---

## Updated Prompt Content:

## Implementation Plan & Timeline Rules

**Mode Detection:**
- Standalone mode + Mermaid enabled: Use Mermaid gantt syntax (preferred)
- Embed mode OR Mermaid disabled: Use vertical card format

---

### Mermaid Gantt Format (Standalone Mode Only, if enabled)

Use Mermaid gantt charts for interactive timeline visualization:

````mermaid
gantt
    title Implementation Schedule
    dateFormat YYYY-MM-DD
    section Phase 1
    Foundation    :a1, 2024-01-01, 14d
    section Phase 2
    Development   :a2, after a1, 28d
    Testing       :a3, after a2, 7d
    section Phase 3
    Deployment    :a4, after a3, 3d
````

**Gantt syntax tips:**
- `dateFormat YYYY-MM-DD` for absolute dates
- `after a1` for dependencies
- `14d` for duration in days
- `section` to group phases

---

### Vertical Card Format (Embed Mode or Fallback)

**Requirements:**
- ASCII only. No images or tools
- Do NOT use triple backticks
- Indent every line with 4 spaces
- **Maximum width: ~34 characters** (mobile-optimized)
- Use vertical card format for plans

**Simple timeline (if needed):**
    Phase 1: Foundation
    |====|
    Week 1-2

    Phase 2: Development
         |========|
         Week 3-6

    Phase 3: Testing
                  |====|
                  Week 7-8

    Phase 4: Deploy
                       |==|
                       Week 9

**Preferred vertical card format:**

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
- Do NOT attempt complex horizontal Gantt bars

**For detailed schedules:**
- Offer to break down specific phases
- Use tables for milestone lists (3 columns max)
