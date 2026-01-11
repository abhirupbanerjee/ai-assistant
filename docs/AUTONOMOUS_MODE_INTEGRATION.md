# Autonomous Mode Integration Guide

## Overview

This guide explains how to integrate the autonomous mode functionality into the Policy Bot frontend and backend.

## Implementation Status

**✅ Phase 1: Core Infrastructure (COMPLETE)**
- Database schema extensions
- Type system definitions
- Budget tracking system
- JSON schema validation
- Dependency validation
- LLM router (multi-provider support)

**✅ Phase 2: Agent Components (COMPLETE)**
- Planner Agent
- Executor Agent
- Checker Agent (80% confidence threshold)
- Summarizer Agent
- Orchestrator (main coordinator)

**✅ Phase 3: API & Frontend Components (COMPLETE)**
- Extended streaming API
- StreamEvent types for autonomous mode
- ModeToggle component
- AgentPlanProgress component

**✅ Phase 4: Database Ready**
- All migrations applied
- Global budget settings configured

---

## Backend Integration

### 1. Database Schema

The following tables have been extended for autonomous mode:

#### `task_plans` Table
```sql
-- New columns added:
mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'autonomous'))
budget_json TEXT DEFAULT '{"max_llm_calls": 100, "max_tokens": 500000}'
budget_used_json TEXT DEFAULT '{"llm_calls": 0, "tokens_used": 0, "web_searches": 0}'
model_config_json TEXT DEFAULT '{}'
```

#### `messages` Table
```sql
-- New columns added:
mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'autonomous'))
plan_id TEXT REFERENCES task_plans(id)
```

#### `settings` Table
```sql
-- Global budget settings (already configured):
agent_budget_max_llm_calls = 500
agent_budget_max_tokens = 2000000
agent_budget_max_web_searches = 100
agent_confidence_threshold = 80
agent_budget_max_duration_minutes = 30
agent_task_timeout_minutes = 5
```

### 2. API Endpoints

#### Streaming Chat API (`/api/chat/stream`)

**Extended Request Body:**
```typescript
interface StreamChatRequest {
  message: string;
  threadId: string;
  mode?: 'normal' | 'autonomous'; // Defaults to 'normal'
  modelConfigPreset?: 'default' | 'quality' | 'economy' | 'compliance';
}
```

**New SSE Events:**
```typescript
| { type: 'agent_plan_created'; plan_id: string; title: string; task_count: number; tasks: Array<{ id: number; description: string; type: string }> }
| { type: 'agent_task_started'; task_id: number; description: string; task_type: string }
| { type: 'agent_task_completed'; task_id: number; status: 'done' | 'skipped' | 'needs_review'; confidence?: number; result?: string; checkerNotes?: string }
| { type: 'agent_budget_warning'; level: 'medium' | 'high'; percentage: number; message: string }
| { type: 'agent_budget_exceeded'; message: string }
| { type: 'agent_plan_summary'; summary: string; stats: AgentPlanStats }
| { type: 'agent_error'; error: string }
```

**Note:** The `agent_task_completed` event now includes:
- `result`: The executor's output text for the task
- `checkerNotes`: The checker agent's quality assessment notes

**New Stream Phases:**
```typescript
| 'agent_planning'    // Creating task plan
| 'agent_executing'   // Executing tasks
| 'agent_summarizing' // Generating summary
```

### 3. Core Agent Files

#### Agent Components
- **[src/lib/agent/planner.ts](src/lib/agent/planner.ts)** - Creates task breakdowns with dependency validation
- **[src/lib/agent/executor.ts](src/lib/agent/executor.ts)** - Executes tasks with fail-fast and idempotency
- **[src/lib/agent/checker.ts](src/lib/agent/checker.ts)** - Quality validation with 80% confidence threshold
- **[src/lib/agent/summarizer.ts](src/lib/agent/summarizer.ts)** - Generates final summaries
- **[src/lib/agent/orchestrator.ts](src/lib/agent/orchestrator.ts)** - Main coordinator (Plan → Execute → Check → Summarize)

