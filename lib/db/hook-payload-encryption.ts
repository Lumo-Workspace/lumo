import type { PrismaClient } from '@prisma/client'
import type { DataKey } from '@/lib/hook-payload/seal'
import {
  isSealedPayload,
  openPayload,
  sealPayload,
  sealedKeyId,
} from '@/lib/hook-payload/seal'
import type { DataKeyRing } from '@/lib/hook-payload/data-key-ring'
import { logger } from '@/lib/logger'

/**
 * LUM-1302 — HookEvent.payload is encrypted at rest with its workspace's data
 * key. This query extension is the one place that happens, so the ~30 files
 * that read or write `payload` keep handling plain JSON:
 *
 * - every write of `payload` (create, update, upsert, createMany, updateMany)
 *   is sealed with the row's workspace key and records `payloadKeyId`. The
 *   workspace comes from the write itself: `data.workspaceId` on a create,
 *   `where.workspaceId` on an update — an update of `payload` without it
 *   throws. Beyond loading a data key (cached per instance; a workspace's
 *   first one is created outside any transaction) the extension runs no
 *   queries of its own, so a write inside an interactive transaction stays
 *   on that transaction's connection;
 * - every result row's sealed `payload` is opened; a plaintext one (written
 *   before encryption) passes through unchanged;
 * - any database-side filter on `payload` (equals, JSON path,
 *   string_contains…) throws: it cannot see inside ciphertext, so it would
 *   silently match nothing. Lift the field into its own column instead.
 *
 * Without ENCRYPTION_KEY (a self-hosted install that never set it) writes
 * stay plaintext and reads still pass plaintext through.
 *
 * Not covered: HookEvent rows read or written through another model
 * (`include`, nested `create`) and raw SQL. None exist today.
 */

type Where = Record<string, unknown>
type Data = Record<string, unknown>

/**
 * Columns stored as ciphertext, by Prisma delegate: generic code that would
 * filter on a column's value (a compare-and-swap) must not for these.
 */
export const ENCRYPTED_AT_REST_FIELDS: Readonly<
  Record<string, readonly string[]>
> = { hookEvent: ['payload'] }

export interface HookPayloadEncryptionDeps {
  ring: DataKeyRing
  /** Whether new writes are sealed (ENCRYPTION_KEY configured). */
  enabled: () => boolean
}

/** What a sealed payload reads as when its key cannot be loaded. */
export const UNREADABLE_PAYLOAD = Object.freeze({}) as Record<string, never>

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
  'upsert',
  'delete',
  'deleteMany',
])

// ── result: open sealed payloads ────────────────────────────────────────────

async function openRows(rows: unknown[], ring: DataKeyRing): Promise<void> {
  const sealedRows = rows.filter(
    (r): r is { payload: unknown } =>
      typeof r === 'object' &&
      r !== null &&
      'payload' in r &&
      isSealedPayload((r as { payload: unknown }).payload)
  )
  if (sealedRows.length === 0) return
  const ids = [
    ...new Set(
      sealedRows.map(r =>
        sealedKeyId(r.payload as Parameters<typeof sealedKeyId>[0])
      )
    ),
  ]
  const keys = new Map<string, DataKey | null>()
  await Promise.all(
    ids.map(async id => {
      try {
        keys.set(id, await ring.keyById(id))
      } catch (error) {
        logger.error(`[hook-payload] data key ${id} unavailable:`, error)
        keys.set(id, null)
      }
    })
  )
  for (const row of sealedRows) {
    const sealed = row.payload as Parameters<typeof openPayload>[0]
    const key = keys.get(sealedKeyId(sealed))
    if (!key) {
      row.payload = UNREADABLE_PAYLOAD
      continue
    }
    try {
      row.payload = openPayload(sealed, key)
    } catch (error) {
      logger.error('[hook-payload] payload failed to decrypt:', error)
      row.payload = UNREADABLE_PAYLOAD
    }
  }
}

export async function openResult(
  result: unknown,
  ring: DataKeyRing
): Promise<unknown> {
  if (Array.isArray(result)) await openRows(result, ring)
  else if (typeof result === 'object' && result !== null)
    await openRows([result], ring)
  return result
}

