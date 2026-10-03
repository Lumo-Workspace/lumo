/**
 * LUM-949 — run converted R-Judge records through the real boundary-detection
 * pipeline and aggregate per record.
 *
 * Pipeline = the deterministic part of `boundaryDetectorService.detectAndRecord`
 * minus persistence and project policy (R-Judge has no project): `detectCrossings`
 * → `confirmActionCandidates` with the LUM-468 deterministic stub judge →
 * `detectSensitivePathEdit` with the built-in path set. No DB, no network, no
 * writes. An `advisory` crossing (recorded LOW, never blocking) is reported but
 * does not count as a flag — the same rule the align eval uses.
 */
import {
  detectCrossings,
  confirmActionCandidates,
  detectSensitivePathEdit,
  type DetectedCrossing,
} from '@/lib/services/boundary-detector.service'
import { stubActionJudge } from '@/lib/boundary-crossing/align-eval'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import type { ActionConfirmJudge } from '@/lib/boundary-crossing/action-confirm'
import type { ConvertedRecord, SkipReason, ToolEvent } from './convert'
import type { RJudgeRecord } from './source'
import { classifyRisk, LUMO_COVERAGE, type RiskType } from './gaps'

export type Detector = (event: ToolEvent) => Promise<DetectedCrossing[]>

/** The real pipeline (deterministic stages + injected action judge). */
export function pipelineDetector(
  judge: ActionConfirmJudge = stubActionJudge
): Detector {
  return async event => {
    const input = {
      toolName: event.toolName,
      filePath: event.filePath,
      payload: event.payload,
    }
    const confirmed = await confirmActionCandidates(
      input,
      detectCrossings(input),
      judge
    )
    const sensitive = detectSensitivePathEdit({
      toolName: event.toolName,
      filePath: event.filePath,
    })
    return sensitive ? [...confirmed, sensitive] : confirmed
  }
}

export interface Hit {
  category: string
  advisory: boolean
  /** The event that tripped it, redacted + truncated for display. */
  excerpt: string
}

export interface RecordResult {
  key: string
  file: string
  category: string
  scenario: string
  attackType: string
  label: 'safe' | 'unsafe'
  status: ConvertedRecord<RJudgeRecord>['status']
  events: number
  /** Distinct non-advisory categories the pipeline raised. */
  flagged: string[]
  hits: Hit[]
  riskType: RiskType
  /** First event, redacted + truncated (for the miss list). */
  firstEvent: string
  riskDescription: string
}

export const EXCERPT_MAX = 140

/** Redact registry secret shapes (incl. private-key blocks), collapse whitespace,
 *  truncate. Never echoes a secret the shared registry knows. */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const flat = redactForStorage(text).text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function describeEvent(e: ToolEvent): string {
  const ti = e.payload.tool_input
  if (e.toolName === 'Bash') return `Bash: ${ti.command ?? ''}`
  if (e.toolName === 'Write')
    return `Write ${ti.file_path ?? ''}: ${ti.content ?? ''}`
  return `${e.toolName} ${ti.file_path ?? ''}`
}

export function recordKey(r: { file: string; id: number }): string {
  return `${r.file}#${r.id}`
}

/** Detect every event of one converted record and fold to a record verdict. */
export async function evaluateRecord(
  converted: ConvertedRecord<RJudgeRecord>,
  detect: Detector
): Promise<RecordResult> {
  const r = converted.record
  const hits: Hit[] = []
  for (const event of converted.events) {
    for (const c of await detect(event)) {
      hits.push({
        category: c.category,
        advisory: c.advisory === true,
        excerpt: excerpt(describeEvent(event)),
      })
    }
  }
  const flagged = [
    ...new Set(hits.filter(h => !h.advisory).map(h => h.category)),
  ]
  const first = converted.events[0]
  return {
    key: recordKey(r),
    file: r.file,
    category: r.category,
    scenario: r.scenario || '(none)',
    attackType: r.attackType || '(none)',
    label: r.label === 1 ? 'unsafe' : 'safe',
    status: converted.status,
    events: converted.events.length,
    flagged,
    hits,
    riskType: classifyRisk(r, converted.events),
    firstEvent: first ? excerpt(describeEvent(first)) : '',
    riskDescription: excerpt(r.riskDescription, 200),
  }
}

// --- aggregation ---------------------------------------------------------------

export interface Rate {
  unsafe: number
  detected: number
  detectionRate: number | null
  safe: number
  falsePositives: number
  falsePositiveRate: number | null
}

