# Quick Dispatch v2 — Design Spec

## Summary

Upgrade the existing Quick Dispatch (Cmd+K) from "create-only" to a full "create + update + batch" command bar. Users type natural language with optional `@` mentions to update task statuses, create new tasks, and assign tasks — all in one input.

**Example inputs:**

- `@ENG-42 完成` → update ENG-42 status to DONE
- `@登录bug 进行中，创建支付集成 @PaymentProject @张三` → update + create in one go
- `ENG-42 done` → rule-parsed, no AI needed

## Scope

- **Extends existing Quick Dispatch** — same Cmd+K entry point, same modal shell
- **New capabilities:** task status updates, `@` mentions, batch operations, rule-based parsing
- **No changes to:** NewTaskModal, kanban add-task flow, existing task CRUD APIs
- **Replaces:** `2026-04-07-quick-dispatch-design.md` (v1 spec)

## User Flow

```
Cmd+K (or click button) → Quick Dispatch input box
  ↓
User types natural language with optional @ mentions
  - @ triggers autocomplete popover (tasks, projects, members)
  - Tab/Enter/Click to select mention
  ↓
Enter to submit
  ↓
POST /api/tasks/parse-quick-dispatch (upgraded)
  ↓
Rule parser runs first:
  - @ mentions with structured IDs → instant resolution
  - Status keywords matched → action determined
  - Fully parsed? → skip AI
  ↓
AI fallback (only for unparsed portions):
  - Receives: unparsed text + user's assigned tasks + projects + members
  - Returns: QuickAction[] in same format
  ↓
Merge rule + AI results → actions[]
  ↓
Preview screen:
  - Single action → show inline preview
  - Multiple actions → show action list with per-item remove
  ↓
User confirms → POST /api/tasks/quick-dispatch/execute
  ↓
Results displayed → modal closes
```

## @ Mention System

### Syntax

| Syntax      | Meaning                 | Example                    |
| ----------- | ----------------------- | -------------------------- |
| `@人名`     | Assign to member        | `创建支付任务 @张三`       |
| `@ENG-42`   | Reference task by ID    | `@ENG-42 标记完成`         |
| `@任务标题` | Reference task by title | `@登录bug 改为进行中`      |
| `@项目名`   | Specify project         | `创建任务 @PaymentProject` |

### Autocomplete Data Sources

| Type     | Source                | Display Format     |
| -------- | --------------------- | ------------------ |
| Tasks    | User's assigned tasks | `ENG-42 OAuth集成` |
| Projects | Workspace projects    | `Lumo 后端`        |
| Members  | Workspace members     | `张三`             |

### Frontend Mention Format

The input component sends structured mentions alongside the raw text:

```typescript
type QuickDispatchInput = {
  text: string // Raw text with @ placeholders
  workspaceUrl: string
  mentions: Mention[]
}

type Mention =
  | { type: 'task'; id: string; position: [number, number] }
  | { type: 'project'; id: string; position: [number, number] }
  | { type: 'member'; actorId: string; position: [number, number] }
```

## Parsing Layer

### Layer 1: Rule Parser (pure function, zero latency)

Processes all structured `@` mentions and status keywords. No network calls.

**Status keyword table (zh + en):**

| Keywords                               | Maps to     |
| -------------------------------------- | ----------- |
| `完成` `done` `搞定` `关闭` `close`    | DONE        |
| `进行中` `doing` `开始` `start` `开工` | IN_PROGRESS |
| `评审` `review` `提审`                 | IN_REVIEW   |
| `待办` `todo` `回退` `reopen`          | TODO        |

**Priority keyword table:**

| Keywords             | Maps to |
| -------------------- | ------- |
| `P0` `紧急` `urgent` | URGENT  |
| `P1` `高` `high`     | HIGH    |
| `P2` `中` `medium`   | MEDIUM  |
| `P3` `低` `low`      | LOW     |

**Action keyword table:**

| Keywords                     | Action         |
| ---------------------------- | -------------- |
| `创建` `新建` `add` `create` | type: "create" |

**Rule parser logic:**

1. Iterate through mentions and their surrounding text context
2. Task mention + status keyword → `{ type: "update", taskId, fields: { status } }`
3. "Create" keyword + title text + optional project/member mentions → `{ type: "create", ... }`
4. Member mention near task → assign action
5. Unresolved text segments → pass to AI layer

### Layer 2: AI Parser (fallback, only when needed)

Triggered only for text segments the rule parser cannot resolve. Receives:

- Unparsed text fragments
- User's assigned tasks (id, title, status) — **search scope limited to user's own tasks**
- Workspace project list (id, name, description)
- Workspace member list (name, actorId)

AI returns `QuickAction[]` in the same format as rule parser.

**Project resolution for creates (AI):**

