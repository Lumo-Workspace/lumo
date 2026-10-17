import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { resolveOrderedIds, type MilestoneRef } from '../lib/milestone-reorder'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export interface ReorderMilestoneOptions {
  project?: string | undefined
}

interface MilestoneListRow {
  id: string
  name: string
  sortOrder: number
  slug?: string | null
}

export async function milestoneReorder(
  refs: string[],
  opts: ReorderMilestoneOptions
): Promise<number | void> {
  if (!refs || refs.length === 0) {
    console.error(
      'Error: usage: lumo milestone reorder <ref...> [--project <ref>]'
    )
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
    slug: m.slug ?? null,
  }))

  const resolved = resolveOrderedIds(refs, refRows)
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
    console.error(errHttp('milestone reorder', patchRes.status, msg))
    return 1
  }

  const byId = new Map(refRows.map(m => [m.id, m.name]))
  console.log(`Reordered ${resolved.orderedIds.length} milestones:`)
  resolved.orderedIds.forEach((id, i) => {
    console.log(`  ${i + 1}. ${sanitizeField(byId.get(id) ?? id)}`)
  })
}
