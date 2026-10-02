import { readCredentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { resolveSessionId } from './session-id'

/**
 * Fire-and-forget telemetry for progressive disclosure (LUM-500).
 *
 * When an agent pulls a fragment's body via a `lumo … show <id>` command, this
 * reports the pull to the server, which stamps `pulledAt` on the session-start
 * lineage edge — the middle of the disclosure funnel (saw → pulled → used).
 *
 * Contract:
 * - NO-OP silently when there is no bound session (nothing is sent). The bound
 *   session id is `CLAUDE_CODE_SESSION_ID` — the same source other commands use
 *   for `X-Lumo-Session-Id` provenance.
 * - Fire-and-forget: never blocks the command's main output and never surfaces
 *   an error. All failures (no creds, network, non-ok) are swallowed. Returns
 *   void so callers can `await` it without affecting their exit code.
 *
 * `fragmentId` must be the DB row id the lineage edge stored — callers are
 * responsible for passing the id that matches (see each command's wiring).
 */
export async function reportPull(ref: {
  fragmentType: string
  fragmentId: string
}): Promise<void> {
  try {
    const sessionId = await resolveSessionId({ write: false })
    if (!sessionId) return

    const creds = readCredentials()
    if (!creds) return

    const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
    await fetch(`${base}/api/lineage/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        fragmentType: ref.fragmentType,
        fragmentId: ref.fragmentId,
      }),
    })
  } catch {
    // fire-and-forget: never surface telemetry failures
  }
}
