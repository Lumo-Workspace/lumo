import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { buildMemoryContent, type MemoryFlags } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'

interface AddOptions extends MemoryFlags {
  category?: string
}

export async function memoryTaskAdd(
  identifierArg: string | undefined,
  options: AddOptions
): Promise<number | void> {
  if (!options.category) {
    console.error('Error: --category <trap|decision|convention|procedural> is required.')
    return 1
  }
  const built = buildMemoryContent(options.category, options)
  if (!built.ok) {
    console.error(`Error: ${built.error}`)
    return 1
  }

  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  // Resolve the target: explicit arg > session-bound task.
  const identifier = identifierArg ?? (await resolveBoundTaskIdentifier(apiUrl, creds.token))
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
    const r = await fetch(`${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (r.status === 401) { console.error('Error: API key invalid or revoked. Run `lumo auth login`.'); return 1 }
    if (r.status === 404) { console.error(`Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`); return 1 }
    if (!r.ok) { console.error(`Error: resolve failed (HTTP ${r.status})`); return 1 }
    taskId = ((await r.json()) as { id: string }).id
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }

  // POST the memory.
  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/${encodeURIComponent(taskId)}/memories`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: built.category, content: built.content }),
    })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (res.status !== 201) {
    let m: string | null = null
    try { const b = (await res.json()) as { error?: string }; if (typeof b.error === 'string') m = b.error } catch { /* */ }
    console.error(m ? `Error: ${m}` : `Error: memory add failed (HTTP ${res.status})`)
    return 1
  }

  process.stdout.write(
    `Added ${built.category} memory to ${identifier}` +
      `${identifierArg ? '' : ' (from bound session)'}\n` +
      'Tip: only useful for this task? If it generalizes, use `lumo project memory add` or `lumo memory promote` later.\n'
  )
}
