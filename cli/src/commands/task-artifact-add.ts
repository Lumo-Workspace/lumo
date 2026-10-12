import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { readFileUtf8, unreadableFileMessage } from '../lib/doc-input'
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'
import { sanitizeField } from '../lib/sanitize'
import { checkArtifactFilePath } from '../lib/path-guard'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

export interface ArtifactAddOptions {
  kind?: string
  title?: string
  file?: string
  source?: string
  agent?: string
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
  const agentRaw = options.agent?.trim()
  if (!agentRaw) {
    console.error(
      `Error: --agent is required. Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
    )
    return 1
  }
  const agent = normalizeAgent(agentRaw)
  if (!agent) {
    console.error(
      `Error: invalid --agent "${agentRaw}". Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
    )
    return 1
  }
  if (!options.file) {
    console.error('Error: --file <path> is required.')
    return 1
  }

  const verdict = checkArtifactFilePath(options.file)
  if (!verdict.ok) {
    if (verdict.reason === 'unreadable') {
      console.error(`Error: ${unreadableFileMessage(options.file)}`)
    } else {
      console.error(
        `Error: refusing to read ${options.file} — ${verdict.detail}. ` +
          `artifact --file must be a non-sensitive path inside the project directory.`
      )
    }
    return 1
  }

  let content: string
  try {
    content = await readFileUtf8(verdict.resolved)
  } catch {
    console.error(`Error: ${unreadableFileMessage(options.file)}`)
    return 1
  }
  if (content.trim().length === 0) {
    console.error(`Error: file ${options.file} is empty.`)
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  const payload: Record<string, string> = {
    kind,
    title,
    content,
    source,
    agent,
  }

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
    console.error(errAuth())
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
        ? `Error: ${sanitizeField(serverMsg)}`
        : errHttp('artifact add', res.status)
    )
    return 1
  }

  const data = (await res.json()) as ArtifactResponse
  process.stdout.write(
    `Added [${sanitizeField(data.artifact.kind)}] "${sanitizeField(data.artifact.title)}" to ${identifier}\n`
  )
}
