# AI Task Priority Suggestion

## Overview

When creating a task, AI silently analyzes the title and description in the background, then suggests a priority level. The suggestion appears inline without blocking the form. Users see three layers of information: the recommended priority (highlighted), a one-line reason, and historical task references. When users override the suggestion, the system records their preference to improve future recommendations.

## Decisions

| Dimension              | Decision                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| History matching       | Structured fields (project, assignee) to narrow scope + semantic similarity to rank |
| Preference granularity | User + project combination (most fine-grained)                                      |
| Trigger timing         | Two-stage: after title (initial), after description (refined)                       |
| Override data          | Store result only (AI suggested vs user chosen), no reason required                 |
| Display                | Inline replacement of PrioritySelect + "AI Recommended" label + tooltip             |
| Historical reference   | Stats summary + up to 2 specific similar task links                                 |
| AI approach            | Pure prompt with `generateObject` + Zod schema (Vercel AI SDK)                      |

## Data Model

New table `PriorityOverride` — stores each instance where a user chose a different priority than AI suggested.

```prisma
model PriorityOverride {
  id              String       @id @default(cuid())
  taskId          String
  task            Task         @relation(fields: [taskId], references: [id], onDelete: Cascade)
  memberId        String
  projectId       String
  project         Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  aiSuggested     TaskPriority
  userChosen      TaskPriority
  taskTitle       String
  taskDescription String?
  createdAt       DateTime     @default(now())

  @@index([memberId, projectId])
}
```

Design rationale:

- Independent table, not added to Task or UserPreference — keeps concerns separate.
- Redundant `taskTitle`/`taskDescription` avoids joining Task table when querying preference patterns, and preserves the original text even if the task is later edited.
- `memberId + projectId` composite index serves the primary query: "all overrides by this user in this project."
- No aggregation table — small team scale means computing stats from raw records is sufficient.

## API Design

### POST /api/tasks/suggest-priority

Request:

```typescript
{
  projectId: string
  title: string
  description?: string  // present in stage 2 only
}
```

Processing:

1. Query the project's recent 50 tasks regardless of status (structured filter by projectId, ordered by createdAt desc).
2. Query the user's PriorityOverride records for this project (most recent 30).
3. Assemble prompt with historical tasks + preference records + current input.
4. Call `generateObject` with Claude via Vercel AI SDK, constrained by Zod schema.

Response:

```typescript
{
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  reason: string           // e.g. "Involves core auth module, affects all users"
  stats: {
    total: number
    distribution: {
      [key in TaskPriority]: number
    }
  }
  similarTasks: Array<{
    id: string
    number: number         // e.g. 42 for LUM-42
    title: string
    priority: TaskPriority
  }>                       // max 2 items
}
```

### POST /api/tasks/priority-override

Request:

```typescript
{
  taskId: string
  projectId: string
  aiSuggested: TaskPriority
  userChosen: TaskPriority
  taskTitle: string
  taskDescription?: string
}
```

Processing: Create PriorityOverride record, return 201. Called after task creation succeeds, only when the user changed the AI suggestion.

## Frontend Interaction Flow

### Stage 1: Title Trigger

1. User finishes typing the title — blur or 500ms debounce.
2. Small spinner appears next to PrioritySelect (non-blocking, user continues filling other fields).
3. Call `suggest-priority` with title only.
4. On response:
   - If user has **not** manually selected a priority → replace PrioritySelect value with AI suggestion.
   - If user **has** manually selected → do not replace, show suggestion in tooltip only.
5. "AI Recommended" label appears next to PrioritySelect. Hover shows tooltip.

### Stage 2: Description Trigger

1. User finishes typing the description — blur or 800ms debounce.
2. Same spinner, call `suggest-priority` again with title + description.
3. If new suggestion differs from stage 1 and user hasn't manually changed → update the value.
4. Tooltip content refreshes with potentially more detailed reason.

### Tooltip Content (Three Layers)

```
Recommended: HIGH
"Involves core auth module, affects all users"

5 similar tasks: HIGH ×3, MEDIUM ×1, URGENT ×1
• LUM-42 Fix login timeout — HIGH
• LUM-38 Session expiry handling — HIGH
```

### Override Feedback

1. User manually selects a different priority than AI suggested.
2. "AI Recommended" label transitions to "Preference Recorded", fades out after 2 seconds.
3. After task creation succeeds, background call to `priority-override` stores the record.

## Prompt Design

### System Prompt

