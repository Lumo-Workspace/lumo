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
  'createdAt',
  'updatedAt',
  'summaryFrequency',
  'summaryEnabled',
  'summaryLocale',
  'boundaryGateEnabled',
  'hookEventRetentionDays',
  'hookEventRetentionMode',
  'hookEventRetentionSince',
  'hookEventRetentionLegacyDays',
  'crossingRawRetentionDays',
  'crossingRawRetentionSince',
  'deadLetterRetentionDays',
  'aiDerivedContentEnabled',
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

/** Extra top-level `GET /api/workspaces/me` fields from every plugin. */
export function pluginMeFields(): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const c of getPluginRegistry().workspaceSettings)
    Object.assign(fields, c.meFields?.() ?? {})
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
