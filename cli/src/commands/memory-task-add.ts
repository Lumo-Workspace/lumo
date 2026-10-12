import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { buildMemoryContent, type MemoryFlags } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { cmd, hint } from '../lib/feedback'

interface AddOptions extends MemoryFlags {
  category?: string
  agent?: string
}

export async function memoryTaskAdd(
  identifierArg: string | undefined,
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

  // Resolve the target: explicit arg > session-bound task.
  const identifier =
    identifierArg ?? (await resolveBoundTaskIdentifier(apiUrl, creds.token))
  if (!identifier) {
    console.error(
      'Error: no <LUM-N> given and no task bound to this session.\n' +
        'Pass it explicitly or run `lumo session attach <LUM-N>`.'
    )
    return 1
  }

  // LUM-N → task id.
  let taskId: string
  try {
    const r = await fetch(
      `${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`,
      {
        headers: { Authorization: `Bearer ${creds.token}` },
      }
    )
    if (r.status === 401) {
      console.error(errAuth())
      return 1
    }
    if (r.status === 404) {
      console.error(
        `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
      )
      return 1
    }
    if (!r.ok) {
      console.error(errHttp('resolve', r.status))
      return 1
    }
    taskId = ((await r.json()) as { id: string }).id
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }

  // POST the memory.
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/memories`,
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

  const boundSuffix = identifierArg ? '' : ' (from bound session)'

  let outcome = 'ADD'
  let memId = ''
  try {
    const b = (await res.json()) as {
      outcome?: string
      memory?: { id?: string }
    }
    if (typeof b.outcome === 'string') outcome = b.outcome
    if (b.memory && typeof b.memory.id === 'string') memId = b.memory.id
  } catch {
    /* keep defaults */
  }

  switch (outcome) {
    case 'NOOP':
      process.stdout.write(
        `Skipped — duplicate of existing memory ${memId}, nothing written${boundSuffix}\n`
      )
      break
    case 'UPDATE':
      process.stdout.write(
        `Merged into existing memory ${memId} (near-duplicate)${boundSuffix}\n`
      )
      break
    case 'SUPERSEDE':
      process.stdout.write(
        `Superseded an existing memory; new version ${memId}${boundSuffix}\n`
      )
      break
    default:
      process.stdout.write(
        `Added ${built.category} memory to ${identifier}${boundSuffix}\n` +
          hint(
            `only useful for this task? If it generalizes, use ${cmd('lumo project memory add')} or ${cmd('lumo memory promote')} later.`
          ) +
          '\n'
      )
  }
}
