import { Prisma } from '@prisma/client'

/**
 * LUM-1062 — every scalar column of the `Workspace` model, from the
 * generated client (no query). The settings extension point checks each
 * column is owned by the core or an installed plugin.
 */
export const WORKSPACE_COLUMNS: readonly string[] = Object.values(
  Prisma.WorkspaceScalarFieldEnum
)
