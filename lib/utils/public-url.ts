/**
 * The externally reachable origin of this Lumo deployment.
 *
 * Used to build links that leave the app — CLI output, GitHub comments — where
 * a relative path is useless. `NEXT_PUBLIC_APP_URL` (used by `buildTaskUrl`)
 * is the browser-side origin and defaults to localhost; this one is the public
 * one, set per environment via `LUMO_PUBLIC_URL`. Trailing slashes are
 * stripped so callers can concatenate a path directly.
 *
 * Lived in `task-cli.service.ts` until LUM-735 needed it for PR write-back.
 */
const DEFAULT_PUBLIC_URL = 'https://www.uselumo.ai'

export function resolvePublicUrl(): string {
  const v = process.env.LUMO_PUBLIC_URL?.trim()
  return v && v.length > 0 ? v.replace(/\/+$/, '') : DEFAULT_PUBLIC_URL
}
