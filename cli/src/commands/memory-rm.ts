import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { resolveSessionId } from '../lib/session-id'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { REF_ERROR_STATUSES, refLookupError } from '../lib/ref-error'
import { shortRef } from '../../../shared/src/short-ref'

type RmOptions = ConfirmFlags

const SUMMARY_MAX = 120

/**
 * One-line summary of a memory's structured content for the envelope: the
 * first string field (memory cards lead with their headline field), trimmed.
 */
export function summarizeMemoryContent(content: unknown): string | null {
  if (typeof content === 'string') return truncate(content)
  if (content && typeof content === 'object') {
    for (const value of Object.values(content as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) return truncate(value)
    }
  }
  return null
}

function truncate(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat
}

/** The changes[] block for the confirmation envelope. */
export function describeMemoryRm(memory: {
  id: string
  category: string
  content: unknown
}): string[] {
  const lines = [
    `Will hard-delete memory ${shortRef(memory.id)} [${memory.category}]`,
  ]
  const summary = summarizeMemoryContent(memory.content)
  if (summary) lines.push(`Content: ${summary}`)
  lines.push('The memory is removed for the whole team; there is no undo')
  return lines.map(l => sanitizeField(l))
}

export async function memoryRm(
  memoryId: string | undefined,
  options: RmOptions
): Promise<number | void> {
  if (!memoryId) {
    console.error(
      'Error: missing <memory>. Usage: lumo memory rm <memory> --confirm'
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
  const url = `${base}/api/memories/${encodeURIComponent(memoryId)}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  // LUM-793: the server attributes a used-TRAP deletion to the task this
  // session is attached to — without the header it can prove no binding and
  // records nothing.
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
  // LUM-1230: the server resolves a short ref / unique prefix and explains a
  // miss or an ambiguous ref; this is the fallback for an older server.
  const notFound = `memory ${sanitizeField(memoryId)} not found — pass the ref shown by \`lumo task memory list\` / \`lumo project memory list\``

  // LUM-755: without --confirm, fetch the card so the envelope shows what
  // would be deleted, then stop — no DELETE is sent.
  if (!isConfirmed(options)) {
    let showRes: Response
    try {
      showRes = await fetch(url, { headers })
    } catch (err) {
      console.error(
        `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
      )
      return 1
    }
    if (showRes.status === 401) {
      console.error(errAuth())
      return 1
    }
    if (REF_ERROR_STATUSES.has(showRes.status)) {
      console.error(await refLookupError(showRes, notFound))
      return 1
    }
    if (!showRes.ok) {
      console.error(errHttp('memory lookup', showRes.status))
      return 1
    }
    const { memory } = (await showRes.json()) as {
      memory: { id: string; category: string; content: unknown }
    }
    return emitConfirmation({
      command: 'memory rm',
      changes: describeMemoryRm(memory),
    })
  }

  let res: Response
  try {
    res = await fetch(url, { method: 'DELETE', headers })
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }
  if (REF_ERROR_STATUSES.has(res.status)) {
    console.error(await refLookupError(res, notFound))
    return 1
  }
  if (res.status !== 204) {
    console.error(errHttp('delete', res.status))
    return 1
  }
  process.stdout.write(`Deleted memory ${sanitizeField(memoryId)}\n`)
}
