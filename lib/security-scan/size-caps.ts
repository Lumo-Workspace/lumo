/**
 * LUM-832 — the size caps a scan's layers run under, read back off the row.
 *
 * Like CodeRabbit's file limit, a layer whose input is over its cap does NOT
 * run (no tokens spent), and the customer is told the change is too large and
 * how to get the layer: narrow the review scope or split the PR.
 *
 *   - hunt  — more than HUNT_MAX_HUNTED_FILES touched source files: stage A
 *             never starts it; `stages.hunt = SKIPPED`, cause HUNT_OVERSIZED,
 *             `huntAudit.overCap = { sourceFiles, capFiles }`.
 *   - judge — a diff over the AI review's top tier: stage A never calls the
 *             model; `stages.judge = SKIPPED`, cause JUDGE_OVER_CAP, and the
 *             numbers are on `judgeBudget` (`diffChars` / `tierChars`).
 *
 * Pure: every surface (view, PR summary, CLI payloads) reads the same facts.
 */
import type {
  HuntOverCapInput,
  JudgeOverCapInput,
} from '@/shared/src/security-scan'

export interface ScanSizeCaps {
  huntOverCap: HuntOverCapInput | null
  judgeOverCap: JudgeOverCapInput | null
}

export interface SizeCapRow {
  stages: Partial<Record<string, string | undefined>> | null
  partialCauses?: ReadonlyArray<string> | null
  huntAudit?: unknown
  judgeBudget?: unknown
}

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** The hunt's over-cap facts, or null when it was not skipped for size. */
export function huntOverCapOf(row: SizeCapRow): HuntOverCapInput | null {
  if (row.stages?.hunt !== 'SKIPPED') return null
  if (!(row.partialCauses ?? []).includes('HUNT_OVERSIZED')) return null
  const audit = row.huntAudit
  if (!audit || typeof audit !== 'object') return null
  const overCap = (audit as { overCap?: unknown }).overCap
  if (!overCap || typeof overCap !== 'object') return null
  const { sourceFiles, capFiles } = overCap as {
    sourceFiles?: unknown
    capFiles?: unknown
  }
  if (!positive(sourceFiles) || !positive(capFiles)) return null
  return { sourceFiles, capFiles }
}

/** The AI review's over-cap facts, or null when it was not skipped for size. */
export function judgeOverCapOf(row: SizeCapRow): JudgeOverCapInput | null {
  if (row.stages?.judge !== 'SKIPPED') return null
  if (!(row.partialCauses ?? []).includes('JUDGE_OVER_CAP')) return null
  const budget = row.judgeBudget
  if (!budget || typeof budget !== 'object') return null
  const { diffChars, tierChars } = budget as {
    diffChars?: unknown
    tierChars?: unknown
  }
  if (!positive(diffChars) || !positive(tierChars)) return null
  return { diffChars, capChars: tierChars }
}

export function scanSizeCaps(row: SizeCapRow): ScanSizeCaps {
  return { huntOverCap: huntOverCapOf(row), judgeOverCap: judgeOverCapOf(row) }
}
