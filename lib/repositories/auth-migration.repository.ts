import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type {
  AccountWrite,
  ExistingAuthAccount,
  ExistingAuthUser,
  UserPlan,
} from '@/lib/auth-migration/import-plan'
import type { IdColumn } from '@/lib/auth-migration/identity-columns'
import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'
import { rewriteUserMentions } from '@/lib/auth-migration/mentions'

/**
 * LUM-1072 — Prisma access for the Clerk → Better Auth migration tooling
 * (lib/services/auth-migration.service.ts is the only caller). No business
 * rules here: what to write is decided by lib/auth-migration/import-plan.
 */

/** The three delegate methods used on the generic id / mention columns. */
interface ColumnDelegate {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>
  updateMany(args: unknown): Promise<{ count: number }>
  update(args: unknown): Promise<unknown>
}

type Db = Prisma.TransactionClient

function delegate(db: Db, c: IdColumn): ColumnDelegate {
  const d = (db as unknown as Record<string, ColumnDelegate | undefined>)[
    c.model
  ]
  if (!d) throw new Error(`Unknown Prisma model ${c.model}`)
  return d
}

/**
 * Base `where` of a column. Naming `deletedAt` (as undefined: no filter)
 * opts out of the soft-delete extension, so trashed rows are included.
 */
function baseWhere(c: IdColumn): Record<string, unknown> {
  return {
    ...(c.where ?? {}),
    ...(c.softDelete ? { deletedAt: undefined } : {}),
  }
}

const PAGE = 500

