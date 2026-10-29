import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { ENCRYPTED_AT_REST_FIELDS } from '@/lib/db/hook-payload-encryption'

/** A stored table to re-redact: the Prisma delegate, the columns, a filter. */
export interface StockTableRef {
  label: string
  delegate: string
  fields: readonly string[]
  /** The row's workspace column; read with the row and named on its write. */
  workspaceField?: string
  where?: Record<string, unknown>
}

export type StockRow = Record<string, unknown> & { id: string }

export interface StockColumnRewrite {
  field: string
  before: unknown
  after: unknown
}

/** Rows per write transaction, and its timeout (see rewriteRows). */
export const STOCK_WRITE_CHUNK = 25
const WRITE_TIMEOUT_MS = 30_000

type Delegate = {
  findMany(args: unknown): Promise<StockRow[]>
  updateMany(args: unknown): Promise<{ count: number }>
}

interface ModelShape {
  jsonFields: Set<string>
  /** The `@updatedAt` column, when the model has one. */
  updatedAtField: string | null
}

function modelShape(delegate: string): ModelShape {
  const model = Prisma.dmmf.datamodel.models.find(
    m => m.name.charAt(0).toLowerCase() + m.name.slice(1) === delegate
  )
  if (!model) throw new Error(`Unknown Prisma model for delegate ${delegate}`)
  return {
    jsonFields: new Set(
      model.fields.filter(f => f.type === 'Json').map(f => f.name)
    ),
    // Prisma 7's runtime DMMF drops `isUpdatedAt`; in this schema every
    // `updatedAt DateTime` column is `@updatedAt` and nothing else is.
    updatedAtField: model.fields.some(
      f => f.name === 'updatedAt' && f.type === 'DateTime'
    )
      ? 'updatedAt'
      : null,
  }
}

function delegateOf(client: unknown, table: StockTableRef): Delegate {
  return (client as Record<string, Delegate>)[table.delegate]!
}

// ── Secret stock re-redaction repository (LUM-898) ──────────────────────────

export const secretStockRepository = {
  /** One keyset page of `table` in id order: id, the columns, `updatedAt`. */
  async findPage(
    table: StockTableRef,
    afterId: string | null,
    take: number
  ): Promise<StockRow[]> {
    const shape = modelShape(table.delegate)
    const select: Record<string, true> = { id: true }
    for (const f of table.fields) select[f] = true
    if (table.workspaceField) select[table.workspaceField] = true
    if (shape.updatedAtField) select[shape.updatedAtField] = true
    return delegateOf(prisma, table).findMany({
      where: {
        ...(table.where ?? {}),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select,
      orderBy: { id: 'asc' },
      take,
    })
  },

  /**
   * Write each row's rewritten columns. The update matches only while every
   * rewritten column still holds the value that was read (and the table's
   * filter still holds — a HookEvent pruned meanwhile is left alone), so a
   * concurrent edit is never overwritten. A column encrypted at rest
   * (HookEvent.payload, LUM-1302) cannot be compared in the database: only
   * the table's filter guards it — for HookEvent, a payload is rewritten
   * after insert only by being pruned (excluded by that filter) or by the
   * SESSION_START metrics stamp moments after insert. `updatedAt` is written
   * back as it was: a redaction is not an edit. Small interactive transactions with an
   * explicit timeout — a large one from this Mac to Neon runs past Prisma's
   * 5s default and rolls back (LUM-855). Returns how many rows were written.
   */
  async rewriteRows(
    table: StockTableRef,
    rows: {
      id: string
      columns: StockColumnRewrite[]
      updatedAt?: Date | undefined
      /** Required when the table has a `workspaceField`. */
      workspaceId?: string | undefined
    }[]
  ): Promise<number> {
    const shape = modelShape(table.delegate)
    const encrypted = new Set(ENCRYPTED_AT_REST_FIELDS[table.delegate] ?? [])
    let written = 0
    for (let i = 0; i < rows.length; i += STOCK_WRITE_CHUNK) {
      const chunk = rows.slice(i, i + STOCK_WRITE_CHUNK)
      written += await prisma.$transaction(
        async tx => {
          let count = 0
          for (const row of chunk) {
            const where: Record<string, unknown> = {
              ...(table.where ?? {}),
              id: row.id,
            }
            if (table.workspaceField)
              where[table.workspaceField] = row.workspaceId
            const data: Record<string, unknown> = {}
            for (const c of row.columns) {
              if (!encrypted.has(c.field))
                where[c.field] = shape.jsonFields.has(c.field)
                  ? { equals: c.before }
                  : c.before
              data[c.field] = c.after
            }
            if (shape.updatedAtField && row.updatedAt)
              data[shape.updatedAtField] = row.updatedAt
            const r = await delegateOf(tx, table).updateMany({ where, data })
            count += r.count
          }
          return count
        },
        { timeout: WRITE_TIMEOUT_MS }
      )
    }
    return written
  },
}
