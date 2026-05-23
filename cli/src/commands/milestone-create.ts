import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'

export interface CreateMilestoneOptions {
  project?: string
  description?: string
  start?: string
  target?: string
}

interface CreatePayload {
  name: string
  description?: string
  startDate?: string
  targetDate?: string
}

export function buildCreatePayload(
  name: string,
  opts: CreateMilestoneOptions
): CreatePayload {
  const payload: CreatePayload = { name }
  if (opts.description !== undefined) payload.description = opts.description
  if (opts.start !== undefined) payload.startDate = opts.start
  if (opts.target !== undefined) payload.targetDate = opts.target
  return payload
}

export function formatCreatedMilestoneLine(milestone: {
  id: string
  name: string
}): string {
  return `Created milestone "${milestone.name}"  ${milestone.id}`
}

export async function milestoneCreate(
  name: string,
  opts: CreateMilestoneOptions
): Promise<number | void> {
  if (!name || !name.trim()) {
    console.error('Error: milestone name is required')
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

  let projectId: string
  try {
    projectId = await resolveProjectId(base, creds.token, opts.project)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const payload = buildCreatePayload(name.trim(), opts)
  const res = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Error: milestone create failed (HTTP ${res.status}) ${body}`)
    return 1
  }

  const { milestone } = (await res.json()) as {
    milestone: { id: string; name: string }
  }
  process.stdout.write(formatCreatedMilestoneLine(milestone) + '\n')
}
