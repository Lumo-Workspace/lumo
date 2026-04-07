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
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
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
