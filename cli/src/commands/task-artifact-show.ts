import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { AGENT_LABELS } from '../lib/agent'
import { sanitizeField } from '../lib/sanitize'
import { shortRef } from '../../../shared/src/short-ref'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { refLookupError } from '../lib/ref-error'

interface Artifact {
  id: string
  kind: string
  title: string
  source: string
  agent: string
  order: number
  content: string
  createdAt?: string
  updatedAt?: string
}

export async function taskArtifactShow(
  identifier: string | undefined,
  artifactId: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact show <LUM-42> <artifact>'
    )
    return EXIT_USAGE
  }
  if (!artifactId) {
    console.error(
      'Error: missing <artifact>. Usage: lumo task artifact show <LUM-42> <artifact>'
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
        `could not resolve artifact "${sanitizeField(artifactId)}"`
      )
    )
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
  if (!res.ok) {
    console.error(errHttp('artifact show', res.status))
    return 1
  }

  const { artifact } = (await res.json()) as { artifact: Artifact }
  process.stdout.write(`ref:    ${shortRef(artifact.id)}\n`)
  process.stdout.write(`kind:   ${sanitizeField(artifact.kind)}\n`)
  process.stdout.write(`title:  ${sanitizeField(artifact.title)}\n`)
  process.stdout.write(`source: ${sanitizeField(artifact.source)}\n`)
  process.stdout.write(
    `agent:  ${AGENT_LABELS[artifact.agent] ?? sanitizeField(artifact.agent ?? '')}\n`
  )
  process.stdout.write(`order:  ${artifact.order}\n`)
  process.stdout.write(`task:   ${identifier}\n`)
  process.stdout.write(`\n${sanitizeField(artifact.content)}\n`)
}
