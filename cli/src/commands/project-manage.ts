import { readCredentials } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { fetchDirectory, resolveDirectoryMember } from '../lib/directory'
import { resolveProjectId } from '../lib/resolve'

/** LUM-821: `lumo project create` / `lumo project update`. */

interface ProjectRow {
  id: string
  name: string
}

/** `lumo project create <name> [--description]` */
export async function projectCreate(
  name: string,
  opts: { description?: string } = {}
): Promise<number | void> {
  const trimmed = name.trim()
  if (!trimmed) {
    console.error('Error: project name must not be empty')
    return 1
  }
  if (trimmed.length > 200) {
    console.error('Error: project name must be at most 200 characters')
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ project: ProjectRow }>(
    ctx,
    '/api/projects',
    {
      method: 'POST',
      json: {
        name: trimmed,
        ...(opts.description !== undefined
          ? { description: opts.description }
          : {}),
      },
    },
    'project create'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    `Created project "${sanitizeField(r.data.project.name)}"  (${r.data.project.id})\n`
  )
}

export interface ProjectUpdateOptions {
  name?: string
  description?: string
  owner?: string
}

/** `lumo project update <ref> [--name] [--description] [--owner]` */
export async function projectUpdate(
  ref: string,
  opts: ProjectUpdateOptions
): Promise<number | void> {
  const body: Record<string, unknown> = {}
  if (opts.name !== undefined) {
    if (!opts.name.trim()) {
      console.error('Error: --name cannot be empty')
      return 1
    }
    body.name = opts.name.trim()
  }
  if (opts.description !== undefined) {
    body.description = opts.description === '' ? null : opts.description
  }
  if (Object.keys(body).length === 0 && opts.owner === undefined) {
    console.error(
      'Error: provide at least one field to update (--name, --description, --owner)'
    )
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1

  if (opts.owner !== undefined) {
    if (opts.owner === '') {
      body.ownerId = null
    } else {
      // The API takes the owner as an Actor id; resolve the ref locally.
      const dir = await fetchDirectory(ctx)
      if (!dir) return 1
      const creds = readCredentials()
      const hit = resolveDirectoryMember(dir, opts.owner, {
        userId: creds?.userId ?? '',
        email: creds?.email ?? '',
      })
      if (hit.kind !== 'ok') {
        console.error(
          hit.kind === 'ambiguous'
            ? `Error: owner "${opts.owner}" is ambiguous — use an email`
            : `Error: no member matches "${opts.owner}". Try \`lumo member list\`.`
        )
        return 1
      }
      body.ownerId =
        dir.members.find(m => m.memberId === hit.member.memberId)?.actorId ??
        null
    }
  }

  let projectId: string
  try {
    projectId = await resolveProjectId(ctx.base, ctx.token, ref)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  const r = await apiCall<{ project: ProjectRow }>(
    ctx,
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: 'PATCH', json: body },
    'project update'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    `Updated project "${sanitizeField(r.data.project.name)}"\n`
  )
}
