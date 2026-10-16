/**
 * LUM-1211: 网页记录弹窗的逐步选择 → 请求体里的 stepResults。
 * 纯模块（客户端组件 import），不得 import prisma / service。
 * 规则与服务端 missingStepRefs 一致：PASS 报全部；FAIL 报到第一个 FAIL 为止。
 */
import type { ReportedStepResult, StepPhase } from './step-report'

export type PickerEntry = { status: 'PASS' | 'FAIL' | 'SKIP'; reason: string }
export type PickerState = Record<string, PickerEntry>

export function pickerToStepResults(
  steps: string[],
  verification: string[],
  result: 'PASS' | 'FAIL',
  state: PickerState
):
  | { ok: true; value: ReportedStepResult[] }
  | { ok: false; missing: string[] } {
  const items: Array<{ phase: StepPhase; index: number }> = [
    ...steps.map((_, index) => ({ phase: 'STEPS' as const, index })),
    ...verification.map((_, index) => ({
      phase: 'VERIFICATION' as const,
      index,
    })),
  ]
  const value: ReportedStepResult[] = []
  const missing: string[] = []
  let broke = false
  for (const { phase, index } of items) {
    const e = state[`${phase}:${index}`]
    const ref = `${phase === 'STEPS' ? 's' : 'v'}${index + 1}`
    if (!e || (e.status === 'SKIP' && !e.reason.trim())) {
      missing.push(ref)
      continue
    }
    if (e.status === 'FAIL' && result !== 'FAIL') {
      missing.push(ref)
      continue
    }
    value.push(
      e.status === 'SKIP'
        ? { phase, index, status: 'SKIP', reason: e.reason.trim() }
        : { phase, index, status: e.status }
    )
    if (e.status === 'FAIL') {
      broke = true
      break
    }
  }
  if (result === 'FAIL' && !broke) return { ok: false, missing }
  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, value }
}
