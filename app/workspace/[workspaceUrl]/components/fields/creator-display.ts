import type { ActorInfo, WorkspaceMemberInfo } from '../../types'

/**
 * LUM-1283: how the task detail shows the Actor that created a task.
 * `unrecorded` = no creator on the row (automation, or older than the column);
 * `former-member` = a human actor whose member is no longer listed.
 */
export type CreatorDisplay =
  | { kind: 'agent'; name: string }
  | { kind: 'member'; name: string; imageUrl: string | null }
  | { kind: 'former-member' }
  | { kind: 'unrecorded' }

/** Resolve a task's `createdBy` actor against the workspace member list. */
export function resolveCreatorDisplay(
  createdBy: ActorInfo | null | undefined,
  members: Pick<WorkspaceMemberInfo, 'actorId' | 'name' | 'imageUrl'>[]
): CreatorDisplay {
  if (!createdBy) return { kind: 'unrecorded' }
  if (createdBy.type === 'AGENT') {
    return { kind: 'agent', name: createdBy.agent?.name ?? 'Coding Agent' }
  }
  const member = members.find(m => m.actorId === createdBy.id)
  return member
    ? { kind: 'member', name: member.name, imageUrl: member.imageUrl }
    : { kind: 'former-member' }
}