export interface Bucket extends Rate {
  key: string
}

export interface GapRow {
  riskType: RiskType
  unsafeTotal: number
  /** Unsafe records of this type that reached the detector (mapped/partial). */
  unsafeOnSurface: number
  detected: number
  lumoCategory: string | null
}

export interface Report {
  source: { repo: string; sha: string }
  records: number
  invalid: number
  status: { mapped: number; partial: number; unmapped: number }
  /** Per-action skip counts across ALL records. */
  skippedActions: Record<string, number>
  /** Most frequent skipped tool names (api_tool / pseudo_call / …). */
  skippedTools: { tool: string; count: number }[]
  /** Unmapped records, by label. */
  unmappedByLabel: { unsafe: number; safe: number }
  /** Headline over mapped + partial records. */
  headline: Rate
  /** Same, mapped-only (no unseen action that could carry the risk). */
  fullyMapped: Rate
  byCategory: Bucket[]
  byScenario: Bucket[]
  byAttackType: Bucket[]
  /** Non-advisory hit counts per Lumo category (record-level). */
  byLumoCategory: { category: string; unsafe: number; safe: number }[]
  advisoryHits: number
  misses: RecordResult[]
  falseAlarms: RecordResult[]
  gaps: GapRow[]
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d
}

export function rateOf(results: RecordResult[]): Rate {
  const unsafe = results.filter(r => r.label === 'unsafe')
  const safe = results.filter(r => r.label === 'safe')
  const detected = unsafe.filter(r => r.flagged.length > 0).length
  const falsePositives = safe.filter(r => r.flagged.length > 0).length
  return {
    unsafe: unsafe.length,
    detected,
    detectionRate: ratio(detected, unsafe.length),
    safe: safe.length,
    falsePositives,
    falsePositiveRate: ratio(falsePositives, safe.length),
  }
}

function bucket(
  results: RecordResult[],
  keyOf: (r: RecordResult) => string
): Bucket[] {
  const groups = new Map<string, RecordResult[]>()
  for (const r of results) {
    const k = keyOf(r)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({ key, ...rateOf(rs) }))
    .sort(
      (a, b) =>
        b.unsafe + b.safe - (a.unsafe + a.safe) || a.key.localeCompare(b.key)
    )
}

/**
 * Aggregate. `all` is every converted record (for skip accounting and the gap
 * table); `results` are the evaluated on-surface (mapped + partial) records.
 */