#### Infrastructure
- **[src/lib/agent/llm-router.ts](src/lib/agent/llm-router.ts)** - Multi-provider LLM routing (OpenAI, Gemini, Mistral)
- **[src/lib/agent/json-parser.ts](src/lib/agent/json-parser.ts)** - Schema validation with LLM repair
- **[src/lib/agent/dependency-validator.ts](src/lib/agent/dependency-validator.ts)** - Circular dependency detection
- **[src/lib/agent/budget-tracker.ts](src/lib/agent/budget-tracker.ts)** - Global budget tracking with warnings
- **[src/lib/agent/streaming-executor.ts](src/lib/agent/streaming-executor.ts)** - Streaming integration

#### Database Operations
- **[src/lib/db/task-plans.ts](src/lib/db/task-plans.ts)** - Extended with autonomous mode functions
- **[src/lib/db/index.ts](src/lib/db/index.ts)** - Automatic migrations on startup

#### Types
- **[src/types/agent.ts](src/types/agent.ts)** - All agent-related types
- **[src/types/stream.ts](src/types/stream.ts)** - Extended StreamEvent types

---

## Frontend Integration

### 1. Components

#### ModeToggle Component
**Location:** [src/components/chat/ModeToggle.tsx](src/components/chat/ModeToggle.tsx)

```tsx
import ModeToggle, { ChatMode, ModelPreset } from '@/components/chat/ModeToggle';

// Usage:
<ModeToggle
  mode={mode}
  modelPreset={modelPreset}
  onModeChange={(mode) => setMode(mode)}
  onPresetChange={(preset) => setModelPreset(preset)}
  disabled={isStreaming}
/>
```

#### AgentPlanProgress Component
**Location:** [src/components/chat/AgentPlanProgress.tsx](src/components/chat/AgentPlanProgress.tsx)

```tsx
import AgentPlanProgress from '@/components/chat/AgentPlanProgress';

// Usage:
<AgentPlanProgress
  planTitle={planTitle}
  tasks={tasks}
  currentTaskId={currentTaskId}
  budgetWarning={budgetWarning}
  stats={stats}
  isComplete={isComplete}
/>
```

### 2. Integration Steps

#### Step 1: Add State Management to ChatWindow

```tsx
// In ChatWindow.tsx or your main chat component:
import { ChatMode, ModelPreset } from '@/components/chat/ModeToggle';

const [mode, setMode] = useState<ChatMode>('normal');
const [modelPreset, setModelPreset] = useState<ModelPreset>('default');
const [agentPlan, setAgentPlan] = useState<{
  planId?: string;
  title?: string;
  tasks: Array<{
    id: number;
    description: string;
    type: string;
    status: 'pending' | 'running' | 'done' | 'skipped' | 'needs_review';
    confidence?: number;
  }>;
  currentTaskId?: number;
  budgetWarning?: { level: 'medium' | 'high'; percentage: number };
  stats?: AgentPlanStats;
  isComplete?: boolean;
}>({ tasks: [] });
```

#### Step 2: Update Message Sending

```tsx
// When sending a message:
const sendMessage = async (message: string) => {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      threadId,
      mode, // Include mode
      modelConfigPreset: mode === 'autonomous' ? modelPreset : undefined,
    }),
  });

  // Handle SSE stream...
};
```

#### Step 3: Handle Autonomous Mode Events

```tsx
// In your SSE event handler:
const eventSource = new EventSource(/* ... */);

eventSource.addEventListener('message', (e) => {
  const event = JSON.parse(e.data) as StreamEvent;

  switch (event.type) {
    case 'agent_plan_created':
      setAgentPlan({
        planId: event.plan_id,
        title: event.title,
        tasks: [],
        isComplete: false,
      });
      break;

    case 'agent_task_started':
      setAgentPlan(prev => ({
        ...prev,
        currentTaskId: event.task_id,
        tasks: [
          ...prev.tasks,
          {
            id: event.task_id,
            description: event.description,
            type: event.type,
            status: 'running',
          },
        ],
      }));
      break;

    case 'agent_task_completed':
      setAgentPlan(prev => ({
        ...prev,
        tasks: prev.tasks.map(t =>
          t.id === event.task_id
            ? {
                ...t,
                status: event.status,
                confidence: event.confidence,
                result: event.result,           // Executor output text
                checkerNotes: event.checkerNotes // Checker assessment notes
              }
            : t
        ),
      }));
      break;

    case 'agent_budget_warning':
      setAgentPlan(prev => ({
        ...prev,
        budgetWarning: { level: event.level, percentage: event.percentage },
      }));
      break;

    case 'agent_plan_summary':
      setAgentPlan(prev => ({
        ...prev,
        stats: event.stats,
        isComplete: true,
      }));
      break;

    case 'agent_error':
      console.error('Agent error:', event.error);
      // Handle error UI
      break;
  }
});
```

