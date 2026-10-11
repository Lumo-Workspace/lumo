/**
 * LUM-1072 — every place a user (Clerk / Better Auth) id is stored.
 *
 * `USER_ID_COLUMNS` = the 11 columns of RFC LUM-1069 appendix A (derived from
 * prisma/schema.prisma; __tests__/auth-migration/identity-columns.test.ts
 * re-runs that derivation so a new column cannot be missed) plus
 * `PriorityOverride.memberId`, whose name hides that it stores the user id
 * (RFC §1.2). `MENTION_COLUMNS` = rich-text columns whose @mentions carry the
 * user id in `data-id` (lib/editor/parse-mentions.ts).
 *
 * `softDelete`: Task / Document rows in the trash are hidden from default
 * reads by lib/db/soft-delete; these columns must still be read and rewritten.
 */
export interface IdColumn {
  /** Prisma client delegate name. */
  model: string
  field: string
  /** Extra filter: only rows where this holds store a user id. */
  where?: Record<string, unknown>
  softDelete?: boolean
}

export const USER_ID_COLUMNS: readonly IdColumn[] = [
  { model: 'workspaceMember', field: 'clerkId' },
  { model: 'mcpConnection', field: 'clerkUserId' },
  { model: 'mcpAuditLog', field: 'clerkUserId' },
  // Only MEMBER events carry a user id; AGENT / SYSTEM actorIds are not.
  { model: 'auditEvent', field: 'actorId', where: { actorType: 'MEMBER' } },
  { model: 'subprocessorNoticeDelivery', field: 'clerkId' },
  { model: 'task', field: 'deletedByClerkId', softDelete: true },
  { model: 'document', field: 'deletedByClerkId', softDelete: true },
  { model: 'workspace', field: 'deletionRequestedByClerkId' },
  { model: 'workspaceDeletionReceipt', field: 'requestedByClerkId' },
  { model: 'workspaceExport', field: 'requestedByClerkId' },
  { model: 'workspaceExport', field: 'lastDownloadedByClerkId' },
  // RFC §1.2: written from requireAuth().userId despite the name.
  { model: 'priorityOverride', field: 'memberId' },
]

export const MENTION_COLUMNS: readonly IdColumn[] = [
  { model: 'comment', field: 'body' },
  { model: 'task', field: 'description', softDelete: true },
  { model: 'document', field: 'content', softDelete: true },
  { model: 'documentRevision', field: 'content' },
  { model: 'documentComment', field: 'body' },
  { model: 'project', field: 'description' },
  { model: 'milestone', field: 'description' },
]

/** `Model.field` label for reports. */
export function columnLabel(c: IdColumn): string {
  return `${c.model[0]!.toUpperCase()}${c.model.slice(1)}.${c.field}`
}
