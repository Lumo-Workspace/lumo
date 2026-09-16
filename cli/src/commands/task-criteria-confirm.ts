import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitConfirmation, isConfirmed } from '../lib/confirmation'

interface CriterionRow {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  confirmedAt: string | null
}

export interface CriteriaConfirmOptions {
  confirm?: boolean | undefined
  yes?: boolean | undefined
}

/**
 * `lumo task criteria confirm <task> [--confirm]`
 *
 * 记录人对验收合同的一次性确认（LUM-789）。这是 gated mutation：不带
 * `--confirm` 时打确认信封并 exit 4，**写入为零**；agent 把 changes 逐条念给
 * 用户，用户批准后才跑信封里的 confirmCommand。`--confirm` 的含义是「用户已
 * 确认」，agent 不得自行添加。
 */
export async function taskCriteriaConfirm(
  identifier: string | undefined,
  options: CriteriaConfirmOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task criteria confirm <LUM-42>'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers = { Authorization: `Bearer ${creds.token}` }

  let listRes: Response
  try {
    listRes = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/criteria`,
      { headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${base} (${msg})`)
    return 1
  }
  if (listRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (listRes.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!listRes.ok) {
    console.error(`Error: could not read the contract (HTTP ${listRes.status})`)
    return 1
  }
  const { criteria } = (await listRes.json()) as { criteria: CriterionRow[] }
  if (criteria.length === 0) {
    console.error(
      `Error: ${identifier} has no acceptance criteria — nothing to confirm.`
    )
    return 1
  }

  if (!isConfirmed(options)) {
    const pending = criteria.filter(c => c.confirmedAt == null)
    return emitConfirmation({
      command: 'task criteria confirm',
      changes: [
        `Will record YOUR confirmation of the acceptance contract on ${identifier}`,
        `${pending.length} of ${criteria.length} criteria are not yet confirmed`,
        ...criteria.map(
          c =>
            `  [${c.verifierType}] ${sanitizeField(c.statement)}${c.confirmedAt ? ' (already confirmed)' : ''}`
        ),
        'Confirming does NOT close the task and never blocks DONE — it records that a human agreed to what "done" means here',
        'To change the contract instead, run `lumo task criteria set <task> --file <criteria.json> --human`',
      ],
    })
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/criteria/confirm`,
      { method: 'POST', headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${base} (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status !== 201) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    const detail =
      typeof body?.error === 'string' ? sanitizeField(body.error) : ''
    console.error(
      `Error: confirm failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }
  const { confirmedCount } = (await res.json()) as { confirmedCount: number }
  process.stdout.write(
    `Confirmed the acceptance contract on ${identifier} (${confirmedCount} criteri${confirmedCount === 1 ? 'on' : 'a'} newly confirmed)\n`
  )
}
