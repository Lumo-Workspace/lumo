import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryContentToText } from '@/lib/memory/content-text'
import { isMemoryPipelineDisabled } from '@/lib/memory/pipeline-switch'
import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import { aiFeaturesService } from '@/lib/services/ai-features.service'

/**
 * DONE-time Layer-1 memory curation (LUM-544, Section 1 — automates the old
 * `lumo session wrap` memory-review section). When a task reaches DONE, an LLM
 * judge reviews the Layer-1 memories each of the task's sessions newly recorded,
 * against that session's event log, and INVALIDATES (soft, not hard-delete —
 * LUM-325 "失效非删") only the ones that are clearly wrong / self-contradictory.
 * Uncertain memories are left untouched. Promotion to project scope is NOT done
 * here — that stays with the existing Layer-2 flow.
 *
 * Best-effort: every step degrades to a no-op on failure; never throws (it runs
 * detached under `waitUntil` from the task→DONE path).
 */
export const memoryCurationService = {
  /** Curate every session of a just-completed task. Idempotent (invalidate is
   *  guarded on status='ACTIVE', so an already-retired row is skipped). */
  async curateForTask(taskId: string): Promise<void> {
    // LUM-1314: the global memory pipeline switch is on.
    if (isMemoryPipelineDisabled()) return
    try {
      // LUM-1338: memory consolidation switched off, or no model.
      if (
        !(await aiFeaturesService.isEnabled({ taskId }, 'memoryConsolidation'))
      )
        return
      const task = await taskRepository.getTitleAndStatus(taskId)
      if (!task) return
      const sessions = await sessionRepository.listForTask(taskId)
      for (const s of sessions) {
        try {
          // LUM-932 P3: an unattached session inferred onto this task spans
          // other tasks too — only memories born on THIS task are eligible.
          await curateSession(s.id, task.title, s.inferred ? taskId : undefined)
        } catch (err) {
          logger.error(`[memory.curation] session=${s.id} failed`, err)
        }
      }
    } catch (err) {
      logger.error(`[memory.curation] task=${taskId} failed`, err)
    }
  },
}

/**
 * Curate one session: judge its newly-recorded ACTIVE Layer-1 memories against
 * its event log, soft-invalidate the clearly-wrong ones. No-op when the session
 * recorded nothing or the log is empty. `sourceTaskId` narrows eligibility to
 * memories born on that task (unattached multi-task sessions).
 */
async function curateSession(
  sessionId: string,
  taskTitle: string,
  sourceTaskId?: string
): Promise<void> {
  const memories = sourceTaskId
    ? await memoryRepository.findBySourceSessionId(sessionId, { sourceTaskId })
    : await memoryRepository.findBySourceSessionId(sessionId)
  if (memories.length === 0) return

  const events = await sessionRepository.listEventsForSession(sessionId)
  const eventLog = compactEvents(events as unknown as RawEvent[], {
    maxToolCalls: 200,
  }).text
  if (eventLog.trim().length === 0) return

  const candidates = memories.map(m => ({
    id: m.id,
    text: memoryContentToText(m.category, m.content),
  }))

  // Dynamic import keeps the @ai-sdk/gateway static graph out of this service's
  // (and its callers') jest path — see project_ai_sdk_gateway_jest_trap.
  const { judgeMemoryCuration } =
    await import('@/lib/services/memory/curation-judge')
  const invalid = await judgeMemoryCuration({ taskTitle, candidates, eventLog })
  if (invalid.length === 0) return

  let invalidated = 0
  for (const entry of invalid) {
    const n = await memoryRepository.invalidate(entry.id)
    invalidated += n
  }
  logger.info(
    `[memory.curation] session=${sessionId} invalidated=${invalidated}/${memories.length}`
  )
}
