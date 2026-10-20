import { z } from 'zod'
import {
  ASSESSED_PRIORITIES,
  type TaskPriorityValue,
} from '@/lib/task/priority'

export const PRIORITY_SYSTEM_PROMPT = `You are a task priority analysis assistant. Based on the project's historical task patterns and user preferences, recommend a priority for the new task.

Priority definitions:
- LOW: Does not affect core functionality, can be deferred
- MEDIUM: Normal iteration requirement
- HIGH: Affects core flows or multiple users
- URGENT: Production incident or blocking issue

When recommending, prioritize:
1. User's historical preferences (override records have highest weight)
2. Priority distribution of similar tasks in the same project
3. Urgency signals in the task description

You MUST reference only tasks from the provided historical task list. Do NOT fabricate task IDs, numbers, or titles.`

export const PrioritySuggestionSchema = z.object({
  priority: z.enum(ASSESSED_PRIORITIES),
  reason: z
    .string()
    .max(100)
    .describe('One-line reason for the recommendation'),
  stats: z.object({
    total: z.number().describe('Number of similar historical tasks found'),
    distribution: z
      .record(z.string(), z.number())
      .describe(
        'Priority distribution of similar tasks, e.g. { "HIGH": 3, "MEDIUM": 1 }'
      ),
  }),
  similarTasks: z
    .array(
      z.object({
        id: z.string(),
        number: z.number(),
        title: z.string(),
        priority: z.enum(ASSESSED_PRIORITIES),
      })
    )
    .max(2)
    .describe('Up to 2 most similar historical tasks'),
})

export type PrioritySuggestion = z.infer<typeof PrioritySuggestionSchema>

interface HistoricalTask {
  id: string
  number: number
  title: string
  priority: TaskPriorityValue
}

interface OverrideRecord {
  taskTitle: string
  aiSuggested: TaskPriorityValue
  userChosen: TaskPriorityValue
}

interface BuildPromptParams {
  title: string
  description?: string
  projectName?: string | undefined
  historicalTasks: HistoricalTask[]
  overrides: OverrideRecord[]
}

const MAX_HISTORICAL_TASKS = 50
const MAX_OVERRIDES = 30

export function buildPriorityPrompt({
  title,
  description,
  projectName,
  historicalTasks,
  overrides,
}: BuildPromptParams): string {
  const truncatedTasks = historicalTasks.slice(0, MAX_HISTORICAL_TASKS)
  const truncatedOverrides = overrides.slice(0, MAX_OVERRIDES)

  const taskLines =
    truncatedTasks.length > 0
      ? truncatedTasks
          .map(t => `[${t.priority}] #${t.number} ${t.title}`)
          .join('\n')
      : 'No historical tasks available.'

  const overrideLines =
    truncatedOverrides.length > 0
      ? truncatedOverrides
          .map(
            o =>
              `"${o.taskTitle}" → AI suggested ${o.aiSuggested}, user chose ${o.userChosen}`
          )
          .join('\n')
      : 'No preference records available.'

  return `## Current Task
Title: ${title}
Description: ${description || 'Not provided'}
${projectName ? `Project: ${projectName}` : 'Project: Not yet assigned'}

## User's Preference Records${projectName ? ` in This Project` : ''} (recent ${MAX_OVERRIDES} overrides)
${overrideLines}

## ${projectName ? 'Project ' : ''}Historical Tasks (recent ${MAX_HISTORICAL_TASKS})
${taskLines}`
}
