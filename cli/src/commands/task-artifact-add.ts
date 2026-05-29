import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { readFileUtf8 } from '../lib/doc-input'

export interface ArtifactAddOptions {
  kind?: string
  title?: string
  file?: string
  source?: string
}

interface ArtifactResponse {
  artifact: { id: string; kind: string; title: string }
}

export async function taskArtifactAdd(
  identifier: string | undefined,
  options: ArtifactAddOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact add <LUM-42> --kind spec --title "Spec" --file spec.md --source Superpowers'
    )
    return 1
  }
  const kind = options.kind?.trim()
  const title = options.title?.trim()
  const source = options.source?.trim()
  if (!kind) {
    console.error('Error: --kind is required and cannot be empty.')
    return 1
  }
  if (!title) {
    console.error('Error: --title is required and cannot be empty.')
    return 1
  }
  if (!source) {
    console.error(
      'Error: --source is required (the spec-gen framework, formal name e.g. Superpowers, "Spec Kit", BMad, OpenSpec, GSD).'
    )
    return 1
  }
  if (!options.file) {
    console.error('Error: --file <path> is required.')
    return 1
  }

  let content: string
  try {
    content = await readFileUtf8(options.file)
  } catch {
    console.error(`Error: could not read file ${options.file}`)
    return 1
  }
  if (content.trim().length === 0) {
    console.error(`Error: file ${options.file} is empty.`)
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

  const payload: Record<string, string> = { kind, title, content, source }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts`,
      {
        method: 'POST',
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
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (res.status !== 201) {
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
        : `Error: artifact add failed (HTTP ${res.status})`
    )
    return 1
  }

  const data = (await res.json()) as ArtifactResponse
  process.stdout.write(
    `Added [${data.artifact.kind}] "${data.artifact.title}" to ${identifier}\n`
  )
}
