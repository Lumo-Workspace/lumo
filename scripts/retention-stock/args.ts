/**
 * LUM-914 — argument parsing and report formatting for the pre-rule retention
 * stock script (run.ts). Pure: no database, no env, no output.
 */
import {
  isRetentionStockCategory,
  retentionStockCategories,
  type RetentionStockCategory,
  type StockApplyResult,
  type StockPlan,
} from '@/lib/services/retention-stock.service'

export const DEFAULT_BATCH_SIZE = 20
export const MAX_BATCH_SIZE = 200

export interface StockArgs {
  categories: RetentionStockCategory[]
  apply: boolean
  limit?: number
  batchSize: number
  crossingRolloutAt?: Date
}

export const USAGE = `Usage:
  npx tsx scripts/retention-stock/run.ts <${retentionStockCategories().join('|')}|all>
      [--apply --confirm-scope <category> --confirm-host <db host>
       --rollback-branch <Neon branch you created>]
      [--limit N] [--batch-size N] [--crossing-rollout-at <ISO time>]

Without --apply: read-only dry run (counts, workspace slugs and dates only).
--apply takes ONE category, and --confirm-scope must repeat it.`

function positiveInt(name: string, raw: string | undefined): number {
  const n = Number(raw)
  if (!raw || !Number.isInteger(n) || n < 1) {
    throw new Error(`${name} needs a positive integer`)
  }
  return n
}

function valueOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--'))
    throw new Error(`${name} needs a value`)
  return v
}

/**
 * Parse argv (without node/script). Throws with a message on anything
 * unclear: an apply must name one category and repeat it in
 * `--confirm-scope`; the host check is the caller's (it needs the env).
 */
export function parseStockArgs(argv: string[]): StockArgs & {
  confirmScope?: string
  confirmHost?: string
  rollbackBranch?: string
} {
  const known = new Set([
    '--apply',
    '--confirm-scope',
    '--confirm-host',
    '--rollback-branch',
    '--limit',
    '--batch-size',
    '--crossing-rollout-at',
  ])
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      if (!known.has(a)) throw new Error(`Unknown flag ${a}`)
      if (a !== '--apply') i++
      continue
    }
    positional.push(a)
  }
  if (positional.length !== 1) throw new Error('Pass exactly one category')
  const target = positional[0]!
  const categories =
    target === 'all'
      ? retentionStockCategories()
      : isRetentionStockCategory(target)
        ? [target]
        : null
  if (!categories) throw new Error(`Unknown category ${target}`)

  const apply = argv.includes('--apply')
  const confirmScope = valueOf(argv, '--confirm-scope')
  const confirmHost = valueOf(argv, '--confirm-host')
  const rollbackBranch = valueOf(argv, '--rollback-branch')
  if (apply) {
    if (target === 'all') throw new Error('--apply takes one category, not all')
    if (confirmScope !== target)
      throw new Error(
        `Refusing --apply: --confirm-scope must repeat the category (${target})`
      )
    if (!confirmHost) throw new Error('Refusing --apply: pass --confirm-host')
    if (!rollbackBranch)
      throw new Error(
        'Refusing --apply: create a Neon branch first and name it in --rollback-branch'
      )
  }

  const limitRaw = valueOf(argv, '--limit')
  const batchRaw = valueOf(argv, '--batch-size')
  const batchSize =
    batchRaw === undefined
      ? DEFAULT_BATCH_SIZE
      : positiveInt('--batch-size', batchRaw)
  if (batchSize > MAX_BATCH_SIZE)
    throw new Error(`--batch-size is at most ${MAX_BATCH_SIZE}`)
  const rolloutRaw = valueOf(argv, '--crossing-rollout-at')
  const crossingRolloutAt = rolloutRaw ? new Date(rolloutRaw) : undefined
  if (crossingRolloutAt && Number.isNaN(crossingRolloutAt.getTime()))
    throw new Error('--crossing-rollout-at needs an ISO time')

  return {
    categories,
    apply,
    batchSize,
    ...(limitRaw !== undefined
      ? { limit: positiveInt('--limit', limitRaw) }
      : {}),
    ...(crossingRolloutAt ? { crossingRolloutAt } : {}),
    ...(confirmScope ? { confirmScope } : {}),
    ...(confirmHost ? { confirmHost } : {}),
    ...(rollbackBranch ? { rollbackBranch } : {}),
  }
}

const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : '-'

function entries(map: Record<string, number>): string {
  const list = Object.entries(map).sort((a, b) => b[1] - a[1])
  return list.length ? list.map(([k, n]) => `${k}=${n}`).join(', ') : '-'
}

/**
 * The plan as report lines: counts, workspace slugs and dates only — the
 * plan carries no payload, so none can be printed.
 */
export function formatStockPlan(
  plan: StockPlan,
  slugs: Map<string, string>
): string[] {
  const bySlug: Record<string, number> = {}
  for (const [id, n] of Object.entries(plan.byWorkspace)) {
    bySlug[slugs.get(id) ?? id] = n
  }
  const lines = [
    `${plan.category}: due=${plan.due} · workspaces=${Object.keys(plan.byWorkspace).length} · range ${day(plan.oldest)}..${day(plan.newest)}`,
    `  by reason: ${entries(plan.byReason)}`,
    `  held (left alone): ${entries(plan.held)}`,
    `  by workspace: ${entries(bySlug)}`,
  ]
  if (plan.findings !== undefined)
    lines.push(`  findings in due scans: ${plan.findings}`)
  if (plan.rolloutAt !== undefined)
    lines.push(
      `  LUM-912 rollout (stock = dispositioned before): ${plan.rolloutAt ? plan.rolloutAt.toISOString() : '-'}`
    )
  return lines
}

export function formatApplyResult(result: StockApplyResult): string {
  return (
    `${result.category}: processed=${result.processed}` +
    (result.findings !== undefined ? ` findings=${result.findings}` : '') +
    ` lastId=${result.lastId ?? '-'}`
  )
}
