# Quick Dispatch — Design Spec

## Summary

Add a global `Cmd+K` quick dispatch input that parses natural language into task fields, shows a confirmation card, and creates the task in one step.

Example: `帮 Chao 做一个 P1 的 OAuth 集成，明天截止` → title: "OAuth 集成", priority: URGENT, assignee: Chao, dueDate: tomorrow, project: (AI-inferred).

## Scope

- **New feature alongside existing NewTaskModal** — both entry points coexist for now.
- No changes to existing task creation flow, API routes, or data model.

## User Flow

```
Cmd+K (or click button) → Minimal input box (floating modal)
  ↓
User types natural language, presses Enter
  ↓
POST /api/tasks/parse-quick-dispatch
  ↓
AI parses → returns structured fields
  ↓
Validation:
  - Title too vague (e.g. "new task")? → Show inline prompt: "请更具体地描述任务"
  - No project resolved? → Show inline prompt: "请指定项目，例如「Lumo 后端」"
  ↓
All required fields resolved → Show confirmation card
  ↓
Confirmation card (default: read-only preview)
  - Shows: title, project, priority, assignee, due date, AI-generated description
  - "编辑" button → expands inline field editors (same selects as NewTaskModal)
  - "确认创建" → calls existing handleCreateTask flow
  - "取消" → back to input box
```

## Architecture

### New Files

| File                                                                    | Purpose                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `app/api/tasks/parse-quick-dispatch/route.ts`                           | API route: AI parses natural language → structured task fields |
| `lib/validation/schemas.ts` (update)                                    | Add `quickDispatchSchema` for request validation               |
| `lib/prompts/quick-dispatch.ts`                                         | System prompt + response schema for parsing                    |
| `app/workspace/[workspaceUrl]/components/modals/QuickDispatchModal.tsx` | The floating input box + confirmation card UI                  |
| `app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts`                | Hook: manages input state, API call, parsed result             |

### API: POST /api/tasks/parse-quick-dispatch

**Request:**

```typescript
{
  input: string // Raw natural language input
  workspaceUrl: string // For resolving projects/members
}
```

**Response:**

```typescript
{
  parsed: {
    title: string
    description: string // AI-generated, 1-2 sentences
    priority: ApiPriority // Inferred or default MEDIUM
    projectId: string | null // Resolved project ID or null
    projectName: string | null // For display
    assigneeActorId: string | null
    assigneeName: string | null // For display
    dueDate: string | null // ISO datetime
    status: ApiStatus // Default TODO
  }
  validation: {
    titleTooVague: boolean // true if title needs clarification
    missingProject: boolean // true if no project could be resolved
  }
  confidence: {
    title: number // 0-1
    priority: number
    project: number
    assignee: number
    dueDate: number
  }
}
```

**Server logic:**

1. `requireAuth()` → get userId
2. Look up workspace by slug → verify membership
3. Fetch all projects (id, name, description) and members (name, actorId) for context
4. Call Claude with structured output schema
5. Validate: if title is generic ("new task", "做个东西", etc.) → set `titleTooVague: true`
6. Return parsed result

### AI Prompt Design

System prompt provides:

- List of workspace projects (id, name, description)
- List of workspace members (name, actorId)
- Current date (for relative date resolution: "明天", "下周五", "this Friday")
- Priority mapping: P0/P1/紧急/urgent → URGENT, P2/高/high → HIGH, P3/中/medium → MEDIUM, P4/低/low → LOW

The model extracts fields from natural language input, matching against provided project/member lists by fuzzy name matching.

### QuickDispatchModal Component

**States:** `idle` → `loading` → `preview` → `editing`

```
┌─────────────────────────────────────────────┐
│  ✦ Quick Dispatch                      ✕    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 帮 Chao 做一个 P1 的 OAuth 集成...  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ↓ (after parsing)                          │
│                                             │
│  ┌─ Confirmation Card ─────────────────┐    │
│  │  Title:    OAuth 集成                │    │
│  │  Project:  Lumo 后端                 │    │
│  │  Priority: 🔴 URGENT                │    │
│  │  Assignee: Chao                      │    │
│  │  Due:      2026-04-08                │    │
│  │  Desc:     实现 OAuth 2.0 登录集成... │    │
│  │                                      │    │
│  │  [确认创建]  [编辑]  [取消]           │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Edit mode:** Replaces read-only fields with the same selects used in NewTaskModal (StatusSelect, ProjectSelect, AssigneeSelect, PrioritySelect, DueDatePicker). Description becomes editable via DescriptionEditor.

### Global Shortcut Registration

In `WorkspaceApp.tsx`:

- Add `useEffect` for `keydown` listener on `Cmd+K` / `Ctrl+K`
- `e.preventDefault()` to suppress browser default
- Open QuickDispatchModal
- Pass `projects`, `members`, `handleCreateTask` as props (same as NewTaskModal)

## Field Resolution Rules

| Field       | How resolved                                                   | Fallback                                |
| ----------- | -------------------------------------------------------------- | --------------------------------------- |
| Title       | Extracted from input, cleaned up                               | Required — ask user to clarify if vague |
| Project     | Fuzzy match against workspace project names                    | Required — ask user to specify          |
| Priority    | Keywords: P0/P1/urgent/紧急 → URGENT, etc.                     | Default: MEDIUM                         |
| Assignee    | Fuzzy match against member names                               | Default: none                           |
| Due date    | Parse relative/absolute dates, using current date as reference | Default: none                           |
| Status      | Keywords: doing/进行中 → IN_PROGRESS                           | Default: TODO                           |
| Description | AI-generated based on parsed title + context                   | Always generated                        |

## Validation Rules

**Title too vague** — reject if:

- Generic phrases: "new task", "新任务", "做个东西", "task", "something"
- Under 4 characters after cleaning
- No meaningful noun/verb content

**Missing project** — surface as inline prompt, not a blocker for parsing. User can retry with project name or pick from a quick-select.

## Integration Points

- Reuses `handleCreateTask` from WorkspaceApp (same optimistic update flow)
- Reuses existing field select components (ProjectSelect, AssigneeSelect, etc.)
- Reuses AI description generation for the description field
- Does NOT touch NewTaskModal — both coexist

## Out of Scope

- Replacing NewTaskModal (evaluate after trying quick dispatch)
- Batch task creation from natural language
- Voice input
- Slash commands within the input box
