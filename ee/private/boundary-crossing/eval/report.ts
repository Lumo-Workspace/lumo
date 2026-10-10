/**
 * LUM-984 — the text report of one dataset × judge run. Pure. Every string
 * that came from a sample or a judge is already redacted (score.ts).
 */
import type { ClassStats, EvalReport, SampleOutcome } from './types'

/** How many misses / false alarms the text report lists (`--json` has all). */
export const LIST_MAX = 20

const UNIT_PLURAL: Record<EvalReport['unit'], string> = {
  action: 'actions',
  trajectory: 'trajectories',
  record: 'records',
  crossing: 'crossings',
}

export function pct(r: number | null): string {
  return r === null ? '—' : `${(r * 100).toFixed(1)}%`
}

export function formatThreshold(t: number): string {
  return t > 1 ? '>1 (flags nothing)' : t.toFixed(2)
}

function classRow(name: string, c: ClassStats, meaning: string): string {
  const ci = c.wilson
    ? `[${(c.wilson[0] * 100).toFixed(1)}–${(c.wilson[1] * 100).toFixed(1)}%]`
    : '—'
  return (
    `  ${name.padEnd(9)} ${String(c.n).padStart(5)} ${String(c.hits).padStart(5)}` +
    `  ${pct(c.rate).padStart(6)}  ${ci.padEnd(15)} ${meaning}`
  )
}

function tallyLine(m: Record<string, number>): string {
  const parts = Object.entries(m)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}:${n}`)
  return parts.length ? parts.join(' ') : '—'
}

function list(title: string, xs: SampleOutcome[], max: number): string[] {
  const out = [`${title} (${xs.length}):`]
  for (const x of xs.slice(0, max)) {
    const score = x.score === null ? 'failed' : x.score.toFixed(2)
    out.push(
      `  ${x.id}${x.evasion ? ' (evasion)' : ''} [${score}] ${x.evidence}`
    )
  }
  if (xs.length > max) out.push(`  … ${xs.length - max} more (see --json)`)
  return out
}

export function formatEvalReport(r: EvalReport, max = LIST_MAX): string {
  const units = UNIT_PLURAL[r.unit]
  const lines: string[] = []
  lines.push('Boundary-crossing monitor eval (LUM-984)')
  lines.push(
    `  dataset    ${r.dataset}${r.datasetOptions ? ` (${r.datasetOptions})` : ''}`
  )
  lines.push(`  judge      ${r.judge}`)
  lines.push(`  unit       ${r.unit} — every rate below is over ${units}`)
  lines.push(
    `  threshold  ${formatThreshold(r.threshold)} — ${r.thresholdSource}`
  )
  lines.push('')
  lines.push('  class         n  hits    rate  Wilson 95%')
  lines.push(classRow('positive', r.classes.positive, 'detection'))
  lines.push(classRow('negative', r.classes.negative, 'false-positive rate'))
  if (r.classes.evasion.n > 0) {
    lines.push(
      classRow('evasion', r.classes.evasion, 'detection (best-effort)')
    )
  }
  if (r.classes.advisory.n > 0) {
    lines.push(
      classRow(
        'advisory',
        r.classes.advisory,
        `recorded, not blocking · blocked ${r.classes.advisory.blocked}`
      )
    )
  }
  lines.push(
    `  unjudged ${r.unjudged} (excluded) · failed judge calls ${r.failed} (scored not flagged)`
  )
  if (r.auroc !== null) lines.push(`  AUROC ${r.auroc.toFixed(3)}`)

  let dim = ''
  for (const g of r.groups) {
    if (g.dimension !== dim) {
      dim = g.dimension
      lines.push('')
      lines.push(`  by ${dim}  (positive detected · negative false-positive)`)
    }
    const p = g.positive.n ? `${g.positive.hits}/${g.positive.n}` : '—'
    const n = g.negative.n ? `${g.negative.hits}/${g.negative.n}` : '—'
    lines.push(
      `    ${g.value.padEnd(48)} ${p.padStart(9)} ${pct(g.positive.rate).padStart(6)} · ${n.padStart(9)} ${pct(g.negative.rate).padStart(6)}`
    )
  }

  const hasCategories =
    Object.keys(r.categories.positive).length +
      Object.keys(r.categories.negative).length +
      Object.keys(r.advisoryCategories.positive).length +
      Object.keys(r.advisoryCategories.negative).length >
    0
  if (hasCategories) {
    lines.push('')
    lines.push(`  crossing categories (${units} raising each)`)
    lines.push(`    blocking · positive  ${tallyLine(r.categories.positive)}`)
    lines.push(`    blocking · negative  ${tallyLine(r.categories.negative)}`)
    lines.push(
      `    advisory · positive  ${tallyLine(r.advisoryCategories.positive)}`
    )
    lines.push(
      `    advisory · negative  ${tallyLine(r.advisoryCategories.negative)}`
    )
  }
  lines.push('')
  lines.push(...list('  misses', r.misses, max))
  lines.push(...list('  false alarms', r.falseAlarms, max))
  if (r.notes.length) {
    lines.push('')
    for (const n of r.notes) lines.push(`  note: ${n}`)
  }
  return `${lines.join('\n')}\n`
}
