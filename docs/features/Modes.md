# Autonomous Mode Technical Documentation

## 1. Introduction

### 1.1 Overview

Policy Bot supports two operational modes to handle different user requirements:

| Mode | Description | Use Case |
|------|-------------|----------|
| Normal Mode | Single-turn response with direct LLM processing; parallel tool execution for capable models | Simple queries, quick answers, straightforward tasks |
| Autonomous Mode | Multi-agent orchestration with Plan-Execute-Check-Summarize loop | Complex tasks requiring multiple steps, research, multi-tool execution |

### 1.2 When to Use Which Mode

**Use Normal Mode When:**
- Answering straightforward questions
- Simple document retrieval or summarization
- Quick factual lookups
- Single-step tasks that don't require tool usage
- Time-sensitive queries where speed is priority

> **Tool Execution in Normal Mode:** When the LLM returns multiple tool calls in a single response, models marked `parallel_tool_capable` execute them concurrently (via `Promise.allSettled`), while other models execute sequentially. This is transparent to the user — the LLM's natural multi-round loop still handles dependencies (e.g., search in round 1, doc_gen in round 2). Admin control: toggle per-model in Settings > LLM.

**Use Autonomous Mode When:**
- Complex multi-step tasks requiring research
- Tasks requiring multiple tool executions (web search, code analysis, document generation)
- Tasks with dependencies between subtasks
- Quality-critical outputs requiring validation
- Tasks requiring task decomposition and planning

Planner reasoning and executor model selection are configured in Admin Settings → Agent Config. When the selected planner model is marked thinking-capable in Admin Settings → LLM, a planner-only Thinking / Reasoning toggle becomes available.

### 1.3 How to Access

- **Normal Mode**: Default mode in chat input box
- **Autonomous Mode**: Toggle available in chat input box (labeled "+- autonomous mode")
- **Configuration**: Admin Settings → Agent Config

---

## 2. Autonomous Mode Architecture

### 2.1 High-Level Architecture

The autonomous mode implements a Plan-and-Execute pattern with hierarchical agent coordination:

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                              │
│         (Pure Coordinator - No LLM Calls)                   │
│  • Load task plan from database                             │
│  • Initialize budget tracker                                │
│  • Coordinate execution loop                                │
│  • Handle progress callbacks                                │
└─────────────────────────────────────────────────────────────┘
     │
     ├────────────────────────────────────────────────────────┐
     ▼                                                        ▼
┌──────────────────┐                              ┌──────────────────┐
│    PLANNER       │                              │   EXECUTOR       │
│ (Configurable    │                              │ (Configurable    │
│  planner model)  │                              │  executor model) │
│                  │                              │                  │
│                  │                              │                  │
│ • Task decompo-  │                              │ • Tool execution │
│   sition         │                              │ • Code generation│
│ • Optional       │                              │ • Profile-based  │
│   reasoning      │                              │   routing        │
│ • DAG creation   │                              │ • Result handling│
│ • Self-reflection│                              │                  │
└──────────────────┘                              └──────────────────┘
     │                                                    │
     │                                                    ▼
     │                                          ┌──────────────────┐
     │                                          │    CHECKER       │
     │                                          │ (GPT-4.1 Mini)   │
     │                                          │                  │
     │                                          │ • Quality check  │
     │                                          │ • Confidence     │
     │                                          │   scoring        │
     │                                          │ • Retry logic    │
     │                                          └──────────────────┘
     │
     ▼
┌──────────────────┐
│   SUMMARIZER     │
│ (GPT-4.1 Mini)   │
│                  │
│ • Final output   │
│   synthesis      │
│ • Format results │
└──────────────────┘
```

### 2.2 Agent Flow

```
                         ┌─────────────────────────────────────┐
                         │         USER REQUEST                │
                         └─────────────────┬───────────────────┘
                                           │
                                           ▼
                         ┌─────────────────────────────────────┐
                         │         ORCHESTRATOR                │
                         │    (No LLM - Coordinator Only)      │
                         │                                     │
                         │  • Load plan from DB                │
                         │  • Initialize budget                │
                         │  • Coordinate execution             │
                         └─────────────────┬───────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
         ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
         │    PLANNER       │  │    EXECUTOR       │  │   SUMMARIZER     │
         │                  │  │                   │  │                  │
         │ Claude Sonnet    │  │  MiniMax M2.5     │  │  GPT-4.1 Mini   │
         │     4.6          │  │                   │  │                  │
         │                  │  │                   │  │                  │
         │ • Decompose      │  │ • Execute tasks   │  │ • Synthesize     │
         │ • Create DAG     │  │ • Call tools      │  │ • Format output  │
         │ • Self-reflect   │  │ • Handle results  │  │                  │
         └────────┬─────────┘  └────────┬──────────┘  └────────┬─────────┘
                  │                     │                      │
                  │                     ▼                      │
                  │           ┌──────────────────┐             │
                  │           │    CHECKER        │             │
                  │           │                   │             │
                  │           │  GPT-4.1 Mini     │             │
                  │           │                   │             │
                  │           │ • Validate        │             │
                  │           │ • Confidence      │             │
                  │           │ • Retry if <80%   │             │
                  │           └──────────────────┘             │
                  │                     │                      │
                  └─────────────────────┴──────────────────────┘
                                           │
                                           ▼
                         ┌─────────────────────────────────────┐
                         │         FINAL OUTPUT                │
                         └─────────────────────────────────────┘
