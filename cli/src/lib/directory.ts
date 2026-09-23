import { apiCall, type ApiContext } from './test-case-api'
import { resolveMember, type MemberRow } from './resolve-member'

/**
 * LUM-821: the workspace directory (humans + agent actors) as the CLI needs
 * it for filtering and display — keyed by Actor id, because tasks point at
 * `assigneeActorId`, not at WorkspaceMember ids.
 */

export interface DirectoryMember extends MemberRow {
  actorId: string | null
  role: string
}

export interface DirectoryAgent {
  actorId: string
  name: string
  type: string
}

export interface Directory {
  members: DirectoryMember[]
  agents: DirectoryAgent[]
}

interface MembersResponse {
  members: Array<{
    id: string
    name: string
    email: string | null
    role: string
    actorId: string | null
  }>
  agentActors?: Array<{ actorId: string; name: string; type: string }>
}

/** Fetch the directory; null means the error was already printed. */
export async function fetchDirectory(
  ctx: ApiContext
): Promise<Directory | null> {
  const r = await apiCall<MembersResponse>(
    ctx,
    '/api/workspaces/members',
    {},
    'member list'
  )
  if (!r.ok || !r.data) return null
  return {
    members: r.data.members.map(m => ({
      memberId: m.id,
      displayName: m.name,
      email: m.email,
      actorId: m.actorId,
      role: m.role,
    })),
    agents: (r.data.agentActors ?? []).map(a => ({
      actorId: a.actorId,
      name: a.name,
      type: a.type,
    })),
  }
}

/** actorId → display name, for rendering assignee columns. */
export function actorNameMap(dir: Directory): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of dir.members) {
    if (m.actorId) map.set(m.actorId, m.displayName)
  }
  for (const a of dir.agents) map.set(a.actorId, a.name)
  return map
}

export type AssigneeResolution =
  | { ok: true; actorIds: string[]; unassigned: boolean }
  | { ok: false; error: string }

/**
 * Resolve `--assignee` refs (`me`, email, member name, agent name, or
 * `none` for unassigned) to Actor ids. Pure — the directory is passed in.
 */
export function resolveAssigneeRefs(
  refs: string[],
  dir: Directory,
  myEmail: string
): AssigneeResolution {
  const actorIds: string[] = []
  let unassigned = false
  for (const ref of refs) {
    const trimmed = ref.trim()
    if (trimmed.toLowerCase() === 'none') {
      unassigned = true
      continue
    }
    const hit = resolveMember(dir.members, trimmed, myEmail)
    if (hit.kind === 'ok') {
      const actorId = (hit.member as DirectoryMember).actorId
      if (!actorId) {
        return { ok: false, error: `member "${ref}" has no actor yet` }
      }
      actorIds.push(actorId)
      continue
    }
    if (hit.kind === 'ambiguous') {
      const names = hit.candidates
        .map(c => `${c.displayName}${c.email ? ` <${c.email}>` : ''}`)
        .join(', ')
      return {
        ok: false,
        error: `assignee "${ref}" is ambiguous: ${names}. Use an email.`,
      }
    }
    const agents = dir.agents.filter(
      a => a.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (agents.length === 1) {
      actorIds.push(agents[0]!.actorId)
      continue
    }
    return {
      ok: false,
      error: `no member or agent matches "${ref}". Try \`lumo member list\`.`,
    }
  }
  return { ok: true, actorIds: [...new Set(actorIds)], unassigned }
}
