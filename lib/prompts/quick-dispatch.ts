import { z } from 'zod'

export const QUICK_DISPATCH_SYSTEM_PROMPT = `You are a task dispatcher for a project management tool. Parse the user's natural language input into structured task fields.

Priority mapping:
- P0, P1, 紧急, urgent, blocker → URGENT
- P2, 高, high, important → HIGH
- P3, 中, medium, normal (or no priority mentioned) → MEDIUM
- P4, 低, low, minor, nice-to-have → LOW

Status mapping:
- doing, 进行中, in progress, started → IN_PROGRESS
- review, 评审, in review → IN_REVIEW
- done, 完成, finished → DONE
- (default or no status mentioned) → TODO

Rules:
1. Extract a clear, actionable task title. Remove meta-info (assignee names, dates, priority keywords) from the title.
2. Match assignee names against the provided member list using fuzzy matching. Output the exact actorId from the list.
3. Match project references against the provided project list using fuzzy matching. Output the exact projectId from the list.
4. Parse dates relative to the provided current date. Output ISO 8601 datetime (midnight UTC).
5. Generate a concise 1-2 sentence HTML description focused on execution steps. Use only: <p>, <strong>, <code>, <ul>/<li>.
6. Set titleTooVague=true if the title is generic/meaningless: "new task", "新任务", "做个东西", "task", "something", "test", or under 4 meaningful characters.
7. Set missingProject=true if no project could be confidently matched from the input.
8. If a field is not mentioned or cannot be resolved, use null for optional fields and MEDIUM/TODO for defaults.`

export const QuickDispatchResponseSchema = z.object({
  title: z.string().describe('Clean task title with meta-info removed'),
  description: z
    .string()
    .describe('1-2 sentence HTML description of execution steps'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  projectId: z
    .string()
    .nullable()
    .describe('Matched project ID from the provided list, or null'),
  projectName: z
    .string()
    .nullable()
    .describe('Matched project name for display, or null'),
  assigneeActorId: z
    .string()
    .nullable()
    .describe('Matched member actorId from the provided list, or null'),
  assigneeName: z
    .string()
    .nullable()
    .describe('Matched member name for display, or null'),
  dueDate: z
    .string()
    .nullable()
    .describe('ISO 8601 datetime string, or null if no date mentioned'),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
  titleTooVague: z
    .boolean()
    .describe('True if the extracted title is too generic to be useful'),
  missingProject: z
    .boolean()
    .describe('True if no project could be confidently resolved'),
})

export type QuickDispatchResponse = z.infer<typeof QuickDispatchResponseSchema>

interface BuildPromptParams {
  input: string
  projects: { id: string; name: string; description: string | null }[]
  members: { name: string; actorId: string }[]
  currentDate: string
}

export function buildQuickDispatchPrompt({
  input,
  projects,
  members,
  currentDate,
}: BuildPromptParams): string {
  const projectList = projects
    .map(
      p =>
        `- id="${p.id}" name="${p.name}"${p.description ? ` description="${p.description}"` : ''}`
    )
    .join('\n')

  const memberList = members
    .map(m => `- name="${m.name}" actorId="${m.actorId}"`)
    .join('\n')

  return `Current date: ${currentDate}

<projects>
${projectList}
</projects>

<members>
${memberList}
</members>

<user_input>${input}</user_input>`
}

// ─── V2: Multi-action prompt & schema ───────────────────────────────

export const QUICK_DISPATCH_V2_SYSTEM_PROMPT = `You are a task dispatcher for a project management tool. Parse the user's natural language input into one or more structured actions.
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
1. Match tasks from the provided user_tasks list by fuzzy title matching. Use the exact taskId and identifier from the matched task.
2. If a referenced task cannot be matched to the user_tasks list, treat it as a create action.
3. Match assignee names against the provided member list using fuzzy matching. Output the exact actorId from the list.
4. Match project references against the provided project list using fuzzy matching. Output the exact projectId from the list.
5. Generate a concise 1-2 sentence HTML description for create actions focused on execution steps. Use only: <p>, <strong>, <code>, <ul>/<li>.
6. Parse dates relative to the provided current date. Output ISO 8601 datetime (midnight UTC).
7. For update actions, only include fields that are being changed — omit unchanged fields.
8. Process ALL actions mentioned in the input. A single input may contain multiple updates, multiple creates, or a mix of both.`

export const QuickDispatchV2ResponseSchema = z.object({
  actions: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('update'),
          taskId: z.string().describe('Exact task ID from the user_tasks list'),
          taskIdentifier: z.string().describe('Task identifier like ENG-42'),
          taskTitle: z.string().describe('Task title for display'),
          fields: z.object({
            status: z
              .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
              .optional(),
            assigneeActorId: z.string().optional(),
            priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
          }),
        }),
        z.object({
          type: z.literal('create'),
          title: z.string(),
          status: z.enum([
            'BACKLOG',
            'TODO',
            'IN_PROGRESS',
            'IN_REVIEW',
            'DONE',
          ]),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
          projectId: z
            .string()
            .nullable()
            .describe('Matched project ID from the provided list, or null'),
          projectName: z
            .string()
            .nullable()
            .describe('Matched project name for display, or null'),
          assigneeActorId: z
            .string()
            .nullable()
            .describe('Matched member actorId from the provided list, or null'),
          assigneeName: z
            .string()
            .nullable()
            .describe('Matched member name for display, or null'),
          description: z
            .string()
            .describe('1-2 sentence HTML description of execution steps'),
          dueDate: z
            .string()
            .nullable()
            .describe('ISO 8601 datetime string, or null if no date mentioned'),
        }),
      ])
    )
    .min(1),
})

export type QuickDispatchV2Response = z.infer<
  typeof QuickDispatchV2ResponseSchema
>

interface BuildV2PromptParams {
  input: string
  projects: { id: string; name: string; description: string | null }[]
  members: { name: string; actorId: string }[]
  userTasks: {
    id: string
    identifier: string
    title: string
    status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
  }[]
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
