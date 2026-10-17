import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { buildMemoryContent, type MemoryFlags } from '../lib/memory-content'
import { resolveProjectId } from '../lib/resolve'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { shortRef } from '../../../shared/src/short-ref'

interface AddOptions extends MemoryFlags {
  category?: string
  agent?: string
}

export async function memoryProjectAdd(
  refArg: string | undefined,
  options: AddOptions
): Promise<number | void> {
  if (!options.category) {
    console.error(
      'Error: --category <trap|decision|convention|procedural> is required.'
    )
    return 1
  }
  const built = buildMemoryContent(options.category, options)
  if (!built.ok) {
    console.error(`Error: ${built.error}`)
    return 1
  }

  let agent: string | undefined
  const agentRaw = options.agent?.trim()
  if (agentRaw) {
    const normalized = normalizeAgent(agentRaw)
    if (!normalized) {
      console.error(
        `Error: invalid --agent "${agentRaw}". Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
      )
      return 1
    }
    agent = normalized
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  let echoSuffix = ''
  if (refArg) {
    projectId = await resolveProjectId(base, creds.token, refArg)
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) {
      console.error(
        'Error: no <project-ref> given and no task bound to this session.\nPass a project, or run `lumo session attach <LUM-N>`.'
      )
      return 1
    }
    const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
    if (!r.ok) {
      console.error(`Error: ${r.error}`)
      return 1
    }
    projectId = r.id
    echoSuffix = ` (project of bound task ${bound})`
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/memories`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: built.category,
          content: built.content,
          ...(agent ? { agent } : {}),
        }),
      }
    )
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }
  if (res.status !== 201) {
    let m: string | null = null
    try {
      const b = (await res.json()) as { error?: string }
      if (typeof b.error === 'string') m = b.error
    } catch {
      /* */
    }
    console.error(
      m ? `Error: ${sanitizeField(m)}` : errHttp('memory add', res.status)
    )
    return 1
  }
  let outcome = 'ADD'
  let memId = ''
  try {
    const b = (await res.json()) as {
      outcome?: string
      memory?: { id?: string }
    }
    if (typeof b.outcome === 'string') outcome = b.outcome
    // LUM-1230: print the 8-char short ref, never the bare cuid.
    if (b.memory && typeof b.memory.id === 'string')
      memId = shortRef(b.memory.id)
  } catch {
    /* keep defaults */
  }

  switch (outcome) {
    case 'NOOP':
      process.stdout.write(
        `Skipped — duplicate of existing memory ${memId}, nothing written${echoSuffix}\n`
      )
      break
    case 'UPDATE':
      process.stdout.write(
        `Merged into existing memory ${memId} (near-duplicate)${echoSuffix}\n`
      )
      break
    case 'SUPERSEDE':
      process.stdout.write(
        `Superseded an existing memory; new version ${memId}${echoSuffix}\n`
      )
      break
    default:
      process.stdout.write(
        `Added ${built.category} PROJECT memory${echoSuffix}\n`
      )
  }
}
