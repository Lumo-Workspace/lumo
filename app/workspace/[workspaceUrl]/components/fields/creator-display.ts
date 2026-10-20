import type { WorkspaceMemberInfo } from '../../types'

/**
 * LUM-1283: how the task detail shows the member that created a task. The
 * creator is always a user, never an agent.
 * `unrecorded` = no creator on the row (automation, or older than the column);
 * `former-member` = a creator who is no longer in the member list.
 */
export type CreatorDisplay =
  | { kind: 'member'; name: string; imageUrl: string | null }
  | { kind: 'former-member' }
  | { kind: 'unrecorded' }

/** Resolve a task's `createdBy` member against the workspace member list. */
export function resolveCreatorDisplay(
  createdBy: { id: string } | null | undefined,
  members: Pick<WorkspaceMemberInfo, 'id' | 'name' | 'imageUrl'>[]
): CreatorDisplay {
  if (!createdBy) return { kind: 'unrecorded' }
  const member = members.find(m => m.id === createdBy.id)
  return member
    ? { kind: 'member', name: member.name, imageUrl: member.imageUrl }
    : { kind: 'former-member' }
}
