import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { reportPull } from '../lib/report-pull'
import { printRedactionNotice } from '../lib/redaction-notice'

interface SlackMessage {
  ts?: string
  userId: string
  userName: string | null
  text: string
}

interface SlackSnapshot {
  messages?: SlackMessage[]
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
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} or slack context ${contextId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: slack show failed (HTTP ${res.status})`)
    return 1
  }

  const { snapshot, redactedSecrets } = (await res.json()) as {
    snapshot: SlackSnapshot | null
    redactedSecrets?: number
  }
  const messages = snapshot?.messages ?? []
  if (messages.length === 0) {
    console.log('(no messages in stored snapshot)')
  } else {
    for (const m of messages) {
      const author = sanitizeField(m.userName ?? '@' + m.userId)
      console.log(`${author}: ${sanitizeField(m.text)}`)
    }
  }

  printRedactionNotice(redactedSecrets)

  // LUM-500: stamp the disclosure funnel. The contextId arg == lineage
  // SLACK_CONTEXT fragmentId. Fire-and-forget — never blocks, swallows failures.
  await reportPull({ fragmentType: 'SLACK_CONTEXT', fragmentId: contextId })
}
