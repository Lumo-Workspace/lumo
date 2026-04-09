# Quick Dispatch v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Quick Dispatch from create-only to create + update + batch with `@` mentions and rule-based parsing.

**Architecture:** Extend the existing `parse-quick-dispatch` API with a two-layer parser (rule → AI fallback). Add a new `execute` endpoint for batch action execution. Replace the plain text input with a `MentionInput` component that supports `@` autocomplete. Upgrade the modal preview from a single card to an action list.

**Tech Stack:** Next.js API routes, Claude AI (via ai-sdk gateway), Zod validation, React (hooks + components), Tailwind CSS, shadcn/ui.

---

### Task 1: Rule Parser — Status & Priority Keyword Maps

**Files:**

- Create: `lib/quick-dispatch/rule-parser.ts`
- Test: `__tests__/quick-dispatch-rule-parser.test.ts`

This task builds the pure-function rule parser that extracts actions from structured mentions + keyword matching. No AI, no network calls.

- [ ] **Step 1: Write failing tests for keyword maps and single-action parsing**

```typescript
// __tests__/quick-dispatch-rule-parser.test.ts
import {
  parseQuickDispatch,
  STATUS_KEYWORDS,
  PRIORITY_KEYWORDS,
} from '@/lib/quick-dispatch/rule-parser'
import type { Mention, QuickAction } from '@/lib/quick-dispatch/types'

describe('STATUS_KEYWORDS', () => {
  it('maps Chinese and English status keywords', () => {
    expect(STATUS_KEYWORDS['完成']).toBe('DONE')
    expect(STATUS_KEYWORDS['done']).toBe('DONE')
    expect(STATUS_KEYWORDS['搞定']).toBe('DONE')
    expect(STATUS_KEYWORDS['关闭']).toBe('DONE')
    expect(STATUS_KEYWORDS['close']).toBe('DONE')
    expect(STATUS_KEYWORDS['进行中']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['doing']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['开始']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['start']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['开工']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['评审']).toBe('IN_REVIEW')
    expect(STATUS_KEYWORDS['review']).toBe('IN_REVIEW')
    expect(STATUS_KEYWORDS['提审']).toBe('IN_REVIEW')
    expect(STATUS_KEYWORDS['待办']).toBe('TODO')
    expect(STATUS_KEYWORDS['todo']).toBe('TODO')
    expect(STATUS_KEYWORDS['回退']).toBe('TODO')
    expect(STATUS_KEYWORDS['reopen']).toBe('TODO')
  })
})

describe('PRIORITY_KEYWORDS', () => {
  it('maps priority keywords', () => {
    expect(PRIORITY_KEYWORDS['P0']).toBe('URGENT')
    expect(PRIORITY_KEYWORDS['紧急']).toBe('URGENT')
    expect(PRIORITY_KEYWORDS['urgent']).toBe('URGENT')
    expect(PRIORITY_KEYWORDS['P1']).toBe('HIGH')
    expect(PRIORITY_KEYWORDS['高']).toBe('HIGH')
    expect(PRIORITY_KEYWORDS['high']).toBe('HIGH')
    expect(PRIORITY_KEYWORDS['P2']).toBe('MEDIUM')
    expect(PRIORITY_KEYWORDS['P3']).toBe('LOW')
    expect(PRIORITY_KEYWORDS['低']).toBe('LOW')
  })
})

describe('parseQuickDispatch', () => {
  it('parses task mention + status keyword into update action', () => {
    const result = parseQuickDispatch('@ENG-42 完成', [
      {
        type: 'task',
        id: 'task-1',
        identifier: 'ENG-42',
        title: 'OAuth集成',
        position: [0, 7],
      },
    ])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      type: 'update',
      taskId: 'task-1',
      taskIdentifier: 'ENG-42',
      taskTitle: 'OAuth集成',
      fields: { status: 'DONE' },
      confidence: 'high',
    })
    expect(result.unparsed).toBe('')
  })

  it('parses task mention + member mention into assign action', () => {
    const result = parseQuickDispatch('@ENG-42 @张三', [
      {
        type: 'task',
        id: 'task-1',
        identifier: 'ENG-42',
        title: 'OAuth集成',
        position: [0, 7],
      },
      { type: 'member', actorId: 'actor-1', name: '张三', position: [8, 11] },
    ])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      type: 'update',
      taskId: 'task-1',
      taskIdentifier: 'ENG-42',
      taskTitle: 'OAuth集成',
      fields: { assigneeActorId: 'actor-1' },
      confidence: 'high',
    })
  })

  it('parses create keyword + title + project mention', () => {
    const result = parseQuickDispatch('创建支付集成 @PaymentProject', [
      {
        type: 'project',
        id: 'proj-1',
        name: 'PaymentProject',
        position: [7, 22],
      },
    ])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      type: 'create',
      title: '支付集成',
      status: 'TODO',
      priority: 'MEDIUM',
      projectId: 'proj-1',
      projectName: 'PaymentProject',
      assigneeActorId: null,
      assigneeName: null,
      description: '',
      dueDate: null,
      confidence: 'high',
    })
  })

  it('returns unparsed text when no mentions or keywords match', () => {
    const result = parseQuickDispatch('帮我处理一下登录bug', [])
    expect(result.actions).toHaveLength(0)
    expect(result.unparsed).toBe('帮我处理一下登录bug')
  })

  it('parses multiple actions from comma-separated input', () => {
    const result = parseQuickDispatch('@ENG-42 完成，@ENG-15 进行中', [
      {
        type: 'task',
        id: 'task-1',
        identifier: 'ENG-42',
        title: 'OAuth',
        position: [0, 7],
      },
      {
        type: 'task',
        id: 'task-2',
        identifier: 'ENG-15',
        title: '登录bug',
        position: [12, 19],
      },
    ])
    expect(result.actions).toHaveLength(2)
    expect(result.actions[0]!.type).toBe('update')
    expect(
      (result.actions[0] as { fields: { status: string } }).fields.status
    ).toBe('DONE')
    expect(result.actions[1]!.type).toBe('update')
    expect(
      (result.actions[1] as { fields: { status: string } }).fields.status
    ).toBe('IN_PROGRESS')
  })

  it('parses task mention + status + priority together', () => {
    const result = parseQuickDispatch('@ENG-42 进行中 P0', [
      {
        type: 'task',
        id: 'task-1',
        identifier: 'ENG-42',
        title: 'OAuth',
        position: [0, 7],
      },
    ])
    expect(result.actions).toHaveLength(1)
    const action = result.actions[0] as {
      fields: { status?: string; priority?: string }
    }
    expect(action.fields.status).toBe('IN_PROGRESS')
    expect(action.fields.priority).toBe('URGENT')
  })

  it('parses create with assignee and priority', () => {
    const result = parseQuickDispatch('创建支付集成 @PaymentProject @张三 P1', [
      {
        type: 'project',
        id: 'proj-1',
        name: 'PaymentProject',
        position: [7, 22],
      },
      { type: 'member', actorId: 'actor-1', name: '张三', position: [23, 26] },
    ])
    expect(result.actions).toHaveLength(1)
    const action = result.actions[0] as {
      type: string
      assigneeActorId: string | null
      priority: string
    }
    expect(action.type).toBe('create')
    expect(action.assigneeActorId).toBe('actor-1')
    expect(action.priority).toBe('HIGH')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/quick-dispatch-rule-parser.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create shared types**

```typescript
// lib/quick-dispatch/types.ts
export type Mention =
  | {
      type: 'task'
      id: string
      identifier: string
      title: string
      position: [number, number]
    }
  | { type: 'project'; id: string; name: string; position: [number, number] }
  | {
      type: 'member'
      actorId: string
      name: string
      position: [number, number]
    }

