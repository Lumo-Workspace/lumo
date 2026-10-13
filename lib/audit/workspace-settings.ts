import type { AuditAction } from '@/lib/audit/actions'

/**
 * LUM-907: which workspace-setting columns a settings change audits, and
 * under which action. Values are setting values (names, booleans, day tiers,
 * policies), never content.
 *
 * These are the core's columns. A plugin that owns workspace columns
 * (`workspaceSettings`, LUM-1062) adds its own under the same actions
 * (LUM-1065; see `auditedWorkspaceSettings` in lib/plugins/workspace-settings.ts).
 */
export const AUDITED_WORKSPACE_SETTINGS = {
  'workspace.settings_updated': [
    'name',
    'slug',
    'summaryEnabled',
    'summaryFrequency',
    'summaryLocale',
    'defaultLocale',
  ],
  'workspace.security_settings_updated': ['aiDerivedContentEnabled'],
  'workspace.retention_updated': [
    'hookEventRetentionMode',
    'hookEventRetentionDays',
    'crossingRawRetentionDays',
    'deadLetterRetentionDays',
  ],
} as const satisfies Partial<Record<AuditAction, readonly string[]>>

export type WorkspaceSettingsAuditAction =
  keyof typeof AUDITED_WORKSPACE_SETTINGS

/** Audited columns per action (the core's, or the core's plus plugins'). */
export type AuditedWorkspaceSettings = Readonly<
  Partial<Record<WorkspaceSettingsAuditAction, readonly string[]>>
>

export interface WorkspaceSettingsChange {
  action: WorkspaceSettingsAuditAction
  changes: Record<string, { from: unknown; to: unknown }>
}

/** Every column of an audited-settings map. */
export function auditedColumns(audited: AuditedWorkspaceSettings): string[] {
  return [...new Set(Object.values(audited).flat())]
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
  next: Record<string, unknown>,
  audited: AuditedWorkspaceSettings = AUDITED_WORKSPACE_SETTINGS
): WorkspaceSettingsChange[] {
  const out: WorkspaceSettingsChange[] = []
  for (const [action, fields] of Object.entries(audited)) {
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
