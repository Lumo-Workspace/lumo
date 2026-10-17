import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { reportPull } from '../lib/report-pull'
import {
  formatSlackSnapshot,
  type SlackSnapshotMessage,
} from '../lib/tier2-render'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { sanitizeField } from '../lib/sanitize'
import { refLookupError } from '../lib/ref-error'

interface SlackSnapshot {
  messages?: SlackSnapshotMessage[]
}

/**
 * `lumo task slack show <LUM-N> <ref>`
 *
 * Tier-2 retrieval for the cheap inline Slack card. Fetches the stored thread
 * snapshot (no live Slack call) from
 * `/api/tasks/:id/slack-contexts/:contextId/snapshot` and prints one line per
 * message as `author: text`, falling back to `@<userId>` when the display name
 * is missing.
 */
export async function taskSlackShow(
  identifier: string | undefined,
  contextId: string | undefined
): Promise<number | void> {
  if (!identifier || !contextId) {
    console.error('Error: usage: lumo task slack show <LUM-42> <ref>')
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/slack-contexts/${encodeURIComponent(contextId)}/snapshot`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  // LUM-1230: an ambiguous (409) or too-short (400) short ref — the server
  // message lists the candidates / the minimum length.
  if (res.status === 409 || res.status === 400) {
    console.error(
      await refLookupError(
        res,
        `could not resolve Slack context "${sanitizeField(contextId)}"`
      )
    )
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} or slack context ${contextId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('slack show', res.status))
    return 1
  }

  const { id, snapshot, redactedSecrets } = (await res.json()) as {
    /** LUM-1230: the resolved context id (absent on an older server). */
    id?: string
    snapshot: SlackSnapshot | null
    redactedSecrets?: number
  }
  // LUM-998: fenced + guarded; the redaction count is the first notice.
  console.log(formatSlackSnapshot(snapshot?.messages ?? [], redactedSecrets))

  // LUM-500: stamp the disclosure funnel with the lineage SLACK_CONTEXT
  // fragmentId — the resolved id, not a short ref (LUM-1230). Fire-and-forget.
  await reportPull({
    fragmentType: 'SLACK_CONTEXT',
    fragmentId: id ?? contextId,
  })
}
