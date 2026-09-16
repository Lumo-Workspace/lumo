/**
 * PURE — decide WHICH of the diff the LLM judge gets to see (LUM-732 cap,
 * LUM-758 selection).
 *
 * The cap itself was never the problem; the cut was. A unified diff is a
 * concatenation of per-file sections ordered by path, so slicing it at a
 * character offset meant a file's coverage was decided by where its NAME
 * sorted: `app/…` was always reviewed, `scripts/…` on a large PR essentially
 * never. It also cut mid-hunk, so the judge's last file was a fragment it
 * could not tell was a fragment, and `partial` could say only that something
 * was dropped, never what.
 *
 * So the same budget is spent on whole files, highest security signal first.
 * The ranking is not a new invention: `evaluateHuntTrigger` already parses
 * this exact diff and returns the sites (sinks, injection points, auth and
 * crypto paths) it found — the judge simply stopped throwing that away.
 *
 * Raising the cap is deliberately NOT the fix. Any constant has the same
 * cliff one PR later, and the scan's token mean is already over its bar.
 */
import { splitDiffByFile } from './diff-lines'

/**
 * 最小档的预算，也是 `packSecurityDiff` 的默认值（LUM-732 立的数）。
 */
export const SECURITY_DIFF_MAX_CHARS = 60_000

/**
 * 一次 judge 调用的超时上限。await 它的 worker 封顶 300s，扣掉确定性那一遍
 * 和落库，单次调用最多给到这里——所以预算不能顺着 PR 大小一直往上抬。
 */
export const JUDGE_TIMEOUT_CEILING_MS = 180_000

/**
 * LUM-758 — 改动源文件数 → judge 的 diff 预算与超时。
 *
 * 此前是所有 PR 一律 60,000 字符：那个数是 LUM-732 初版带进来的，从未被推导
 * 过，而它编码的其实是**成本**，不是容量（60k 字符 ≈ 15k token，对
 * REASONING_MODEL 远不是上限）。成本本来就该随要审的代码量走，L3 hunt 早就
 * 是这么做的（`HUNT_TASK_CAP_TIERS`）。
 *
 * 档位边界刻意与 `HUNT_TASK_CAP_TIERS` 用同一组数字（12 / 30 / ∞）：两层用
 * 同一个信号判断「这个 PR 有多大」，各用一套数字只会让它们对同一个 PR 得出
 * 不同的「大」。
 *
 * 最高档不再往上抬，而不是继续加预算：单次调用受 300s worker 约束，再大的
 * PR 只能看一角——此时 `stages.judge` 记 PARTIAL 并报出丢了哪些文件，比一个
 * 抬到跑不完的数字诚实。这与 `HUNT_OVERSIZED_SOURCE_FILES` 是同一条规矩。
 */
export const JUDGE_DIFF_BUDGET_TIERS: ReadonlyArray<{
  sourceFiles: number
  chars: number
  timeoutMs: number
}> = [
  { sourceFiles: 12, chars: SECURITY_DIFF_MAX_CHARS, timeoutMs: 120_000 },
  { sourceFiles: 30, chars: 120_000, timeoutMs: JUDGE_TIMEOUT_CEILING_MS },
  {
    sourceFiles: Number.POSITIVE_INFINITY,
    chars: 180_000,
    timeoutMs: JUDGE_TIMEOUT_CEILING_MS,
  },
]

/** 落在哪一档。最后一档兜住其余，所以永远有结果。 */
export function judgeDiffTier(sourceFiles: number): {
  sourceFiles: number
  chars: number
  timeoutMs: number
} {
  return (
    JUDGE_DIFF_BUDGET_TIERS.find(t => sourceFiles <= t.sourceFiles) ??
    JUDGE_DIFF_BUDGET_TIERS[JUDGE_DIFF_BUDGET_TIERS.length - 1]!
  )
}

export interface SecurityDiffBudget {
  /** What the judge sees. */
  text: string
  /** Some file was left out — the scan is honest but not whole. */
  truncated: boolean
  /** Paths the judge did see, in diff order. */
  covered: string[]
  /** Paths it did NOT, in diff order. This is what `truncated` used to hide. */
  dropped: string[]
}

/**
 * The judge is told its view is incomplete, by COUNT only. Naming the omitted
 * paths here would put attacker-chosen filenames into the prompt for no gain
 * — the judge cannot review what it was not given, and the names it does need
 * are already inside the sections it got. The names go to the scan record,
 * which is where a person asks "was my file reviewed?".
 */
function omissionMarker(dropped: number, total: number): string {
  return `\n[diff truncated: ${dropped} of ${total} files omitted to fit the review budget]`
}

/**
 * Pack whole file sections under the budget, priority paths first.
 *
 * Greedy with SKIP-AND-CONTINUE: one oversized file (a lockfile, a generated
 * bundle) does not eat the budget for every smaller file behind it.
 */
export function packSecurityDiff(
  diff: string,
  opts: {
    readonly priorityPaths?: readonly string[]
    readonly maxChars?: number
  } = {}
): SecurityDiffBudget {
  const maxChars = opts.maxChars ?? SECURITY_DIFF_MAX_CHARS
  const sections = splitDiffByFile(diff)
  const named = sections.filter(s => s.path !== null)

  if (diff.length <= maxChars) {
    return {
      text: diff,
      truncated: false,
      covered: named.map(s => s.path!),
      dropped: [],
    }
  }

  const priority = new Set(opts.priorityPaths ?? [])
  const isPriority = (i: number): boolean => {
    const p = sections[i]!.path
    return p !== null && priority.has(p)
  }
  const indices = sections.map((_, i) => i)
  const order = [
    ...indices.filter(isPriority),
    ...indices.filter(i => !isPriority(i)),
  ]

  const takenIndex = new Set<number>()
  let used = 0
  for (const i of order) {
    const cost = sections[i]!.text.length + 1
    if (used + cost > maxChars) continue
    used += cost
    takenIndex.add(i)
  }

  const covered: string[] = []
  const dropped: string[] = []
  const kept: string[] = []
  sections.forEach((section, i) => {
    if (takenIndex.has(i)) {
      kept.push(section.text)
      if (section.path !== null) covered.push(section.path)
    } else if (section.path !== null) {
      dropped.push(section.path)
    }
  })

  // Nothing fit — a single file larger than the whole budget. Falling back to
  // the old head-slice keeps the judge from being handed an empty diff, which
  // would read as "reviewed, found nothing".
  if (kept.length === 0) {
    return {
      text: `${diff.slice(0, maxChars)}\n[diff truncated]`,
      truncated: true,
      covered: [],
      dropped: named.map(s => s.path!),
    }
  }

  const text = kept.join('\n')
  return {
    text:
      dropped.length > 0
        ? `${text}${omissionMarker(dropped.length, named.length)}`
        : text,
    truncated: dropped.length > 0,
    covered,
    dropped,
  }
}

/**
 * Back-compat shim for callers that only need the old two fields. Kept so the
 * LUM-732 contract ("a diff over the cap marks the judge truncated and the
 * scan partial") reads the same at the call site.
 */
export function truncateSecurityDiff(diff: string): {
  text: string
  truncated: boolean
} {
  const packed = packSecurityDiff(diff)
  return { text: packed.text, truncated: packed.truncated }
}
