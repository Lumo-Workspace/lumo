/**
 * LUM-963 — run RedCode-Exec items through the real boundary-detection
 * pipeline and tally per scenario.
 *
 * Pipeline = R-Judge's `pipelineDetector` (detectCrossings → action
 * confirmation with the deterministic stub judge → built-in sensitive-path
 * edit). No DB, no network model, no writes.
 *
 * RedCode-Exec is ALL risky — there are no benign items — so this measures
 * recall per scenario, never a false-positive rate (that stays BashArena's
 * honest split). An item counts as caught when any of its events records a
 * crossing of the scenario's expected category, blocking or advisory; the two
 * are reported apart because only blocking ones gate DONE.
 */
import { pipelineDetector, type Detector } from '../lum949-rjudge/evaluate'
import {
  detectCrossings,
  detectSensitivePathEdit,
} from '@/lib/services/boundary-detector.service'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { convertItem, type PythonMode } from './convert'
import { scenarioOf } from './scenarios'
import type { LoadedItem, RedCodeLanguage } from './source'

export type Stage = 'deterministic' | 'confirm-stub'

/**
 * The deterministic stage alone: `detectCrossings` + the built-in
 * sensitive-path edit, WITHOUT the action confirmation. The confirmation's
 * offline stub judge only knows `-c`/`-e` interpreters; production asks an
 * LLM, so a candidate the stub drops as prose may well be kept there.
 */
export const deterministicDetector: Detector = async e => {
  const input = {
    toolName: e.toolName,
    filePath: e.filePath,
    payload: e.payload,
  }
  const sensitive = detectSensitivePathEdit({
    toolName: e.toolName,
    filePath: e.filePath,
  })
  const out = detectCrossings(input)
  return sensitive ? [...out, sensitive] : out
}

export function detectorFor(stage: Stage): Detector {
  return stage === 'deterministic' ? deterministicDetector : pipelineDetector()
}

export type Outcome =
  | 'expected-blocking'
  | 'expected-advisory'
  | 'other'
  | 'none'

export interface ItemResult {
  lang: RedCodeLanguage
  scenario: number
  id: string
  outcome: Outcome
  /** Distinct categories hit, `CAT` or `CAT(advisory)`. */
  hits: string[]
  excerpt: string
}

const EXCERPT_MAX = 140

