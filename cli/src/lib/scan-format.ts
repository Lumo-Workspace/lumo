import { sanitizeField } from './sanitize'
import {
  formatQueueExits,
  SCAN_STAGE_KEYS,
  scanStageLabel,
  scanStageStateLabel,
} from '../../../shared/src/security-scan'

/**
 * LUM-788 — the scan-line grammar shared by `lumo task status` (one line per
 * linked PR, LUM-735) and `lumo pr scan` (one block per scan). Extracted so
 * the two surfaces cannot name a layer, a state or a queue exit two
 * different ways; the display labels themselves come from
 * `shared/src/security-scan.ts`, the same map the GitHub PR summary and the
 * web panel render from (LUM-763).
 */

/** What one scan's layer line needs — a structural subset of both payloads. */
export interface ScanLayerLineInput {
  stages: Partial<Record<string, string>>
  partial: boolean
  /** Raw external-tool hits that are not dependencies (decorates Code scan). */
  externalFindings: number
  /** LUM-738 — DEPENDENCY rows (decorates Dependencies). Absent on an older server. */
  dependencyFindings?: number | undefined
  /** LUM-738 — rows already on the default-branch baseline. */
  persistingFindings?: number | undefined
  /** LUM-775 — rows that left the queue on a merged / closed PR, by reason. */
  queueExits?: Partial<Record<string, number>> | undefined
  /**
   * P8 — the SCRUBBED external-scanner reason (text after the `external: `
   * prefix), already null when the layer did not fail or the error carried
   * no prefix. Callers derive it with `externalFailureReason`.
   */
  externalFailureReason: string | null
}

const EXTERNAL_ERROR_TAIL = 200

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s
}

/**
 * ` · Secrets: checked · Code scan: checked (2 external findings) ·
 * Dependencies: checked (1 dependency finding, 1 already on main) ·
 * AI review: checked · Exploit paths: checked · partial · 3 left the queue
 * (2 resolved on main, 1 merged unreviewed) — <scrubbed reason>`, or `''`
 * when the scan carries no stage at all. The caller prefixes its own head
 * (`  PR #945 · scan CLEAN` / `Scan abc1234 · FINDINGS`).
 *
 * Stage segments only for keys present, in secrets/external/supplyChain/
 * judge/hunt order; the `(N external findings)` count only decorates the
 * Code scan segment, the dependency count (with its already-on-main share)
 * only the Dependencies segment, and each only when N > 0.
 */
export function formatScanLayerTail(s: ScanLayerLineInput): string {
  const segments: string[] = []
  for (const key of SCAN_STAGE_KEYS) {
    const state = s.stages[key]
    if (!state) continue
    const head = `${scanStageLabel(key)}: ${scanStageStateLabel(state)}`
    if (key === 'external' && s.externalFindings > 0) {
      const noun = s.externalFindings === 1 ? 'finding' : 'findings'
      segments.push(`${head} (${s.externalFindings} external ${noun})`)
    } else if (key === 'supplyChain' && (s.dependencyFindings ?? 0) > 0) {
      const n = s.dependencyFindings ?? 0
      const noun = n === 1 ? 'finding' : 'findings'
      const persisting = s.persistingFindings ?? 0
      const tail = persisting > 0 ? `, ${persisting} already on main` : ''
      segments.push(`${head} (${n} dependency ${noun}${tail})`)
    } else {
      segments.push(head)
    }
  }
  let line = ''
  if (segments.length > 0) line += ` · ${segments.join(' · ')}`
  if (s.partial) line += ' · partial'
  // LUM-775: what left the queue because the PR merged / closed, and why —
  // so a merged PR's line explains where its findings went instead of
  // silently listing fewer open rows than the scan found.
  const exits = formatQueueExits(s.queueExits)
  if (exits) line += ` · ${exits}`
  // LUM-756 (P8): only the prefixed, scrubbed scanner reason is printed, and
  // only the text after the prefix (the caller has already applied the rule).
  if (s.externalFailureReason) {
    line += ` — ${sanitizeField(tail(s.externalFailureReason, EXTERNAL_ERROR_TAIL))}`
  }
  return line
}

/** LUM-762 — one planned task's coverage row (shape frozen for older CLIs). */
export interface HuntCoverageRow {
  taskId?: string | undefined
  objective?: string | undefined
  category: string
  stopped: string
  elapsedMs: number
  tokens: number
  candidates: number
  attempts: number
}

export interface HuntCoverageInput {
  total: number
  done: number
  categories: HuntCoverageRow[]
}

/**
 * LUM-762 — the hunt's per-task read-out, one line under its scan:
 * `Exploit paths 2/3 done · t1 idor 41.2s done · t2 injection 72.0s done
 * (2 attempts) · t3 race skipped`. Headed by the same display label as the
 * layer's own segment (LUM-763) — the detail line and the line above it
 * must not name the layer two different ways. Elapsed time is summed over a
 * task's attempts; a skipped task has none to print.
 *
 * LUM-758: a plan may hold two tasks of the same category, so the row is led
 * by its task id. Pre-task-graph audits carry no id — the row then prints
 * exactly as it always did.
 */
export function formatHuntCoverageLine(hunt: HuntCoverageInput): string {
  const parts = hunt.categories.map(c => {
    const attempts = c.attempts > 1 ? ` (${c.attempts} attempts)` : ''
    const spent =
      c.stopped === 'skipped' ? '' : `${(c.elapsedMs / 1000).toFixed(1)}s `
    const id = c.taskId === undefined ? '' : `${sanitizeField(c.taskId)} `
    return `${id}${sanitizeField(c.category)} ${spent}${sanitizeField(c.stopped)}${attempts}`
  })
  return `${scanStageLabel('hunt')} ${hunt.done}/${hunt.total} done · ${parts.join(' · ')}`
}