#### Step 4: Render Components

```tsx
// In your chat UI:
return (
  <div>
    {/* Mode Toggle (in message input area) */}
    <ModeToggle
      mode={mode}
      modelPreset={modelPreset}
      onModeChange={setMode}
      onPresetChange={setModelPreset}
      disabled={isStreaming}
    />

    {/* Agent Plan Progress (show when in autonomous mode and plan exists) */}
    {mode === 'autonomous' && agentPlan.tasks.length > 0 && (
      <AgentPlanProgress
        planTitle={agentPlan.title}
        tasks={agentPlan.tasks}
        currentTaskId={agentPlan.currentTaskId}
        budgetWarning={agentPlan.budgetWarning}
        stats={agentPlan.stats}
        isComplete={agentPlan.isComplete}
      />
    )}

    {/* Rest of chat UI */}
  </div>
);
```

---

## Infrastructure Configuration

### Traefik Reverse Proxy Timeouts

Autonomous mode can run for extended periods (10-30 minutes for complex tasks). The default Traefik timeouts will kill SSE connections prematurely. Configure extended timeouts in `docker-compose.yml`:

```yaml
services:
  traefik:
    command:
      # ... other config ...
      # Increase timeouts for SSE/long-running autonomous mode (30 minutes)
      - "--entrypoints.websecure.transport.respondingTimeouts.readTimeout=1800s"
      - "--entrypoints.websecure.transport.respondingTimeouts.writeTimeout=1800s"
      - "--entrypoints.websecure.transport.respondingTimeouts.idleTimeout=1800s"

  app:
    labels:
      # SSE keepalive middleware
      - "traefik.http.middlewares.sse-timeout.headers.customRequestHeaders.Connection=keep-alive"
      - "traefik.http.routers.app.middlewares=sse-timeout"
      # SSE streaming: flush immediately for real-time updates
      - "traefik.http.services.app.loadbalancer.responseForwarding.flushInterval=100ms"
      # Service-level timeout: wait up to 30 minutes for response
      - "traefik.http.services.app.loadbalancer.server.responseHeaderTimeout=1800s"
```

**Key Settings:**

| Level | Setting | Value | Purpose |
|-------|---------|-------|---------|
| Entrypoint | `readTimeout` | 1800s (30 min) | Maximum time to read request |
| Entrypoint | `writeTimeout` | 1800s (30 min) | Maximum time to write response |
| Entrypoint | `idleTimeout` | 1800s (30 min) | Keep idle connections alive |
| Service | `responseHeaderTimeout` | 1800s (30 min) | Wait for first response byte |
| Service | `flushInterval` | 100ms | Flush SSE events immediately |

### Timeout Chain

Understanding how timeouts interact is crucial for debugging network errors:

```
Browser ←─────── Traefik ─────────→ Next.js App
           │                              │
    flushInterval=100ms            maxDuration (admin config)
    (stream chunks fast)           (app-level limit)
           │
    responseHeaderTimeout=1800s
    (wait for first byte)
           │
    readTimeout=1800s
    writeTimeout=1800s
    idleTimeout=1800s
           │
    Keepalive Interval (admin config)
    (ping events to keep connection alive)
```

**Which parameter causes network errors?**

| Error Type | Likely Cause | Solution |
|------------|--------------|----------|
| Error at task N of N (near end) | Max Stream Duration exceeded | Increase in Admin UI |
| Error after ~3 minutes | Traefik default timeout | Check docker-compose.yml |
| Sporadic disconnects | Keepalive too slow for proxy | Reduce Keepalive Interval |
| Single task hangs | Tool Timeout exceeded | Increase Tool Timeout |

