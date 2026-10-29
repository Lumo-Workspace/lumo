/**
 * LUM-1062 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §3.4 设置页,
 * §4 option A) — the core side of the `workspaceSettings` extension point.
 *
 * Every `Workspace` column is either the core's (listed below) or owned by an
 * installed plugin. `GET /api/workspaces/me` serves the core columns plus the
 * owned ones; `PATCH /api/workspaces/me` validates owned columns with the
 * plugin's validators and writes them in the same update as the core
 * settings. A column nobody owns — a plugin's column on a server without that
 * plugin — is neither served nor accepted (400).
 */
import {
  AUDITED_WORKSPACE_SETTINGS,
  type AuditedWorkspaceSettings,
  type WorkspaceSettingsAuditAction,
} from '@/lib/audit/workspace-settings'
import { WORKSPACE_COLUMNS } from '@/lib/repositories/workspace-columns'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import { getPluginRegistry } from './registry'
import type { WorkspaceSettingsContributor } from './types'

/** The `Workspace` columns the core itself owns and serves. */
export const CORE_WORKSPACE_COLUMNS: readonly string[] = [
  'id',
  'name',
  'slug',
  'logoUrl',
  'documentSeq',
  'crossingSeq',
  'feedbackSeq',
  'createdAt',
  'updatedAt',
  'summaryFrequency',
  'summaryEnabled',
  'defaultLocale',
  'boundaryGateEnabled',
  'hookEventRetentionDays',
  'hookEventRetentionMode',
  'hookEventRetentionSince',
  'hookEventRetentionLegacyDays',
  'crossingRawRetentionDays',
  'crossingRawRetentionSince',
  'deadLetterRetentionDays',
  'aiDerivedContentEnabled',
  'aiFeatureSwitches',
  'deletionRequestedAt',
  'deletionExecuteAt',
  'deletionRequestedByClerkId',
]

type ColumnValidators = WorkspaceSettingsContributor['columns']

/**
 * The validators of every plugin-owned column, merged. Throws when two
 * plugins claim the same column, or a plugin claims a core column.
 */
export function pluginWorkspaceColumns(): ColumnValidators {
  const merged: ColumnValidators = {}
  for (const c of getPluginRegistry().workspaceSettings) {
    for (const [column, validator] of Object.entries(c.columns)) {
      if (CORE_WORKSPACE_COLUMNS.includes(column) || column in merged)
        throw new Error(
          `workspace setting "${column}" (plugin ${c.key}) is already owned`
        )
      merged[column] = validator
    }
  }
  return merged
}

/** PATCH /api/workspaces/me: the core settings plus every owned column. */
export function workspaceSettingsUpdateSchema() {
  return updateWorkspaceSchema.extend(pluginWorkspaceColumns())
}

/** The workspace row as the settings API serves it: core + owned columns. */
export function serializeWorkspaceSettings(
  row: Record<string, unknown>
): Record<string, unknown> {
  const served = new Set([
    ...CORE_WORKSPACE_COLUMNS,
    ...Object.keys(pluginWorkspaceColumns()),
  ])
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => served.has(column))
  )
}

/**
 * Extra top-level `GET /api/workspaces/me` fields from every plugin. A field
 * named like one of the core's (`coreFields`) is dropped: a plugin can add to
 * the response, never replace part of it.
 */
export function pluginMeFields(
  coreFields: readonly string[] = [],
  workspaceId: string | null = null
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const c of getPluginRegistry().workspaceSettings) {
    for (const [key, value] of Object.entries(
      c.meFields?.({ workspaceId }) ?? {}
    )) {
      if (!coreFields.includes(key) && key !== '__proto__') fields[key] = value
    }
  }
  return fields
}

/**
 * Keys of a settings write that name a `Workspace` column no one on this
 * server owns. Keys that are not columns at all keep being dropped by the
 * schema, as before.
 */
export function unownedWorkspaceColumns(
  body: Record<string, unknown>
): string[] {
  const owned = pluginWorkspaceColumns()
  return Object.keys(body).filter(
    key =>
      WORKSPACE_COLUMNS.includes(key) &&
      !CORE_WORKSPACE_COLUMNS.includes(key) &&
      !(key in owned)
  )
}

/** The plugin-owned column writes of a validated settings update. */
export function pluginWorkspaceWrites(
  input: Record<string, unknown>
): Record<string, unknown> {
  const owned = pluginWorkspaceColumns()
  return Object.fromEntries(
    Object.entries(input).filter(
      ([column, value]) => column in owned && value !== undefined
    )
  )
}

/**
 * LUM-1065: the audited settings columns — the core's plus every installed
 * plugin's `audit` columns, under the same actions. A plugin may only audit
 * columns it owns.
 */
export function auditedWorkspaceSettings(): AuditedWorkspaceSettings {
  const merged: Partial<Record<WorkspaceSettingsAuditAction, string[]>> = {}
  for (const [action, cols] of Object.entries(AUDITED_WORKSPACE_SETTINGS))
    merged[action as WorkspaceSettingsAuditAction] = [...cols]
  for (const c of getPluginRegistry().workspaceSettings) {
    for (const [action, cols] of Object.entries(c.audit ?? {})) {
      for (const column of cols ?? []) {
        if (!(column in c.columns))
          throw new Error(
            `plugin ${c.key} audits workspace setting "${column}" it does not own`
          )
      }
      const key = action as WorkspaceSettingsAuditAction
      merged[key] = [...(merged[key] ?? []), ...(cols ?? [])]
    }
  }
  return merged
}

/**
 * LUM-1065: a settings update as Prisma writes it — each plugin-owned column
 * mapped through its owner's `toColumnWrite` (core columns, and owned values
 * the owner does not map, pass through unchanged).
 */
export function toWorkspaceColumnWrites<T extends object>(data: T): T {
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const c of getPluginRegistry().workspaceSettings) {
    if (!c.toColumnWrite) continue
    for (const column of Object.keys(c.columns)) {
      if (column in out && out[column] !== undefined)
        out[column] = c.toColumnWrite(column, out[column])
    }
  }
  return out as T
}

/**
 * Whether the workspace lets AI review send its code to a model. Every
 * contributor must agree; with none the answer is yes (the column default).
 */
export async function isWorkspaceAiReviewEnabled(
  workspaceId: string
): Promise<boolean> {
  for (const c of getPluginRegistry().workspaceSettings) {
    if (c.aiReviewEnabled && !(await c.aiReviewEnabled(workspaceId)))
      return false
  }
  return true
}
