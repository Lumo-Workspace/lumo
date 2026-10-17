import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

export interface ArtifactUpdateOptions {
  kind?: string
  title?: string
  source?: string
  agent?: string
}

interface ArtifactResponse {
  artifact: { id: string; kind: string; title: string; source: string }
}

export async function taskArtifactUpdate(
  identifier: string | undefined,
  artifactId: string | undefined,
  options: ArtifactUpdateOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact update <LUM-42> <artifact> --kind plan'
    )
    return EXIT_USAGE
  }
  if (!artifactId) {
    console.error(
      'Error: missing <artifact>. Usage: lumo task artifact update <LUM-42> <artifact> --kind plan'
    )
    return EXIT_USAGE
  }

  const payload: Record<string, string> = {}
  const kind = options.kind?.trim()
  const title = options.title?.trim()
  const source = options.source?.trim()
  if (options.kind !== undefined) {
    if (!kind) {
      console.error('Error: --kind cannot be empty.')
      return EXIT_USAGE
    }
    payload.kind = kind
  }
  if (options.title !== undefined) {
    if (!title) {
      console.error('Error: --title cannot be empty.')
      return EXIT_USAGE
    }
    payload.title = title
  }
  if (options.source !== undefined) {
    if (!source) {
      console.error('Error: --source cannot be empty.')
      return EXIT_USAGE
    }
    payload.source = source
  }
  if (options.agent !== undefined) {
    const agent = normalizeAgent(options.agent)
    if (!agent) {
      console.error(
        `Error: invalid --agent "${options.agent}". Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
      )
      return EXIT_USAGE
    }
    payload.agent = agent
  }
  if (Object.keys(payload).length === 0) {
    console.error(
      'Error: provide at least one of --kind, --title, --source, or --agent to update.'
    )
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
      `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts/${encodeURIComponent(artifactId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
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
    let serverMsg = `task ${identifier} or artifact ${artifactId} not found in workspace ${creds.workspaceSlug}`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      /* not JSON */
    }
    console.error(`Error: ${sanitizeField(serverMsg)}`)
    return 1
  }
  if (res.status !== 200) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      /* not JSON */
    }
    console.error(
      serverMsg
        ? `Error: ${sanitizeField(serverMsg)}`
        : errHttp('artifact update', res.status)
    )
    return 1
  }

  const data = (await res.json()) as ArtifactResponse
  process.stdout.write(
    `Updated [${sanitizeField(data.artifact.kind)}] "${sanitizeField(data.artifact.title)}" (${sanitizeField(data.artifact.source)}) on ${identifier}\n`
  )
}
