/**
 * LUM-926 stock — READ-ONLY. Counts stored comment bodies that still carry
 * XSS-shaped markup (see classify.ts), per source (task comment written in
 * Lumo / inbound PR mirror / idea / document comment), per workspace and per
 * pattern. Prints counts, workspace slugs and date ranges only, never a body.
 * findMany only — no writes; whether to clean the stock is the user's call.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum926-comment-xss-stock/count.ts
 */
import {
  RISK_PATTERNS,
  classifyCommentBody,
  commentSource,
  type CommentSource,
  type RiskPattern,
} from './classify'

const BATCH = 500

interface Tally {
  rows: number
  affected: number
  affectedLive: number
  byPattern: Map<RiskPattern, number>
  byWorkspace: Map<string, Map<RiskPattern | '*', number>>
  first?: Date
  last?: Date
}

const tallies = new Map<CommentSource, Tally>()

function tallyFor(source: CommentSource): Tally {
  let t = tallies.get(source)
  if (!t) {
    t = {
      rows: 0,
      affected: 0,
      affectedLive: 0,
      byPattern: new Map(),
      byWorkspace: new Map(),
    }
    tallies.set(source, t)
  }
  return t
}

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1)

function record(
  source: CommentSource,
  body: string,
  workspaceId: string | undefined,
  deleted: boolean,
  createdAt: Date
) {
  const t = tallyFor(source)
  t.rows++
  const hits = classifyCommentBody(body)
  if (hits.size === 0) return
  t.affected++
  if (!deleted) t.affectedLive++
  if (!t.first || createdAt < t.first) t.first = createdAt
  if (!t.last || createdAt > t.last) t.last = createdAt
  const ws = workspaceId ?? '(unknown)'
  const wsMap = t.byWorkspace.get(ws) ?? new Map<RiskPattern | '*', number>()
  t.byWorkspace.set(ws, wsMap)
  bump(wsMap, '*')
  for (const p of hits) {
    bump(t.byPattern, p)
    bump(wsMap, p)
  }
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  console.log(
    `[read-only] LUM-926 comment XSS stock · db ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`
  )

  let cursor: string | undefined
  for (;;) {
    const rows = await prisma.comment.findMany({
      select: {
        id: true,
        body: true,
        ideaId: true,
        deletedAt: true,
        createdAt: true,
        task: { select: { team: { select: { workspaceId: true } } } },
        idea: { select: { workspaceId: true } },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows)
      record(
        commentSource(r),
        r.body,
        r.task?.team.workspaceId ?? r.idea?.workspaceId,
        r.deletedAt !== null,
        r.createdAt
      )
    cursor = rows[rows.length - 1]!.id
  }

  cursor = undefined
  for (;;) {
    const rows = await prisma.documentComment.findMany({
      select: {
        id: true,
        body: true,
        deletedAt: true,
        createdAt: true,
        document: { select: { workspaceId: true } },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows)
      record(
        'document',
        r.body,
        r.document.workspaceId,
        r.deletedAt !== null,
        r.createdAt
      )
    cursor = rows[rows.length - 1]!.id
  }

  const wsIds = [...tallies.values()].flatMap(t => [...t.byWorkspace.keys()])
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: wsIds } },
    select: { id: true, slug: true },
  })
  const slug = new Map(workspaces.map(w => [w.id, w.slug]))

  for (const [source, t] of tallies) {
    const range = t.first
      ? ` · created ${t.first.toISOString().slice(0, 10)}..${t.last!.toISOString().slice(0, 10)}`
      : ''
    console.log(
      `\n${source}: ${t.affected}/${t.rows} rows affected (${t.affectedLive} not soft-deleted)${range}`
    )
    for (const p of RISK_PATTERNS)
      if (t.byPattern.get(p)) console.log(`  ${p}: ${t.byPattern.get(p)}`)
    for (const [ws, m] of [...t.byWorkspace].sort(
      (a, b) => b[1].get('*')! - a[1].get('*')!
    )) {
      const parts = RISK_PATTERNS.filter(p => m.get(p)).map(
        p => `${p}=${m.get(p)}`
      )
      console.log(
        `  ws ${slug.get(ws) ?? ws}: ${m.get('*')} rows (${parts.join(', ')})`
      )
    }
  }
  await prisma.$disconnect()
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