// ── where: payload filters ──────────────────────────────────────────────────

function hasPayloadFilter(where: unknown): boolean {
  if (typeof where !== 'object' || where === null) return false
  if ('payload' in where) return true
  return ['AND', 'OR', 'NOT'].some(combinator => {
    const branch = (where as Where)[combinator]
    const parts = Array.isArray(branch) ? branch : branch ? [branch] : []
    return parts.some(hasPayloadFilter)
  })
}

/** Refuse a database-side filter on the encrypted payload. */
export function assertNoPayloadFilter(where: unknown): void {
  if (hasPayloadFilter(where))
    throw new Error(
      'HookEvent.payload is encrypted at rest (LUM-1302) and cannot be ' +
        'filtered in the database; lift the field into its own column.'
    )
}

// ── data: seal payload writes ───────────────────────────────────────────────

function writesPayload(data: unknown): data is Data & { payload: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Data).payload !== undefined
  )
}

function workspaceIdOfCreate(data: Data): string {
  const direct = data.workspaceId
  if (typeof direct === 'string') return direct
  const connect = (data.workspace as { connect?: { id?: unknown } } | undefined)
    ?.connect?.id
  if (typeof connect === 'string') return connect
  throw new Error('HookEvent payload write names no workspace (LUM-1302)')
}

async function sealData(
  data: Data & { payload: unknown },
  workspaceId: string,
  ring: DataKeyRing
): Promise<Data> {
  const key = await ring.activeKey(workspaceId)
  return {
    ...data,
    payload: sealPayload(data.payload, key),
    payloadKeyId: key.id,
  }
}

async function sealCreateData(data: unknown, ring: DataKeyRing) {
  if (!writesPayload(data)) return data
  return sealData(data, workspaceIdOfCreate(data), ring)
}

function workspaceIdOfUpdate(where: unknown): string {
  const id = (where as Where | undefined)?.workspaceId
  if (typeof id === 'string') return id
  throw new Error(
    'A HookEvent payload update must name `where.workspaceId` (LUM-1302): ' +
      "the payload is sealed with that workspace's key."
  )
}

// ── the extension ───────────────────────────────────────────────────────────

interface QueryParams {
  operation: string
  args: Record<string, unknown> | undefined
  query: (args: unknown) => Promise<unknown>
}

/** One hookEvent operation through the encryption layer. */
export async function runHookEventOperation(
  { operation, args, query }: QueryParams,
  deps: HookPayloadEncryptionDeps
): Promise<unknown> {
  const next: Record<string, unknown> = { ...(args ?? {}) }
  if (WHERE_OPERATIONS.has(operation)) assertNoPayloadFilter(next.where)

  if (deps.enabled()) {
    switch (operation) {
      case 'create':
        next.data = await sealCreateData(next.data, deps.ring)
        break
      case 'createMany':
      case 'createManyAndReturn':
        next.data = Array.isArray(next.data)
          ? await Promise.all(next.data.map(d => sealCreateData(d, deps.ring)))
          : await sealCreateData(next.data, deps.ring)
        break
      case 'update':
      case 'updateMany':
      case 'updateManyAndReturn':
        if (writesPayload(next.data))
          next.data = await sealData(
            next.data,
            workspaceIdOfUpdate(next.where),
            deps.ring
          )
        break
      case 'upsert':
        if (writesPayload(next.update))
          next.update = await sealData(
            next.update,
            workspaceIdOfUpdate(next.where),
            deps.ring
          )
        next.create = await sealCreateData(next.create, deps.ring)
        break
    }
  }

  return openResult(await query(next), deps.ring)
}

/** Wrap a client so HookEvent payloads are encrypted at rest. */
export function withHookPayloadEncryption(
  client: PrismaClient,
  deps: HookPayloadEncryptionDeps
): PrismaClient {
  return client.$extends({
    query: {
      hookEvent: {
        $allOperations: params =>
          runHookEventOperation(params as unknown as QueryParams, deps),
      },
    },
  }) as unknown as PrismaClient
}
