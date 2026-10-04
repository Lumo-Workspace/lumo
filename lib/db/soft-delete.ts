import type { PrismaClient } from '@prisma/client'

/**
 * LUM-918 — tasks and documents in the trash stay in their tables with
 * `deletedAt` set. This query extension makes every top-level read of those
 * two models skip trashed rows by default, so a list, search, lookup by id
 * or AI-context read cannot surface one by forgetting a filter.
 *
 * Opting out is explicit: a query whose top-level `where` names `deletedAt`
 * (the trash list, restore, purge) is passed through untouched.
 *
 * Not covered — callers filter these themselves: relation reads through
 * another model (`include: { tasks }`, `_count: { tasks }`, a
 * `where: { task: … }` relation filter) and raw SQL.
 */
export const SOFT_DELETE_MODELS = ['task', 'document'] as const

const FILTERED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
])

type Where = Record<string, unknown> | undefined

/** `where` with the trash filter added, unless the caller already chose. */
export function withoutTrashed(where: Where): Record<string, unknown> {
  if (where && 'deletedAt' in where) return where
  return { ...(where ?? {}), deletedAt: null }
}

interface QueryParams {
  operation: string
  args: { where?: Where } | undefined
  query: (args: unknown) => Promise<unknown>
}

function filterTrashed({ operation, args, query }: QueryParams) {
  if (!FILTERED_OPERATIONS.has(operation)) return query(args)
  return query({ ...(args ?? {}), where: withoutTrashed(args?.where) })
}

/**
 * Wrap a client so Task / Document reads skip the trash. Query extensions
 * leave every method's types unchanged, so the result is typed as the
 * plain client and existing `Prisma.TransactionClient` code keeps compiling.
 */
export function withSoftDelete(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      task: {
        $allOperations: params => filterTrashed(params as QueryParams),
      },
      document: {
        $allOperations: params => filterTrashed(params as QueryParams),
      },
    },
  }) as unknown as PrismaClient
}
