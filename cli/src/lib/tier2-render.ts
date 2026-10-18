/**
 * LUM-998 — the agent-facing output of the tier-2 retrieval commands
 * (`task slack show`, `task web show`, `task figma show`,
 * `task pr show`). LUM-997 found each printed member- or externally-authored
 * text with only the control-character strip. Bodies now print inside an
 * `<untrusted-linked-context>` fence (the same tag `task show --full` uses for
 * these sources): wrapper tags defanged, directive-shaped content flagged at
 * the head, the server's redaction count as the first notice. Single-line
 * fields (a PR title, a Figma file name) are defanged and marked inline.
 *
 * Pure: each function returns the text the command prints.
 */
import { fmtTimestamp } from './format'
import {
  LINKED_FENCE,
  fenceUntrustedText,
  guardInlineText,
  linkedRetrievalPreamble,
} from '../../../shared/src/untrusted-fence'
import { sanitizeField } from './sanitize'
import { redactionNoticeLine } from './redaction-notice'

function notices(redactedSecrets: number | undefined): string[] {
  const line = redactionNoticeLine(redactedSecrets)
  return line ? [line] : []
}

export interface SlackSnapshotMessage {
  ts?: string
  userId: string
  userName: string | null
  text: string
}

/** `author: text` per message, fenced; `(no messages …)` when empty. */
export function formatSlackSnapshot(
  messages: SlackSnapshotMessage[],
  redactedSecrets?: number
): string {
  const body = messages
    .map(m => `${sanitizeField(m.userName ?? '@' + m.userId)}: ${m.text ?? ''}`)
    .join('\n')
  const fenced = fenceUntrustedText(
    LINKED_FENCE,
    linkedRetrievalPreamble('The Slack thread'),
    body,
    notices(redactedSecrets)
  )
  return fenced || '(no messages in stored snapshot)'
}

/** The fetched page body, fenced; `(empty body)` when blank. */
export function formatWebBody(
  body: string | null,
  redactedSecrets?: number
): string {
  const fenced = fenceUntrustedText(
    LINKED_FENCE,
    linkedRetrievalPreamble('The fetched web page'),
    body ?? '',
    notices(redactedSecrets)
  )
  return fenced || '(empty body)'
}

export interface FigmaContextMetadata {
  url: string
  fileName: string | null
  frameName: string | null
  lastSyncedAt: string | null
  lastSyncError: string | null
}

/**
 * Cached Figma metadata. `fileName` / `frameName` are set by whoever owns the
 * Figma file and `lastSyncError` echoes the Figma API, so all three are
 * guarded inline. `note` is the route's own fixed text.
 */
export function formatFigmaContext(
  metadata: FigmaContextMetadata,
  note?: string
): string {
  const lines: string[] = []
  if (metadata.fileName)
    lines.push(`file:  ${guardInlineText(metadata.fileName)}`)
  if (metadata.frameName)
    lines.push(`frame: ${guardInlineText(metadata.frameName)}`)
  lines.push(`url:   ${metadata.url}`)
  if (metadata.lastSyncedAt)
    lines.push(`synced: ${fmtTimestamp(metadata.lastSyncedAt)}`)
  if (metadata.lastSyncError)
    lines.push(`syncError: ${guardInlineText(metadata.lastSyncError)}`)
  if (note) lines.push(`\nnote: ${sanitizeField(note)}`)
  return lines.join('\n')
}

export interface PrShowRecord {
  repo: string | null
  number: number
  title: string | null
  url: string | null
  state: string | null
  isDraft: boolean
  ciStatus: string | null
  authorLogin: string | null
  headBranch: string | null
  baseBranch: string | null
}

/** The synced PR record; the title is the PR author's text, guarded inline. */
export function formatPrShow(pr: PrShowRecord, note?: string): string {
  const lines: string[] = []
  lines.push(
    `#${pr.number}${pr.repo ? ` (${sanitizeField(pr.repo)})` : ''}  ${guardInlineText(pr.title ?? '')}`
  )
  lines.push(
    `state:    ${pr.state ?? 'unknown'}${pr.isDraft ? ' · draft' : ''}`
  )
  if (pr.ciStatus) lines.push(`ci:       ${pr.ciStatus}`)
  if (pr.authorLogin) lines.push(`author:   ${sanitizeField(pr.authorLogin)}`)
  if (pr.headBranch || pr.baseBranch)
    // Branch names are chosen by whoever opened the PR: guarded like the title.
    lines.push(
      `branch:   ${guardInlineText(pr.headBranch ?? '?')} → ${guardInlineText(pr.baseBranch ?? '?')}`
    )
  if (pr.url) lines.push(`url:      ${pr.url}`)
  if (note) lines.push(`\nnote: ${sanitizeField(note)}`)
  return lines.join('\n')
}