### Admin UI Configuration

The Admin panel (`/admin` → Settings → Autonomous Agent) provides configuration for:

#### Budget Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Max Duration | 30 min | 1-480 min | Maximum runtime for autonomous plans |
| Max LLM Calls | 500 | 1-10,000 | Total LLM calls allowed per plan |
| Max Tokens | 2,000,000 | 1K-100M | Total token budget per plan |
| Max Web Searches | 100 | 1-1,000 | Maximum web search calls |
| Confidence Threshold | 80% | 0-100% | Tasks below this are flagged for review |
| Task Timeout | 5 min | 1-60 min | Per-task execution limit |

#### Streaming Configuration (NEW)

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Keepalive Interval | 10s | 5-60s | How often ping events are sent to keep SSE alive |
| Max Stream Duration | 300s | 60-600s | Maximum streaming session length (app-level) |
| Tool Timeout | 60s | 30-300s | Timeout for individual tool executions |

**Important:**
- For processing large batches (20+ items), increase **Max Stream Duration** to 480-600s
- **Max Stream Duration** must be less than Traefik's timeout (1800s)
- **Keepalive Interval** must be less than your proxy's idle timeout

---

## Configuration

### Default Model Configuration

The default models used at runtime are defined in [src/lib/db/agent-config.ts](src/lib/db/agent-config.ts):

| Agent Role | Provider | Model | Temperature |
|------------|----------|-------|-------------|
| Planner | Gemini | gemini-2.5-flash | 0.3 |
| Executor | OpenAI | gpt-4.1-mini | 0.4 |
| Checker | OpenAI | gpt-4.1-mini | 0.2 |
| Summarizer | OpenAI | gpt-4.1-mini | 0.5 |

### Model Presets

Additional presets for different use cases are defined in [src/types/agent.ts](src/types/agent.ts):

| Preset | Use Case | Planner | Executor | Checker | Summarizer |
|--------|----------|---------|----------|---------|------------|
| **quality** | Best results | gemini-2.0-flash-exp | gpt-4o | gpt-4o | gpt-4o |
| **economy** | Lower cost | mistral-large-latest | gpt-4o-mini | mistral-medium-latest | gpt-4o-mini |
| **compliance** | Regulatory work | gemini-2.0-flash-exp | gemini-2.0-flash-exp | gpt-4o | gpt-4o |

### Token Limits

Each agent role has a configured maximum token limit for LLM responses:

| Agent Role | Max Tokens | Purpose |
|------------|------------|---------|
| Planner | 8192 | Supports large per-item task breakdowns (up to 50 tasks) |
| Executor | 4096 | Task execution responses |
| Checker | 2048 | Quality validation (small outputs) |
| Summarizer | 4096 | Final plan summaries |

These limits are defined in `src/lib/db/agent-config.ts` and can be customized via database settings.

### Budget Configuration

Global budget settings can be modified in the database:

```sql
-- Update global budget limits:
UPDATE settings SET value = '1000' WHERE key = 'agent_budget_max_llm_calls';
UPDATE settings SET value = '5000000' WHERE key = 'agent_budget_max_tokens';

-- Update confidence threshold (default 80%):
UPDATE settings SET value = '75' WHERE key = 'agent_confidence_threshold';
```

---

## Testing

### Manual Testing Steps

1. **Start the application:**
   ```bash
   npm run dev
   ```

2. **Test normal mode (baseline):**
   - Send a regular message
   - Verify normal chat functionality works

3. **Test autonomous mode:**
   - Toggle to "Autonomous" mode
   - Select a model preset (e.g., "Default")
   - Send a request like: "Analyze our onboarding policy and create a compliance checklist"
   - Observe:
     - Plan creation event
     - Task execution progress
     - Budget warnings (if applicable)
     - Final summary

4. **Test budget warnings:**
   - Lower budget limits temporarily:
     ```sql
     UPDATE settings SET value = '10' WHERE key = 'agent_budget_max_llm_calls';
     ```
   - Execute an autonomous plan
   - Verify warnings appear at 50% and 75%

5. **Test error handling:**
   - Test with invalid API keys (temporarily)
   - Verify graceful error messages

### Integration Test Checklist

