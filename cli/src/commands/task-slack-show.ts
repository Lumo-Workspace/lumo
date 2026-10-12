import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { reportPull } from '../lib/report-pull'
import {
  formatSlackSnapshot,
  type SlackSnapshotMessage,
} from '../lib/tier2-render'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface SlackSnapshot {
  messages?: SlackSnapshotMessage[]
}

/**
 * `lumo task slack show <LUM-N> <context-id>`
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
    console.error('Error: usage: lumo task slack show <LUM-42> <context-id>')
    return 1
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

  const { snapshot, redactedSecrets } = (await res.json()) as {
    snapshot: SlackSnapshot | null
    redactedSecrets?: number
  }
  // LUM-998: fenced + guarded; the redaction count is the first notice.
  console.log(formatSlackSnapshot(snapshot?.messages ?? [], redactedSecrets))

  // LUM-500: stamp the disclosure funnel. The contextId arg == lineage
  // SLACK_CONTEXT fragmentId. Fire-and-forget — never blocks, swallows failures.
  await reportPull({ fragmentType: 'SLACK_CONTEXT', fragmentId: contextId })
}
