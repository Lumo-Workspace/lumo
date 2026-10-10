/**
 * LUM-1061 (RFC §3.4 "agent 提醒") — plugin sections of the agent-facing
 * surfaces: session-start / `session attach`, `lumo task status` and the
 * PreToolUse reminder.
 *
 * Best-effort on the core's side: a contributor that throws is logged and
 * contributes nothing, so a plugin can never take one of these surfaces
 * down. No contributor → `''` / an empty section / no reminder field.
 */
import { logger } from '@/lib/logger'
import { getPluginRegistry } from './registry'
import type { TaskStatusSection } from './types'

/**
 * Session-start / attach sections of every contributor, joined by a blank
 * line; `''` when none has anything to show.
 */
export async function collectSessionStartSections(input: {
  taskId: string
  taskIdentifier: string
}): Promise<string> {
  const contributors = getPluginRegistry().agentContexts.filter(
    c => c.sessionStart
  )
  if (contributors.length === 0) return ''
  const sections = await Promise.all(
    contributors.map(c => c.sessionStart!(input).catch(() => ''))
  )
  return sections.filter(s => s !== '').join('\n\n')
}

/**
 * Task-status sections of every contributor, merged: `nextActions` in
 * registration order, `fields` shallow-merged (a later plugin cannot
 * overwrite an earlier plugin's field).
 */
export async function collectTaskStatusSections(
  taskId: string
): Promise<TaskStatusSection> {
  const merged: TaskStatusSection = { nextActions: [], fields: {} }
  const contributors = getPluginRegistry().agentContexts.filter(
    c => c.taskStatus
  )
  const sections = await Promise.all(
    contributors.map(async c => {
      try {
        return await c.taskStatus!(taskId)
      } catch (error) {
        logger.warn('taskStatus.pluginSection.failed', {
          plugin: c.id,
          taskId,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    })
  )
  for (const section of sections) {
    if (!section) continue
    merged.nextActions.push(...section.nextActions)
    for (const [key, value] of Object.entries(section.fields)) {
      if (!(key in merged.fields)) merged.fields[key] = value
    }
  }
  return merged
}

/**
 * PreToolUse reminders keyed by response field (`<contributor id>Reminder`,
 * e.g. `securityReminder`). Each read is settled on its own: one failing
 * never drops another.
 */
export async function collectPreToolUseReminders(input: {
  sessionId: string | null
  taskId: string
}): Promise<Record<string, string>> {
  const contributors = getPluginRegistry().agentContexts.filter(
    c => c.preToolUseReminder
  )
  const out: Record<string, string> = {}
  const results = await Promise.allSettled(
    contributors.map(c => c.preToolUseReminder!(input))
  )
  results.forEach((result, i) => {
    const id = contributors[i]!.id
    if (result.status === 'fulfilled') {
      if (result.value) out[`${id}Reminder`] = result.value
    } else {
      logger.error(`pre-tool-use ${id} reminder error:`, result.reason)
    }
  })
  return out
}
