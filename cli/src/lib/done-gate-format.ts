import { sanitizeField } from './sanitize'
import {
  fieldLines,
  sectionHeading,
  wrapLines,
  type Field,
  type LayoutOptions,
} from './report-layout'

/**
 * LUM-1186 — the Done gate as `GET /api/tasks/[id]/status` serves it
 * (`doneGate`): the web Record tab's headline and rows, derived server-side
 * by the same `deriveDoneGate` (lib/acceptance/done-gate.ts). The CLI only
 * renders it — no rule is recomputed here.
 */
export type DoneGateReadout =
  | {
      confirmed: true
      headline: 'accepted' | 'blocked' | 'ready'
      blockingTotal: number
      crossings: {
        state: 'blocked' | 'advisory' | 'clear' | 'none'
        blocking: number
        advisory: number
        dispositioned: number
        total: number
      }
      /** null: no plugin contributes a security check on this server. */
      security: {
        state: 'blocked' | 'clear' | 'notScanned'
        blocking: number
      } | null
      tests: {
        state: 'blocked' | 'clear' | 'none'
        blocking: number
        passing: number
        total: number
      }
    }
  | { confirmed: false; unconfirmed: string[] }

type ConfirmedGate = Extract<DoneGateReadout, { confirmed: true }>

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The headline, one line. Fail-closed: an absent gate (older server) or an
 * unconfirmed one is `⚠ CANNOT CONFIRM`, never READY.
 */
export function doneGateHeadline(gate: DoneGateReadout | undefined): string {
  if (gate === undefined)
    return '⚠ CANNOT CONFIRM — this server does not report a Done gate'
  if (!gate.confirmed)
    return `⚠ CANNOT CONFIRM — could not read ${gate.unconfirmed
      .map(u => sanitizeField(u))
      .join(', ')}`
  if (gate.headline === 'accepted') return 'ACCEPTED — the task is DONE'
  if (gate.headline === 'blocked')
    return `BLOCKED — ${plural(gate.blockingTotal, 'item blocks', 'items block')} DONE`
  return 'READY — nothing blocks DONE'
}

/** `✗` a row that blocks, `✓` a row that is clear, `–` nothing to check. */
export function crossingsRow(c: ConfirmedGate['crossings']): string {
  if (c.state === 'none') return '– none recorded'
  const parts: string[] = []
  if (c.blocking > 0) parts.push(`${c.blocking} blocking, not dispositioned`)
  if (c.advisory > 0)
    parts.push(`${c.advisory} advisory (open, does not block DONE)`)
  parts.push(`dispositioned ${c.dispositioned}/${c.total}`)
  return `${c.state === 'blocked' ? '✗' : '✓'} ${parts.join(' · ')}`
}

export function securityRow(s: NonNullable<ConfirmedGate['security']>): string {
  if (s.state === 'blocked')
    return `✗ ${plural(s.blocking, 'blocking finding')} not dispositioned`
  if (s.state === 'clear') return '✓ no blocking findings'
  // Never "clean": nothing was scanned.
  return '– not scanned (no linked PR has a scan) — not a clean result'
}

export function testsRow(t: ConfirmedGate['tests']): string {
  if (t.state === 'none') return '– no test cases'
  const passing = `${t.passing}/${t.total} passing`
  if (t.state === 'blocked')
    return `✗ ${plural(t.blocking, 'proven defect')} awaiting a ruling · ${passing}`
  return `✓ no proven defects · ${passing}`
}

/** The gate rows (crossings / security / tests), at `indent`. */
export function doneGateRows(
  gate: ConfirmedGate,
  indent: number,
  opts: LayoutOptions = {}
): string[] {
  const fields: Field[] = [
    { label: 'Crossings', value: crossingsRow(gate.crossings) },
  ]
  if (gate.security !== null)
    fields.push({ label: 'Security', value: securityRow(gate.security) })
  fields.push({ label: 'Tests', value: testsRow(gate.tests) })
  return fieldLines(fields, indent, opts)
}

/**
 * The `Done gate: …` section of `lumo task status` — first after the header,
 * the same verdict as the web Record tab's Done gate.
 */
export function doneGateSection(
  gate: DoneGateReadout | undefined,
  opts: LayoutOptions = {}
): string[] {
  const lines = sectionHeading(`Done gate: ${doneGateHeadline(gate)}`, opts)
  if (gate === undefined || !gate.confirmed) {
    lines.push(
      ...wrapLines(
        'Unknown, not clear — the gate rows could not be read. Re-run; if it persists, check the web Record tab.',
        2,
        opts
      )
    )
    return lines
  }
  lines.push(...doneGateRows(gate, 2, opts))
  return lines
}
