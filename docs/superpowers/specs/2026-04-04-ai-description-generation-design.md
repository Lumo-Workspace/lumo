# AI Description Generation — Design Spec

## Overview

When a task's description is empty, show an AI prompt card that generates 1–2 sentences of execution instructions based on the task title and project context. When a description already exists, show a subtle "✦ Refine" button that rewrites the description with AI assistance.

**Scope:** NewTaskModal + TaskDetailPanel (both surfaces).

## Two Modes

### Mode 1: Generate (description empty)

1. A purple dashed-border prompt card appears **above** the Tiptap editor:
   - Icon: ✦ (sparkle)
   - Title: "AI generate description"
   - Subtitle: "Generate 1–2 execution instructions from title + project context"
   - Arrow indicator on the right
2. User clicks the card → card transforms to loading state ("Generating description...")
3. AI returns → a **read-only preview card** replaces the loading state, rendering the generated HTML
4. Three action buttons: **"Use this"** / **"↻ Regenerate"** / **"Cancel"**
   - "Use this" → inserts HTML into Tiptap editor, preview card disappears, prompt card disappears
   - "Regenerate" → returns to loading state, calls API again
   - "Cancel" → preview card disappears, prompt card reappears

### Mode 2: Refine (description has content)

1. The AI prompt card is **hidden**
2. A small **"✦ Refine"** button appears at the bottom-right corner of the editor area
3. Click → same preview card flow as Mode 1, but the API receives the existing description for rewriting
4. On "Use this" → editor content is **replaced** with the new HTML

## Visibility Rules

| Condition                             | Prompt card | Refine button |
| ------------------------------------- | ----------- | ------------- |
| No title                              | Hidden      | Hidden        |
| Title filled, description empty       | Visible     | Hidden        |
| Title filled, description has content | Hidden      | Visible       |
| AI loading/preview active             | Transformed | Hidden        |

**Title threshold:** Title must be ≥ 3 characters to show the AI prompt/refine button.

## API Design

### Endpoint

`POST /api/tasks/generate-description`

### Request Body

```typescript
{
  title: string                   // Task title (required, ≥ 3 chars)
  projectId: string               // Project ID for context lookup
  existingDescription?: string    // Existing HTML description (refine mode)
}
```

### Response

```typescript
{
  description: string // Generated HTML (lightweight rich text)
}
```

### Validation Schema (Zod)

```typescript
const generateDescriptionSchema = z.object({
  title: z.string().min(3).max(200),
  projectId: z.string().cuid(),
  existingDescription: z.string().optional(),
})
```

### Server Logic

