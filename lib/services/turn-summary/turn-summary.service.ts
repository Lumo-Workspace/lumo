import { FAST_MODEL } from '@/lib/ai/models'
import { logger } from '@/lib/logger'
import { generateText } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { extractCurrentTurn } from '@/lib/services/memory/layer1-input'
import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import { cleanTurnSummary } from '@/lib/services/meta-reasoning'
import { DERIVED_CONTENT_NO_CODE_RULE } from '@/lib/ai-derived/strip-code'
import { aiFeaturesService } from '@/lib/services/ai-features.service'

interface TriggerInput {
  /** The just-inserted STOP / STOP_FAILURE event id — destination for
   *  the generated summary write-back. */
  stopEventId: string
  /** Claude Code session id; events are pulled by sessionId, not taskId,
   *  because the turn boundary lives in the session's event stream. */
  sessionId: string
}

const MODEL_ID = FAST_MODEL
const MAX_OUTPUT_TOKENS = 80

const SYSTEM_PROMPT = `你是 Lumo 的 Agent 运行总结助手。给你一个 Claude Code 回合内的工具调用序列（已压缩），请用一句中文（不超过 60 个字）总结这一回合 Agent 实际做了什么——基于事件本身，不要套话。

要求：
- 用动词开头，例如"读了 X、修改 Y、运行 Z"
- 提到关键文件名或命令时保留原样
- 不要写"我"或"Agent"，直接写动作
- 不要解释为什么、不要总结意义、不要写下一步、不要写"完成了"
- 如果回合只是查询/思考没有副作用，写"查阅 X"或"分析 X"
- 严格一句话，不换行，不带引号`

/**
 * Fire-and-forget: read this STOP's surrounding session events, slice
 * the just-ended turn out, ask a small LLM for a one-line description
 * of what happened, and write it back onto the STOP HookEvent row.
 *
 * LUM-773 — this is now the SUMMARY-ONLY path: sessions with no bound task
 * (STOP) and STOP_FAILURE turns. A task-bound STOP gets its summary from the
 * combined Layer 1 extraction (`layer1Service`), whose single model call
 * yields both the memory candidates and this same one-liner — the stop route
 * dispatches to exactly one of the two. Keep the summary contract here and in
 * `layer1-prompt.ts` (`## turnSummary`) in step.
 *
 * Owns its own error handling (must never throw — invoked from
 * `afterRecord` which itself runs under `waitUntil`). Failure modes:
 *   - empty turn → no-op
 *   - LLM error / empty output → no-op (UI falls back to
 *     last_assistant_message first-sentence)
 *   - DB write fails on a deleted row → swallowed inside repo
 *
 * Cost note: one small-model call per turn (~few hundred input + 80
 * output tokens), routed to deepseek-v4-flash via the gateway to cut
 * cost vs Haiku. We do not retry — a stuck call is wasted latency, and
 * the next STOP will produce another summary opportunity.
 */
export const turnSummaryService = {
  async generateAndStore(input: TriggerInput): Promise<void> {
    try {
      // LUM-1338: switched off, or no model — no call, no error log per turn.
      if (
        !(await aiFeaturesService.isEnabled(
          { sessionId: input.sessionId },
          'turnSummary'
        ))
      )
        return
      const events = await sessionRepository.listEventsForSession(
        input.sessionId
      )
      if (events.length === 0) return

      const turnEvents = extractCurrentTurn(events as unknown as RawEvent[])
      if (turnEvents.length === 0) return

      const compacted = compactEvents(turnEvents, { maxToolCalls: 80 }).text
      if (compacted.trim().length === 0) return

      const { text } = await generateText({
        model: gateway(MODEL_ID),
        system: `${SYSTEM_PROMPT}\n\n${DERIVED_CONTENT_NO_CODE_RULE}`,
        prompt: compacted,
        // Tight output budget — we want a sentence, not a paragraph.
        // The model occasionally still produces a brief lede + dash +
        // detail; the truncate below keeps the wire format predictable.
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })

      // LUM-574: cleanTurnSummary also REJECTS meta-reasoning (returns null),
      // so the model's "我们被要求…" deliberation is never stored as a summary.
      const cleaned = cleanTurnSummary(text)
      if (!cleaned) return

      await hookEventRepository.setTurnSummary(input.stopEventId, cleaned)
    } catch (error) {
      logger.error(
        `[turnSummary] failed event=${input.stopEventId} session=${input.sessionId}:`,
        error
      )
    }
  },
}
