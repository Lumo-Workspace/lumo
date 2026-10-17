import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { shortRef } from '../../../shared/src/short-ref'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { errAuth, errHttp, errNotLoggedIn, httpFailed } from '../lib/errors'

export type ArtifactRmOptions = ConfirmFlags

interface ArtifactSummary {
  id: string
  kind: string
  title: string
}

/** Best-effort `{ error }` extraction, else null. */
async function serverError(res: Response): Promise<string | null> {
  try {
    const errBody = (await res.json()) as { error?: string }
    return typeof errBody.error === 'string' ? errBody.error : null
  } catch {
    return null
  }
}

/** The changes[] block for the confirmation envelope. */
export function describeArtifactRm(
  identifier: string,
  artifact: ArtifactSummary
): string[] {
  const title = sanitizeField(artifact.title).replace(/"/g, '\\"')
  return [
    `Will delete artifact ${shortRef(artifact.id)} "${title}" (${artifact.kind}) from ${identifier}`,
    'Artifact deletion is irreversible',
  ]
}

export async function taskArtifactRm(
  identifier: string | undefined,
  artifactId: string | undefined,
  options: ArtifactRmOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact rm <LUM-42> <artifact> --confirm'
    )
    return EXIT_USAGE
  }
  if (!artifactId) {
    console.error(
      'Error: missing <artifact>. Usage: lumo task artifact rm <LUM-42> <artifact> --confirm'
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
  const url = `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts/${encodeURIComponent(artifactId)}`
  const headers = { Authorization: `Bearer ${creds.token}` }

  // LUM-755: without --confirm, look the artifact up so the envelope names
  // what would be deleted, then stop — no DELETE is sent.
  if (!isConfirmed(options)) {
    let showRes: Response
    try {
      showRes = await fetch(url, { headers })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
      return 1
    }
    if (showRes.status === 401) {
      console.error(errAuth())
      return 1
    }
    if (!showRes.ok) {
      const msg =
        (await serverError(showRes)) ??
        (showRes.status === 404
          ? `task ${identifier} or artifact ${artifactId} not found in workspace ${creds.workspaceSlug}`
          : httpFailed('artifact lookup', showRes.status))
      console.error(`Error: ${sanitizeField(msg)}`)
      return 1
    }
    const { artifact } = (await showRes.json()) as { artifact: ArtifactSummary }
    return emitConfirmation({
      command: 'task artifact rm',
      changes: describeArtifactRm(identifier, artifact),
    })
  }

  let res: Response
  try {
    res = await fetch(url, { method: 'DELETE', headers })
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
    const serverMsg =
      (await serverError(res)) ??
      `task ${identifier} or artifact ${artifactId} not found in workspace ${creds.workspaceSlug}`
    console.error(`Error: ${sanitizeField(serverMsg)}`)
    return 1
  }
  if (res.status !== 204) {
    const serverMsg = await serverError(res)
    console.error(
      serverMsg
        ? `Error: ${sanitizeField(serverMsg)}`
        : errHttp('artifact rm', res.status)
    )
    return 1
  }

  process.stdout.write(`Removed ${artifactId} from ${identifier}\n`)
}
