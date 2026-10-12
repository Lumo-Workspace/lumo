import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveProjectId } from '../lib/resolve'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

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
  return `Created milestone "${sanitizeField(milestone.name)}"  ${milestone.id}`
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

  const payload = buildCreatePayload(name.trim(), opts)

  let res: Response
  try {
    res = await fetch(`${base}/api/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }

  if (!res.ok) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // Body wasn't JSON; fall through to status-only message
    }
    if (serverMsg) {
      console.error(`Error: ${sanitizeField(serverMsg)}`)
    } else {
      console.error(errHttp('milestone create', res.status))
    }
    return 1
  }

  const { milestone } = (await res.json()) as {
    milestone: { id: string; name: string }
  }
  process.stdout.write(formatCreatedMilestoneLine(milestone) + '\n')
}
