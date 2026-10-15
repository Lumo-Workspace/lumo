/**
 * LUM-1129 — reading a reviewer command off a PR conversation comment,
 * the usual PR-bot form (`@<app> review`): a line that starts with the
 * App's mention handle, followed by the command.
 *
 * Pure (env read aside) and dependency-free, so the plugin's event handler
 * can drop the ordinary comment synchronously before loading the service.
 */

export type PrCommand =
  | 'review'
  | 'full review'
  | 'pause'
  | 'resume'
  | 'resolve'
  | 'approve'
  | 'ignore pre-merge checks'
  | 'configuration'
  | 'help'

export interface ParsedPrCommand {
  /** `null` = the handle was addressed with something Lumo does not know. */
  command: PrCommand | null
  /** What followed the handle, whitespace-collapsed (for the help reply). */
  text: string
}

export const PR_COMMANDS: readonly PrCommand[] = [
  'review',
  'full review',
  'pause',
  'resume',
  'resolve',
  'approve',
  // LUM-1148: the per-PR override of the pre-merge checks.
  'ignore pre-merge checks',
  'configuration',
  'help',
]

/**
 * The App's mention handle — `@<GITHUB_APP_SLUG>` (production `@uselumo`;
 * the App was renamed from `lumo-agent` on 2026-10-08, and a self-hosted
 * install names its own). Derived from the App config, never hard-coded;
 * `null` when the slug is not configured, which turns commands off.
 */
export function prCommandHandle(): string | null {
  const slug = process.env.GITHUB_APP_SLUG?.trim()
  return slug ? `@${slug}` : null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The first line (outside code fences and `>` quotes) that starts with the
 * handle — `@slug` or `@slug[bot]`, any case. A mention mid-sentence is not
 * a command. Returns `null` when no line addresses Lumo.
 */
export function parsePrCommand(
  body: string,
  handle: string
): ParsedPrCommand | null {
  const head = new RegExp(
    `^${escapeRegExp(handle)}(?:\\[bot\\])?(?=$|[\\s,:.!])[\\s,:]*(.*)$`,
    'i'
  )
  let fenced = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced || line.startsWith('>')) continue
    const m = head.exec(line)
    if (!m) continue
    const text = (m[1] ?? '')
      .trim()
      .replace(/[.!]+$/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
    if (text === '') return { command: 'help', text }
    const command = (PR_COMMANDS as readonly string[]).includes(text)
      ? (text as PrCommand)
      : null
    return { command, text }
  }
  return null
}
