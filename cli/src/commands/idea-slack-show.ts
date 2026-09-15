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
 * `lumo idea slack show <LUM-I1> <context-id>`
 *
 * Tier-2 retrieval for the cheap inline Slack card on an idea. Fetches the
 * stored thread snapshot (no live Slack call) from
 * `/api/ideas/:id/slack-contexts/:contextId/snapshot` and prints one line per
 * message as `author: text`, falling back to `@<userId>` when the display
 * name is missing. Mirrors `taskSlackShow` (LUM-681).
 */
export async function ideaSlackShow(
  identifier: string | undefined,
  contextId: string | undefined
): Promise<number | void> {
  if (!identifier || !contextId) {
    console.error('Error: usage: lumo idea slack show <LUM-I1> <context-id>')
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
      `${base}/api/ideas/${encodeURIComponent(identifier)}/slack-contexts/${encodeURIComponent(contextId)}/snapshot`,
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
      `Error: idea ${identifier} or slack context ${contextId} not found in workspace ${creds.workspaceSlug}`
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

  // LUM-681: mirrors LUM-500 disclosure-funnel stamping for idea fragments.
  // The contextId arg == lineage SLACK_CONTEXT fragmentId. Fire-and-forget —
  // never blocks, swallows failures.
  await reportPull({ fragmentType: 'SLACK_CONTEXT', fragmentId: contextId })
}