```

---

## 3. Agent Deep Dive

### 3.1 Orchestrator

**Role:** Pure coordination layer — NO direct LLM calls

**Responsibilities:**
- Load and manage the task plan from the database
- Initialize the budget tracker
- Coordinate the execution loop (Plan → Execute → Check → Summarize)
- Handle progress callbacks for streaming updates
- Manage pause/stop signals
- Track task dependencies and execution order

**Key Characteristics:**
- Zero LLM dependency — pure orchestration logic
- Manages state across agent lifecycle
- Handles error propagation from sub-agents
- Enforces budget constraints at coordinator level
- Max 1000 iteration safety guard to prevent infinite loops

### 3.2 Planner

**Model:** Configurable in Admin Settings → Agent Config, typically a thinking-capable planner model

**Planner control:** The planner can use optional reasoning when the selected model supports thinking. It can also assign task-level `executor_profile` values to route work to specialized executor models for low-cost, deep reasoning, long-context, or artifact-generation tasks.

**Responsibilities:**
- Decompose user request into structured tasks
- Create Directed Acyclic Graph (DAG) of task dependencies
- Self-reflection on complex plans (triggers for plans with ≥4 tasks)
- Identify required tools for each task
- Estimate task complexity for budget allocation

**Key Features:**
- Chain-of-thought reasoning for task decomposition
- DAG-based dependency validation (cycle detection via DFS, topological sort via Kahn's algorithm)
- 7-point self-critique checklist (completeness, task types, dependencies, implicit items, search chain, synthesis, redundancy)
- Tool allowlist based on task type

### 3.3 Executor

**Model:** Configurable in Admin Settings → Agent Config

**Executor control:** The executor model is configurable in Admin Settings → Agent Config, and the planner can route specific tasks to executor profiles such as `fast_low_cost`, `deep_reasoning`, `long_context`, and `artifact_generation`.

**Responsibilities:**
- Execute each task in the plan using appropriate tools
- Handle tool invocation and result processing
- Manage code generation and execution
- Stream progress updates back to orchestrator
- Handle tool-specific errors and retries

**Key Features:**
- 8 tool types: `doc_gen`, `image_gen`, `chart_gen`, `xlsx_gen`, `pptx_gen`, `podcast_gen`, `diagram_gen`, `web_search`
- Code generation for dynamic tasks (temperature: 0.4, max tokens: 4096)
- Streaming response handling
- Tool result parsing and validation

### 3.4 Checker

**Model:** Configurable in Admin Settings → Agent Config

**Responsibilities:**
- Validate task execution results
- Calculate confidence scores (0–100%)
- Determine if results meet quality thresholds
- Trigger retry logic if confidence < 80%
- Provide feedback for improvement

**Key Features:**
- Confidence-based approval threshold (80%)
- Max 1 retry (2 total attempts per task)
- 4 retry strategies: `fallback_ascii_diagram`, `fallback_text_description`, `expand_web_search`, `more_specific_prompt`
- Auto-approves summarize/synthesize tasks without LLM evaluation
- Smart tool detection: verifies tool output directly without LLM call

### 3.5 Summarizer

**Model:** Configurable in Admin Settings → Agent Config

**Responsibilities:**
- Synthesize final output from all task results
- Format response according to user requirements
- Handle multi-part results aggregation
- Ensure coherent narrative from subtasks

**Key Features:**
- Long-context synthesis using the configured summarizer model
- Structured output formatting
- Result aggregation from DAG execution
- Progressive streaming support (`generatePlanIntro`, `generateIncrementalSummary`, `generateConclusion`)

---

## 4. LLM Configuration

### 4.1 Default Model Assignments

These defaults are configurable in Admin Settings → Agent Config and may differ by deployment.

| Agent Role | Default Model Example | Provider | Purpose |
|------------|----------------------|----------|---------|
| Orchestrator | None (Coordinator) | — | Pure coordination — no LLM needed |
| Planner | Thinking-capable planner model | Configurable | Task decomposition, optional reasoning |
| Executor | Executor model | Configurable | Tool execution, code generation |
| Checker | Checker model | Configurable | Quality validation, confidence scoring |
| Summarizer | Summarizer model | Configurable | Output synthesis |

### 4.2 Model Selection Rationale

| Agent Role | Selection Guideline | Rationale |
|------------|---------------------|-----------|
| Planner | Thinking-capable model when available | Best for structured reasoning, decomposition, and self-critique |
| Executor | Specialized executor profile | Best matches task complexity, latency, privacy, or artifact requirements |
| Checker | Faster/smaller validation model | Fast quality evaluation, sufficient for confidence scoring |
| Summarizer | Strong synthesis model | Fast synthesis and consolidation of task results |

### 4.3 Fallback Chain

The system implements a configurable fallback chain for resilience:

1. **Primary model** → Configured per-agent role
2. **Global default** → Configured in Admin Settings (`getDefaultLLMModel()`)
3. **Universal fallback** → Admin-configured model (`getLlmFallbackSettings().universalFallback`)

All fallback levels are admin-configurable — no models are hardcoded. Fallback models must be vision-capable and tool-capable.

---

## 5. Technical Implementation

### 5.1 DAG Implementation

The Planner creates a Directed Acyclic Graph (DAG) for task dependencies:
- Nodes represent individual tasks
- Edges represent dependencies between tasks
- Topological sorting (Kahn's algorithm) determines execution order
- Parallel execution for independent tasks
- Validation includes: duplicate ID detection, invalid reference checks, self-dependency checks, circular dependency detection (DFS), root task existence

### 5.2 Self-Reflection in Planner

Complex plans (≥4 tasks) trigger self-reflection with a 7-point checklist:
1. Completeness — are all user requirements covered?
2. Task types — are explicit tool types used where applicable?
3. Dependencies — are dependencies correct and non-circular?
4. Implicit items — are any implied tasks missing?
5. Search chain — is web search only used for new information?
6. Synthesis — is there a final synthesis/summarize task?
7. Redundancy — are there duplicate or unnecessary tasks?

### 5.3 Checker Retry Logic

```
Task Execution → Confidence Score
       │
       ├─ ≥80% → Approve → Next Task
       │
       └─ <80% → Retry (max 1 retry)
                    │
                    ├─ ≥80% → Approve → Next Task
                    └─ <80% → Mark as needs_review → Continue
