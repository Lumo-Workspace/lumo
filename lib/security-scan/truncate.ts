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

export const SECURITY_DIFF_MAX_CHARS = 60_000

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
