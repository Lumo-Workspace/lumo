/**
 * LUM-762 — the read side of `PrSecurityScan.huntAudit`.
 *
 * The audit has been written since LUM-739 but never read: no API, no UI, so
 * "which categories actually ran, and how long does a healthy one take" could
 * only be answered by paging through Vercel logs. `lumo task status` answers
 * it from this.
 *
 * Pure and defensive: the column is raw Json written by past versions of the
 * workflow, so every row is validated against the current category list and
 * stop vocabulary, and anything unrecognised is dropped rather than trusted or
 * thrown over. A category the retry pass re-ran has one row per attempt, in
 * attempt order — the last row is its outcome, the elapsed times add up.
 */
import {
  HUNT_CATEGORIES,
  type HuntCategory,
  type HuntCategoryStop,
} from '@/lib/services/security-hunt.config'

const STOPS: readonly HuntCategoryStop[] = [
  'done',
  'steps',
  'budget',
  'timeout',
  'error',
  'skipped',
]

export interface HuntCategoryCoverage {
  category: HuntCategory
  /** The last attempt's stop reason. */
  stopped: HuntCategoryStop
  /** Summed over every attempt — what the category cost the scan. */
  elapsedMs: number
  tokens: number
  candidates: number
  /** 1, or 2 when the workflow's retry pass re-ran it. */
  attempts: number
}

export interface HuntCoverage {
  /**
   * LUM-758 — how many categories the planning step picked for this scan
   * (`audit.planned.length`), not `HUNT_CATEGORIES.length`: a scan plans
   * 0–2, so "out of 6" understates a fully-run layer. A pre-LUM-758 row has
   * no `planned` field and falls back to `HUNT_CATEGORIES.length`.
   */
  total: number
  /** How many ended `done` — `done === total` is the whole layer. */
  done: number
  /** Recorded categories, in HUNT_CATEGORIES run order. */
  categories: HuntCategoryCoverage[]
}

function isCategory(value: unknown): value is HuntCategory {
  return HUNT_CATEGORIES.includes(value as HuntCategory)
}

function isStop(value: unknown): value is HuntCategoryStop {
  return STOPS.includes(value as HuntCategoryStop)
}

/** A count we can print: finite, non-negative, integral. Anything else → 0. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0
}

/**
 * `huntAudit` → per-category coverage, or null when the column holds nothing
 * usable (absent, a pre-LUM-739 row, an error-only audit, or garbage).
 */
export function parseHuntCoverage(raw: unknown): HuntCoverage | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rows = (raw as { categories?: unknown }).categories
  if (!Array.isArray(rows)) return null

  const byCategory = new Map<HuntCategory, HuntCategoryCoverage>()
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const { category, stopped } = row as Record<string, unknown>
    if (!isCategory(category) || !isStop(stopped)) continue
    const prior = byCategory.get(category)
    const cells = row as Record<string, unknown>
    byCategory.set(category, {
      category,
      stopped,
      elapsedMs: (prior?.elapsedMs ?? 0) + count(cells.elapsedMs),
      tokens: count(cells.tokens),
      candidates: count(cells.candidates),
      attempts: (prior?.attempts ?? 0) + 1,
    })
  }
  if (byCategory.size === 0) return null

  const categories = HUNT_CATEGORIES.filter(c => byCategory.has(c)).map(
    c => byCategory.get(c)!
  )

  // LUM-758: the denominator is what the planning step planned, not the full
  // category list. `planned` is absent on pre-LUM-758 rows — fall back to
  // HUNT_CATEGORIES.length so those still render sensibly.
  const planned = (raw as { planned?: unknown }).planned
  const total = Array.isArray(planned)
    ? planned.filter(isCategory).length
    : HUNT_CATEGORIES.length

  return {
    total,
    done: categories.filter(c => c.stopped === 'done').length,
    categories,
  }
}

/**
 * One line a human can read in a deploy log or a status pane:
 * `2/6 done · idor 41.2s done · injection 72.0s done (2 attempts)`. Kept
 * beside the parser so the log line and the API payload describe a category
 * the same way. (`lumo task status` renders its own copy — the CLI is a
 * separate package and never imports from `lib/`.)
 */
export function formatHuntCoverage(coverage: HuntCoverage): string {
  const parts = coverage.categories.map(c => {
    const attempts = c.attempts > 1 ? ` (${c.attempts} attempts)` : ''
    const spent =
      c.stopped === 'skipped' ? '' : `${(c.elapsedMs / 1000).toFixed(1)}s `
    return `${c.category} ${spent}${c.stopped}${attempts}`
  })
  return [`${coverage.done}/${coverage.total} done`, ...parts].join(' · ')
}
