import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { computeMoveOrder, type MilestoneRef } from '../lib/milestone-reorder'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export interface MoveMilestoneOptions {
  project?: string | undefined
  before?: string | undefined
  after?: string | undefined
}

interface MilestoneListRow {
  id: string
  name: string
  sortOrder: number
}

export async function milestoneMove(
  reference: string | undefined,
  opts: MoveMilestoneOptions
): Promise<number | void> {
  if (!reference) {
    console.error(
      'Error: usage: lumo milestone move <ref> --before <ref> | --after <ref>'
    )
    return 1
  }
  const hasBefore = typeof opts.before === 'string' && opts.before.length > 0
  const hasAfter = typeof opts.after === 'string' && opts.after.length > 0
  if (hasBefore && hasAfter) {
    console.error('Error: --before and --after are mutually exclusive')
    return 1
  }
  if (!hasBefore && !hasAfter) {
    console.error('Error: specify --before <ref> or --after <ref>')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  try {
    projectId = await resolveProjectId(base, creds.token, opts.project)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const listRes = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!listRes.ok) {
    console.error(errHttp('milestone list', listRes.status))
    return 1
  }
  const { milestones } = (await listRes.json()) as {
    milestones: MilestoneListRow[]
  }
  const refRows: MilestoneRef[] = milestones.map(m => ({
    id: m.id,
    name: m.name,
    sortOrder: m.sortOrder,
  }))

  const position: 'before' | 'after' = hasBefore ? 'before' : 'after'
  const targetRef = (hasBefore ? opts.before : opts.after) as string
  const resolved = computeMoveOrder(reference, targetRef, position, refRows)
  if (!resolved.ok) {
    console.error(`Error: ${resolved.error}`)
    return 1
  }

  const patchRes = await fetch(
    `${base}/api/projects/${projectId}/milestones/reorder`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderedIds: resolved.orderedIds }),
    }
  )
  if (!patchRes.ok) {
    const text = await patchRes.text()
    let msg = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) msg = json.error
    } catch {}
    console.error(errHttp('milestone move', patchRes.status, msg))
    return 1
  }

  const byId = new Map(refRows.map(m => [m.id, m.name]))
  console.log(
    `Moved "${sanitizeField(reference)}" ${position} "${sanitizeField(targetRef)}". New order:`
  )
  resolved.orderedIds.forEach((id, i) => {
    console.log(`  ${i + 1}. ${sanitizeField(byId.get(id) ?? id)}`)
  })
}
