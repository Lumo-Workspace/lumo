# AI Description Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered description generation (empty → generate) and refinement (existing → rewrite) to both NewTaskModal and TaskDetailPanel.

**Architecture:** A single reusable `AiDescriptionPrompt` client component handles both generate and refine modes with an idle→loading→preview state machine. A new `POST /api/tasks/generate-description` endpoint uses Vercel AI Gateway (`generateObject` with `anthropic/claude-sonnet-4.5`) to produce lightweight HTML descriptions. The component is integrated into NewTaskModal (between title and editor) and TaskDetailPanel (above DescriptionEditor).

**Tech Stack:** Next.js 14 App Router, TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/gateway`), Zod, Tiptap (DescriptionEditor), Tailwind CSS, Prisma.

---

### Task 1: Add Zod Validation Schema

**Files:**

- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add the generate-description schema to schemas.ts**

Add at the end of the file, after the `batchCreateTasksSchema`:

```typescript
// ─── AI Description Generation ──────────────────────────────────────────────
export const generateDescriptionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(200),
  projectId: z.string().cuid(),
  existingDescription: z.string().max(10000).optional(),
})
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat: add generateDescriptionSchema for AI description endpoint"
```

---

### Task 2: Create API Endpoint

**Files:**

- Create: `app/api/tasks/generate-description/route.ts`

- [ ] **Step 1: Create the generate-description route**

Create file `app/api/tasks/generate-description/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/prisma'
import { generateDescriptionSchema } from '@/lib/validation/schemas'

const descriptionResponseSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
})

