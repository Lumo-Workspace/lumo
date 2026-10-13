/**
 * LUM-1114 — group exported crossings into false-positive patterns and rank
 * them by how much human review they cost. Pure: the report script does the
 * file I/O.
 *
 * Label per row (current state, not history):
 *   FP        — a human ruled FALSE_POSITIVE
 *   CONFIRMED — a human ruled CONFIRMED (it happened; maybe intended)
 *   AUTO      — the system cleared it (AUTO_LEGIT triage / AUTO_SUPPRESSED rule)
 *   OPEN      — nobody has ruled yet
 *
 * FP rate = FP ÷ (FP + CONFIRMED), the same denominator as
 * scripts/boundary-fp-rate.ts — AUTO and OPEN are volume, not labels.
 */
import { crossingShape } from './shape'

export interface ExportedCrossing {
  id: string
  ref: string | null
  category: string
  severity: string
  advisory: boolean
  disposition: string | null
  detail: string
  target: string | null
  policyRuleText: string | null
  triageProbability: number | null
  detectedAt: string
}

export type Label = 'FP' | 'CONFIRMED' | 'AUTO' | 'OPEN'

export function labelOf(disposition: string | null): Label {
  if (disposition === 'FALSE_POSITIVE') return 'FP'
  if (disposition === 'CONFIRMED') return 'CONFIRMED'
  if (disposition === 'AUTO_LEGIT' || disposition === 'AUTO_SUPPRESSED')
    return 'AUTO'
  return 'OPEN'
}

export interface Cluster {
  category: string
  shape: string
  /** PROJECT_RULE_VIOLATION rows split per rule — one rule, one fix. */
  rule: string | null
  blocking: number
  advisory: number
  counts: Record<Label, number>
  /** FP ÷ (FP + CONFIRMED); null with no human label yet. */
  fpRate: number | null
  /** Up to three refs/ids to open in the web UI. */
  examples: string[]
  /** One representative detail (already redacted at detection time). */
  sample: string
}

const RULE_CHARS = 80

export function clusterCrossings(rows: ExportedCrossing[]): Cluster[] {
  const byKey = new Map<string, Cluster>()
  for (const row of rows) {
    const shape = crossingShape(row)
    const rule =
      row.category === 'PROJECT_RULE_VIOLATION' && row.policyRuleText
        ? row.policyRuleText.slice(0, RULE_CHARS)
        : null
    const key = `${row.category}\u0000${rule ?? ''}\u0000${shape}`
    const c =
      byKey.get(key) ??
      ({
        category: row.category,
        shape,
        rule,
        blocking: 0,
        advisory: 0,
        counts: { FP: 0, CONFIRMED: 0, AUTO: 0, OPEN: 0 },
        fpRate: null,
        examples: [],
        sample: row.detail.slice(0, 160),
      } satisfies Cluster)
    c.counts[labelOf(row.disposition)]++
    if (row.advisory) c.advisory++
    else c.blocking++
    if (c.examples.length < 3) c.examples.push(row.ref ?? row.id)
    byKey.set(key, c)
  }
  const clusters = [...byKey.values()]
  for (const c of clusters) {
    const labelled = c.counts.FP + c.counts.CONFIRMED
    c.fpRate = labelled > 0 ? c.counts.FP / labelled : null
  }
  // Review cost first: human FPs, then OPEN rows a human still owes.
  return clusters.sort(
    (a, b) =>
      b.counts.FP - a.counts.FP ||
      b.counts.OPEN - a.counts.OPEN ||
      b.blocking - a.blocking ||
      a.category.localeCompare(b.category) ||
      a.shape.localeCompare(b.shape)
  )
}

function pct(r: number | null): string {
  return r === null ? '   —' : `${Math.round(r * 100)}%`.padStart(4)
}

export function formatClusters(
  clusters: Cluster[],
  opts: { top: number }
): string {
  const total = clusters.reduce(
    (acc, c) => {
      for (const k of Object.keys(acc) as Label[]) acc[k] += c.counts[k]
      return acc
    },
    { FP: 0, CONFIRMED: 0, AUTO: 0, OPEN: 0 } as Record<Label, number>
  )
  const lines = [
    `${clusters.length} patterns · FP ${total.FP} · CONFIRMED ${total.CONFIRMED} · AUTO ${total.AUTO} · OPEN ${total.OPEN}`,
    '',
    '  FP  CONF  AUTO  OPEN  FP%  blk/adv  category · shape',
  ]
  for (const c of clusters.slice(0, opts.top)) {
    const n = c.counts
    lines.push(
      `${String(n.FP).padStart(4)}  ${String(n.CONFIRMED).padStart(4)}  ${String(n.AUTO).padStart(4)}  ${String(n.OPEN).padStart(4)}  ${pct(c.fpRate)}  ${`${c.blocking}/${c.advisory}`.padStart(7)}  ${c.category} · ${c.shape}`
    )
    if (c.rule) lines.push(`${' '.repeat(42)}rule: ${c.rule}`)
    lines.push(`${' '.repeat(42)}e.g. ${c.examples.join(', ')} — ${c.sample}`)
  }
  if (clusters.length > opts.top)
    lines.push('', `… ${clusters.length - opts.top} more (--top N)`)
  return lines.join('\n')
}
