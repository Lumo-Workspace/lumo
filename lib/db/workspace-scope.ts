import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'

/**
 * LUM-979 — make "forgot the tenant filter" hard to write.
 *
 * `scopedPrisma` is the production client (soft-delete included) plus a query
 * extension: every top-level query on a model with a direct `workspaceId`
 * column must pin a concrete workspace, or it is rejected before it reaches
 * the database. Repositories opt in by importing `scopedPrisma` instead of
 * `prisma`; interactive transactions opened on it inherit the check.
 *
 * "Pins a workspace" means, at the top level of the query (or under `AND`):
 * `workspaceId: '<id>'`, `{ equals: '<id>' }`, `{ in: [<ids>] }` (non-empty),
 * or a compound unique key that includes `workspaceId`. `workspaceId: undefined` does NOT
 * count — Prisma drops undefined filters, so it would match every tenant.
 * Creates must carry `workspaceId` (or `workspace: { connect: { id } }`).
 * A by-id lookup stays one query: `findUnique({ where: { id, workspaceId } })`
 * is legal (Prisma ≥5 accepts extra filters in a unique where) and returns
 * null for another tenant's id.
 *
 * Legitimate cross-tenant paths (tenant resolution before an access check,
 * crons, webhooks, export/deletion, backfills) use `unscoped('<reason>')` —
 * explicit, greppable, logged.
 *
 * Not checked: models scoped only through a relation (e.g. Comment → Task),
 * nested relation reads/writes, raw SQL, and a `tx` handed in from a
 * transaction opened on the plain client. (Task itself is checked since
 * LUM-992 denormalized `Task.workspaceId`.)
 *
 * On a violation: throw in dev/test; in production log and let the query run
 * (a throw on a missed legitimate system path would be an outage). Override
 * with `LUMO_WORKSPACE_SCOPE=throw|log`.
 */

/**
 * Every Prisma model with a direct, required `workspaceId String` column
 * (nullable ones — DocumentTemplate, McpAuditLog — hold global rows too). A unit test
 * diffs this list against prisma/schema.prisma so new models can't drift out.
 */
export const WORKSPACE_SCOPED_MODELS = [
  'Actor',
  'AgentProfile',
  'AuditEvent',
  'Document',
  'DocumentRevision',
  'Draft',
  'DroppedFragment',
  'Feedback',
  'FigmaIntegration',
  'GitHubAppInstallation',
  'GitHubIntegration',
  'GoogleDriveIntegration',
  'HookEvent',
  'LineageEdge',
  'LocalScanRun',
  'Memory',
  'MemoryStaleAnchorReport',
  'MilestoneMemoryEdge',
  'Notification',
  'OutcomeSignal',
  'PrChatRequest',
  'PrCommentSyncJob',
  'PrFindingThread',
  'PrReviewLearning',
  'PrSecurityScan',
  'Priority',
  'Project',
  'PullRequest',
  'RepositoryReviewSetting',
  'SentryIntegration',
  'Session',
  'SlackIntegration',
  'SubprocessorNoticeDelivery',
  'Tag',
  'Task',
  'TaskArtifact',
  'TaskAttributionSegment',
  'TaskDependency',
  'TaskFigmaLink',
  'TaskSlackContext',
  'TaskTemplate',
  'TaskWebLink',
  'Team',
  'UsageResyncAudit',
  'View',
  'WorkspaceDeletionReceipt',
  'WorkspaceExport',
  'WorkspaceInvite',
  'WorkspaceMember',
  'WorkspaceLlmSpend',
  'WorkspaceSummary',
  'Worktree',
] as const

const SCOPED = new Set<string>(WORKSPACE_SCOPED_MODELS)

const WHERE_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
])

const CREATE_MANY_OPERATIONS = new Set(['createMany', 'createManyAndReturn'])

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function pinsWorkspace(cond: unknown): boolean {
  if (isId(cond)) return true
  if (!isObj(cond)) return false
  const keys = Object.keys(cond).filter(k => cond[k] !== undefined)
  if (keys.length !== 1) return false
  if (keys[0] === 'equals') return isId(cond.equals)
  if (keys[0] === 'in') {
    const list = cond.in
    return Array.isArray(list) && list.length > 0 && list.every(isId)
  }
  return false
}

function whereIsScoped(where: unknown): boolean {
  if (!isObj(where)) return false
  if (pinsWorkspace(where.workspaceId)) return true
  for (const [key, value] of Object.entries(where)) {
    // A compound unique key (`workspaceId_number`, `teamId_workspaceId`, …).
    if (
      key.split('_').includes('workspaceId') &&
      isObj(value) &&
      isId(value.workspaceId)
    )
      return true
  }
  const and = where.AND
  if (Array.isArray(and)) return and.some(whereIsScoped)
  return whereIsScoped(and)
}