1. AI infers project from input context (e.g., "登录相关" → Auth project)
2. Fallback: user's most recently active project

### Merge Strategy

Rule-parsed actions (`confidence: "high"`) + AI-parsed actions (`confidence: "medium" | "low"`) merged into final list. Duplicate task references deduplicated (rule result wins).

## Action Data Structures

```typescript
type QuickAction =
  | {
      type: 'update'
      taskId: string
      taskIdentifier: string // e.g. "ENG-42"
      taskTitle: string
      fields: {
        status?: TaskStatus
        assigneeActorId?: string
        priority?: TaskPriority
      }
      confidence: 'high' | 'medium' | 'low'
    }
  | {
      type: 'create'
      title: string
      status: TaskStatus
      priority: TaskPriority
      projectId: string | null
      projectName: string | null
      assigneeActorId: string | null
      assigneeName: string | null
      description: string
      dueDate: string | null
      confidence: 'high' | 'medium' | 'low'
    }

type ParseResult = {
  actions: QuickAction[]
  needsConfirmation: boolean // true when multiple actions or AI-inferred
}
```

## API Design

### Parse: `POST /api/tasks/parse-quick-dispatch` (upgraded)

**Request:**

```typescript
{
  input: string
  workspaceUrl: string
  mentions: Mention[]  // NEW
}
```

**Response:**

```typescript
{
  actions: QuickAction[]
  needsConfirmation: boolean
}
```

**Server logic:**

1. `requireAuth()` → get userId, actorId
2. Look up workspace → verify membership
3. Run rule parser on input + mentions → `ruleActions[]`
4. If unparsed segments remain:
   a. Fetch user's assigned tasks, projects, members
   b. Call Claude with unparsed text + context → `aiActions[]`
5. Merge rule + AI actions, deduplicate
6. Return `{ actions, needsConfirmation }`

### Execute: `POST /api/tasks/quick-dispatch/execute` (new)

**Request:**

```typescript
{
  actions: QuickAction[]
  workspaceUrl: string
}
```

**Response:**

```typescript
{
  results: ActionResult[]
}

type ActionResult =
  | { type: "updated"; taskId: string; taskIdentifier: string; success: true }
  | { type: "created"; taskId: string; taskIdentifier: string; success: true }
  | { type: "error"; index: number; message: string; success: false }
```

**Server logic:**

1. `requireAuth()` → get userId, actorId
2. For each action:
   - `update` → call `taskService.updateTask(taskId, fields)` (validates state machine)
   - `create` → call existing project task creation flow (with assignee = current user)
3. If `create` action has `projectId: null` → return error for that action ("missing project")
4. Fire Pusher events + notifications (same as existing flows)
5. Return results array (partial success allowed — some actions may succeed while others fail)

## Frontend Changes

### MentionInput Component (new)

Rich text input with `@` autocomplete:

- Typing `@` opens a popover with filtered candidates
- Categories: Tasks (user's assigned), Projects, Members
- Selection inserts a styled mention tag (non-editable inline badge)
- Backspace on a mention tag removes it entirely
- Maintains `mentions[]` array in sync with displayed tags

### QuickDispatchModal Changes

**Input phase:**

- Replace plain `<input>` with `MentionInput`
- Rest unchanged (Enter to parse, Escape to close)

**Preview phase — single action:**

- Same as current v1 card (create) or a simple status change line (update)

**Preview phase — multiple actions:**

```
┌─ Quick Dispatch ──────────────────────────┐
│  @ENG-42 完成，@登录bug 进行中             │
│                                           │
│  ┌─ 操作预览 ──────────────────────────┐  │
│  │ ↻ ENG-42 OAuth集成   TODO → DONE  ✕ │  │
│  │ ↻ ENG-15 登录bug  TODO → IN_PROG  ✕ │  │
│  │ + 支付集成  Payment  @张三  TODO   ✕ │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  [返回]           [确认执行 (3)]           │
└───────────────────────────────────────────┘
```

- `↻` = update, `+` = create
- Per-action remove button (✕)
- Confirm button shows action count

### useQuickDispatch Hook Changes

- `phase`: add `executing` state → `idle | input | loading | preview | executing`
- `result` → `actions: QuickAction[]`
- New methods: `execute()`, `removeAction(index: number)`
- `parse()` sends `mentions[]` alongside input text

## Integration Points

- Reuses `taskService.updateTask()` for status updates (respects state machine)
- Reuses existing project task creation flow for creates
- Reuses Pusher events + notification dispatch
- NewTaskModal unchanged — kanban add-task continues to use it
- Global Cmd+K shortcut unchanged

## Out of Scope

- Voice input
- Slash commands within the input box
- Replacing NewTaskModal
- Offline/optimistic execution (execute is server-confirmed)
- Task deletion via Quick Dispatch