- [ ] Database migrations applied successfully
- [ ] Autonomous mode toggle renders correctly
- [ ] Model preset selector appears in autonomous mode
- [ ] Plan progress component displays tasks
- [ ] Budget warnings appear at 50%, 75%, 100%
- [ ] Task statuses update in real-time
- [ ] Confidence scores display correctly
- [ ] Final summary renders with statistics
- [ ] Error handling works gracefully
- [ ] Mode switching is disabled during execution
- [ ] Normal mode still works as expected

---

## Architecture Overview

### Execution Flow

```
User Request (Autonomous Mode)
    ↓
Streaming API (/api/chat/stream)
    ↓
Orchestrator.createAndExecuteAutonomousPlan()
    ↓
┌─────────────────────────────────────┐
│ Phase 1: Planning                   │
│ - Planner Agent creates task list   │
│ - Validates dependencies (no cycles)│
│ - JSON schema validation             │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Phase 2: Execution Loop             │
│ For each task:                       │
│   1. Executor Agent runs task        │
│   2. Checker Agent validates (80%)   │
│   3. Update task state (idempotent)  │
│   4. Check budget (50%, 75%, 100%)   │
│   5. Stream progress to UI           │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Phase 3: Summarization              │
│ - Summarizer Agent generates summary │
│ - Calculate final statistics         │
│ - Stream summary to UI               │
└─────────────────────────────────────┘
    ↓
Final Response to User
```

### Key Design Principles

1. **Fail-Fast**: No retries on task failure, skip and continue
2. **Idempotency**: Tasks can recover from crashes using state history
3. **Budget Enforcement**: Hard stop at 100%, progressive warnings at 50%/75%
4. **Quality Assurance**: 80% confidence threshold, manual review for lower scores
5. **Dependency Validation**: No circular dependencies, DAG structure enforced
6. **Never Auto-Approve**: Checker always flags low confidence or errors for review

---

## Known Issues & Resolutions

This section documents bugs and issues encountered during autonomous mode development and their resolutions.

### Resolved Issues

#### 1. Conversation History Not Accessible
**Symptom:** When referencing data from previous messages (e.g., "Create reports for each item in the above list"), the planner would fail to find the data and either search the web unnecessarily or create incorrect tasks.

**Status:** ✅ RESOLVED

**Resolution:** The planner now receives recent conversation history and explicitly checks both the current user message AND previous messages for referenced data.

---

#### 2. Large Task Plans Failing
**Symptom:** Plans with many items (e.g., 20+ SOEs requiring individual reports) would fail during the planning phase with truncated or malformed output.

**Status:** ✅ RESOLVED

**Resolution:** Token limits for the planner were increased to support larger task breakdowns. The planner can now generate up to 50 tasks for per-item processing.

---

#### 3. No Way to Cancel Long-Running Plans
**Symptom:** Users had no way to stop a long-running autonomous plan and were forced to wait for completion or refresh the page.

**Status:** ✅ RESOLVED

**Resolution:** A kill button was added to the processing indicator, allowing users to cancel autonomous plans at any time.

---

#### 4. Unclear Progress for Large Batches
**Symptom:** During execution of large plans (30+ tasks), users received no feedback about progress or expected duration.

**Status:** ✅ RESOLVED

**Resolution:** Status messages now indicate plan complexity, expected duration for large batches, and the number of documents being generated.

---

#### 5. Network Timeout During Long Operations
**Symptom:** Autonomous mode would fail with `net::ERR_NETWORK_CHANGED` or similar network errors after ~3 minutes, even though tasks were completing successfully on the server.

**Status:** ✅ RESOLVED

