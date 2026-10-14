import { parseCliVersion } from '@/lib/api/cli-version-gate'
import { logger } from '@/lib/logger'

/**
 * LUM-1136 — the newest published Lumo CLI (`@lumoai/cli` on npm), the
 * reference the members page marks members' CLIs against. The skill ships
 * inside the CLI, so this is the newest skill version too.
 *
 * Cached by Next's fetch cache for an hour; any failure (npm down, timeout,
 * odd payload) is null, never a thrown error — the page then falls back to
 * the newest version seen in the workspace.
 */
const LATEST_URL = 'https://registry.npmjs.org/@lumoai/cli/latest'
const REVALIDATE_SECONDS = 60 * 60
const TIMEOUT_MS = 3000

export async function fetchLatestCliVersion(
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const res = await fetchImpl(LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    } as RequestInit)
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    const version = typeof body.version === 'string' ? body.version : null
    const parsed = parseCliVersion(version)
    return parsed ? parsed.join('.') : null
  } catch (error) {
    logger.warn('fetchLatestCliVersion failed:', error)
    return null
  }
}
