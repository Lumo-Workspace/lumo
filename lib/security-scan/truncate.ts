/**
 * PURE — decide WHICH of the diff the LLM judge gets to see (LUM-732 cap,
 * LUM-758 selection, LUM-811 budget tiering).
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
 * LUM-811 — diff 的字符长度 → judge 的 diff 预算与超时。
 *
 * 此前是所有 PR 一律 60,000 字符：那个数是 LUM-732 初版带进来的，从未被推导
 * 过，而它编码的其实是**成本**，不是容量（60k 字符 ≈ 15k token，对
 * REASONING_MODEL 远不是上限）。成本本来就该随要审的代码量走，LUM-758 因此
 * 把它分了档。
 *
 * LUM-758 选档用的是**改动源文件数**，发的却是**字符预算**——代理量和被配给
 * 量不是同一个东西，于是存在一段反向区间：文件少但文件胖的 PR，比文件多但文
 * 件瘦的 PR 拿到更少的预算，尽管前者要读的内容更多。近 80 个已合并 PR 上实
 * 测：19 个被截断，其中 **10 个纯粹是这个代理造成的**（换成按字符选档即可整
 * 份审完，天花板一动不动）；最极端的 PR 1028 只改 6 个源文件、diff 170,955
 * 字符，落最小档拿 60k，丢掉 65%——同一批里 13 个源文件、28,561 字符的
 * PR 972 却拿到 120k，四倍于它可能用掉的量。
 *
 * 所以选档量改成被配给的那个量本身。`max(按文件数, 按字符数)` 是可证明的空
 * 操作，不是折中：`packSecurityDiff` 在 `diff.length <= maxChars` 时整份原样
 * 返回，文件数档给出的多余余量永远花不掉——80/80 个 PR 上两者结果逐一相同。
 *
 * 那 L3 hunt（`HUNT_TASK_CAP_TIERS`）为什么仍然按源文件数分档？因为**两层配
 * 给的不是同一个量**，不是其中一层写错了：
 *
 *   · hunt 配给的是**任务数**——一个 diff 上根本测不出来的量。「这个 PR 值几
 *     个调查单元」没有直读的刻度，文件数是那里唯一可用的代理，而且是个像样
 *     的代理：一个任务就是一处独立的调查落点。
 *   · judge 配给的是**一次模型调用里的字符**——`diff.length` 在调用点就在手
 *     里，免费。judge 是单次调用读一段拼接的 diff，没有每文件的上下文切换要
 *     付；它按 token 计价，而 token 就是字符。
 *
 * 规矩因此是一句话：**选档量必须等于被配给量**。测不到才用代理；测得到还用
 * 代理，只引入方差、不带来任何东西。两层的档位层级仍然对齐（三档、同样的
 * 「小 / 中 / 其余」形状），各自用自己发出去的那把尺子量。
 *
 * 最高档不再往上抬，而不是继续加预算：单次调用受 300s worker 约束，再大的
 * PR 只能看一角——此时 `stages.judge` 记 PARTIAL 并报出丢了哪些文件，比一个
 * 抬到跑不完的数字诚实。这与 `HUNT_OVERSIZED_SOURCE_FILES` 是同一条规矩，
 * LUM-811 不动它：实测那 19 个截断里剩下的 9 个就是真超顶的，照旧记 PARTIAL。
 */
export const JUDGE_DIFF_BUDGET_TIERS: ReadonlyArray<{
  chars: number
  timeoutMs: number
}> = [
  { chars: SECURITY_DIFF_MAX_CHARS, timeoutMs: 120_000 },
  { chars: 120_000, timeoutMs: JUDGE_TIMEOUT_CEILING_MS },
  { chars: 180_000, timeoutMs: JUDGE_TIMEOUT_CEILING_MS },
]

/**
 * 落在哪一档。最后一档兜住其余，所以永远有结果。
 *
 * 取的是 diff 本身而不是它的长度：一个 `number` 形参正是 LUM-758 踩进去的那
 * 个口子——任何计数都能喂进来，编译器不会说话。收 `string` 之后，「拿另一个
 * 量选档」变成 tsc 当场报错，这条反向区间关不回来。
 */
export function judgeDiffTier(diff: string): {
  chars: number
  timeoutMs: number
} {
  return (
    JUDGE_DIFF_BUDGET_TIERS.find(t => diff.length <= t.chars) ??
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