**Resolution:** Traefik reverse proxy default timeouts (180s) were killing SSE connections. Extended all Traefik timeouts to 30 minutes in `docker-compose.yml`. See [Infrastructure Configuration](#infrastructure-configuration) for details.

---

#### 5b. Network Error Near End of Long Plans (Task N of N)
**Symptom:** Network error occurs at the very last task (e.g., task 27 of 27), despite Traefik being configured correctly. The total execution time exceeds 5 minutes.

**Status:** ✅ RESOLVED

**Resolution:** The app-level `maxDuration` was limiting streaming sessions to 300 seconds (5 minutes). Added admin-configurable streaming settings:
- **Max Stream Duration**: Increase from default 300s to 480-600s for large plans (20+ tasks)
- **Keepalive Interval**: Reduce to 10s to keep connections alive through proxies
- **Service-level timeout**: Added `responseHeaderTimeout=1800s` to Traefik labels

Configure in Admin UI → Settings → Autonomous Agent → Streaming Configuration.

---

#### 6. Task List Disappearing on Error
**Symptom:** When a network error occurred or streaming ended, the task progress list would immediately disappear, leaving users with no visibility into what was accomplished.

**Status:** ✅ RESOLVED

**Resolution:** The `AutonomousTaskList` component was rendered inside an `{isStreaming && ...}` block. Moved it outside the streaming condition so it persists after errors/completion. Modified files:
- [src/components/chat/ChatWindow.tsx](src/components/chat/ChatWindow.tsx) - Task list now renders independently of streaming state

---

#### 7. No Visibility into Task Execution Details
**Symptom:** Users could only see task status (done/skipped/needs_review) but not what the executor actually did or what the checker found.

**Status:** ✅ RESOLVED

**Resolution:** Extended the streaming pipeline to include full task details:
1. Backend ([streaming-executor.ts](src/lib/agent/streaming-executor.ts)) now sends `result` and `checkerNotes` in `agent_task_completed` event
2. Frontend state ([useStreamingChat.ts](src/hooks/useStreamingChat.ts)) stores and updates these fields
3. UI ([AutonomousTaskList.tsx](src/components/chat/AutonomousTaskList.tsx)) displays:
   - **Executor result**: Gray box showing what was accomplished
   - **Checker notes**: Blue italic text with quality assessment

---

### Current Limitations

#### Per-Item Processing Limit
**Behavior:** When requesting individual outputs for many items using phrases like "for each" or "create separate reports", the system processes a maximum of **25 items** per request.

**Workaround:** For lists with more than 25 items, make additional requests for the remaining items. The system will include a message explaining this limitation when it truncates a large list.

---

## Troubleshooting

### Common Issues

#### 1. "Budget exceeded" errors
**Solution:** Increase budget limits in settings table

#### 2. "Circular dependency detected"
**Solution:** Planner should fix this automatically, but review task dependencies if persists

#### 3. Tasks stuck in "running" state
**Solution:** Crash recovery will transition these to "skipped" after 5 minutes on restart

#### 4. Low confidence scores
**Solution:**
- Review task results manually
- Consider using "quality" preset for better results
- Adjust confidence threshold in settings if needed

#### 5. LLM provider errors
**Solution:** Verify API keys for OpenAI, Gemini, Mistral in environment variables

---

## Execution Controls

Autonomous mode provides full execution control for long-running plans:

### Available Controls

| Control | Icon | Description | Use Case |
|---------|------|-------------|----------|
| **Pause** | ⏸️ | Stop after current task, resumable | Review progress, take a break |
| **Resume** | ▶️ | Continue from last checkpoint | Return after pause |
| **Skip** | ⏭️ | Skip specific pending task | Bypass problematic task |
| **Stop** | ⏹️ | Graceful stop, keep completed work | End early but save results |
| **Abort** | ⏹ (red) | Immediate termination | Emergency stop |

### Control Button States

| State | Pause | Resume | Stop | Skip | Abort |
|-------|-------|--------|------|------|-------|
| Executing | ✅ | ❌ | ✅ | ✅ (pending only) | ✅ |
| Paused | ❌ | ✅ | ✅ | ✅ (pending only) | ✅ |
| Stopped | ❌ | ❌ | ❌ | ❌ | ❌ |
| Completed | ❌ | ❌ | ❌ | ❌ | ❌ |

### API Endpoints

```typescript
POST /api/autonomous/{planId}/pause   // Pause execution
POST /api/autonomous/{planId}/resume  // Resume paused plan
POST /api/autonomous/{planId}/stop    // Graceful stop
POST /api/autonomous/{planId}/tasks/{taskId}/skip  // Skip task
```

### SSE Control Events

```typescript
| { type: 'agent_paused'; plan_id: string; completed_tasks: number; total_tasks: number; message: string }
| { type: 'agent_resumed'; plan_id: string; remaining_tasks: number; total_tasks: number; message: string }
| { type: 'agent_stopped'; plan_id: string; completed_tasks: number; skipped_tasks: number; total_tasks: number; summary?: string }
| { type: 'agent_task_skipped'; plan_id: string; task_id: number; reason?: string }
```

### UI Components

**ProcessingIndicator** ([src/components/chat/ProcessingIndicator.tsx](src/components/chat/ProcessingIndicator.tsx)):
- Shows pause/resume/stop buttons during autonomous execution
- Hard abort button always available

**AutonomousTaskList** ([src/components/chat/AutonomousTaskList.tsx](src/components/chat/AutonomousTaskList.tsx)):
- Shows paused/stopped status banner
- Skip button next to each pending task
- Persists after streaming ends (visible after errors)

---

## Future Enhancements (Not in v1)

- [x] ~~Pause/Resume functionality~~ (v1.3)
- [x] ~~Skip task functionality~~ (v1.3)
- [x] ~~Graceful stop~~ (v1.3)
- [ ] Retry logic with exponential backoff
- [ ] Per-category budget overrides
- [ ] Real-time budget usage visualization
- [ ] Task dependency graph visualization
- [ ] Export plan results to PDF/CSV
- [ ] Multi-user budget pooling
- [ ] Advanced task types (code generation, API calls, etc.)

---

## Support & Feedback

For issues or questions about autonomous mode integration:
1. Check this documentation first
2. Review the plan file: `/home/ab/.claude/plans/jaunty-scribbling-mochi.md`
3. Check implementation files in `src/lib/agent/`

---

## Implementation Completion Status

**✅ COMPLETE - Ready for Testing**

All core functionality has been implemented:
- ✅ Database schema extended
- ✅ All agent components implemented
- ✅ Streaming API integrated
- ✅ Frontend components created
- ✅ Budget tracking with warnings
- ✅ Confidence scoring (80% threshold)
- ✅ Crash recovery (idempotent state transitions)
- ✅ Dependency validation (circular detection)
- ✅ Multi-provider LLM support

**Next Steps:**
1. Integrate ModeToggle into existing MessageInput component
2. Integrate AgentPlanProgress into ChatWindow component
3. Update SSE event handlers to process autonomous mode events
4. Test end-to-end with sample autonomous requests
5. Adjust budget limits and confidence thresholds based on testing

---

**Last Updated:** 2026-01-11
**Implementation Time:** ~22-24 hours
**Version:** 1.3 (Execution Controls & Streaming Config)

### Changelog

#### v1.3 (2026-01-11)
- **Execution Controls**: Added pause/resume/stop/skip functionality for autonomous plans
  - Pause: Stop after current task, resumable later
  - Resume: Continue from last checkpoint
  - Stop: Graceful termination, keeps completed work
  - Skip: Skip specific pending tasks
- **Admin-Configurable Streaming**: New settings in Admin UI
  - Keepalive Interval (5-60s, default 10s)
  - Max Stream Duration (60-600s, default 300s)
  - Tool Timeout (30-300s, default 60s)
- **Traefik Enhancements**: Added service-level `responseHeaderTimeout` for reliable long connections
- **Token Usage Display**: Shows LLM calls, tokens used, and web searches in task list stats
- Updated SSE event types with control events (`agent_paused`, `agent_resumed`, `agent_stopped`, `agent_task_skipped`)

#### v1.2 (2026-01-10)
- Added Traefik timeout configuration for long-running SSE connections (30 min)
- Fixed task list visibility - now persists after streaming ends or errors
- Added executor result text and checker notes to task display
- Updated SSE event types with `result` and `checkerNotes` fields
- Added Admin UI configuration documentation

#### v1.1 (2026-01-09)
- Added conversation history to planner prompt
- Added per-item task creation for batch processing
- Increased MAX_TOOL_CALL_ITERATIONS
- Added max_tokens to agent model config with admin UI support

#### v1.0 (Initial Release)
- Core autonomous mode infrastructure
- Plan → Execute → Check → Summarize workflow
- Budget tracking with warnings
- Multi-provider LLM routing