/** Page through `c` rows matching `where`, ordered by id. */
async function* pages(
  db: Db,
  c: IdColumn,
  where: Record<string, unknown>
): AsyncGenerator<Array<{ id: string; value: string }>> {
  let cursor: string | undefined
  for (;;) {
    const rows = await delegate(db, c).findMany({
      where: { ...baseWhere(c), ...where },
      select: { id: true, [c.field]: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) return
    yield rows.map(r => ({ id: r.id as string, value: r[c.field] as string }))
    if (rows.length < PAGE) return
    cursor = rows[rows.length - 1]!.id as string
  }
}

async function writeAccount(tx: Db, a: AccountWrite): Promise<void> {
  if (a.action === 'create') {
    await tx.authAccount.create({
      data: {
        id: a.id,
        userId: a.userId,
        providerId: a.providerId,
        accountId: a.accountId,
        scope: a.scope,
        password: a.password,
      },
    })
    return
  }
  await tx.authAccount.update({
    where: { id: a.id },
    data: {
      ...(a.scope !== undefined ? { scope: a.scope } : {}),
      ...(a.password !== undefined ? { password: a.password } : {}),
    },
  })
}

export const authMigrationRepository = {
  async listAuthUsers(): Promise<ExistingAuthUser[]> {
    const rows = await prisma.authUser.findMany({
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        firstName: true,
        lastName: true,
        image: true,
        banned: true,
      },
    })
    return rows.map(r => ({ ...r, banned: r.banned === true }))
  },

  async listAuthAccounts(): Promise<ExistingAuthAccount[]> {
    return prisma.authAccount.findMany({
      select: {
        id: true,
        userId: true,
        providerId: true,
        accountId: true,
        scope: true,
        password: true,
        updatedAt: true,
      },
    })
  },

  /** Write one user's plan atomically (user row first, then accounts). */
  async applyUserPlan(plan: UserPlan): Promise<void> {
    if (plan.action === 'skip' || plan.action === 'unchanged') return
    await prisma.$transaction(async tx => {
      if (plan.create) await tx.authUser.create({ data: plan.create })
      else if (plan.update && Object.keys(plan.update).length > 0) {
        await tx.authUser.update({ where: { id: plan.id }, data: plan.update })
      }
      for (const a of plan.accounts) await writeAccount(tx, a)
    })
  },

  /** Pending, unexpired invites addressed to any of `emails` (lowercase). */
  async countPendingInvitesTo(emails: string[], now: Date): Promise<number> {
    if (emails.length === 0) return 0
    return prisma.workspaceInvite.count({
      where: {
        status: 'PENDING',
        expiresAt: { gt: now },
        email: { in: emails },
      },
    })
  },

  /** Ids of `ids` that exist in auth_users. */
  async existingAuthUserIds(ids: string[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (let i = 0; i < ids.length; i += PAGE) {
      const rows = await prisma.authUser.findMany({
        where: { id: { in: ids.slice(i, i + PAGE) } },
        select: { id: true },
      })
      for (const r of rows) found.add(r.id)
    }
    return found
  },

  /** Ids of auth_accounts per user, for verify. */
  async accountKeysByUser(): Promise<Map<string, Set<string>>> {
    const rows = await prisma.authAccount.findMany({
      select: { userId: true, providerId: true, accountId: true },
    })
    const out = new Map<string, Set<string>>()
    for (const r of rows) {
      const set = out.get(r.userId) ?? new Set<string>()
      set.add(`${r.providerId}\u0000${r.accountId}`)
      out.set(r.userId, set)
    }
    return out
  },

  /** Distinct non-null values of an id column. */
  async distinctIds(c: IdColumn): Promise<string[]> {
    // No `not: null` filter: Prisma rejects it on required columns.
    const rows = await delegate(prisma, c).findMany({
      where: baseWhere(c),
      select: { [c.field]: true },
      distinct: [c.field],
    })
    return rows
      .map(r => r[c.field] as string | null)
      .filter((v): v is string => typeof v === 'string' && v !== '')
  },

  /** Distinct user ids mentioned in a rich-text column. */
  async mentionedIds(c: IdColumn): Promise<string[]> {
    const ids = new Set<string>()
    for await (const rows of pages(prisma, c, {
      [c.field]: { contains: 'mention' },
    })) {
      for (const r of rows) {
        for (const id of parseMentionedUserClerkIds(r.value ?? '', ''))
          ids.add(id)
      }
    }
    return [...ids]
  },

  /** Of `ids`, those that still have an active (not deactivated) membership. */
  async idsWithActiveMembership(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await prisma.workspaceMember.findMany({
      where: { clerkId: { in: ids }, deactivatedAt: null },
      select: { clerkId: true },
      distinct: ['clerkId'],
    })
    return new Set(rows.map(r => r.clerkId))
  },

  /** Rows of `c` that reference any of `ids` (id column: equality). */
  async countIdRefs(c: IdColumn, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const rows = await delegate(prisma, c).findMany({
      where: { ...baseWhere(c), [c.field]: { in: ids } },
      select: { id: true },
    })
    return rows.length
  },

  /** Rows of a mention column that mention any of `ids`. */
  async countMentionRefs(c: IdColumn, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    let n = 0
    for (const id of ids) {
      const rows = await delegate(prisma, c).findMany({
        where: { ...baseWhere(c), [c.field]: { contains: `data-id="${id}"` } },
        select: { id: true, [c.field]: true },
      })
      for (const r of rows) {
        if (
          parseMentionedUserClerkIds((r[c.field] as string) ?? '', '').includes(
            id
          )
        )
          n++
      }
    }
    return n
  },

  /**
   * Rewrite every old → new id in the id columns and mentions, in one
   * transaction. Returns rows changed per column label.
   */
  async applyRekey(
    idMap: ReadonlyMap<string, string>,
    idColumns: readonly IdColumn[],
    mentionColumns: readonly IdColumn[],
    label: (c: IdColumn) => string
  ): Promise<Record<string, number>> {
    return prisma.$transaction(
      async tx => {
        const changed: Record<string, number> = {}
        for (const c of idColumns) {
          let n = 0
          for (const [from, to] of idMap) {
            const r = await delegate(tx, c).updateMany({
              where: { ...baseWhere(c), [c.field]: from },
              data: { [c.field]: to },
            })
            n += r.count
          }
          changed[label(c)] = n
        }
        for (const c of mentionColumns) {
          let n = 0
          const touched = new Set<string>()
          for (const from of idMap.keys()) {
            const rows = await delegate(tx, c).findMany({
              where: {
                ...baseWhere(c),
                [c.field]: { contains: `data-id="${from}"` },
              },
              select: { id: true },
            })
            for (const r of rows) touched.add(r.id as string)
          }
          for (const id of touched) {
            const [row] = await delegate(tx, c).findMany({
              where: { ...baseWhere(c), id },
              select: { id: true, [c.field]: true },
            })
            const before = (row?.[c.field] as string | null) ?? ''
            const { html, replaced } = rewriteUserMentions(before, idMap)
            if (replaced === 0) continue
            await delegate(tx, c).update({
              where: { id },
              data: { [c.field]: html },
            })
            n++
          }
          changed[label(c)] = n
        }
        return changed
      },
      { timeout: 120_000, maxWait: 30_000 }
    )
  },

  /** Better Auth users created after `since` (rekey window). */
  async authUsersCreatedSince(
    since: Date
  ): Promise<Array<{ id: string; email: string; createdAt: Date }>> {
    return prisma.authUser.findMany({
      where: { createdAt: { gt: since } },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  },

  /** Users whose avatar still points at `hosts` (https). */
  async usersWithImageOnHosts(
    hosts: readonly string[]
  ): Promise<Array<{ id: string; image: string }>> {
    const rows = await prisma.authUser.findMany({
      where: {
        OR: hosts.map(h => ({ image: { startsWith: `https://${h}/` } })),
      },
      select: { id: true, image: true },
      orderBy: { id: 'asc' },
    })
    return rows.map(r => ({ id: r.id, image: r.image! }))
  },

  /** Set the avatar only if it is still `expected` (compare-and-set). */
  async replaceImageIfUnchanged(
    id: string,
    expected: string,
    next: string
  ): Promise<boolean> {
    const r = await prisma.authUser.updateMany({
      where: { id, image: expected },
      data: { image: next },
    })
    return r.count === 1
  },
}
