/**
 * LUM-808: `lumo task testcase run` 判决层的纯函数。
 *
 * 抽出来单独测的理由同 `./test-case-handle.ts`：这里藏着 CLI 表面 **1-based**
 * ↔ 存储 **0-based** 的换算，以及回显那一行的措辞——后者是整个步骤 2 最要紧
 * 的输出，自己报的 PASS 当场被降级，比事后在网页上发现有用得多。
 *
 * CLI 不重算封顶：`deriveRunCeiling` 的结论由服务端随 run 返回，这里只负责把
 * 它渲染成一行。一份规则一处实现。
 */

export type FailureCause =
  | 'IMPLEMENTATION_DEFECT'
  | 'CASE_OUTDATED'
  | 'EXTERNAL_BLOCK'
  | 'UNKNOWN'

/** 命令行上的短词 → 存储枚举。短词是给人打的，枚举是给库存的。 */
const CAUSE_WORDS: Record<string, FailureCause> = {
  defect: 'IMPLEMENTATION_DEFECT',
  outdated: 'CASE_OUTDATED',
  external: 'EXTERNAL_BLOCK',
  unknown: 'UNKNOWN',
}

const CAUSE_ENUMS: FailureCause[] = [
  'IMPLEMENTATION_DEFECT',
  'CASE_OUTDATED',
  'EXTERNAL_BLOCK',
  'UNKNOWN',
]

export type CauseResolution =
  | { ok: true; cause: FailureCause | null }
  | { ok: false; error: string }

/**
 * `--cause` 的解析，连同它与 result 的绑定关系。
 *
 * FAIL 必须归因（`unknown` 是合法答案，不是逃避）；非 FAIL 不谈「谁的锅」。
 * 服务端有同样的闸门——这里挡一道只是为了不让人白跑一趟网络。
 */
export function resolveFailureCause(
  raw: string | undefined,
  result: 'PASS' | 'FAIL' | 'BLOCKED'
): CauseResolution {
  const given = raw?.trim()

  if (result !== 'FAIL') {
    if (given) {
      return {
        ok: false,
        error: `a ${result} run cannot carry --cause. Only a FAIL says whose fault it is.`,
      }
    }
    return { ok: true, cause: null }
  }

  if (!given) {
    return {
      ok: false,
      error:
        '--cause is required on a FAIL. Valid values: defect | outdated | external | unknown. ' +
        'Use "unknown" if you genuinely could not tell — that is a real answer.',
    }
  }

  const word = CAUSE_WORDS[given.toLowerCase()]
  if (word) return { ok: true, cause: word }

  const asEnum = given.toUpperCase() as FailureCause
  if (CAUSE_ENUMS.includes(asEnum)) return { ok: true, cause: asEnum }

  return {
    ok: false,
    error: `invalid --cause "${given}". Valid values: defect | outdated | external | unknown.`,
  }
}

export type UnprovenResolution =
  | { ok: true; indices: number[] }
  | { ok: false; error: string }

/**
 * `--unproven <n>`（可重复）：本次没能观察到的复验条目。
 * CLI 表面 1-based，存储 0-based——换算只在这里发生（同 `toZeroBased`）。
 */
export function resolveUnprovenIndices(
  raw: string[] | undefined
): UnprovenResolution {
  if (!raw || raw.length === 0) return { ok: true, indices: [] }

  const indices: number[] = []
  for (const value of raw) {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed) || parseInt(trimmed, 10) < 1) {
      return {
        ok: false,
        error: `invalid --unproven "${value}". Verification numbers are 1-based (the first one is 1).`,
      }
    }
    indices.push(parseInt(trimmed, 10) - 1)
  }
  return { ok: true, indices }
}

/** 服务端随 run 回传的封顶结论。形状与 `lib/test-cases/provability.ts` 一致。 */
export type RunCeiling =
  | { effective: 'PASS' }
  | {
      effective: 'UNPROVEN'
      reason: 'environment'
      requiredEnvironment: string
      ranIn: string
    }
  | {
      effective: 'UNPROVEN'
      reason: 'unobserved'
      unobserved: Array<{ index: number; text: string }>
    }
  | { effective: 'FAIL' }
  | { effective: 'BLOCKED' }

export interface RunOutcome {
  handle: string
  reported: string
  environment: string
  ceiling: RunCeiling
}

/**
 * 回显的第一行。
 *
 * 没被封顶时它和 LUM-801 的原样一字不差——不给没发生的事加噪音。被封顶时
 * 这一行自己就说清三件事：我报的是什么、实际结论是什么、因为哪条边界。
 * 不需要再去别处查。
 */
export function formatRunOutcome(outcome: RunOutcome): string {
  const head = `Recorded ${outcome.handle}: ${outcome.reported} on ${outcome.environment}`
  const ceiling = outcome.ceiling
  if (ceiling.effective !== 'UNPROVEN') return head

  if (ceiling.reason === 'environment') {
    return `${head} → UNPROVEN (this case only proves anything on ${ceiling.requiredEnvironment})`
  }
  // 下标回到 1-based 的表面。
  const items = ceiling.unobserved
    .map(u => `#${u.index + 1} ${u.text}`)
    .join('; ')
  return `${head} → UNPROVEN (unobserved verification: ${items})`
}

export type RequiredEnvResolution =
  | { ok: true; value: 'LOCAL' | 'PREVIEW' | 'PRODUCTION' | null | undefined }
  | { ok: false; error: string }

/**
 * `--requires-env <local|preview|production|none>`。
 *
 * 三态，别压成两态：`undefined` = 没给这个 flag（update 时保持库里原样），
 * `null` = 显式清除约束，具体值 = 设定约束。把「没给」和「清除」混为一谈会
 * 让一次只改标题的 update 顺手抹掉目标环境。
 */
export function resolveRequiredEnvironment(
  raw: string | undefined
): RequiredEnvResolution {
  if (raw === undefined) return { ok: true, value: undefined }

  const given = raw.trim().toLowerCase()
  if (given === 'none' || given === '') return { ok: true, value: null }
  if (given === 'local') return { ok: true, value: 'LOCAL' }
  if (given === 'preview') return { ok: true, value: 'PREVIEW' }
  if (given === 'production') return { ok: true, value: 'PRODUCTION' }

  return {
    ok: false,
    error: `invalid --requires-env "${raw}". Valid values: local | preview | production | none.`,
  }
}