1. Auth: `requireAuth()` — workspace membership is verified implicitly by checking the user has access to the project (project query scoped to user's workspaces)
2. Validate request body with `generateDescriptionSchema`
3. Fetch project context from DB (also serves as authorization — if project not found or user has no access, return 404):
   - `project.name`, `project.description`
   - Last 10 tasks in project: `title` + `description` (via Prisma `select`, ordered by `createdAt desc`, limit 10)
4. Build prompt (see Prompt Design below)
5. Call `generateObject` via Vercel AI Gateway:

   ```typescript
   import { generateObject } from 'ai'
   import { gateway } from '@ai-sdk/gateway'

   const { object } = await generateObject({
     model: gateway('anthropic/claude-sonnet-4.5'),
     schema: descriptionResponseSchema,
     prompt,
   })
   ```

6. Return `{ description: object.description }`

### Prompt Design

**Generate mode (no existing description):**

```
You are a project management assistant. Generate a concise task description (1–2 sentences of execution instructions) for the following task.

Project: {projectName}
Project description: {projectDescription}

Recent tasks in this project for style reference:
{recentTasks.map(t => `- ${t.title}: ${t.description}`).join('\n')}

Task title: {title}

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li> (for steps), <input type="checkbox"> (for checklists). Keep it actionable and concise — focus on HOW to execute, not WHAT the task is (the title already says that).
```

**Refine mode (existing description provided):**

```
You are a project management assistant. Improve the following task description — make it more actionable, specific, and well-structured.

Project: {projectName}
Project description: {projectDescription}

Recent tasks in this project for style reference:
{recentTasks.map(t => `- ${t.title}: ${t.description}`).join('\n')}

Task title: {title}
Current description: {existingDescription}

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">. Preserve the original intent but make it clearer and more actionable.
```

### AI Response Schema (Zod)

```typescript
const descriptionResponseSchema = z.object({
  description: z
    .string()
    .describe('Generated HTML description, lightweight rich text'),
})
```

## Component Design

### `AiDescriptionPrompt` (Client Component)

**Location:** `app/workspace/[workspaceUrl]/components/AiDescriptionPrompt.tsx`

**Props:**

```typescript
interface AiDescriptionPromptProps {
  title: string
  projectId: string
  existingDescription: string | null // null = generate mode, non-null = refine mode
  onAccept: (html: string) => void
  onCancel?: () => void
}
```

**Internal State Machine:**

```
idle → loading → preview → idle
         ↑          |
         └── regenerate
```

States:

- `idle` — shows prompt card (generate) or refine button (refine)
- `loading` — shows spinner with "Generating description..."
- `preview` — shows read-only rendered HTML + action buttons

**API Call:**

```typescript
const response = await apiFetch('/api/tasks/generate-description', {
  method: 'POST',
  body: JSON.stringify({ title, projectId, existingDescription }),
})
```

**Rendering Logic:**

```
if (title.length < 3) → render nothing
if (state === 'loading') → render loading card
if (state === 'preview') → render preview card with actions
if (existingDescription) → render refine button only
else → render prompt card
```

### Integration Points

**NewTaskModal:**

- `AiDescriptionPrompt` placed between the "Description" label and the `DescriptionEditor`
- `onAccept(html)` → sets `descriptionRef.current = html` and calls editor's `setContent(html)`
- `title` comes from the modal's title input state
- `projectId` comes from the modal's selected project

**TaskDetailPanel:**

- `AiDescriptionPrompt` placed between the description label/header and the `DescriptionEditor`
- `onAccept(html)` → calls `handlePatch({ description: html })` to persist, and updates editor content
- `title` comes from `task.title`
- `projectId` comes from `task.projectId`
- `existingDescription` comes from `task.description`

## Edge Cases

| Case                                 | Behavior                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Title < 3 chars                      | AI prompt/refine button hidden                                                     |
| Title very generic (e.g., "Fix bug") | AI generates best-effort description; no special handling needed                   |
| No project description               | Omit from prompt context; recent tasks still provide style reference               |
| No recent tasks in project           | Omit recent tasks section from prompt; generate based on title + project name only |
| API error / timeout                  | Show error toast, return to idle state, user can retry                             |
| User edits title after generating    | Preview stays visible (already generated); user can regenerate or cancel           |
| Rapid clicks                         | Disable prompt card/button during loading state                                    |
| Generated HTML is empty              | Treat as error, show toast "Failed to generate description"                        |

## Error Handling

- Network/API errors → show toast notification, return to idle state
- AI model errors → catch in API route, return 500 with `{ error: 'Failed to generate description' }`
- Validation errors → return 400 with field-level error messages

## UI Styling

- Prompt card: `border-2 border-dashed border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-800`
- Preview card: `border border-indigo-300 bg-white dark:bg-zinc-900`
- "Use this" button: `bg-indigo-500 text-white hover:bg-indigo-600`
- "Regenerate" button: `border border-indigo-300 text-indigo-500`
- "Cancel" button: `border border-zinc-300 text-zinc-500`
- Refine button: `bg-indigo-50 text-indigo-500 border border-indigo-200 text-xs`
- Dark mode: all colors have dark variants using Tailwind's `dark:` prefix

## Dependencies

- Existing: `ai`, `@ai-sdk/gateway`, `zod`
- No new packages needed
