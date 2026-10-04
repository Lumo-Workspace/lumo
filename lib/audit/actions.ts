/**
 * LUM-907: the workspace audit log's vocabulary.
 *
 * `action` is stored as text (not a Postgres enum) so adding an action is a
 * code change, not a migration; this list is the enum. Keys are
 * `<area>.<verb>` and never change once shipped — the audit log, its exports
 * and any customer tooling key on them.
 */

/** Days an audit event is kept before the daily prune deletes it (user ruling 2026-10-04: 1 year). */
export const AUDIT_RETENTION_DAYS = 365

export const AUDIT_ACTIONS = [
  // Members and invites
  'member.role_changed',
  'member.left',
  'invite.created',
  'invite.revoked',
  'invite.resent',
  'invite.accepted',
  // Workspace settings
  'workspace.settings_updated',
  'workspace.security_settings_updated',
  'workspace.retention_updated',
  // Data rights
  'workspace.deletion_scheduled',
  'workspace.deletion_cancelled',
  'data_export.requested',
  'data_export.downloaded',
  'ai_derived_content.purged',
  'session_raw_record.deleted',
  // Task templates
  'task_template.created',
  'task_template.updated',
  'task_template.deleted',
  // Integrations
  'github_app.installed',
  'github_app.reverified',
  'github_app.uninstalled',
  'slack.connected',
  'slack.disconnected',
  'sentry.connected',
  'sentry.disconnected',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_TARGET_TYPES = [
  'workspace',
  'member',
  'invite',
  'data_export',
  'session',
  'task_template',
  'integration',
] as const

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}
