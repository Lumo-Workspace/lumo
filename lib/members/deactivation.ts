/**
 * LUM-906 PR2 — soft deactivation of workspace members.
 *
 * Removing a member, leaving a workspace and identity-provider
 * deprovisioning never delete the WorkspaceMember row: 11 RESTRICT foreign
 * keys reference it (projects, documents, revisions, links…) and a delete
 * cascaded the member's sessions and hook events. Instead the row gets
 * `deactivatedAt` + `deactivationReason`, their API keys are revoked and
 * their team memberships dropped, and every membership lookup filters on
 * ACTIVE_MEMBER. A re-invite reactivates the same row.
 */
export const MEMBER_DEACTIVATION_REASONS = [
  'REMOVED',
  'LEFT',
  'CLERK_USER_DELETED',
  'CLERK_USER_BANNED',
  // LUM-1071: Better Auth mode — an operator banned / removed the user
  // (lib/services/auth-user-admin.service.ts). The CLERK_* values stay for
  // historical rows and the Clerk webhook.
  'AUTH_USER_DELETED',
  'AUTH_USER_BANNED',
] as const

export type MemberDeactivationReason =
  (typeof MEMBER_DEACTIVATION_REASONS)[number]

/** Prisma `where` fragment: only members who still belong to the workspace. */
export const ACTIVE_MEMBER = { deactivatedAt: null } as const