export type QuickAction =
  | {
      type: 'update'
      taskId: string
      taskIdentifier: string
      taskTitle: string
      fields: {
        status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
        assigneeActorId?: string
        priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
      }
      confidence: 'high' | 'medium' | 'low'
    }
  | {
      type: 'create'
      title: string
      status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
      projectId: string | null
      projectName: string | null
      assigneeActorId: string | null
      assigneeName: string | null
      description: string
      dueDate: string | null
      confidence: 'high' | 'medium' | 'low'
    }

export interface ParseResult {
  actions: QuickAction[]
  unparsed: string
  needsConfirmation: boolean
}
```

- [ ] **Step 4: Implement rule parser**

```typescript
// lib/quick-dispatch/rule-parser.ts
import type { Mention, QuickAction, ParseResult } from './types'

export const STATUS_KEYWORDS: Record<
  string,
  'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
> = {
  完成: 'DONE',
  done: 'DONE',
  搞定: 'DONE',
  关闭: 'DONE',
  close: 'DONE',
  进行中: 'IN_PROGRESS',
  doing: 'IN_PROGRESS',
  开始: 'IN_PROGRESS',
  start: 'IN_PROGRESS',
  开工: 'IN_PROGRESS',
  评审: 'IN_REVIEW',
  review: 'IN_REVIEW',
  提审: 'IN_REVIEW',
  待办: 'TODO',
  todo: 'TODO',
  回退: 'TODO',
  reopen: 'TODO',
}

export const PRIORITY_KEYWORDS: Record<
  string,
  'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
> = {
  P0: 'URGENT',
  紧急: 'URGENT',
  urgent: 'URGENT',
  P1: 'HIGH',
  高: 'HIGH',
  high: 'HIGH',
  P2: 'MEDIUM',
  中: 'MEDIUM',
  medium: 'MEDIUM',
  P3: 'LOW',
  低: 'LOW',
  low: 'LOW',
}

const CREATE_KEYWORDS = ['创建', '新建', 'add', 'create']

/**
 * Split input into segments by Chinese/English comma or semicolon.
 * Each segment is parsed independently.
 */