function buildPrompt({
  title,
  projectName,
  projectDescription,
  recentTasks,
  existingDescription,
}: {
  title: string
  projectName: string
  projectDescription: string | null
  recentTasks: { title: string; description: string | null }[]
  existingDescription?: string
}): string {
  const projectContext = projectDescription
    ? `Project: ${projectName}\nProject description: ${projectDescription}`
    : `Project: ${projectName}`

  const recentTasksContext =
    recentTasks.length > 0
      ? `\nRecent tasks in this project for style reference:\n${recentTasks
          .map(t => `- ${t.title}${t.description ? `: ${t.description}` : ''}`)
          .join('\n')}`
      : ''

  if (existingDescription) {
    return `You are a project management assistant. Improve the following task description — make it more actionable, specific, and well-structured.

${projectContext}${recentTasksContext}

Task title: ${title}
Current description: ${existingDescription}

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">. Preserve the original intent but make it clearer and more actionable.`
  }

  return `You are a project management assistant. Generate a concise task description (1–2 sentences of execution instructions) for the following task.

${projectContext}${recentTasksContext}

Task title: ${title}

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li> (for steps), <input type="checkbox"> (for checklists). Keep it actionable and concise — focus on HOW to execute, not WHAT the task is (the title already says that).`
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = generateDescriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { title, projectId, existingDescription } = parsed.data

    // Fetch project + verify membership (also serves as authorization)
    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult
    const { project } = projectResult

    // Fetch recent tasks for context
    const recentTasks = await prisma.task.findMany({
      where: { projectId },
      select: { title: true, description: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    const prompt = buildPrompt({
      title,
      projectName: project.name,
      projectDescription: project.description ?? null,
      recentTasks,
      existingDescription,
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: descriptionResponseSchema,
      prompt,
    })

    if (!object.description) {
      return NextResponse.json(
        { error: 'Failed to generate description' },
        { status: 500 }
      )
    }

    return NextResponse.json({ description: object.description })
  } catch (error) {
    console.error('POST /api/tasks/generate-description error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify the project model has a `description` field accessible by `loadProjectAndMember`**

Check what `loadProjectAndMember` returns — it does `prisma.project.findUnique({ where: { id: projectId } })` which returns all scalar fields including `name` and `description`. Confirmed.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/generate-description/route.ts
git commit -m "feat: add POST /api/tasks/generate-description endpoint"
```

---

### Task 3: Create AiDescriptionPrompt Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/AiDescriptionPrompt.tsx`

- [ ] **Step 1: Create the AiDescriptionPrompt component**

Create file `app/workspace/[workspaceUrl]/components/AiDescriptionPrompt.tsx`:

```typescript
'use client'

import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '../utils'

type PromptState = 'idle' | 'loading' | 'preview'

interface AiDescriptionPromptProps {
  title: string
  projectId: string
  existingDescription: string | null
  onAccept: (html: string) => void
}

export function AiDescriptionPrompt({
  title,
  projectId,
  existingDescription,
  onAccept,
}: AiDescriptionPromptProps) {
  const [state, setState] = useState<PromptState>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isRefineMode = !!existingDescription
  const titleTooShort = title.trim().length < 3

  const handleGenerate = useCallback(async () => {
    setError(null)
    setState('loading')
    try {
      const res = await apiFetch('/api/tasks/generate-description', {
        method: 'POST',
        body: {
          title: title.trim(),
          projectId,
          ...(existingDescription && { existingDescription }),
        },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to generate description')
      }
      const data = await res.json()
      if (!data.description) {
        throw new Error('Failed to generate description')
      }
      setPreview(data.description)
      setState('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('idle')
    }
  }, [title, projectId, existingDescription])

  const handleAccept = useCallback(() => {
    if (preview) {
      onAccept(preview)
    }
    setPreview(null)
    setState('idle')
  }, [preview, onAccept])

  const handleCancel = useCallback(() => {
    setPreview(null)
    setState('idle')
  }, [])

  // Don't render anything if title is too short
  if (titleTooShort) return null

  // Loading state
  if (state === 'loading') {
    return (
      <div className='rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950/30'>
        <div className='flex items-center gap-2.5'>
          <Loader2 className='size-4 animate-spin text-indigo-500' />
          <span className='text-sm text-indigo-600 dark:text-indigo-400'>
            Generating description...
          </span>
        </div>
      </div>
    )
  }

  // Preview state
  if (state === 'preview' && preview) {
    return (
      <div className='rounded-lg border border-indigo-300 bg-white p-4 dark:border-indigo-800 dark:bg-zinc-900'>
        <div className='mb-2 text-xs font-semibold text-indigo-500'>
          ✦ AI Generated Preview
        </div>
        <div
          className='prose prose-sm max-w-none text-zinc-700 dark:prose-invert dark:text-zinc-300'
          dangerouslySetInnerHTML={{ __html: preview }}
        />
        <div className='mt-3 flex gap-2'>
          <button
            type='button'
            onClick={handleAccept}
            className='rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 transition-colors'
          >
            Use this
          </button>
          <button
            type='button'
            onClick={handleGenerate}
            className='rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-500 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-950/50 transition-colors'
          >
            ↻ Regenerate
          </button>
          <button
            type='button'
            onClick={handleCancel}
            className='rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 transition-colors'
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Error display (shown briefly, then back to idle prompt)
  const errorBanner = error ? (
    <div className='mb-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400'>
      {error}
    </div>
  ) : null

  // Refine mode: small button
  if (isRefineMode) {
    return (
      <div>
        {errorBanner}
        <button
          type='button'
          onClick={handleGenerate}
          className='flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-500 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400 dark:hover:bg-indigo-950/50 transition-colors'
        >
          <span>✦</span>
          <span>Refine</span>
        </button>
      </div>
    )
  }

  // Generate mode: prompt card
  return (
    <div>
      {errorBanner}
      <button
        type='button'
        onClick={handleGenerate}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors',
          'border-indigo-300 bg-indigo-50 hover:bg-indigo-100',
          'dark:border-indigo-800 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50'
        )}
      >
        <span className='flex size-6 items-center justify-center rounded-full bg-indigo-500 text-sm text-white'>
          ✦
        </span>
        <div className='flex-1'>
          <div className='text-sm font-semibold text-indigo-600 dark:text-indigo-400'>
            AI generate description
          </div>
          <div className='text-xs text-zinc-400 dark:text-zinc-500'>
            Generate 1–2 execution instructions from title + project context
          </div>
        </div>
        <span className='text-indigo-500'>→</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/AiDescriptionPrompt.tsx
git commit -m "feat: add AiDescriptionPrompt component with generate/refine modes"
```

---

### Task 4: Integrate into NewTaskModal

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx`

- [ ] **Step 1: Add import for AiDescriptionPrompt**

Add after the existing imports (near the top of the file, with the other component imports):

```typescript
import { AiDescriptionPrompt } from '../AiDescriptionPrompt'
```

- [ ] **Step 2: Convert description from ref-only to ref+state for editor sync**

The DescriptionEditor currently receives `value={null}`. To inject AI content, we need a state variable that triggers the editor's `useEffect` sync. Replace:

```typescript
const descriptionRef = useRef<string | null>(null)
```

with:

```typescript
const descriptionRef = useRef<string | null>(null)
const [descriptionValue, setDescriptionValue] = useState<string | null>(null)
```

Add `useState` to the React import if not already present (it already is — the file uses `useState`).

- [ ] **Step 3: Update DescriptionEditor to use descriptionValue**

Replace the DescriptionEditor block:

```typescript
<DescriptionEditor
  value={null}
  onCommit={html => {
    descriptionRef.current = html
  }}
  onChange={html => {
    descriptionRef.current = html
  }}
  placeholder='Add description…'
/>
```

with:

```typescript
<DescriptionEditor
  value={descriptionValue}
  onCommit={html => {
    descriptionRef.current = html
  }}
  onChange={html => {
    descriptionRef.current = html
  }}
  placeholder='Add description…'
/>
```

- [ ] **Step 4: Add AiDescriptionPrompt before the DescriptionEditor**

Insert the `AiDescriptionPrompt` component right before the `<div>` that wraps `DescriptionEditor`. Find:

```typescript
<div className={expanded ? 'flex-1 min-h-0 overflow-y-auto' : ''}>
  <DescriptionEditor
```

Insert before that `<div>`:

```typescript
<AiDescriptionPrompt
  title={title}
  projectId={projectId || defaultProjectId || ''}
  existingDescription={descriptionRef.current}
  onAccept={html => {
    descriptionRef.current = html
    setDescriptionValue(html)
  }}
/>
```

- [ ] **Step 5: Reset descriptionValue on modal close/submit**

In the reset logic (the function that runs after submit), add `setDescriptionValue(null)` alongside the existing `descriptionRef.current = null` reset. Find the reset section where `setTitle('')` is called and add:

```typescript
setDescriptionValue(null)
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/modals/NewTaskModal.tsx
git commit -m "feat: integrate AiDescriptionPrompt into NewTaskModal"
```

---

### Task 5: Integrate into TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Add import for AiDescriptionPrompt**

Add with the other component imports:

```typescript
import { AiDescriptionPrompt } from './AiDescriptionPrompt'
```

- [ ] **Step 2: Add AiDescriptionPrompt above the DescriptionEditor**

Find the description section (around line 860):

```typescript
{/* Description */}
<div className='pt-4'>
  {descriptionLoading ? (
    <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
  ) : (
    <DescriptionEditor
      value={descriptionValue}
      onCommit={commitDescription}
      members={mentionableMembers}
      tasks={tasks}
    />
  )}
</div>
```

Replace with:

```typescript
{/* Description */}
<div className='pt-4'>
  {descriptionLoading ? (
    <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
  ) : (
    <>
      <AiDescriptionPrompt
        title={task.title}
        projectId={task.projectId}
        existingDescription={task.description ?? null}
        onAccept={html => {
          handlePatch({ description: html })
          onDescriptionLoaded?.(task.id, html)
        }}
      />
      <DescriptionEditor
        value={descriptionValue}
        onCommit={commitDescription}
        members={mentionableMembers}
        tasks={tasks}
      />
    </>
  )}
</div>
```

- [ ] **Step 3: Position the refine button**

For the refine mode (existing description), the `AiDescriptionPrompt` renders a small "✦ Refine" button. It should appear **below** the editor. Move the `AiDescriptionPrompt` for the refine case:

Update the description section to conditionally position the component:

```typescript
{/* Description */}
<div className='pt-4'>
  {descriptionLoading ? (
    <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
  ) : (
    <>
      {!task.description && (
        <div className='mb-2'>
          <AiDescriptionPrompt
            title={task.title}
            projectId={task.projectId}
            existingDescription={null}
            onAccept={html => {
              handlePatch({ description: html })
              onDescriptionLoaded?.(task.id, html)
            }}
          />
        </div>
      )}
      <DescriptionEditor
        value={descriptionValue}
        onCommit={commitDescription}
        members={mentionableMembers}
        tasks={tasks}
      />
      {task.description && (
        <div className='mt-1 flex justify-end'>
          <AiDescriptionPrompt
            title={task.title}
            projectId={task.projectId}
            existingDescription={task.description}
            onAccept={html => {
              handlePatch({ description: html })
              onDescriptionLoaded?.(task.id, html)
            }}
          />
        </div>
      )}
    </>
  )}
</div>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailPanel.tsx
git commit -m "feat: integrate AiDescriptionPrompt into TaskDetailPanel"
```

---

### Task 6: Verify End-to-End

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test generate mode in NewTaskModal**

1. Open the new task modal
2. Type a title with ≥ 3 characters (e.g., "Implement GitHub OAuth")
3. Verify the AI prompt card appears above the editor
4. Verify the card is hidden when title is < 3 characters
5. Click the prompt card → verify loading state appears
6. After generation → verify preview card with HTML content
7. Click "Use this" → verify content fills the editor
8. Verify "Regenerate" triggers a new API call
9. Verify "Cancel" returns to prompt card

- [ ] **Step 3: Test refine mode in TaskDetailPanel**

1. Open a task that already has a description
2. Verify the "✦ Refine" button appears below the editor
3. Click it → verify loading → preview → accept flow
4. Verify the description is persisted (page reload shows new content)

- [ ] **Step 4: Test edge cases**

1. Empty title → no AI prompt visible
2. Title with 2 chars → no AI prompt visible
3. Title with 3 chars → AI prompt visible
4. Task with no project description → generation still works (context is partial)

- [ ] **Step 5: Verify TypeScript and lint pass**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
