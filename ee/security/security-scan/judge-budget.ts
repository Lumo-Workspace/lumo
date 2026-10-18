/**
 * LUM-814 — the L2 judge's budget arithmetic, written on the scan row and
 * read back by `lumo pr show`.
 *
 * Until now the judge reported one boolean (`truncated`). A boolean cannot
 * tell two PRs apart that were both reviewed whole, which is most of them:
 * PR 1051 (117,408 chars, 2.2% of its tier left) and PR 1052 (168,516 chars,
 * 6.4% left) both read `AI review: checked` and nothing more. The first is a
 * PR that nearly lost files; the second was rescued from dropping 64% of
 * itself by LUM-811's re-tiering. Neither fact was recoverable from the
 * read-out — the numbers existed only inside one `logger.info` that fires
 * ONLY on truncation, so the interesting near-misses left no trace at all.
 *
 * Recorded, not recomputed. The CLI must never re-derive the tier from the
 * diff: the client does not have the diff, and a second implementation of
 * `judgeDiffTier` is exactly the kind of drift LUM-811 closed by making the
 * selecting quantity and the allocated quantity the same value.
 *
 * Deliberately NOT recorded: the number of changed source files. The judge
 * stopped selecting its tier by that count in LUM-811, so publishing it next
 * to the budget would invite the reader to believe it still means something.
 * The same reason keeps the "old rule vs new rule" comparison out: it was
 * LUM-811's forensics, not a standing capability of `pr show`.
 */

/** What the judge's budget pass decided, as persisted on the scan row. */
export interface JudgeBudget {
  /** `diff.length` — the whole diff, in characters. */
  diffChars: number
  /** The tier `judgeDiffTier` selected, in characters. */
  tierChars: number
  /**
   * Characters OF THE DIFF the judge actually got. Never `text.length` —
   * that includes the omission marker, which is prose, not diff.
   */
  reviewedChars: number
  /** Whole file sections the judge saw. */
  coveredFiles: number
  /** Whole file sections it did not. `0` on an untruncated scan. */
  droppedFiles: number
  /**
   * LUM-1144 — present when the reviewable diff was over the AI review's
   * cap: the review then ran on part of it (PARTIAL) or not at all.
   * Not read by `parseJudgeBudget` (the budget line); `size-caps` reads it.
   */
  overCap?: JudgeOverCapRecord
  /**
   * LUM-1208 — server config files the PR does not change, sent read-only
   * because its added lines start that server; paid for out of the context
   * budget. Absent when none were sent.
   */
  serverConfig?: JudgeServerConfigRecord
}

/** LUM-1208 — what server config the review read, on `judgeBudget.serverConfig`. */
export interface JudgeServerConfigRecord {
  paths: string[]
  chars: number
}

/** LUM-1144 — the over-cap facts on `judgeBudget.overCap`. */
export interface JudgeOverCapRecord {
  /** Reviewable files in the diff (after path filters). */
  files: number
  capFiles: number
  capChars: number
  /** Reviewable files the AI review did not read, in diff order. */
  skippedPaths: string[]
}

const KEYS: ReadonlyArray<
  Exclude<keyof JudgeBudget, 'overCap' | 'serverConfig'>
> = ['diffChars', 'tierChars', 'reviewedChars', 'coveredFiles', 'droppedFiles']

/**
 * Read the raw Json column. Defensive in the same way as `parseHuntCoverage`:
 * the value was written by some past version of the scanner, so a row that
 * is not a complete, finite, non-negative record of all five numbers returns
 * `null` — "not recorded" — rather than a half-filled object a renderer would
 * print as arithmetic. Fail-closed: a missing budget must never read as a
 * budget of zero, which would render as a PR that spent nothing.
 */
export function parseJudgeBudget(raw: unknown): JudgeBudget | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const out: Partial<Record<(typeof KEYS)[number], number>> = {}
  for (const key of KEYS) {
    const value = row[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      return null
    out[key] = value
  }
  const serverConfig = parseServerConfig(row.serverConfig)
  return {
    ...(out as JudgeBudget),
    ...(serverConfig ? { serverConfig } : {}),
  }
}

/** LUM-1208 — a well-formed record, or null (a malformed one is dropped). */
function parseServerConfig(raw: unknown): JudgeServerConfigRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (
    !Array.isArray(r.paths) ||
    !r.paths.every(p => typeof p === 'string') ||
    typeof r.chars !== 'number' ||
    !Number.isFinite(r.chars) ||
    r.chars < 0
  )
    return null
  return { paths: r.paths as string[], chars: r.chars }
}