function splitSegments(text: string): string[] {
  return text
    .split(/[,，;；]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Find status keyword in a text segment. Returns the matched status or null. */
function findStatus(
  text: string
): 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | null {
  const lower = text.toLowerCase()
  for (const [keyword, status] of Object.entries(STATUS_KEYWORDS)) {
    if (lower.includes(keyword.toLowerCase())) return status
  }
  return null
}

/** Find priority keyword in a text segment. Returns the matched priority or null. */
function findPriority(
  text: string
): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null {
  for (const [keyword, priority] of Object.entries(PRIORITY_KEYWORDS)) {
    if (text.includes(keyword)) return priority
  }
  return null
}

/** Check if segment contains a create keyword. Returns the keyword or null. */
function findCreateKeyword(text: string): string | null {
  const lower = text.toLowerCase()
  return CREATE_KEYWORDS.find(k => lower.includes(k.toLowerCase())) ?? null
}

/** Remove all occurrences of the given substrings (keywords, mention placeholders) from text. */
function stripTokens(text: string, tokens: string[]): string {
  let result = text
  for (const token of tokens) {
    result = result.replace(
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      ''
    )
  }
  return result.replace(/\s+/g, ' ').trim()
}

/**
 * Parse structured mentions + keywords into QuickAction[].
 * Returns unparsed text for AI fallback.
 */
export function parseQuickDispatch(
  text: string,
  mentions: Mention[]
): ParseResult {
  const actions: QuickAction[] = []
  const segments = splitSegments(text)
  const usedMentionIndices = new Set<number>()
  const parsedSegments = new Set<number>()

  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si]!
    const tokensToStrip: string[] = []

    // Find mentions whose position falls in this segment
    // (We use segment text matching since positions are relative to the full input)
    const segmentMentions: { mention: Mention; index: number }[] = []
    for (let mi = 0; mi < mentions.length; mi++) {
      if (usedMentionIndices.has(mi)) continue
      const m = mentions[mi]!
      // Check if segment contains the mention text
      const mentionText =
        m.type === 'task'
          ? `@${m.identifier}`
          : m.type === 'project'
            ? `@${m.name}`
            : `@${m.name}`
      if (
        segment.includes(mentionText) ||
        segment.includes(mentionText.slice(1))
      ) {
        segmentMentions.push({ mention: m, index: mi })
      }
    }

    const taskMentions = segmentMentions.filter(
      sm => sm.mention.type === 'task'
    )
    const projectMentions = segmentMentions.filter(
      sm => sm.mention.type === 'project'
    )
    const memberMentions = segmentMentions.filter(
      sm => sm.mention.type === 'member'
    )

    const status = findStatus(segment)
    const priority = findPriority(segment)
    const createKw = findCreateKeyword(segment)

    // Case 1: Task mention → update action
    if (taskMentions.length > 0 && !createKw) {
      for (const { mention, index } of taskMentions) {
        if (mention.type !== 'task') continue
        const fields: QuickAction & { type: 'update' } extends {
          fields: infer F
        }
          ? F
          : never = {}
        if (status) fields.status = status
        if (priority) fields.priority = priority
        // Member mention near task → assign
        if (
          memberMentions.length > 0 &&
          memberMentions[0]!.mention.type === 'member'
        ) {
          fields.assigneeActorId = memberMentions[0]!.mention.actorId
          usedMentionIndices.add(memberMentions[0]!.index)
        }

        if (Object.keys(fields).length > 0) {
          actions.push({
            type: 'update',
            taskId: mention.id,
            taskIdentifier: mention.identifier,
            taskTitle: mention.title,
            fields,
            confidence: 'high',
          })
          usedMentionIndices.add(index)
          parsedSegments.add(si)
        }
      }
      continue
    }

    // Case 2: Create keyword → create action
    if (createKw) {
      // Strip create keyword, mention texts, status/priority keywords to extract title
      tokensToStrip.push(createKw)
      for (const sm of [...projectMentions, ...memberMentions]) {
        const m = sm.mention
        const mentionText = m.type === 'project' ? `@${m.name}` : `@${m.name}`
        tokensToStrip.push(mentionText)
        tokensToStrip.push(mentionText.slice(1)) // without @
        usedMentionIndices.add(sm.index)
      }
      if (status) {
        const matchedKey = Object.keys(STATUS_KEYWORDS).find(k =>
          segment.toLowerCase().includes(k.toLowerCase())
        )
        if (matchedKey) tokensToStrip.push(matchedKey)
      }
      if (priority) {
        const matchedKey = Object.keys(PRIORITY_KEYWORDS).find(k =>
          segment.includes(k)
        )
        if (matchedKey) tokensToStrip.push(matchedKey)
      }

      const title = stripTokens(segment, tokensToStrip)

      if (title) {
        const proj = projectMentions[0]?.mention
        const member = memberMentions[0]?.mention

        actions.push({
          type: 'create',
          title,
          status: status ?? 'TODO',
          priority: priority ?? 'MEDIUM',
          projectId: proj?.type === 'project' ? proj.id : null,
          projectName: proj?.type === 'project' ? proj.name : null,
          assigneeActorId: member?.type === 'member' ? member.actorId : null,
          assigneeName: member?.type === 'member' ? member.name : null,
          description: '',
          dueDate: null,
          confidence: 'high',
        })
        parsedSegments.add(si)
      }
    }
  }

  // Collect unparsed segments
  const unparsedSegments = segments.filter((_, i) => !parsedSegments.has(i))
  const unparsed = unparsedSegments.join('，').trim()

  return {
    actions,
    unparsed,
    needsConfirmation: actions.length > 1,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/quick-dispatch-rule-parser.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/quick-dispatch/types.ts lib/quick-dispatch/rule-parser.ts __tests__/quick-dispatch-rule-parser.test.ts
git commit -m "feat: add rule parser for Quick Dispatch v2 [LUM-0]"
```

---

### Task 2: AI Parser — Upgrade Prompt & Schema for Actions

**Files:**

- Modify: `lib/prompts/quick-dispatch.ts`
- Modify: `__tests__/quick-dispatch-prompt.test.ts`

Upgrade the AI prompt to return `QuickAction[]` instead of a single parsed object. The AI now also handles task matching (update actions) in addition to create actions.

- [ ] **Step 1: Write failing tests for the new AI response schema**

Add to `__tests__/quick-dispatch-prompt.test.ts`:

```typescript
import {
  QuickDispatchV2ResponseSchema,
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
  buildQuickDispatchV2Prompt,
} from '@/lib/prompts/quick-dispatch'

describe('QUICK_DISPATCH_V2_SYSTEM_PROMPT', () => {
  it('includes update action instructions', () => {
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('update')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('create')
  })

  it('includes status mapping keywords', () => {
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('DONE')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('IN_PROGRESS')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('IN_REVIEW')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('TODO')
  })
})

describe('QuickDispatchV2ResponseSchema', () => {
  it('accepts an update action', () => {
    const valid = {
      actions: [
        {
          type: 'update',
          taskId: 'task-1',
          taskIdentifier: 'ENG-42',
          taskTitle: 'OAuth集成',
          fields: { status: 'DONE' },
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a create action', () => {
    const valid = {
      actions: [
        {
          type: 'create',
          title: '支付集成',
          status: 'TODO',
          priority: 'MEDIUM',
          projectId: 'proj-1',
          projectName: 'Payment',
          assigneeActorId: null,
          assigneeName: null,
          description: '<p>实现支付集成</p>',
          dueDate: null,
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts mixed actions', () => {
    const valid = {
      actions: [
        {
          type: 'update',
          taskId: 'task-1',
          taskIdentifier: 'ENG-42',
          taskTitle: 'OAuth',
          fields: { status: 'DONE' },
        },
        {
          type: 'create',
          title: '支付集成',
          status: 'TODO',
          priority: 'HIGH',
          projectId: 'proj-1',
          projectName: 'Payment',
          assigneeActorId: 'actor-1',
          assigneeName: '张三',
          description: '',
          dueDate: null,
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid action type', () => {
    const invalid = {
      actions: [{ type: 'delete', taskId: 'task-1' }],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('buildQuickDispatchV2Prompt', () => {
  it('includes user tasks in context', () => {
    const result = buildQuickDispatchV2Prompt({
      input: '登录bug 完成',
      projects: [{ id: 'p1', name: 'Auth', description: null }],
      members: [{ name: 'Chao', actorId: 'a1' }],
      userTasks: [
        { id: 't1', identifier: 'ENG-42', title: '登录bug', status: 'TODO' },
      ],
      currentDate: '2026-04-08',
    })
    expect(result).toContain('ENG-42')
    expect(result).toContain('登录bug')
    expect(result).toContain('TODO')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/quick-dispatch-prompt.test.ts --no-coverage`
Expected: FAIL — exports not found

- [ ] **Step 3: Add V2 prompt, schema, and prompt builder to `lib/prompts/quick-dispatch.ts`**

Append to the existing file (keep v1 exports for backwards compatibility during migration):

```typescript
// ── V2: Multi-action parsing ───────────────────────────────────────────────

export const QUICK_DISPATCH_V2_SYSTEM_PROMPT = `You are a task dispatcher for a project management tool. Parse the user's natural language input into one or more actions.

Each action is either:
1. "update" — change fields on an existing task (status, assignee, priority)
2. "create" — create a new task

Status mapping:
- doing, 进行中, in progress, started → IN_PROGRESS
- review, 评审, in review, 提审 → IN_REVIEW
- done, 完成, finished, 搞定, 关闭, close → DONE
- todo, 待办, 回退, reopen → TODO

Priority mapping:
- P0, P1, 紧急, urgent, blocker → URGENT
- P2, 高, high, important → HIGH
- P3, 中, medium, normal (or no priority mentioned) → MEDIUM
- P4, 低, low, minor → LOW

Rules:
1. Match task references against the provided user_tasks list using fuzzy title matching. Use exact taskId and identifier from the list.
2. If a task reference cannot be matched to any existing task, treat it as a "create" action.
3. Match assignee names against the provided member list. Output exact actorId.
4. Match project references against the provided project list. Output exact projectId.
5. For "create" actions: extract a clean title, generate a 1-2 sentence HTML description. Use only: <p>, <strong>, <code>, <ul>/<li>.
6. Parse dates relative to the provided current date. Output ISO 8601 datetime.
7. For "update" actions: only include fields that are being changed. Do not include unchanged fields.
8. Process ALL actions mentioned in the input — the user may describe multiple actions in one sentence.`

const updateActionSchema = z.object({
  type: z.literal('update'),
  taskId: z.string().describe('Exact task ID from the user_tasks list'),
  taskIdentifier: z.string().describe('Task identifier like ENG-42'),
  taskTitle: z.string().describe('Task title for display'),
  fields: z.object({
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
    assigneeActorId: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  }),
})

const createActionSchema = z.object({
  type: z.literal('create'),
  title: z.string().describe('Clean task title'),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  projectId: z.string().nullable().describe('Matched project ID or null'),
  projectName: z.string().nullable().describe('Project name for display'),
  assigneeActorId: z.string().nullable().describe('Matched actorId or null'),
  assigneeName: z.string().nullable().describe('Member name for display'),
  description: z.string().describe('1-2 sentence HTML description'),
  dueDate: z.string().nullable().describe('ISO 8601 datetime or null'),
})

export const QuickDispatchV2ResponseSchema = z.object({
  actions: z.array(
    z.discriminatedUnion('type', [updateActionSchema, createActionSchema])
  ),
})

export type QuickDispatchV2Response = z.infer<
  typeof QuickDispatchV2ResponseSchema
>

interface BuildV2PromptParams {
  input: string
  projects: { id: string; name: string; description: string | null }[]
  members: { name: string; actorId: string }[]
  userTasks: { id: string; identifier: string; title: string; status: string }[]
  currentDate: string
}

export function buildQuickDispatchV2Prompt({
  input,
  projects,
  members,
  userTasks,
  currentDate,
}: BuildV2PromptParams): string {
  const projectList = projects
    .map(
      p =>
        `- id="${p.id}" name="${p.name}"${p.description ? ` description="${p.description}"` : ''}`
    )
    .join('\n')

  const memberList = members
    .map(m => `- name="${m.name}" actorId="${m.actorId}"`)
    .join('\n')

  const taskList = userTasks
    .map(
      t =>
        `- id="${t.id}" identifier="${t.identifier}" title="${t.title}" status="${t.status}"`
    )
    .join('\n')

  return `Current date: ${currentDate}

<projects>
${projectList}
</projects>

<members>
${memberList}
</members>

<user_tasks>
${taskList}
</user_tasks>

<user_input>${input}</user_input>`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/quick-dispatch-prompt.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/quick-dispatch.ts __tests__/quick-dispatch-prompt.test.ts
git commit -m "feat: add V2 AI prompt and schema for multi-action parsing [LUM-0]"
```

---

### Task 3: Validation Schema & Parse API Route Upgrade

**Files:**

- Modify: `lib/validation/schemas.ts`
- Modify: `app/api/tasks/parse-quick-dispatch/route.ts`
- Modify: `lib/repositories/task.repository.ts` (add findAssignedTasksSummary)

Upgrade the parse endpoint to accept mentions, run rule parser first, then AI fallback.

- [ ] **Step 1: Add quickDispatchV2Schema to validation schemas**

In `lib/validation/schemas.ts`, add after the existing `quickDispatchSchema`:

```typescript
// ─── Quick Dispatch V2 ────────────────────────────────────────────────────

const mentionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task'),
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    position: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('project'),
    id: z.string(),
    name: z.string(),
    position: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('member'),
    actorId: z.string(),
    name: z.string(),
    position: z.tuple([z.number(), z.number()]),
  }),
])

export const quickDispatchV2Schema = z.object({
  input: z
    .string()
    .trim()
    .min(1, 'Input is required')
    .max(1000, 'Input must be at most 1000 characters'),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
  mentions: z.array(mentionSchema).max(20).default([]),
})
```

- [ ] **Step 2: Add findAssignedTasksSummary to task repository**

In `lib/repositories/task.repository.ts`, add a lightweight query method:

```typescript
/** Lightweight summary of tasks assigned to an actor — for Quick Dispatch AI context. */
async findAssignedTasksSummary(actorId: string) {
  return prisma.task.findMany({
    where: { assigneeActorId: actorId },
    select: {
      id: true,
      title: true,
      number: true,
      status: true,
      team: { select: { identifier: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
},
```

- [ ] **Step 3: Upgrade the parse API route**

Replace `app/api/tasks/parse-quick-dispatch/route.ts` with the v2 logic. The route now:

1. Validates with `quickDispatchV2Schema`
2. Runs rule parser on input + mentions
3. If unparsed text remains, calls AI with user tasks + workspace context
4. Merges results and returns `{ actions, needsConfirmation }`

```typescript
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { clerkClient } from '@clerk/nextjs/server'

import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { quickDispatchV2Schema } from '@/lib/validation/schemas'
import {
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
  QuickDispatchV2ResponseSchema,
  buildQuickDispatchV2Prompt,
} from '@/lib/prompts/quick-dispatch'
import {
  projectRepository,
  memberRepository,
  taskRepository,
} from '@/lib/repositories'
import { parseQuickDispatch } from '@/lib/quick-dispatch/rule-parser'
import { getHumanActorId } from '@/lib/actor'
import type { QuickAction } from '@/lib/quick-dispatch/types'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = quickDispatchV2Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { input, workspaceUrl, mentions } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    // Step 1: Rule parser
    const ruleResult = parseQuickDispatch(input, mentions)

    // Step 2: If unparsed text remains, use AI fallback
    let aiActions: QuickAction[] = []
    if (ruleResult.unparsed) {
      // Fetch context for AI
      const memberRow = await memberRepository.findByClerkId(
        workspaceId,
        userId
      )
      const actorId =
        memberRow?.actor?.id ?? (await getHumanActorId(memberRow?.id ?? ''))

      const [projects, memberRows, assignedTasks] = await Promise.all([
        projectRepository.findByWorkspaceNonIdea(workspaceId),
        memberRepository.findByWorkspace(workspaceId),
        actorId
          ? taskRepository.findAssignedTasksSummary(actorId)
          : Promise.resolve([]),
      ])

      const client = await clerkClient()
      const clerkUsers = await client.users.getUserList({
        userId: memberRows.map(m => m.clerkId),
        limit: 100,
      })
      const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

      const members = memberRows
        .filter(m => m.actor !== null)
        .map(m => {
          const u = userMap.get(m.clerkId)
          const trimmedName = u
            ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
            : ''
          const name =
            trimmedName || u?.emailAddresses[0]?.emailAddress || 'Unknown'
          return { name, actorId: m.actor!.id }
        })

      const userTasks = assignedTasks.map(t => ({
        id: t.id,
        identifier: `${t.team.identifier}-${t.number}`,
        title: t.title,
        status: t.status,
      }))

      const currentDate = new Date().toISOString().split('T')[0] ?? ''

      const prompt = buildQuickDispatchV2Prompt({
        input: ruleResult.unparsed,
        projects,
        members,
        userTasks,
        currentDate,
      })

      const { object } = await generateObject({
        model: gateway('anthropic/claude-sonnet-4.5'),
        schema: QuickDispatchV2ResponseSchema,
        system: QUICK_DISPATCH_V2_SYSTEM_PROMPT,
        prompt,
      })

      aiActions = object.actions.map(a => ({
        ...a,
        confidence: 'medium' as const,
      })) as QuickAction[]
    }

    // Step 3: Merge — rule actions first, then AI actions. Dedupe by taskId.
    const seenTaskIds = new Set(
      ruleResult.actions
        .filter(
          (a): a is QuickAction & { type: 'update' } => a.type === 'update'
        )
        .map(a => a.taskId)
    )

    const dedupedAiActions = aiActions.filter(a => {
      if (a.type === 'update' && seenTaskIds.has(a.taskId)) return false
      return true
    })

    const allActions = [...ruleResult.actions, ...dedupedAiActions]

    return NextResponse.json({
      actions: allActions,
      needsConfirmation: allActions.length > 1 || dedupedAiActions.length > 0,
    })
  } catch (error) {
    console.error('POST /api/tasks/parse-quick-dispatch error:', error)
    return NextResponse.json(
      { error: 'Failed to parse input' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/validation/schemas.ts app/api/tasks/parse-quick-dispatch/route.ts lib/repositories/task.repository.ts
git commit -m "feat: upgrade parse-quick-dispatch API to v2 with rule parser + AI fallback [LUM-0]"
```

---

### Task 4: Execute API Route

**Files:**

- Create: `app/api/tasks/quick-dispatch/execute/route.ts`
- Modify: `lib/validation/schemas.ts` (add executeQuickDispatchSchema)

New endpoint that executes confirmed actions (updates and creates).

- [ ] **Step 1: Add executeQuickDispatchSchema to validation schemas**

In `lib/validation/schemas.ts`, add:

```typescript
// ─── Quick Dispatch Execute ────────────────────────────────────────────────

const executeUpdateActionSchema = z.object({
  type: z.literal('update'),
  taskId: z.string(),
  fields: z.object({
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
    assigneeActorId: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  }),
})

const executeCreateActionSchema = z.object({
  type: z.literal('create'),
  title: z.string().trim().min(1).max(500),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  projectId: z.string(),
  assigneeActorId: z.string().nullable().optional(),
  description: z.string().max(10000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const executeQuickDispatchSchema = z.object({
  actions: z
    .array(
      z.discriminatedUnion('type', [
        executeUpdateActionSchema,
        executeCreateActionSchema,
      ])
    )
    .min(1, 'At least one action is required')
    .max(10, 'Cannot execute more than 10 actions at once'),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
})
```

- [ ] **Step 2: Create the execute route**

```typescript
// app/api/tasks/quick-dispatch/execute/route.ts
import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { executeQuickDispatchSchema } from '@/lib/validation/schemas'
import { taskService } from '@/lib/services/task.service'
import { projectRepository, memberRepository } from '@/lib/repositories'
import { taskRepository } from '@/lib/repositories/task.repository'
import { getOrCreateHumanActor } from '@/lib/actor'
import { triggerPusher } from '@/lib/pusher-server'

interface ActionResult {
  type: 'updated' | 'created' | 'error'
  taskId?: string
  taskIdentifier?: string
  success: boolean
  message?: string
  index: number
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = executeQuickDispatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { actions, workspaceUrl } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    // Get current user's actor ID for creates
    const member = await memberRepository.findByClerkId(workspaceId, userId)
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const actor = await getOrCreateHumanActor(workspaceId, member.id)
    const currentActorId = actor.id

    const results: ActionResult[] = []

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!

      try {
        if (action.type === 'update') {
          const result = await taskService.updateTask(
            action.taskId,
            action.fields
          )
          const task = result.task as {
            team?: { identifier?: string }
            number?: number
            teamIdentifier?: string
          }
          const identifier = task.teamIdentifier
            ? `${task.teamIdentifier}-${task.number}`
            : undefined

          // Fire real-time event
          if (result.changedFields.length > 0) {
            const taskWithProject = await taskRepository.findProjectIdById(
              action.taskId
            )
            if (taskWithProject) {
              await triggerPusher(
                `project-${taskWithProject.projectId}`,
                'project-update',
                {
                  taskId: action.taskId,
                  fields: result.changedFields,
                  patch: action.fields,
                }
              )
            }
          }

          results.push({
            type: 'updated',
            taskId: action.taskId,
            taskIdentifier: identifier,
            success: true,
            index: i,
          })
        } else {
          // Create action
          const project = await projectRepository.findByIdSimple(
            action.projectId
          )
          if (!project || project.workspaceId !== workspaceId) {
            results.push({
              type: 'error',
              success: false,
              message: 'Project not found in workspace',
              index: i,
            })
            continue
          }

          const created = await taskRepository.createWithSequence({
            projectId: action.projectId,
            teamId: project.teamId,
            title: action.title,
            description: action.description ?? null,
            status: action.status,
            priority: action.priority,
            assigneeActorId: action.assigneeActorId ?? currentActorId,
            dueDate: action.dueDate ? new Date(action.dueDate) : null,
          })

          const identifier = created.team
            ? `${created.team.identifier}-${created.number}`
            : undefined

          results.push({
            type: 'created',
            taskId: created.id,
            taskIdentifier: identifier,
            success: true,
            index: i,
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        results.push({
          type: 'error',
          success: false,
          message,
          index: i,
        })
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('POST /api/tasks/quick-dispatch/execute error:', error)
    return NextResponse.json(
      { error: 'Failed to execute actions' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/validation/schemas.ts app/api/tasks/quick-dispatch/execute/route.ts
git commit -m "feat: add quick-dispatch execute endpoint for batch actions [LUM-0]"
```

---

### Task 5: MentionInput Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/MentionInput.tsx`

A rich text input with `@` autocomplete popover for tasks, projects, and members.

- [ ] **Step 1: Create the MentionInput component**

```tsx
// app/workspace/[workspaceUrl]/components/MentionInput.tsx
'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { Hash, User, FolderOpen } from 'lucide-react'
import type { Mention } from '@/lib/quick-dispatch/types'

interface MentionCandidate {
  type: 'task' | 'project' | 'member'
  id: string // taskId, projectId, or actorId
  label: string // display text e.g. "ENG-42 OAuth集成"
  sublabel?: string // project name, role, etc.
  // Extra data carried through to Mention
  identifier?: string // task identifier
  title?: string // task title
  name?: string // project/member name
  actorId?: string // member actorId
}

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  mentions: Mention[]
  onMentionsChange: (mentions: Mention[]) => void
  candidates: MentionCandidate[]
  placeholder?: string
  disabled?: boolean
  onSubmit?: () => void
  autoFocus?: boolean
}

export function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  candidates,
  placeholder,
  disabled,
  onSubmit,
  autoFocus,
}: MentionInputProps) {
  const intl = useIntl()
  const inputRef = useRef<HTMLInputElement>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursorPos, setCursorPos] = useState(0)

  // Find the @ trigger position — where the current @ mention starts
  const atTriggerPos = useMemo(() => {
    const textBefore = value.slice(0, cursorPos)
    const lastAt = textBefore.lastIndexOf('@')
    if (lastAt === -1) return -1
    // Check no space between @ and cursor (allow for multi-word search)
    const textAfterAt = textBefore.slice(lastAt + 1)
    // Close popover if user typed a comma or semicolon after @
    if (/[,，;；]/.test(textAfterAt)) return -1
    return lastAt
  }, [value, cursorPos])

  // Filter candidates based on query
  const filteredCandidates = useMemo(() => {
    if (atTriggerPos === -1) return []
    const searchText = value.slice(atTriggerPos + 1, cursorPos).toLowerCase()
    setQuery(searchText)
    return candidates.filter(c => c.label.toLowerCase().includes(searchText))
  }, [atTriggerPos, value, cursorPos, candidates])

  // Show popover when @ is typed and there are candidates
  useEffect(() => {
    setPopoverOpen(atTriggerPos >= 0 && filteredCandidates.length > 0)
  }, [atTriggerPos, filteredCandidates.length])

  const handleSelect = useCallback(
    (candidate: MentionCandidate) => {
      const mentionText = `@${candidate.label}`
      const before = value.slice(0, atTriggerPos)
      const after = value.slice(cursorPos)
      const newValue = `${before}${mentionText} ${after}`
      onChange(newValue)

      // Build mention object
      const position: [number, number] = [
        atTriggerPos,
        atTriggerPos + mentionText.length,
      ]
      let mention: Mention
      if (candidate.type === 'task') {
        mention = {
          type: 'task',
          id: candidate.id,
          identifier: candidate.identifier ?? '',
          title: candidate.title ?? '',
          position,
        }
      } else if (candidate.type === 'project') {
        mention = {
          type: 'project',
          id: candidate.id,
          name: candidate.name ?? candidate.label,
          position,
        }
      } else {
        mention = {
          type: 'member',
          actorId: candidate.actorId ?? candidate.id,
          name: candidate.name ?? candidate.label,
          position,
        }
      }

      onMentionsChange([...mentions, mention])
      setPopoverOpen(false)

      // Restore focus and cursor
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const newPos = atTriggerPos + mentionText.length + 1
          inputRef.current.setSelectionRange(newPos, newPos)
        }
      })
    },
    [value, atTriggerPos, cursorPos, mentions, onChange, onMentionsChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !popoverOpen) {
        e.preventDefault()
        onSubmit?.()
      }
      if (e.key === 'Escape' && popoverOpen) {
        e.preventDefault()
        setPopoverOpen(false)
      }
    },
    [popoverOpen, onSubmit]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
      setCursorPos(e.target.selectionStart ?? e.target.value.length)
    },
    [onChange]
  )

  const handleClick = useCallback(() => {
    if (inputRef.current) {
      setCursorPos(inputRef.current.selectionStart ?? 0)
    }
  }, [])

  const handleKeyUp = useCallback(() => {
    if (inputRef.current) {
      setCursorPos(inputRef.current.selectionStart ?? 0)
    }
  }, [])

  const iconForType = (type: 'task' | 'project' | 'member') => {
    switch (type) {
      case 'task':
        return <Hash className='size-4 text-zinc-400' />
      case 'project':
        return <FolderOpen className='size-4 text-zinc-400' />
      case 'member':
        return <User className='size-4 text-zinc-400' />
    }
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          className='w-full bg-transparent border-none p-0 text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
          placeholder={
            placeholder ??
            intl.formatMessage({ id: 'quickDispatch.placeholder' })
          }
          type='text'
          value={value}
          onChange={handleInputChange}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          disabled={disabled}
        />
      </PopoverAnchor>
      <PopoverContent
        className='w-[320px] p-0'
        align='start'
        sideOffset={8}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <Command>
          <CommandList>
            <CommandEmpty>
              {intl.formatMessage({
                id: 'quickDispatch.noResults',
                defaultMessage: 'No results found',
              })}
            </CommandEmpty>
            {['task', 'project', 'member'].map(type => {
              const items = filteredCandidates.filter(c => c.type === type)
              if (items.length === 0) return null
              const groupLabel =
                type === 'task'
                  ? intl.formatMessage({
                      id: 'quickDispatch.mentionTasks',
                      defaultMessage: 'Tasks',
                    })
                  : type === 'project'
                    ? intl.formatMessage({
                        id: 'quickDispatch.mentionProjects',
                        defaultMessage: 'Projects',
                      })
                    : intl.formatMessage({
                        id: 'quickDispatch.mentionMembers',
                        defaultMessage: 'Members',
                      })
              return (
                <CommandGroup key={type} heading={groupLabel}>
                  {items.slice(0, 8).map(c => (
                    <CommandItem
                      key={`${c.type}-${c.id}`}
                      onSelect={() => handleSelect(c)}
                      className='flex items-center gap-2'
                    >
                      {iconForType(c.type as 'task' | 'project' | 'member')}
                      <span className='truncate'>{c.label}</span>
                      {c.sublabel && (
                        <span className='text-xs text-zinc-400 truncate ml-auto'>
                          {c.sublabel}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/MentionInput.tsx
git commit -m "feat: add MentionInput component with @ autocomplete [LUM-0]"
```

---

### Task 6: Upgrade useQuickDispatch Hook

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts`

Upgrade the hook to work with v2 actions array, mentions, and the execute flow.

- [ ] **Step 1: Rewrite the hook**

```typescript
// app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import type { QuickAction, Mention } from '@/lib/quick-dispatch/types'

type DispatchPhase = 'input' | 'loading' | 'preview' | 'executing'

interface ParseResponse {
  actions: QuickAction[]
  needsConfirmation: boolean
}

interface ActionResult {
  type: 'updated' | 'created' | 'error'
  taskId?: string
  taskIdentifier?: string
  success: boolean
  message?: string
  index: number
}

interface ExecuteResponse {
  results: ActionResult[]
}

export function useQuickDispatch() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [phase, setPhase] = useState<DispatchPhase>('input')
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  const [actions, setActions] = useState<QuickAction[]>([])
  const [results, setResults] = useState<ActionResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const parse = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim()
      if (!trimmed) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setError(null)
      setPhase('loading')

      try {
        const data = await apiFetch<ParseResponse>(
          '/api/tasks/parse-quick-dispatch',
          {
            method: 'POST',
            body: { input: trimmed, workspaceUrl, mentions },
            signal: controller.signal,
          }
        )

        if (controller.signal.aborted) return

        if (data.actions.length === 0) {
          setError('Could not parse any actions from the input')
          setPhase('input')
          return
        }

        setActions(data.actions)
        setPhase('preview')
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setPhase('input')
      }
    },
    [workspaceUrl, mentions]
  )

  const execute = useCallback(async () => {
    if (actions.length === 0) return

    setPhase('executing')
    setError(null)

    try {
      // Strip confidence field and prepare for execution
      const executeActions = actions.map(a => {
        if (a.type === 'update') {
          return { type: 'update' as const, taskId: a.taskId, fields: a.fields }
        }
        return {
          type: 'create' as const,
          title: a.title,
          status: a.status,
          priority: a.priority,
          projectId: a.projectId!,
          assigneeActorId: a.assigneeActorId,
          description: a.description,
          dueDate: a.dueDate,
        }
      })

      const data = await apiFetch<ExecuteResponse>(
        '/api/tasks/quick-dispatch/execute',
        {
          method: 'POST',
          body: { actions: executeActions, workspaceUrl },
        }
      )

      setResults(data.results)
      return data.results
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed')
      setPhase('preview')
      return undefined
    }
  }, [actions, workspaceUrl])

  const removeAction = useCallback((index: number) => {
    setActions(prev => prev.filter((_, i) => i !== index))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setInput('')
    setMentions([])
    setActions([])
    setResults([])
    setError(null)
  }, [])

  const backToInput = useCallback(() => {
    setPhase('input')
    setActions([])
  }, [])

  return {
    phase,
    input,
    setInput,
    mentions,
    setMentions,
    actions,
    results,
    error,
    parse,
    execute,
    removeAction,
    reset,
    backToInput,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts
git commit -m "feat: upgrade useQuickDispatch hook for v2 actions + execute flow [LUM-0]"
```

---

### Task 7: Upgrade QuickDispatchModal

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/modals/QuickDispatchModal.tsx`
- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`

Replace the single-card preview with an action list. Integrate MentionInput. Add execute flow.

- [ ] **Step 1: Add new i18n keys**

Add to both `lib/i18n/en.json` and `lib/i18n/zh.json`:

```json
// en.json additions
"quickDispatch.confirmExecute": "Execute ({count})",
"quickDispatch.executing": "Executing...",
"quickDispatch.noResults": "No results found",
"quickDispatch.noActions": "Could not parse any actions",
"quickDispatch.mentionTasks": "Tasks",
"quickDispatch.mentionProjects": "Projects",
"quickDispatch.mentionMembers": "Members",
"quickDispatch.actionUpdate": "Update",
"quickDispatch.actionCreate": "Create",
"quickDispatch.executed": "{count} actions executed",
"quickDispatch.placeholder": "Type @ to mention tasks, projects, or members..."
```

```json
// zh.json additions
"quickDispatch.confirmExecute": "执行 ({count})",
"quickDispatch.executing": "执行中...",
"quickDispatch.noResults": "没有找到结果",
"quickDispatch.noActions": "无法解析出任何操作",
"quickDispatch.mentionTasks": "任务",
"quickDispatch.mentionProjects": "项目",
"quickDispatch.mentionMembers": "成员",
"quickDispatch.actionUpdate": "更新",
"quickDispatch.actionCreate": "创建",
"quickDispatch.executed": "已执行 {count} 个操作",
"quickDispatch.placeholder": "输入 @ 引用任务、项目或成员..."
```

- [ ] **Step 2: Rewrite QuickDispatchModal**

Replace the entire content of `QuickDispatchModal.tsx`:

```tsx
'use client'

import { useCallback, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { AnimatePresence } from 'motion/react'
import { Loader2, ArrowRightLeft, Plus, X } from 'lucide-react'
import { Modal } from '../Modal'
import { Button } from '@/components/ui/button'
import { PRIORITY_CONFIG, STATUS_CONFIG } from '../fields'
import { MentionInput } from '../MentionInput'
import { useQuickDispatch } from '../../hooks/useQuickDispatch'
import type { QuickAction } from '@/lib/quick-dispatch/types'
import type { MentionCandidate } from '../MentionInput'
import type {
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
  ApiProject,
  MyTask,
} from '../../types'
import { isSubmitShortcut } from '../../utils'

interface QuickDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  myTasks: MyTask[]
  currentActorId: string | null
  onTasksChanged: () => void
}

export function QuickDispatchModal({
  isOpen,
  onClose,
  members,
  projects,
  myTasks,
  currentActorId,
  onTasksChanged,
}: QuickDispatchModalProps) {
  const intl = useIntl()
  const {
    phase,
    input,
    setInput,
    mentions,
    setMentions,
    actions,
    error,
    parse,
    execute,
    removeAction,
    reset,
    backToInput,
  } = useQuickDispatch()

  // Build autocomplete candidates
  const candidates: MentionCandidate[] = useMemo(() => {
    const taskCandidates: MentionCandidate[] = myTasks.map(t => ({
      type: 'task',
      id: t.id,
      label: `${t.teamIdentifier}-${t.number} ${t.title}`,
      sublabel: t.project?.name,
      identifier: `${t.teamIdentifier}-${t.number}`,
      title: t.title,
    }))
    const projectCandidates: MentionCandidate[] = projects.map(p => ({
      type: 'project',
      id: p.id,
      label: p.name,
      name: p.name,
    }))
    const memberCandidates: MentionCandidate[] = members.map(m => ({
      type: 'member',
      id: m.actorId ?? m.id,
      label: m.name,
      name: m.name,
      actorId: m.actorId ?? m.id,
    }))
    return [...taskCandidates, ...projectCandidates, ...memberCandidates]
  }, [myTasks, projects, members])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const handleExecute = useCallback(async () => {
    const results = await execute()
    if (results) {
      const successCount = results.filter(r => r.success).length
      if (successCount > 0) {
        toast.success(
          intl.formatMessage(
            { id: 'quickDispatch.executed' },
            { count: successCount }
          )
        )
        onTasksChanged()
      }
      const errors = results.filter(r => !r.success)
      for (const err of errors) {
        toast.error(err.message ?? 'Action failed')
      }
      reset()
      onClose()
    }
  }, [execute, intl, onTasksChanged, reset, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase === 'preview' && isSubmitShortcut(e)) {
        e.preventDefault()
        handleExecute()
      }
      if (e.key === 'Escape') {
        if (phase === 'preview') {
          backToInput()
        } else if (phase === 'input') {
          handleClose()
        }
      }
    },
    [phase, handleExecute, backToInput, handleClose]
  )

  const hasCreateWithoutProject = actions.some(
    a => a.type === 'create' && !a.projectId
  )

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={intl.formatMessage({ id: 'quickDispatch.title' })}
        expandable={false}
        footer={
          phase === 'preview' ? (
            <div className='flex items-center gap-3 ml-auto'>
              <Button variant='ghost' onClick={backToInput}>
                {intl.formatMessage({ id: 'quickDispatch.back' })}
              </Button>
              <Button
                onClick={handleExecute}
                disabled={actions.length === 0 || hasCreateWithoutProject}
              >
                {intl.formatMessage(
                  { id: 'quickDispatch.confirmExecute' },
                  { count: actions.length }
                )}
              </Button>
            </div>
          ) : undefined
        }
      >
        {() => (
          <div onKeyDown={handleKeyDown}>
            {/* ── Input Phase ──────────────────────────── */}
            {(phase === 'input' || phase === 'loading') && (
              <div className='space-y-3'>
                <MentionInput
                  value={input}
                  onChange={setInput}
                  mentions={mentions}
                  onMentionsChange={setMentions}
                  candidates={candidates}
                  disabled={phase === 'loading'}
                  onSubmit={() => parse(input)}
                  autoFocus
                />
                {phase === 'loading' && (
                  <div className='flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400'>
                    <Loader2 className='size-4 animate-spin' />
                    {intl.formatMessage({ id: 'quickDispatch.parsing' })}
                  </div>
                )}
                {error && (
                  <div className='rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400'>
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* ── Preview Phase ──────────────────────────── */}
            {phase === 'preview' && (
              <div className='space-y-2'>
                {actions.map((action, i) => (
                  <ActionRow
                    key={i}
                    action={action}
                    onRemove={() => removeAction(i)}
                  />
                ))}
              </div>
            )}

            {/* ── Executing Phase ──────────────────────────── */}
            {phase === 'executing' && (
              <div className='flex items-center justify-center gap-2 py-8 text-sm text-indigo-600 dark:text-indigo-400'>
                <Loader2 className='size-4 animate-spin' />
                {intl.formatMessage({ id: 'quickDispatch.executing' })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}

function ActionRow({
  action,
  onRemove,
}: {
  action: QuickAction
  onRemove: () => void
}) {
  const intl = useIntl()

  if (action.type === 'update') {
    return (
      <div className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
        <ArrowRightLeft className='size-4 text-blue-500 shrink-0' />
        <span className='font-mono text-xs text-zinc-500'>
          {action.taskIdentifier}
        </span>
        <span className='truncate font-medium'>{action.taskTitle}</span>
        {action.fields.status && (
          <span className='ml-auto text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800'>
            → {action.fields.status}
          </span>
        )}
        {action.fields.priority && (
          <span className='text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800'>
            {action.fields.priority}
          </span>
        )}
        <button
          onClick={onRemove}
          className='ml-1 p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded'
        >
          <X className='size-3.5 text-zinc-400' />
        </button>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
      <Plus className='size-4 text-green-500 shrink-0' />
      <span className='truncate font-medium'>{action.title}</span>
      {action.projectName && (
        <span className='text-xs text-zinc-500'>{action.projectName}</span>
      )}
      {action.assigneeName && (
        <span className='text-xs text-zinc-500'>@{action.assigneeName}</span>
      )}
      <span className='ml-auto text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800'>
        {action.status}
      </span>
      <button
        onClick={onRemove}
        className='ml-1 p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded'
      >
        <X className='size-3.5 text-zinc-400' />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/modals/QuickDispatchModal.tsx lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: upgrade QuickDispatchModal with action list preview and MentionInput [LUM-0]"
```

---

### Task 8: Wire Up — WorkspaceModals & WorkspaceApp Integration

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/WorkspaceModals.tsx`
- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

Update the parent components to pass the new props (myTasks, projects, currentActorId, onTasksChanged) to QuickDispatchModal.

- [ ] **Step 1: Update WorkspaceModals props and rendering**

In `WorkspaceModals.tsx`, update the `WorkspaceModalsProps` interface and the `QuickDispatchModal` rendering:

1. Remove from interface: `onQuickDispatchEdit` (no longer needed — v2 handles everything internally)
2. Add to interface: `myTasks: MyTask[]`, `currentActorId: string | null`
3. Update the `QuickDispatchModal` JSX:

```tsx
{
  isQuickDispatchOpen && (
    <QuickDispatchModal
      isOpen={isQuickDispatchOpen}
      onClose={() => setIsQuickDispatchOpen(false)}
      members={members}
      projects={projects}
      myTasks={myTasks}
      currentActorId={currentActorId}
      onTasksChanged={onTasksChanged}
    />
  )
}
```

Remove the import of `QuickDispatchParsedFields` from the modal (it's no longer exported).

- [ ] **Step 2: Update WorkspaceApp to pass new props**

In `WorkspaceApp.tsx`:

1. Remove `handleQuickDispatchEdit` callback and `onQuickDispatchEdit` prop from WorkspaceModals
2. Add `myTasks={myTasks}` and `currentActorId={currentActorId}` to WorkspaceModals
3. Update the `openNewTaskModal` function to no longer open QuickDispatch — instead open NewTaskModal directly for kanban add-task flow
4. Add a separate `openQuickDispatch` function for Cmd+K:

```typescript
const openQuickDispatch = useCallback(() => {
  setIsQuickDispatchOpen(true)
}, [])
```

5. Update the Cmd+K handler to call `openQuickDispatch()` instead of `openNewTaskModal()`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/WorkspaceModals.tsx app/workspace/[workspaceUrl]/WorkspaceApp.tsx
git commit -m "feat: wire up QuickDispatch v2 in WorkspaceModals and WorkspaceApp [LUM-0]"
```

---

### Task 9: Add tasksClient.quickDispatch Methods

**Files:**

- Modify: `lib/api-client/tasks.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`

Add API client methods for the v2 parse and execute endpoints.

- [ ] **Step 1: Add API constants**

In `app/workspace/[workspaceUrl]/constants.ts`, ensure there are entries for the quick dispatch endpoints (check if they already exist, and add if missing):

```typescript
quickDispatchParse: '/api/tasks/parse-quick-dispatch',
quickDispatchExecute: '/api/tasks/quick-dispatch/execute',
```

- [ ] **Step 2: Add client methods**

In `lib/api-client/tasks.ts`, add:

```typescript
parseQuickDispatch<T>(data: unknown, signal?: AbortSignal) {
  return apiFetch<T>('/api/tasks/parse-quick-dispatch', {
    method: 'POST',
    body: data,
    signal,
  })
},

executeQuickDispatch<T>(data: unknown) {
  return apiFetch<T>('/api/tasks/quick-dispatch/execute', {
    method: 'POST',
    body: data,
  })
},
```

- [ ] **Step 3: Update useQuickDispatch to use tasksClient instead of raw apiFetch** (optional — if codebase convention is to go through client layer)

- [ ] **Step 4: Commit**

```bash
git add lib/api-client/tasks.ts app/workspace/[workspaceUrl]/constants.ts
git commit -m "feat: add quick dispatch v2 API client methods [LUM-0]"
```

---

### Task 10: End-to-End Smoke Test & Cleanup

**Files:**

- Modify: `__tests__/quick-dispatch-prompt.test.ts` (ensure v1 tests still pass alongside v2)

- [ ] **Step 1: Run all existing tests**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npx next lint`
Expected: No errors

- [ ] **Step 4: Manual smoke test checklist**

1. Open workspace, press Cmd+K → QuickDispatch modal opens
2. Type `@` → autocomplete popover shows tasks, projects, members
3. Select a task → mention inserted in input
4. Type `@ENG-42 完成` → parse → preview shows single update action
5. Click "Execute (1)" → task status updates, modal closes, toast shown
6. Type `@ENG-42 完成，创建支付集成 @ProjectName @MemberName` → parse → preview shows 2 actions
7. Click X on an action → it's removed from the list
8. Click "Execute (N)" → all actions execute
9. Type without @ → AI fallback parses the input
10. Kanban add-task button → still opens NewTaskModal (not QuickDispatch)

- [ ] **Step 5: Commit final cleanup**

```bash
git add -A
git commit -m "chore: quick dispatch v2 cleanup and test verification [LUM-0]"
```
