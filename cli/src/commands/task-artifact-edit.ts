import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

export interface ArtifactEditOptions {
  kind?: string
  title?: string
  source?: string
}

interface ArtifactResponse {
  artifact: { id: string; kind: string; title: string; source: string }
}

export async function taskArtifactEdit(
  identifier: string | undefined,
  artifactId: string | undefined,
  options: ArtifactEditOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact edit <LUM-42> <artifact-id> --kind plan'
    )
    return 1
  }
  if (!artifactId) {
    console.error(
      'Error: missing <artifact-id>. Usage: lumo task artifact edit <LUM-42> <artifact-id> --kind plan'
    )
    return 1
  }

  const payload: Record<string, string> = {}
  const kind = options.kind?.trim()
  const title = options.title?.trim()
  const source = options.source?.trim()
  if (options.kind !== undefined) {
    if (!kind) {
      console.error('Error: --kind cannot be empty.')
      return 1
    }
    payload.kind = kind
  }
  if (options.title !== undefined) {
    if (!title) {
      console.error('Error: --title cannot be empty.')
      return 1
    }
    payload.title = title
  }
  if (options.source !== undefined) {
    if (!source) {
      console.error('Error: --source cannot be empty.')
      return 1
    }
    payload.source = source
  }
  if (Object.keys(payload).length === 0) {
    console.error(
      'Error: provide at least one of --kind, --title, or --source to edit.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
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
    console.error(`Error: ${serverMsg}`)
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
        ? `Error: ${serverMsg}`
        : `Error: artifact edit failed (HTTP ${res.status})`
    )
    return 1
  }

  const data = (await res.json()) as ArtifactResponse
  process.stdout.write(
    `Updated [${data.artifact.kind}] "${data.artifact.title}" (${data.artifact.source}) on ${identifier}\n`
  )
}
