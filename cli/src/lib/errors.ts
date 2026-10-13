/**
 * LUM-1087: the one place the CLI's error / auth / HTTP-failure / warning
 * wording lives. Commands used to copy these strings by hand (~75 auth lines,
 * ~90 not-logged-in lines, two HTTP-failure wordings, two warning prefixes);
 * route every new message through here instead.
 *
 * The auth lines are grepped by agents and documented in the lumo skill
 * (`lumo auth login`), so their text is fixed — change it here or nowhere.
 * Colour is never applied here: these strings may be sanitized or embedded in
 * agent-read envelopes, so styling belongs to the caller, after sanitizing.
 */

import { sanitizeField } from './sanitize'

/** Bare reason (no remediation) — for structured `reason` fields. */
export const AUTH_INVALID_REASON = 'API key invalid or revoked'

/** Auth failure (HTTP 401) without the `Error: ` prefix — for thrown Errors / `{ error }` results. */
export const AUTH_INVALID_MESSAGE = `${AUTH_INVALID_REASON}. Run \`lumo auth login\`.`

/** No credentials on disk, without the `Error: ` prefix. */
export const NOT_LOGGED_IN_MESSAGE =
  'not logged in. Run `lumo auth login` first.'

/** The single warning prefix (replaces the old `Warning:` spelling). */
export const WARN_PREFIX = '⚠'

/** `Error: API key invalid or revoked. Run \`lumo auth login\`.` */
export function errAuth(): string {
  return `Error: ${AUTH_INVALID_MESSAGE}`
}

/** `Error: not logged in. Run \`lumo auth login\` first.` */
export function errNotLoggedIn(): string {
  return `Error: ${NOT_LOGGED_IN_MESSAGE}`
}

/**
 * `<noun> failed (HTTP <status>)[: <detail>]` — the one HTTP-failure wording.
 * `detail` is usually the server's response text; it is sanitized here, and
 * dropped when empty.
 */
export function httpFailed(
  noun: string,
  status: number | string,
  detail?: string | null
): string {
  const base = `${noun} failed (HTTP ${status})`
  const clean = detail == null ? '' : sanitizeField(detail).trim()
  return clean ? `${base}: ${clean}` : base
}

/** `Error: ` + {@link httpFailed}. */
export function errHttp(
  noun: string,
  status: number | string,
  detail?: string | null
): string {
  return `Error: ${httpFailed(noun, status, detail)}`
}

/** `⚠ <message>` — the one warning prefix. */
export function warn(message: string): string {
  return `${WARN_PREFIX} ${message}`
}

/**
 * LUM-1110: the server refused this CLI as too old (HTTP 426). Names the
 * versions when known and always ends with `lumo update`.
 */
export function cliUpgradeRequired(
  minVersion: string | null,
  cliVersion: string | null
): string {
  const have = cliVersion ? ` ${cliVersion}` : ''
  const need = minVersion ? `; it needs ${minVersion} or newer` : ''
  return `the Lumo server no longer supports this CLI${have} (HTTP 426${need}). Run \`lumo update\` to upgrade.`
}

/**
 * LUM-1110: the server has no API route for the command (an HTTP 404 page,
 * not a JSON "not found") — usually a server older than the CLI.
 */
export function serverLacksFeature(command: string | null): string {
  const what = command ? `\`lumo ${command}\`` : 'this command'
  return `the Lumo server has no API for ${what} (HTTP 404) — it may not have deployed this feature yet. Run it again once the server has been updated (not in a loop); if it persists, check LUMO_API_URL.`
}
