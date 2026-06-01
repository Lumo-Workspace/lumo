import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

export interface ArtifactRmOptions {
  yes?: boolean
}

export async function taskArtifactRm(
  identifier: string | undefined,
  artifactId: string | undefined,
  options: ArtifactRmOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact rm <LUM-42> <artifact-id> --yes'
    )
    return 1
  }
  if (!artifactId) {
    console.error(
      'Error: missing <artifact-id>. Usage: lumo task artifact rm <LUM-42> <artifact-id> --yes'
    )
    return 1
  }
  if (!options.yes) {
    console.error(
      'Error: --yes is required (artifact deletion is irreversible).'
    )
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
      `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts/${encodeURIComponent(artifactId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${creds.token}` },
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
    console.error(`Error: ${sanitizeField(serverMsg)}`)
    return 1
  }
  if (res.status !== 204) {
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
        : `Error: artifact rm failed (HTTP ${res.status})`
    )
    return 1
  }

  process.stdout.write(`Removed ${artifactId} from ${identifier}\n`)
}
