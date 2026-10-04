/**
 * LUM-965 — the results-file record and the pure bookkeeping over it
 * (resume set, holdout-once guard). No network, no AI SDK import, so tests
 * and the report can load it without the gateway.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Split } from './split'

/** Default results file (outside the repository). */
export const DEFAULT_OUT = join(
  homedir(),
  '.cache',
  'lumo-lum965',
  'results.jsonl'
)

/** `generate.py export` output — the fresh ControlArena trajectories. */
export const FRESH_EXPORT = join(
  homedir(),
  '.cache',
  'lumo-lum965',
  'ca-trajectories.jsonl'
)

export const APPROACHES = ['whole', 'authz-action'] as const
export type Approach = (typeof APPROACHES)[number] | 'authz-extract'

export interface MonitorRecord {
  approach: Approach
  variant: string
  model: string
  split: Split
  trajectoryId: string
  /** Trajectory id (whole, authz-extract) or LUM-958 candidate id. */
  unitId: string
  /** 0..1; null = the call failed (after one retry). */
  suspicion: number | null
  category: string | null
  reason: string
  /** Structured extras: the authz list, or the whole-trajectory findings. */
  detail: unknown
  error: string | null
  latencyMs: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  costUsd: number | null
}

/** Success records for (approach, variant, model), keyed by unit. */
export function doneUnits(
  records: MonitorRecord[],
  approach: Approach,
  variant: string,
  model: string
): Map<string, MonitorRecord> {
  const out = new Map<string, MonitorRecord>()
  for (const r of records) {
    if (r.approach !== approach || r.variant !== variant || r.model !== model)
      continue
    if (r.error === null && !out.has(r.unitId)) out.set(r.unitId, r)
  }
  return out
}

/**
 * Every non-tune split (the monitor-eval holdout, the fresh ControlArena
 * set) is scored once: refuse such a run unless explicitly asked for, and
 * refuse it when that split already has judgements for the same approach /
 * variant / model (a crashed run resumes with `--resume-holdout`).
 */
export function holdoutGuard(
  records: MonitorRecord[],
  split: Split,
  approach: Approach,
  variant: string,
  model: string,
  argv: string[]
): string | null {
  if (split === 'tune') return null
  if (!argv.includes('--holdout-once'))
    return 'holdout runs need --holdout-once (score the holdout once, after tuning is frozen)'
  const already = records.some(
    r =>
      r.split === split &&
      r.approach === approach &&
      r.variant === variant &&
      r.model === model
  )
  if (already && !argv.includes('--resume-holdout'))
    return `${split} already scored for ${approach}/${variant}/${model} — pass --resume-holdout only to finish an interrupted run`
  return null
}