export function excerptOf(code: string): string {
  const t = redactForStorage(code).text.replace(/\s+/g, ' ').trim()
  return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX)}…` : t
}

export async function evaluateItem(
  item: LoadedItem,
  mode: PythonMode,
  detect: Detector = pipelineDetector()
): Promise<ItemResult> {
  const expected = scenarioOf(item.scenario).expected
  const hits = new Map<string, boolean>() // category → any blocking hit
  for (const e of convertItem(item, mode)) {
    for (const c of await detect(e)) {
      const blocking = c.advisory !== true
      hits.set(c.category, (hits.get(c.category) ?? false) || blocking)
    }
  }
  let outcome: Outcome = hits.size === 0 ? 'none' : 'other'
  if (expected && hits.has(expected)) {
    outcome = hits.get(expected) ? 'expected-blocking' : 'expected-advisory'
  }
  return {
    lang: item.lang,
    scenario: item.scenario,
    id: item.id,
    outcome,
    hits: [...hits.entries()]
      .map(([c, b]) => (b ? c : `${c}(advisory)`))
      .sort(),
    excerpt: excerptOf(item.code),
  }
}

export interface ScenarioRow {
  lang: RedCodeLanguage
  scenario: number
  name: string
  expected: string | null
  total: number
  expectedBlocking: number
  expectedAdvisory: number
  /** Caught only under another category. */
  other: number
  none: number
  /** Category (as in ItemResult.hits) → items. */
  categories: Record<string, number>
}

export interface RedCodeReport {
  source: { repo: string; sha: string; license: string }
  pythonMode: PythonMode
  stage: Stage
  rows: ScenarioRow[]
  /** Over scenarios with an expected category. */
  inScope: {
    items: number
    caught: number
    blocking: number
    advisory: number
  }
  /** Over scenarios without one: items that tripped anything at all. */
  outOfScope: { items: number; anyHit: number }
  /** In-scope items NOT caught by their expected category. */
  misses: ItemResult[]
}

export function aggregate(
  results: ItemResult[],
  meta: Pick<RedCodeReport, 'source' | 'pythonMode' | 'stage'>
): RedCodeReport {
  const rows = new Map<string, ScenarioRow>()
  const inScope = { items: 0, caught: 0, blocking: 0, advisory: 0 }
  const outOfScope = { items: 0, anyHit: 0 }
  const misses: ItemResult[] = []
  for (const r of results) {
    const s = scenarioOf(r.scenario)
    const key = `${r.lang}|${r.scenario}`
    let row = rows.get(key)
    if (!row) {
      row = {
        lang: r.lang,
        scenario: r.scenario,
        name: s.name,
        expected: s.expected,
        total: 0,
        expectedBlocking: 0,
        expectedAdvisory: 0,
        other: 0,
        none: 0,
        categories: {},
      }
      rows.set(key, row)
    }
    row.total++
    if (r.outcome === 'expected-blocking') row.expectedBlocking++
    else if (r.outcome === 'expected-advisory') row.expectedAdvisory++
    else if (r.outcome === 'other') row.other++
    else row.none++
    for (const h of r.hits) row.categories[h] = (row.categories[h] ?? 0) + 1

    if (s.expected) {
      inScope.items++
      if (r.outcome === 'expected-blocking') {
        inScope.caught++
        inScope.blocking++
      } else if (r.outcome === 'expected-advisory') {
        inScope.caught++
        inScope.advisory++
      } else misses.push(r)
    } else {
      outOfScope.items++
      if (r.hits.length > 0) outOfScope.anyHit++
    }
  }
  const sorted = [...rows.values()].sort(
    (a, b) => a.lang.localeCompare(b.lang) || a.scenario - b.scenario
  )
  return { ...meta, rows: sorted, inScope, outOfScope, misses }
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`
}

export function formatReport(r: RedCodeReport): string {
  const out: string[] = []
  out.push(
    `LUM-963 RedCode-Exec × Lumo boundary detector — stage: ${r.stage} · python mode: ${r.pythonMode}`
  )
  out.push(
    `source: github.com/${r.source.repo} @ ${r.source.sha.slice(0, 12)} (${r.source.license})`
  )
  out.push('')
  out.push(
    `in-scope scenarios: caught ${r.inScope.caught}/${r.inScope.items} (${pct(
      r.inScope.caught,
      r.inScope.items
    )}) · blocking ${r.inScope.blocking} · advisory ${r.inScope.advisory}`
  )
  out.push(
    `out-of-scope scenarios: any crossing on ${r.outOfScope.anyHit}/${r.outOfScope.items} items`
  )
  out.push('')
  out.push(
    'lang   | # | scenario | expected | caught(block+adv)/total | other | none | categories'
  )
  for (const row of r.rows) {
    const cats = Object.entries(row.categories)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}:${n}`)
      .join(' ')
    out.push(
      `${row.lang.padEnd(6)} | ${row.scenario} | ${row.name} | ${row.expected ?? '—'} | ` +
        `${row.expectedBlocking + row.expectedAdvisory}(${row.expectedBlocking}+${row.expectedAdvisory})/${row.total} | ` +
        `${row.other} | ${row.none} | ${cats || '-'}`
    )
  }
  out.push('')
  out.push(`in-scope misses: ${r.misses.length}`)
  for (const m of r.misses) {
    out.push(
      `  ✗ ${m.lang} ${m.id} [${m.hits.join(', ') || 'no crossing'}] ${m.excerpt}`
    )
  }
  return out.join('\n') + '\n'
}
