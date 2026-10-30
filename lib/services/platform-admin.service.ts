import {
  platformAdminRepository as repo,
  type AdminMemberRow,
  type AdminSpendRow,
} from '@/lib/repositories/platform-admin.repository'

/**
 * LUM-1344: platform admin read models. Pure reads across tenants; the
 * caller (route) authenticates and audits. BigInt amounts are serialised as
 * decimal strings so the result is JSON-safe.
 */

export interface AdminPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface AdminWorkspaceItem {
  id: string
  name: string
  slug: string
  createdAt: Date
  memberCount: number
  ownerEmail: string | null
}

export interface AdminWorkspaceDetail extends AdminWorkspaceItem {
  members: {
    userId: string
    /** null when the AuthUser row is missing (matches ownerEmail). */
    email: string | null
    role: string
    joinedAt: Date
  }[]
  llmSpendByMonth: { month: string; usdMicros: string }[]
}

export interface AdminUserItem {
  id: string
  email: string
  name: string
  createdAt: Date
  banned: boolean
  role: string | null
}

export interface AdminUserDetail extends AdminUserItem {
  workspaces: { id: string; name: string; slug: string; memberRole: string }[]
}

export interface AdminUsage {
  month: string
  totalUsdMicros: string
  byWorkspace: { workspaceId: string; name: string; usdMicros: string }[]
}

export interface AdminOverview {
  workspaceCount: number
  userCount: number
  pendingWaitlistCount: number
  currentMonthUsdMicros: string
}

export interface PageInput {
  q?: string | undefined
  cursor?: string | undefined
  limit: number
}

function notFound(what: string): Error {
  return Object.assign(new Error(`${what} not found`), {
    status: 404,
    code: 'NOT_FOUND',
  })
}

function paginate<T extends { id: string }>(
  rows: T[],
  limit: number
): { rows: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    rows: page,
    nextCursor: rows.length > limit && last ? last.id : null,
  }
}

/** 'YYYY-MM' of the UTC month containing `now`. */
export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7)
}

function sumByMonth(rows: AdminSpendRow[]): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const r of rows)
    out.set(r.month, (out.get(r.month) ?? BigInt(0)) + r.usdMicros)
  return out
}

function ownerOf(
  members: AdminMemberRow[],
  emailById: Map<string, string>
): string | null {
  const owner = members.find(m => m.role === 'OWNER')
  return owner ? (emailById.get(owner.clerkId) ?? null) : null
}

async function emailMap(ids: string[]): Promise<Map<string, string>> {
  const users = await repo.findUserEmails([...new Set(ids)])
  return new Map(users.map(u => [u.id, u.email]))
}

export const platformAdminService = {
  async listWorkspaces(q: PageInput): Promise<AdminPage<AdminWorkspaceItem>> {
    const fetched = await repo.listWorkspaces({
      q: q.q,
      cursor: q.cursor,
      take: q.limit + 1,
    })
    const { rows, nextCursor } = paginate(fetched, q.limit)
    const members = await repo.listActiveMembers(rows.map(w => w.id))
    const emails = await emailMap(
      members.filter(m => m.role === 'OWNER').map(m => m.clerkId)
    )
    const items = rows.map(w => {
      const mine = members.filter(m => m.workspaceId === w.id)
      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        createdAt: w.createdAt,
        memberCount: mine.length,
        ownerEmail: ownerOf(mine, emails),
      }
    })
    return { items, nextCursor }
  },

  async getWorkspace(id: string): Promise<AdminWorkspaceDetail> {
    const ws = await repo.findWorkspace(id)
    if (!ws) throw notFound('Workspace')
    const members = await repo.listActiveMembers([id])
    const emails = await emailMap(members.map(m => m.clerkId))
    const spend = await repo.listSpendForWorkspace(id)
    const llmSpendByMonth = [...sumByMonth(spend)]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([month, micros]) => ({ month, usdMicros: micros.toString() }))
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      createdAt: ws.createdAt,
      memberCount: members.length,
      ownerEmail: ownerOf(members, emails),
      members: members.map(m => ({
        userId: m.clerkId,
        email: emails.get(m.clerkId) ?? null,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      llmSpendByMonth,
    }
  },

  async listUsers(q: PageInput): Promise<AdminPage<AdminUserItem>> {
    const fetched = await repo.listUsers({
      q: q.q,
      cursor: q.cursor,
      take: q.limit + 1,
    })
    const { rows, nextCursor } = paginate(fetched, q.limit)
    return {
      items: rows.map(u => ({ ...u, banned: u.banned === true })),
      nextCursor,
    }
  },

  async getUser(id: string): Promise<AdminUserDetail> {
    const user = await repo.findUser(id)
    if (!user) throw notFound('User')
    const memberships = await repo.listUserMemberships(id)
    return {
      ...user,
      banned: user.banned === true,
      workspaces: memberships.map(m => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        memberRole: m.role,
      })),
    }
  },

  /** `month` defaults to the current UTC month. Sorted by spend, desc. */
  async usage(
    month: string | undefined,
    now: Date = new Date()
  ): Promise<AdminUsage> {
    const resolved = month ?? utcMonth(now)
    const rows = await repo.listSpendForMonth(resolved)
    const perWs = new Map<string, bigint>()
    for (const r of rows) {
      perWs.set(
        r.workspaceId,
        (perWs.get(r.workspaceId) ?? BigInt(0)) + r.usdMicros
      )
    }
    const names = new Map(
      (await repo.findWorkspacesByIds([...perWs.keys()])).map(w => [
        w.id,
        w.name,
      ])
    )
    const sorted = [...perWs].sort(([, a], [, b]) =>
      a < b ? 1 : a > b ? -1 : 0
    )
    let total = BigInt(0)
    for (const [, v] of sorted) total += v
    return {
      month: resolved,
      totalUsdMicros: total.toString(),
      byWorkspace: sorted.map(([workspaceId, v]) => ({
        workspaceId,
        name: names.get(workspaceId) ?? '',
        usdMicros: v.toString(),
      })),
    }
  },

  async overview(now: Date = new Date()): Promise<AdminOverview> {
    const [workspaceCount, userCount, pendingWaitlistCount, spend] =
      await Promise.all([
        repo.countWorkspaces(),
        repo.countUsers(),
        repo.countPendingWaitlist(),
        repo.listSpendForMonth(utcMonth(now)),
      ])
    let total = BigInt(0)
    for (const r of spend) total += r.usdMicros
    return {
      workspaceCount,
      userCount,
      pendingWaitlistCount,
      currentMonthUsdMicros: total.toString(),
    }
  },
}
