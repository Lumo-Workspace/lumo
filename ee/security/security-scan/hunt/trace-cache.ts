/**
 * LUM-1224 — the prompt-cache share of one hunt task's search, summed from
 * its step trace for the deploy log. Pure.
 */
import type { HuntStepTrace } from '@/ee/security/services/security-hunt.config'

export function formatTraceCache(trace: ReadonlyArray<HuntStepTrace>): string {
  let input = 0
  let read = 0
  let write = 0
  for (const t of trace) {
    input += t.inputTokens ?? 0
    read += t.cacheReadTokens ?? 0
    write += t.cacheWriteTokens ?? 0
  }
  return `steps=${trace.length} in=${input} cacheRead=${read} cacheWrite=${write}`
}