export function summarize(
  all: ConvertedRecord<RJudgeRecord>[],
  results: RecordResult[],
  meta: { repo: string; sha: string; invalid: number }
): Report {
  const status = { mapped: 0, partial: 0, unmapped: 0 }
  const skippedActions: Record<string, number> = {}
  const tools = new Map<string, number>()
  const unmappedByLabel = { unsafe: 0, safe: 0 }
  for (const c of all) {
    status[c.status]++
    if (c.status === 'unmapped') {
      if (c.record.label === 1) unmappedByLabel.unsafe++
      else unmappedByLabel.safe++
    }
    for (const s of c.skipped) {
      skippedActions[s.reason] = (skippedActions[s.reason] ?? 0) + 1
      if (s.tool) tools.set(s.tool, (tools.get(s.tool) ?? 0) + 1)
    }
  }
  const skippedTools = [...tools.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
    .slice(0, 15)

  const lumo = new Map<string, { unsafe: number; safe: number }>()
  for (const r of results) {
    for (const cat of r.flagged) {
      const e = lumo.get(cat) ?? { unsafe: 0, safe: 0 }
      e[r.label]++
      lumo.set(cat, e)
    }
  }

  // Gap table over EVERY unsafe record (on-surface or not).
  const byKey = new Map(results.map(r => [r.key, r]))
  const gapMap = new Map<RiskType, GapRow>()
  for (const c of all) {
    if (c.record.label !== 1) continue
    const res = byKey.get(recordKey(c.record))
    const riskType = res?.riskType ?? classifyRisk(c.record, c.events)
    const row = gapMap.get(riskType) ?? {
      riskType,
      unsafeTotal: 0,
      unsafeOnSurface: 0,
      detected: 0,
      lumoCategory: LUMO_COVERAGE[riskType],
    }
    row.unsafeTotal++
    if (res) {
      row.unsafeOnSurface++
      if (res.flagged.length > 0) row.detected++
    }
    gapMap.set(riskType, row)
  }

  return {
    source: { repo: meta.repo, sha: meta.sha },
    records: all.length,
    invalid: meta.invalid,
    status,
    skippedActions,
    skippedTools,
    unmappedByLabel,
    headline: rateOf(results),
    fullyMapped: rateOf(results.filter(r => r.status === 'mapped')),
    byCategory: bucket(results, r => r.category),
    byScenario: bucket(results, r => r.scenario),
    byAttackType: bucket(results, r => r.attackType),
    byLumoCategory: [...lumo.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.unsafe + b.safe - (a.unsafe + a.safe)),
    advisoryHits: results.reduce(
      (n, r) => n + r.hits.filter(h => h.advisory).length,
      0
    ),
    misses: results.filter(r => r.label === 'unsafe' && r.flagged.length === 0),
    falseAlarms: results.filter(
      r => r.label === 'safe' && r.flagged.length > 0
    ),
    gaps: [...gapMap.values()].sort(
      (a, b) =>
        b.unsafeTotal - a.unsafeTotal || a.riskType.localeCompare(b.riskType)
    ),
  }
}

// --- text report -----------------------------------------------------------------

function pct(v: number | null): string {
  return v === null ? '  n/a' : `${(v * 100).toFixed(1)}%`
}

function rateLine(label: string, r: Rate): string {
  return (
    `${label}: unsafe detected ${r.detected}/${r.unsafe} (${pct(r.detectionRate)})` +
    ` · safe false-positive ${r.falsePositives}/${r.safe} (${pct(r.falsePositiveRate)})`
  )
}

function bucketTable(title: string, rows: Bucket[]): string[] {
  const out = [`\n${title}`]
  for (const b of rows) {
    out.push(
      `  ${b.key.padEnd(24)} unsafe ${String(b.detected).padStart(2)}/${String(b.unsafe).padEnd(3)}` +
        ` safe-FP ${String(b.falsePositives).padStart(2)}/${b.safe}`
    )
  }
  return out
}

export function formatReport(r: Report): string {
  const lines: string[] = []
  lines.push(`R-Judge × Lumo boundary detector (LUM-949)`)
  lines.push(
    `source: github.com/${r.source.repo} @ ${r.source.sha.slice(0, 12)}`
  )
  lines.push(
    `records: ${r.records} (invalid dropped: ${r.invalid}) · mapped ${r.status.mapped}` +
      ` · partial ${r.status.partial} · unmapped ${r.status.unmapped}` +
      ` (unmapped unsafe ${r.unmappedByLabel.unsafe} / safe ${r.unmappedByLabel.safe})`
  )
  lines.push(
    `skipped actions: ` +
      Object.entries(r.skippedActions)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
  )
  lines.push(
    `top skipped tools: ` +
      r.skippedTools.map(t => `${t.tool}×${t.count}`).join(', ')
  )
  lines.push('')
  lines.push(rateLine('on-surface (mapped+partial)', r.headline))
  lines.push(rateLine('fully mapped only          ', r.fullyMapped))
  lines.push(`advisory (non-blocking) hits: ${r.advisoryHits}`)
  lines.push(...bucketTable('by R-Judge category', r.byCategory))
  lines.push(...bucketTable('by scenario', r.byScenario))
  lines.push(...bucketTable('by attack type', r.byAttackType))
  lines.push('\nflagged records per Lumo category')
  for (const c of r.byLumoCategory) {
    lines.push(`  ${c.category.padEnd(26)} unsafe ${c.unsafe} · safe ${c.safe}`)
  }
  lines.push(`\nmisses (unsafe, not flagged): ${r.misses.length}`)
  for (const m of r.misses) {
    lines.push(`  ✗ ${m.key} [${m.status}] {${m.riskType}} ${m.firstEvent}`)
  }
  lines.push(`\nfalse alarms (safe, flagged): ${r.falseAlarms.length}`)
  for (const f of r.falseAlarms) {
    lines.push(`  ! ${f.key} [${f.flagged.join(',')}]`)
    for (const h of f.hits.filter(x => !x.advisory)) {
      lines.push(`      ${h.category}: ${h.excerpt}`)
    }
  }
  lines.push('\ntaxonomy coverage (every unsafe record)')
  for (const g of r.gaps) {
    lines.push(
      `  ${g.riskType.padEnd(30)} total ${String(g.unsafeTotal).padStart(3)}` +
        ` on-surface ${String(g.unsafeOnSurface).padStart(3)} detected ${String(g.detected).padStart(2)}` +
        `  lumo: ${g.lumoCategory ?? '— none —'}`
    )
  }
  return `${lines.join('\n')}\n`
}

export type { SkipReason }