```
You are a task priority analysis assistant. Based on the project's historical
task patterns and user preferences, recommend a priority for the new task.

Priority definitions:
- LOW: Does not affect core functionality, can be deferred
- MEDIUM: Normal iteration requirement
- HIGH: Affects core flows or multiple users
- URGENT: Production incident or blocking issue

When recommending, prioritize:
1. User's historical preferences (override records have highest weight)
2. Priority distribution of similar tasks in the same project
3. Urgency signals in the task description
```

### User Prompt (Dynamically Assembled)

```
## Current Task
Title: {title}
Description: {description || "Not provided"}
Project: {projectName}

## User's Preference Records in This Project (recent 30 overrides)
{overrides.map(o => `"${o.taskTitle}" → AI suggested ${o.aiSuggested}, user chose ${o.userChosen}`)}

## Project Historical Tasks (recent 50)
{tasks.map(t => `[${t.priority}] #${t.number} ${t.title}`)}
```

### Output Schema

```typescript
const SuggestionSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  reason: z.string().max(100),
  stats: z.object({
    total: z.number(),
    distribution: z.record(z.number()),
  }),
  similarTasks: z
    .array(
      z.object({
        id: z.string(),
        number: z.number(),
        title: z.string(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
      })
    )
    .max(2),
})
```

The `similarTasks` ids and numbers come from the historical task data included in the prompt — the model references existing tasks, it does not fabricate them.

## Error Handling and Edge Cases

**API failure / timeout:**

- 5-second timeout. On timeout, spinner disappears, PrioritySelect keeps default MEDIUM, no AI label shown.
- Silent failure — no toast or error message. AI suggestion is an enhancement, not a blocker.

**Cold start (new user / new project):**

- No preference records: preference section of prompt is empty, model relies on historical tasks and content.
- No historical tasks: history section is empty, model relies on content and priority definitions.
- Neither exists: model gives a basic recommendation from content alone (lower quality, but still functional).

**Title too short:**

- Fewer than 4 characters does not trigger stage 1. Waits for stage 2 (description).
- Avoids low-quality suggestions from titles like "fix" or "bug".

**Rapid consecutive input:**

- Debounce ensures only the last input triggers a request.
- AbortController cancels in-flight requests to prevent stale responses overwriting newer ones.

**Stage 2 result same as stage 1:**

- No UI update, no flicker. Tooltip content may subtly update (more detailed reason).

## Testing Strategy

### API Tests (`__tests__/suggest-priority.test.ts`)

- With historical tasks + preference records → returns correctly formatted suggestion
- Cold start (no history, no preferences) → still returns valid suggestion
- Title too short → returns 400 or skips suggestion
- Override record creation → PriorityOverride created with correct fields

### Frontend Tests (`__tests__/priority-suggestion.test.ts`)

- Title blur triggers request, spinner shows
- Suggestion arrives → PrioritySelect value updates, "AI Recommended" label appears
- User manually selects different priority → label changes to "Preference Recorded"
- User already manually selected → AI suggestion does not override
- API timeout → spinner disappears, no error, default value preserved
- Debounce → rapid input fires only one request

### Prompt Tests (`__tests__/priority-prompt.test.ts`)

- Preference records correctly serialized into prompt
- Historical task list correctly truncated to 50
- Empty description renders as "Not provided" in prompt

## Files to Create or Modify

| Action | Path                                                   | Purpose                                    |
| ------ | ------------------------------------------------------ | ------------------------------------------ |
| Create | `app/api/tasks/suggest-priority/route.ts`              | Suggestion API endpoint                    |
| Create | `app/api/tasks/priority-override/route.ts`             | Override recording endpoint                |
| Create | `lib/prompts/priority.ts`                              | System prompt + prompt builder             |
| Create | `lib/schemas/priority.ts`                              | Zod schema for suggestion output           |
| Create | `hooks/usePrioritySuggestion.ts`                       | Frontend hook: debounce, fetch, state      |
| Modify | `app/workspace/.../components/TaskFieldSelects.tsx`    | Add AI label + tooltip to PrioritySelect   |
| Modify | `app/workspace/.../components/modals/NewTaskModal.tsx` | Wire up the hook, handle override feedback |
| Modify | `prisma/schema.prisma`                                 | Add PriorityOverride model                 |
| Create | `__tests__/suggest-priority.test.ts`                   | API tests                                  |
| Create | `__tests__/priority-suggestion.test.ts`                | Frontend tests                             |
| Create | `__tests__/priority-prompt.test.ts`                    | Prompt tests                               |
