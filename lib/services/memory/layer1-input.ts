import type { MemoryCategory } from '@prisma/client'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

export interface Layer1Input {
  task: {
    id: string
    title: string
    description: string | null
    projectId: string
    workspaceId: string
  }
  /** Events of the *current* turn (between the previous STOP and the latest STOP, inclusive of the latest STOP). */
  turnEvents: RawEvent[]
  /** Active task-scoped memories already on file — feeds UPDATE / DELETE decisions. */
  existingMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

/**
 * Pure: slice an ordered event stream down to the current turn.
 *
 * A "turn" is bracketed by STOP events. The latest STOP marks the end of the
 * current turn; the previous STOP marks where the previous turn ended (so
 * the current turn starts at the event right after it). If there is no
 * previous STOP yet, the current turn is the entire stream up to and
 * including the latest STOP.
 *
 * Returns an empty array when the stream contains no STOP at all (Layer 1
 * shouldn't be running in that case, but we degrade gracefully).
 */
export function extractCurrentTurn(events: RawEvent[]): RawEvent[] {
  const stopIndices: number[] = []
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.type === 'STOP') stopIndices.push(i)
  }
  if (stopIndices.length === 0) return []

  const lastStop = stopIndices[stopIndices.length - 1]!
  const prevStop =
    stopIndices.length > 1 ? stopIndices[stopIndices.length - 2]! : -1
  return events.slice(prevStop + 1, lastStop + 1)
}

/**
 * Gather everything the Layer 1 extraction LLM needs for a single Stop-hook
 * trigger. Returns null when the input is unusable (task gone, no events,
 * or the turn is empty) — caller should treat this as "skip this run".
 */
export async function getLayer1Input(
  sessionId: string,
  taskId: string
): Promise<Layer1Input | null> {
  const task = await taskRepository.findForMemoryContext(taskId)
  if (!task) return null

  const events = await sessionRepository.listEventsForSession(sessionId)
  if (events.length === 0) return null

  const turnEvents = extractCurrentTurn(events as unknown as RawEvent[])
  if (turnEvents.length === 0) return null

  const existingMemories = await memoryRepository.findActiveTaskMemories(taskId)

  return {
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      projectId: task.projectId,
      workspaceId: task.project.workspaceId,
    },
    turnEvents,
    existingMemories: existingMemories.map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    })),
  }
}