```

### 5.4 Budget Enforcement

- Budget tracker initialized per plan from database settings
- Tracks: LLM calls (default 500), total tokens (default 2M), web searches (default 100), duration (default 30 min), task timeout (default 5 min)
- Warning thresholds: 50% (medium), 75% (high), 100% (hard stop)
- Global budget pool shared across all concurrent agents
- 2-second TTL cache prevents excessive DB queries

---

## 6. Best Practices Validation

| Best Practice | Implementation | Status |
|---------------|----------------|--------|
| Modular agent design | Separate Planner, Executor, Checker, Summarizer | Aligned |
| Plan-and-Execute pattern | Planner creates task plan → Executor runs steps | Aligned |
| Separation of planning from execution | Distinct agents for each phase | Aligned |
| Hierarchical communication | Orchestrator coordinates sequential flow | Aligned |
| Fault tolerance | Retry strategies, fallback chains | Aligned |
| Budget enforcement | Budget tracker at each stage | Aligned |
| Human-in-the-loop checkpoint | 80% confidence threshold for auto-approval | Aligned |
| Observability | Task status tracking, progress callbacks | Aligned |
| Tool allowlists | Tool detection by task type | Aligned |

---

## 7. Key Files

| File | Purpose |
|------|---------|
| `src/lib/agent/orchestrator.ts` | Main orchestration loop, task coordination |
| `src/lib/agent/planner.ts` | Task decomposition, DAG creation, self-reflection |
| `src/lib/agent/executor.ts` | Tool execution, code generation |
| `src/lib/agent/checker.ts` | Quality validation, confidence scoring |
| `src/lib/agent/summarizer.ts` | Output synthesis, progressive streaming |
| `src/lib/agent/llm-router.ts` | Model routing, fallback chain |
| `src/lib/agent/budget-tracker.ts` | Global budget enforcement |
| `src/lib/agent/dependency-validator.ts` | DAG validation, cycle detection |
| `src/lib/agent/streaming-executor.ts` | SSE streaming integration |
| `src/lib/db/compat/agent-config.ts` | Model config, system prompts, admin settings |