function dataIsScoped(data: unknown): boolean {
  if (!isObj(data)) return false
  if (isId(data.workspaceId)) return true
  const ws = data.workspace
  return isObj(ws) && isObj(ws.connect) && isId(ws.connect.id)
}

/**
 * Why this query is not tenant-scoped, or null when it is (or the model has
 * no direct `workspaceId` column). Pure — inspects the arguments only.
 */
export function findScopeViolation(
  model: string,
  operation: string,
  args: unknown
): string | null {
  if (!SCOPED.has(model)) return null
  const a = isObj(args) ? args : {}
  const label = `${model}.${operation}`
  if (WHERE_OPERATIONS.has(operation)) {
    return whereIsScoped(a.where)
      ? null
      : `${label}: \`where\` has no workspaceId condition`
  }
  if (operation === 'create') {
    return dataIsScoped(a.data) ? null : `${label}: \`data\` has no workspaceId`
  }
  if (CREATE_MANY_OPERATIONS.has(operation)) {
    const rows = Array.isArray(a.data) ? a.data : [a.data]
    // An empty batch writes nothing, so there is nothing to scope.
    return rows.every(dataIsScoped)
      ? null
      : `${label}: a row in \`data\` has no workspaceId`
  }
  if (operation === 'upsert') {
    if (!whereIsScoped(a.where))
      return `${label}: \`where\` has no workspaceId condition`
    return dataIsScoped(a.create)
      ? null
      : `${label}: \`create\` has no workspaceId`
  }
  return `${label}: operation is not recognized by the workspace-scope check`
}

export type ScopeMode = 'throw' | 'log'

/** Throw in dev/test, log in production; `LUMO_WORKSPACE_SCOPE` overrides. */
export function scopeMode(): ScopeMode {
  const raw = process.env.LUMO_WORKSPACE_SCOPE?.toLowerCase()
  if (raw === 'throw' || raw === 'log') return raw
  return process.env.NODE_ENV === 'production' ? 'log' : 'throw'
}

/** Reject (or, in log mode, report) a query that does not pin a workspace. */
export function enforceWorkspaceScope(
  model: string,
  operation: string,
  args: unknown
): void {
  const violation = findScopeViolation(model, operation, args)
  if (!violation) return
  const message = `[workspace-scope] ${violation} — scope the query to a workspace or use unscoped('<reason>')`
  if (scopeMode() === 'log') {
    // Model + operation only: argument values may carry tenant data.
    logger.error(message)
    return
  }
  throw Object.assign(new Error(message), {
    status: 500,
    code: 'WORKSPACE_SCOPE_MISSING',
  })
}

interface QueryParams {
  model?: string
  operation: string
  args: unknown
  query: (args: unknown) => Promise<unknown>
}

/**
 * Wrap a client with the workspace-scope check. A query extension leaves every
 * method's types unchanged, so the result is typed as the plain client.
 */
export function withWorkspaceScope(client: PrismaClient): PrismaClient {
  return client.$extends({
    name: 'workspace-scope',
    query: {
      $allModels: {
        async $allOperations(params) {
          const { model, operation, args, query } = params as QueryParams
          if (model) enforceWorkspaceScope(model, operation, args)
          return query(args)
        },
      },
    },
  }) as unknown as PrismaClient
}

const derived = new WeakMap<object, PrismaClient>()

/**
 * The checked client for the current base client. Derived lazily (and cached
 * per base) so test suites that swap or stub `@/lib/db/prisma` keep working:
 * a jest double without `$extends` is passed through unchanged.
 */
function checkedClient(): PrismaClient {
  const base = prisma as unknown as PrismaClient & object
  if (typeof base?.$extends !== 'function') return base
  let client = derived.get(base)
  if (!client) {
    client = withWorkspaceScope(base)
    derived.set(base, client)
  }
  return client
}

/** The Prisma client migrated repositories use — see the module comment. */
export const scopedPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = checkedClient()
    const value = Reflect.get(client, prop, client) as unknown
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value
  },
})

/**
 * Escape hatch for a deliberately cross-tenant query: returns the unchecked
 * client and logs the reason (debug level — tenant-resolution lookups run on
 * every request; `LOG_LEVEL=debug` surfaces them in production). Grep
 * `unscoped(` for the full list of call sites.
 */
export function unscoped(reason: string): PrismaClient {
  if (!reason.trim()) {
    throw new Error('unscoped() needs a reason naming the cross-tenant path')
  }
  logger.debug('[workspace-scope] unscoped:', reason)
  return prisma
}
