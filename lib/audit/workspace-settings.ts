import type { AuditAction } from '@/lib/audit/actions'

/**
 * LUM-907: which workspace-setting columns a settings change audits, and
 * under which action. Values are setting values (names, booleans, day tiers,
 * the security policy), never content.
 */
export const AUDITED_WORKSPACE_SETTINGS = {
  'workspace.settings_updated': [
    'name',
    'slug',
    'summaryEnabled',
    'summaryFrequency',
    'summaryLocale',
  ],
  'workspace.security_settings_updated': [
    'securityPolicy',
    'securityScanEnabled',
    'securityAiReviewEnabled',
    'securityHuntEnabled',
    'aiDerivedContentEnabled',
  ],
  'workspace.retention_updated': [
    'hookEventRetentionMode',
    'hookEventRetentionDays',
    'scanEvidenceRetentionDays',
    'crossingRawRetentionDays',
    'deadLetterRetentionDays',
  ],
} as const satisfies Partial<Record<AuditAction, readonly string[]>>

export type AuditedWorkspaceSetting =
  (typeof AUDITED_WORKSPACE_SETTINGS)[keyof typeof AUDITED_WORKSPACE_SETTINGS][number]

export interface WorkspaceSettingsChange {
  action: keyof typeof AUDITED_WORKSPACE_SETTINGS
  changes: Record<string, { from: unknown; to: unknown }>
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * The audited settings that `next` actually changes relative to `before`,
 * grouped per audit action. Fields absent from `next` are not changes.
 */
export function diffWorkspaceSettings(
  before: Record<string, unknown>,
  next: Record<string, unknown>
): WorkspaceSettingsChange[] {
  const out: WorkspaceSettingsChange[] = []
  for (const [action, fields] of Object.entries(AUDITED_WORKSPACE_SETTINGS)) {
    const changes: WorkspaceSettingsChange['changes'] = {}
    for (const field of fields) {
      if (!(field in next) || next[field] === undefined) continue
      if (same(before[field], next[field])) continue
      changes[field] = { from: before[field] ?? null, to: next[field] ?? null }
    }
    if (Object.keys(changes).length > 0) {
      out.push({
        action: action as WorkspaceSettingsChange['action'],
        changes,
      })
    }
  }
  return out
}
