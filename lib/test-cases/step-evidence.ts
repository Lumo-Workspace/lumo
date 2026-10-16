/**
 * LUM-1185: 网页记录弹窗里「把证据文件挂到某一步」的纯逻辑。
 * 纯模块（客户端组件 import），不得 import prisma / service。
 *
 * 契约与 CLI `--step-evidence` 相同：步骤文件和整次文件一起上传、一起进 run 的
 * evidence 数组，stepResults[].evidence 记的是数组下标。不另开接口。
 */
import {
  EVIDENCE_ALLOWED_TYPES,
  EVIDENCE_MAX_BYTES,
  MAX_EVIDENCE_FILES,
} from '@/lib/validation/test-case'
import type { StepPhase } from './step-report'
import type { PickerState } from './step-picker'

export type StepFiles<F> = Record<string, F[]>

/**
 * 本次提交真正会上报的步骤 key（`STEPS:0` 形状）。只有它们能挂证据：
 * BLOCKED 不报步骤；非 FAIL 的 run 里标「失败」的步不算数；FAIL 时报到第一个
 * 失败步为止（与 pickerToStepResults 同一规则）。
 */
export function reportableStepKeys(
  steps: string[],
  verification: string[],
  result: 'PASS' | 'FAIL' | 'BLOCKED',
  state: PickerState
): Set<string> {
  const keys = new Set<string>()
  if (result === 'BLOCKED') return keys
  const items: Array<{ phase: StepPhase; index: number }> = [
    ...steps.map((_, index) => ({ phase: 'STEPS' as const, index })),
    ...verification.map((_, index) => ({
      phase: 'VERIFICATION' as const,
      index,
    })),
  ]
  for (const { phase, index } of items) {
    const key = `${phase}:${index}`
    const e = state[key]
    if (!e) continue
    if (e.status === 'FAIL' && result !== 'FAIL') continue
    keys.add(key)
    if (e.status === 'FAIL') break
  }
  return keys
}

/** 丢掉挂在不再上报的步骤下的文件。没变化时返回原对象（省一次重渲染）。 */
export function pruneStepFiles<F>(
  files: StepFiles<F>,
  keep: Set<string>
): StepFiles<F> {
  const stale = Object.keys(files).filter(k => !keep.has(k))
  if (stale.length === 0) return files
  const next: StepFiles<F> = {}
  for (const [k, v] of Object.entries(files)) if (keep.has(k)) next[k] = v
  return next
}

export function countStepFiles<F>(files: StepFiles<F>): number {
  return Object.values(files).reduce((n, list) => n + list.length, 0)
}

export type EvidenceFileLike = { name: string; size: number; type: string }

export type EvidenceCheck =
  | { ok: true }
  | {
      ok: false
      reason: 'tooMany'
      /** 合计（含 others）。 */
      count: number
      /** 这次选中的个数。 */
      picked: number
      others: number
      max: number
    }
  | {
      ok: false
      reason: 'tooLarge'
      filename: string
      sizeMb: string
      maxMb: number
    }
  | { ok: false; reason: 'badType'; filename: string }

/**
 * 与上传路由同一套闸门：类型白名单、单个 ≤10 MB、整次 run（整次 + 各步合计）
 * ≤5 个。`others` = 这次选择之外、本 run 已经挑好的文件数。
 */
export function checkEvidenceFiles(
  incoming: EvidenceFileLike[],
  others: number
): EvidenceCheck {
  const count = others + incoming.length
  if (count > MAX_EVIDENCE_FILES)
    return {
      ok: false,
      reason: 'tooMany',
      count,
      picked: incoming.length,
      others,
      max: MAX_EVIDENCE_FILES,
    }
  const badType = incoming.find(f => !EVIDENCE_ALLOWED_TYPES.includes(f.type))
  if (badType) return { ok: false, reason: 'badType', filename: badType.name }
  const big = incoming.find(f => f.size > EVIDENCE_MAX_BYTES)
  if (big)
    return {
      ok: false,
      reason: 'tooLarge',
      filename: big.name,
      sizeMb: (big.size / 1024 / 1024).toFixed(1),
      maxMb: EVIDENCE_MAX_BYTES / 1024 / 1024,
    }
  return { ok: true }
}

/**
 * 拼出要上传的文件列表与带下标的 stepResults。顺序：先整次文件，再按步骤
 * 顺序排的步骤文件；`offset` = 上传文件前面已经在 evidence 数组里的条目数。
 */
export function assembleStepEvidence<
  F,
  R extends { phase: StepPhase; index: number },
>(
  runFiles: F[],
  stepFiles: StepFiles<F>,
  stepResults: R[],
  offset = 0
): { files: F[]; stepResults: Array<R & { evidence?: number[] }> } {
  const files = [...runFiles]
  const withEvidence = stepResults.map(r => {
    const mine = stepFiles[`${r.phase}:${r.index}`] ?? []
    if (mine.length === 0) return r
    const evidence = mine.map((_, i) => offset + files.length + i)
    files.push(...mine)
    return { ...r, evidence }
  })
  return { files, stepResults: withEvidence }
}

/** `STEPS:1` → `s2`，`VERIFICATION:0` → `v1`（与 CLI 同一套编号）。 */
export function stepRefOfKey(key: string): string {
  const [phase, index] = key.split(':')
  return `${phase === 'STEPS' ? 's' : 'v'}${Number(index) + 1}`
}
