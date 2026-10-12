import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { AGENT_LABELS } from '../lib/agent'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface ArtifactRow {
  id: string
  kind: string
  title: string
  source: string
  agent: string
  order: number
}

export async function taskArtifactList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact list <LUM-42>'
    )
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
      `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts`,
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
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('artifact list', res.status))
    return 1
  }

  const { artifacts } = (await res.json()) as { artifacts: ArtifactRow[] }
  if (artifacts.length === 0) {
    process.stdout.write(`No artifacts on ${identifier}\n`)
    return
  }
  for (const a of artifacts) {
    const agentLabel = AGENT_LABELS[a.agent] ?? sanitizeField(a.agent)
    process.stdout.write(
      `${a.id}  ${sanitizeField(a.kind).padEnd(10)}  ${agentLabel.padEnd(15)}  ${sanitizeField(a.source).padEnd(12)}  ${sanitizeField(a.title)}\n`
    )
  }
}
