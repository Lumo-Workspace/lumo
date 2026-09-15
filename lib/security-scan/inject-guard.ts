/**
 * LUM-784 — the one helper every injection point calls on untrusted text.
 *
 * Composes, in this order:
 *
 *   1. `redactForInjection` (this subsystem, LUM-784): every registry secret
 *      masked, over-cap lines scanned-then-cut, counts kept for the notice.
 *   2. `guardUntrustedContent` (shared, LUM-783): fence-shaped tags defanged,
 *      instruction-shaped content counted.
 *
 * Redaction runs FIRST so the guard's excerpts and every later consumer only
 * ever see the masked form. Callers still `sanitizeField` before calling —
 * this is layered on the control-char strip, never instead of it — and print
 * `notices` right after the block's opening tag, before the standing
 * preamble, the same slot LUM-783 established.
 *
 * Two render shapes, mirroring LUM-783:
 *   - a fenced block gets `notices` (zero, one or more lines at the head);
 *   - a single prompt line gets `renderInlineRedactionMarker` appended.
 *
 * Nothing here touches the boundary-crossing ledger, by design: a credential
 * in a Slack thread is a property of the *source*, and this is Lumo's own
 * data flow, not an agent stepping over a line. The no-crossing test asserts
 * the import graph as well as the behaviour.
 */
import {
  guardUntrustedContent,
  type InjectionSignal,
} from '@/shared/src/untrusted-content'
import type {
  SlackContextMessage,
  SlackContextSnapshot,
} from '@/types/slack-context'
import {
  MAX_SCANNED_LINE_CHARS,
  redactForInjection,
  type InjectionRedaction,
  type InjectionRedactionOptions,
} from './scan-secrets'

export { redactForInjection }
export type { InjectionRedaction, InjectionRedactionOptions }

export interface GuardedInjectedText {
  /** Redacted, fence-neutralized text. Content is never dropped. */
  text: string
  /** Lines to print at the head of the untrusted block, after the tag. */
  notices: string[]
  redactedCount: number
  downgradedCount: number
  truncatedLines: number
  wrapperEscapes: number
  signals: InjectionSignal[]
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/**
 * The redaction lines an injection point prints inside the block head. Empty
 * when nothing was redacted and nothing was cut — the block is then
 * byte-identical to what LUM-783 rendered.
 */
export function renderRedactionNotices(
  r: Pick<InjectionRedaction, 'redactedCount' | 'truncatedLines'>
): string[] {
  const notices: string[] = []
  if (r.redactedCount > 0) {
    notices.push(
      `⚠ ${r.redactedCount} suspected ${plural(r.redactedCount, 'credential', 'credentials')} in this content ${plural(r.redactedCount, 'was', 'were')} redacted before injection — each value is shown as its first 4 characters + length; the original never entered this context.`
    )
  }
  if (r.truncatedLines > 0) {
    notices.push(
      `⚠ ${r.truncatedLines} ${plural(r.truncatedLines, 'line', 'lines')} exceeded the ${MAX_SCANNED_LINE_CHARS}-character secret-scan cap and ${plural(r.truncatedLines, 'was', 'were')} cut at the cap after scanning (marked …(truncated)); the unscanned remainder was dropped, never passed through.`
    )
  }
  return notices
}

/**
 * Single-line form, for text rendered on one prompt line (a planned
 * objective, a finding title): `''` when clean, else
 * ` [⚠ N suspected credentials redacted]`.
 */
export function renderInlineRedactionMarker(
  r: Pick<InjectionRedaction, 'redactedCount'>
): string {
  if (r.redactedCount === 0) return ''
  return ` [⚠ ${r.redactedCount} suspected ${plural(r.redactedCount, 'credential', 'credentials')} redacted]`
}

/** Redact + guard text that is about to be fenced. */
export function guardInjectedText(
  text: string,
  opts: InjectionRedactionOptions = {}
): GuardedInjectedText {
  const redaction = redactForInjection(text, opts)
  const guarded = guardUntrustedContent(redaction.text)
  return {
    text: guarded.text,
    notices: [...renderRedactionNotices(redaction), ...guarded.notices],
    redactedCount: redaction.redactedCount,
    downgradedCount: redaction.downgradedCount,
    truncatedLines: redaction.truncatedLines,
    wrapperEscapes: guarded.wrapperEscapes,
    signals: guarded.signals,
  }
}

/** Redact text that is rendered on ONE prompt line; marker ready to append. */
export function redactPromptLine(text: string): {
  text: string
  marker: string
} {
  const r = redactForInjection(text)
  return { text: r.text, marker: renderInlineRedactionMarker(r) }
}

function isSnapshotShape(
  v: unknown
): v is { messages: Array<Partial<SlackContextMessage>> } {
  return (
    v !== null &&
    typeof v === 'object' &&
    Array.isArray((v as { messages?: unknown }).messages)
  )
}

/**
 * Tier-2 Slack retrieval (`lumo task slack show` / `lumo idea slack show`)
 * hands the agent every stored message body verbatim. Redact each body; the
 * count rides beside the snapshot so the CLI can print the notice.
 *
 * Takes the column as stored (a Prisma `JsonValue`): a value that is not
 * snapshot-shaped is returned untouched with count 0 — nothing else in Lumo
 * writes that column, and the CLI cannot print any other shape either.
 */
export function redactSlackSnapshotForInjection<T>(snapshot: T): {
  snapshot: T | SlackContextSnapshot
  redactedSecrets: number
} {
  if (!isSnapshotShape(snapshot)) return { snapshot, redactedSecrets: 0 }
  let redactedSecrets = 0
  let changed = false
  const messages = snapshot.messages.map(m => {
    if (typeof m.text !== 'string') return m
    const r = redactForInjection(m.text)
    redactedSecrets += r.redactedCount
    if (r.text === m.text) return m
    changed = true
    return { ...m, text: r.text }
  })
  return {
    snapshot: changed
      ? ({ ...snapshot, messages } as SlackContextSnapshot)
      : snapshot,
    redactedSecrets,
  }
}

/**
 * Tier-2 web retrieval (`lumo task web show` / `lumo idea web show`) prints
 * the fetched page body verbatim. Same treatment as the Slack snapshot.
 */
export function redactWebBodyForInjection(body: string | null): {
  body: string | null
  redactedSecrets: number
} {
  if (body == null) return { body, redactedSecrets: 0 }
  const r = redactForInjection(body)
  return { body: r.text, redactedSecrets: r.redactedCount }
}
