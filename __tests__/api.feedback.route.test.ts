/**
 * @jest-environment node
 *
 * LUM-1240: `POST/GET /api/feedback` and `GET /api/feedback/[ref]`, driven
 * through the real route → service → repository with an in-memory Prisma.
 * Locks: what lands in the row (env, evidence, task ref, redacted text), the
 * strict environment whitelist, cross-workspace reads answering 404, and the
 * four submission limits (counted from the table; a failed count refuses).
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

// ── in-memory Prisma for the feedback tables ───────────────────────────────

type Row = Record<string, unknown> & {
  id: string
  workspaceId: string
  number: number
  createdAt: Date
  submittedByMemberId: string | null
  replies: Array<{ body: string; createdAt: Date }>
}

const db = {
  rows: [] as Row[],
  seq: new Map<string, number>(),
  failCount: false,
  /** Runs once, between an evidence read and its write (a racing request). */
  afterEvidenceRead: null as null | (() => void),
}

/**
 * Transactions run one at a time — the workspace counter row lock that
 * `feedbackRepository.create` takes first holds every other insert into the
 * workspace until commit. Plain statements outside a transaction are not
 * serialised.
 */
let txTail: Promise<unknown> = Promise.resolve()

function byKey(where: {
  workspaceId_number: { workspaceId: string; number: number }
}): Row | undefined {
  return db.rows.find(
    r =>
      r.workspaceId === where.workspaceId_number.workspaceId &&
      r.number === where.workspaceId_number.number
  )
}

function matches(r: Row, where: Record<string, unknown> = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue
    if (k === 'createdAt') {
      if (r.createdAt < (v as { gte: Date }).gte) return false
    } else if (k === 'number' && typeof v === 'object') {
      if (!(r.number < (v as { lt: number }).lt)) return false
    } else if (r[k] !== v) return false
  }
  return true
}

const fakePrisma = {
  workspace: {
    update: jest.fn(async ({ where }: { where: { id: string } }) => {
      const n = (db.seq.get(where.id) ?? 0) + 1
      db.seq.set(where.id, n)
      return { feedbackSeq: n }
    }),
  },
  feedback: {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        ...data,
        // Postgres stores Prisma.DbNull as SQL NULL, read back as null.
        environment:
          data.environment === Prisma.DbNull ? null : data.environment,
        id: `cfb${db.rows.length + 1}`,
        status: 'NEW',
        createdAt: new Date(),
        updatedAt: new Date(),
        statusChangedAt: null,
        replies: [],
      } as unknown as Row
      db.rows.push(row)
      return row
    }),
    findUnique: jest.fn(
      async ({
        where,
        select,
      }: {
        where: { workspaceId_number: { workspaceId: string; number: number } }
        select: Record<string, unknown>
      }) => {
        const row = byKey(where)
        if (!row) return null
        // Snapshot like a real read, so a later write does not show through.
        const snap = { ...row, evidence: row.evidence }
        // Only the evidence-only read inside appendEvidence races.
        if (Object.keys(select).length === 1 && select.evidence) {
          const hook = db.afterEvidenceRead
          db.afterEvidenceRead = null
          hook?.()
        }
        return snap
      }
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: {
          workspaceId: string
          number: number
          evidence: { equals: unknown }
        }
        data: { evidence: unknown; secretsRedacted: { increment: number } }
      }) => {
        const row = db.rows.find(
          r =>
            r.workspaceId === where.workspaceId &&
            r.number === where.number &&
            JSON.stringify(r.evidence === undefined ? [] : r.evidence) ===
              JSON.stringify(
                where.evidence.equals === Prisma.JsonNull
                  ? null
                  : where.evidence.equals
              )
        )
        if (!row) return { count: 0 }
        row.evidence = data.evidence
        row.secretsRedacted =
          Number(row.secretsRedacted ?? 0) + data.secretsRedacted.increment
        return { count: 1 }
      }
    ),
    findMany: jest.fn(
      async ({
        where,
        take,
      }: {
        where: Record<string, unknown>
        take: number
      }) =>
        db.rows
          .filter(r => matches(r, where))
          .sort((a, b) => b.number - a.number)
          .slice(0, take)
          .map(r => ({ ...r, _count: { replies: r.replies.length } }))
    ),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (db.failCount) throw new Error('db down')
      return db.rows.filter(r => matches(r, where)).length
    }),
    findFirst: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        const hit = db.rows
          .filter(r => matches(r, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
        return hit ? { createdAt: hit.createdAt } : null
      }
    ),
  },
  $transaction: jest.fn(
    async (fn: (tx: unknown) => unknown): Promise<unknown> => {
      const run = txTail.then(() => fn(fakePrisma))
      txTail = run.catch(() => undefined)
      return run
    }
  ),
}
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return fakePrisma
  },
}))

const requireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => requireIdentity(...a),
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    // LUM-7 exists only in workspace w-1.
    findByWorkspaceIdentifier: jest.fn(
      async (workspaceId: string, team: string, n: number) =>
        workspaceId === 'w-1' && team === 'LUM' && n === 7 ? { id: 't7' } : null
    ),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    labelsByIds: jest.fn(
      async (ids: string[]) => new Map(ids.map(i => [i, `name-${i}`]))
    ),
  },
}))
const putPrivateFile = jest.fn(async (..._a: unknown[]) => undefined)
jest.mock('@/lib/services/private-file-blob', () => ({
  putPrivateFile: (...a: unknown[]) => putPrivateFile(...a),
}))
jest.mock('@/lib/blob/storage', () => ({
  getBlobStorage: async () => ({ delete: jest.fn() }),
}))

import { GET as LIST, POST } from '@/app/api/feedback/route'
import { GET as SHOW } from '@/app/api/feedback/[ref]/route'
import { POST as ATTACH } from '@/app/api/feedback/[ref]/evidence/route'

// Built at runtime so this file holds no credential-shaped literal.
const AWS_KEY = 'AKIA' + 'Q7M2Z4LW9KP2XC8V'

function identity(workspaceId: string, memberId: string) {
  return {
    clerkId: `u-${memberId}`,
    memberId,
    workspaceId,
    workspaceSlug: workspaceId,
    workspaceName: workspaceId,
    source: 'bearer' as const,
  }
}

function post(
  payload: unknown,
  files: File[] = [],
  headers: Record<string, string> = {}
): NextRequest {
  const fd = new FormData()
  fd.append('payload', JSON.stringify(payload))
  for (const f of files) fd.append('file', f)
  return new NextRequest('http://lumo.test/api/feedback', {
    method: 'POST',
    body: fd,
    headers,
  })
}

const env = {
  cliVersion: '1.126.0',
  os: 'darwin',
  osRelease: '24.2.0',
  arch: 'arm64',
  nodeVersion: '22.11.0',
  agentHost: 'CLAUDE_CODE',
  lastCommand: {
    command: 'task testcase run',
    flags: ['--evidence-file'],
    exitCode: 1,
    at: '2026-10-19T02:01:13Z',
  },
}

function seed(
  n: number,
  opts: {
    workspaceId: string
    member?: (i: number) => string | null
    ageMs: number
  }
) {
  for (let i = 0; i < n; i++)
    db.rows.push({
      id: `seed${db.rows.length}`,
      workspaceId: opts.workspaceId,
      number: 1000 + db.rows.length,
      createdAt: new Date(Date.now() - opts.ageMs),
      submittedByMemberId: opts.member ? opts.member(i) : 'm-1',
      replies: [],
    })
}

beforeEach(() => {
  db.rows = []
  db.seq.clear()
  db.failCount = false
  db.afterEvidenceRead = null
  txTail = Promise.resolve()
  jest.clearAllMocks()
  requireIdentity.mockResolvedValue(identity('w-1', 'm-1'))
})

describe('POST /api/feedback', () => {
  it('stores env, task ref, session ref, evidence and redacts secrets in text and text evidence', async () => {
    const log = new File([`token=${AWS_KEY}\nok`], 'run.log', {
      type: 'text/plain',
    })
    const png = new File([new Uint8Array(4)], 'shot.png', { type: 'image/png' })
    const res = await POST(
      post(
        {
          title: `upload fails with ${AWS_KEY}`,
          kind: 'bug',
          steps: ['run it'],
          actual: `saw ${AWS_KEY}`,
          task: 'LUM-7',
          environment: env,
        },
        [log, png],
        { 'X-Lumo-Cli-Version': '1.126.0', 'X-Lumo-Session-Id': 'sess-1' }
      )
    )
    expect(res.status).toBe(201)
    const row = db.rows[0]!
    expect(row).toMatchObject({
      workspaceId: 'w-1',
      number: 1,
      kind: 'BUG',
      taskRef: 'LUM-7',
      sessionId: 'sess-1',
      submittedByMemberId: 'm-1',
      submittedVia: 'CLI',
      environment: env,
    })
    expect(JSON.stringify(row)).not.toContain(AWS_KEY)
    expect(row.secretsRedacted).toBe(3)
    const evidence = row.evidence as Array<Record<string, unknown>>
    expect(evidence).toHaveLength(2)
    expect(String(evidence[0]!.url)).toMatch(
      /^http:\/\/lumo\.test\/api\/files\/workspaces\/w-1\/feedback\/[0-9a-f-]+$/
    )
    // The stored log is the redacted text, never the raw key.
    const [pathname, body] = putPrivateFile.mock.calls[0]! as [string, Buffer]
    expect(pathname).toMatch(/^workspaces\/w-1\/feedback\//)
    expect(body.toString('utf8')).not.toContain(AWS_KEY)
    const json = (await res.json()) as { feedback: Record<string, unknown> }
    expect(json.feedback).toMatchObject({
      ref: 'FB-1',
      task: 'LUM-7',
      submittedBy: { name: 'name-m-1' },
    })
    expect(json.feedback).not.toHaveProperty('workspaceId')
    expect(json.feedback).not.toHaveProperty('seq')
  })

  it('--no-env: no environment stored', async () => {
    const res = await POST(post({ title: 'idea', kind: 'IDEA' }))
    expect(res.status).toBe(201)
    expect(db.rows[0]).toMatchObject({ kind: 'IDEA', submittedVia: 'API' })
    // Written as SQL NULL (DbNull), not a JSON value and not `{}`.
    expect(fakePrisma.feedback.create.mock.calls[0]![0].data.environment).toBe(
      Prisma.DbNull
    )
    expect(db.rows[0]!.environment).toBeNull()
    expect(db.rows[0]!.sessionId).toBeNull()
    const json = (await res.json()) as {
      feedback: { environment: unknown; sessionId: unknown }
    }
    expect(json.feedback.environment).toBeNull()
    expect(json.feedback.sessionId).toBeNull()
  })

  it('rejects an environment with an extra key or a command carrying a value (strict whitelist)', async () => {
    const extra = await POST(
      post({
        title: 't',
        environment: { ...env, cwd: '/Users/me/secret-project' },
      })
    )
    expect(extra.status).toBe(400)
    const withValue = await POST(
      post({
        title: 't',
        environment: {
          ...env,
          lastCommand: { ...env.lastCommand, command: 'task show LUM-7' },
        },
      })
    )
    expect(withValue.status).toBe(400)
    const flagValue = await POST(
      post({
        title: 't',
        environment: {
          ...env,
          lastCommand: { ...env.lastCommand, flags: ['--title=secret'] },
        },
      })
    )
    expect(flagValue.status).toBe(400)
    expect(db.rows).toHaveLength(0)
  })

  it('rejects a task ref outside the workspace and disallowed evidence', async () => {
    requireIdentity.mockResolvedValue(identity('w-2', 'm-9'))
    expect((await POST(post({ title: 't', task: 'LUM-7' }))).status).toBe(400)
    const pdf = new File([new Uint8Array(2)], 'a.pdf', {
      type: 'application/pdf',
    })
    expect((await POST(post({ title: 't' }, [pdf]))).status).toBe(400)
    const six = Array.from(
      { length: 6 },
      (_, i) => new File([new Uint8Array(1)], `${i}.png`, { type: 'image/png' })
    )
    expect((await POST(post({ title: 't' }, six))).status).toBe(400)
    expect(db.rows).toHaveLength(0)
  })
})

describe('cross-workspace reads', () => {
  it('another workspace sees nothing: list is empty and show is 404', async () => {
    await POST(post({ title: 'mine' }))
    const ownShow = await SHOW(
      new NextRequest('http://lumo.test/api/feedback/FB-1'),
      {
        params: Promise.resolve({ ref: 'FB-1' }),
      }
    )
    expect(ownShow.status).toBe(200)

    requireIdentity.mockResolvedValue(identity('w-2', 'm-9'))
    const list = await LIST(new NextRequest('http://lumo.test/api/feedback'))
    expect(await list.json()).toEqual({
      feedback: [],
      total: 0,
      nextCursor: null,
    })
    const show = await SHOW(
      new NextRequest('http://lumo.test/api/feedback/FB-1'),
      {
        params: Promise.resolve({ ref: 'FB-1' }),
      }
    )
    expect(show.status).toBe(404)
    const byId = await SHOW(
      new NextRequest(`http://lumo.test/api/feedback/${db.rows[0]!.id}`),
      {
        params: Promise.resolve({ ref: db.rows[0]!.id }),
      }
    )
    expect(byId.status).toBe(404)
  })

  it('list pages newest first and filters to my reports with mine=true', async () => {
    await POST(post({ title: 'a' }))
    requireIdentity.mockResolvedValue(identity('w-1', 'm-2'))
    await POST(post({ title: 'b' }))
    const page = (await (
      await LIST(new NextRequest('http://lumo.test/api/feedback?limit=1'))
    ).json()) as {
      feedback: Array<{ ref: string }>
      total: number
      nextCursor: string | null
    }
    expect(page).toMatchObject({
      feedback: [{ ref: 'FB-2' }],
      total: 2,
      nextCursor: '2',
    })
    const mine = (await (
      await LIST(new NextRequest('http://lumo.test/api/feedback?mine=true'))
    ).json()) as {
      feedback: Array<{ ref: string }>
    }
    expect(mine.feedback.map(f => f.ref)).toEqual(['FB-2'])
  })
})

describe('submission limits', () => {
  async function over(): Promise<Record<string, unknown>> {
    const res = await POST(post({ title: 'one more' }))
    expect(res.status).toBe(429)
    return (await res.json()) as Record<string, unknown>
  }

  it('member burst: 5 per 10 minutes', async () => {
    for (let i = 0; i < 5; i++)
      expect((await POST(post({ title: `t${i}` }))).status).toBe(201)
    expect(await over()).toMatchObject({
      code: 'RATE_LIMITED',
      scope: 'member',
      window: 'burst',
      limit: 5,
      error: 'feedback limit reached for you (5 per 10 min)',
    })
  })

  it('workspace burst: 20 per 10 minutes across members', async () => {
    seed(20, { workspaceId: 'w-1', member: i => `other-${i}`, ageMs: 60_000 })
    expect(await over()).toMatchObject({
      scope: 'workspace',
      window: 'burst',
      limit: 20,
    })
  })

  it('member daily: 20 per rolling 24 h', async () => {
    seed(20, { workspaceId: 'w-1', ageMs: 2 * 3_600_000 })
    const body = await over()
    expect(body).toMatchObject({ scope: 'member', window: 'daily', limit: 20 })
    expect(Date.parse(String(body.retryAt))).toBeGreaterThan(Date.now())
  })

  it('workspace daily: 50 per rolling 24 h', async () => {
    seed(50, {
      workspaceId: 'w-1',
      member: i => `other-${i}`,
      ageMs: 2 * 3_600_000,
    })
    expect(await over()).toMatchObject({
      scope: 'workspace',
      window: 'daily',
      limit: 50,
      error: 'feedback limit reached for this workspace (50 per 24 h)',
    })
  })

  it('another workspace is not limited by this one', async () => {
    seed(50, { workspaceId: 'w-1', member: i => `other-${i}`, ageMs: 60_000 })
    requireIdentity.mockResolvedValue(identity('w-2', 'm-9'))
    expect((await POST(post({ title: 'fine' }))).status).toBe(201)
  })

  it('concurrent submissions cannot both slip under the member limit', async () => {
    seed(4, { workspaceId: 'w-1', ageMs: 60_000 })
    const statuses = (
      await Promise.all([
        POST(post({ title: 'a' })),
        POST(post({ title: 'b' })),
        POST(post({ title: 'c' })),
      ])
    ).map(r => r.status)
    expect(statuses.sort()).toEqual([201, 429, 429])
    expect(db.rows.filter(r => r.submittedByMemberId === 'm-1')).toHaveLength(5)
    // Only one of the three requests inserted a row (seeded rows have no title).
    expect(db.rows.filter(r => r.title !== undefined)).toHaveLength(1)
  })

  it('the limit is re-checked inside the insert transaction', async () => {
    seed(4, { workspaceId: 'w-1', ageMs: 60_000 })
    // Another request commits its row after this one's early check passed.
    const realTx = fakePrisma.$transaction.getMockImplementation()!
    fakePrisma.$transaction.mockImplementationOnce(async fn => {
      seed(1, { workspaceId: 'w-1', ageMs: 0 })
      return realTx(fn)
    })
    const body = await over()
    expect(body).toMatchObject({ scope: 'member', window: 'burst' })
    expect(fakePrisma.feedback.create).not.toHaveBeenCalled()
  })

  it('rows of a deleted member (submitter NULL) count for the workspace only', async () => {
    seed(20, { workspaceId: 'w-1', member: () => null, ageMs: 2 * 3_600_000 })
    expect((await POST(post({ title: 'still mine to send' }))).status).toBe(201)
    seed(29, { workspaceId: 'w-1', member: () => null, ageMs: 2 * 3_600_000 })
    expect(await over()).toMatchObject({
      scope: 'workspace',
      window: 'daily',
      limit: 50,
    })
  })

  it('fails closed: a failed count refuses the submission', async () => {
    db.failCount = true
    const res = await POST(post({ title: 't' }))
    expect(res.status).toBe(503)
    expect(db.rows).toHaveLength(0)
  })
})

describe('POST /api/feedback/[ref]/evidence (one file per request)', () => {
  function attach(ref: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return ATTACH(
      new NextRequest(`http://lumo.test/api/feedback/${ref}/evidence`, {
        method: 'POST',
        body: fd,
      }),
      { params: Promise.resolve({ ref }) }
    )
  }
  const png = (name = 'shot.png', bytes = 4) =>
    new File([new Uint8Array(bytes)], name, { type: 'image/png' })

  it('the submitter attaches files one by one; text is stored redacted', async () => {
    await POST(post({ title: 'with files' }))
    expect((await attach('FB-1', png())).status).toBe(200)
    const log = new File([`key ${AWS_KEY}`], 'run.log', { type: 'text/plain' })
    const res = await attach('FB-1', log)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      feedback: {
        evidence: Array<{ filename: string }>
        secretsRedacted: number
      }
    }
    expect(body.feedback.evidence.map(e => e.filename)).toEqual([
      'shot.png',
      'run.log',
    ])
    expect(body.feedback.secretsRedacted).toBe(1)
    const [, stored] = putPrivateFile.mock.calls[1]! as [string, Buffer]
    expect(stored.toString('utf8')).not.toContain(AWS_KEY)
  })

  it('another workspace gets 404; another member of the workspace 403', async () => {
    await POST(post({ title: 'mine' }))
    requireIdentity.mockResolvedValue(identity('w-2', 'm-9'))
    expect((await attach('FB-1', png())).status).toBe(404)
    requireIdentity.mockResolvedValue(identity('w-1', 'm-2'))
    expect((await attach('FB-1', png())).status).toBe(403)
    expect(putPrivateFile).not.toHaveBeenCalled()
  })

  it('refuses after the 15-minute window, past 5 files, over 4 MB, or a bad type', async () => {
    await POST(post({ title: 'mine' }))
    for (let i = 0; i < 5; i++)
      expect((await attach('FB-1', png(`${i}.png`))).status).toBe(200)
    expect((await attach('FB-1', png('6.png'))).status).toBe(400)

    await POST(post({ title: 'second' }))
    expect(
      (await attach('FB-2', png('big.png', 4 * 1024 * 1024 + 1))).status
    ).toBe(400)
    const pdf = new File([new Uint8Array(2)], 'a.pdf', {
      type: 'application/pdf',
    })
    expect((await attach('FB-2', pdf)).status).toBe(400)

    db.rows[1]!.createdAt = new Date(Date.now() - 16 * 60_000)
    expect((await attach('FB-2', png())).status).toBe(409)
  })

  const racer = (row: Row, filename: string) => () => {
    row.evidence = [
      ...((row.evidence as unknown[]) ?? []),
      { type: 'file', filename },
    ]
  }

  it('an upload racing another one between read and write loses neither', async () => {
    await POST(post({ title: 'race' }))
    expect((await attach('FB-1', png('first.png'))).status).toBe(200)
    db.afterEvidenceRead = racer(db.rows[0]!, 'racer.png')
    const res = await attach('FB-1', png('mine.png'))
    expect(res.status).toBe(200)
    const names = (db.rows[0]!.evidence as Array<{ filename: string }>).map(
      e => e.filename
    )
    expect(names).toEqual(['first.png', 'racer.png', 'mine.png'])
    // The compare-and-set missed once, then landed on the fresh read.
    expect(fakePrisma.feedback.updateMany).toHaveBeenCalledTimes(3)
  })

  it('a racing upload that fills the last slot makes this one a 400, cap kept', async () => {
    await POST(post({ title: 'full' }))
    for (let i = 0; i < 4; i++)
      expect((await attach('FB-1', png(`${i}.png`))).status).toBe(200)
    db.afterEvidenceRead = racer(db.rows[0]!, 'racer.png')
    expect((await attach('FB-1', png('sixth.png'))).status).toBe(400)
    const evidence = db.rows[0]!.evidence as Array<{ filename: string }>
    expect(evidence).toHaveLength(5)
    expect(evidence.map(e => e.filename)).not.toContain('sixth.png')
  })

  it('parallel uploads keep every entry and stop at 5, never a 409', async () => {
    await POST(post({ title: 'parallel' }))
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const statuses = (
      await Promise.all(names.map(n => attach('FB-1', png(`${n}.png`))))
    ).map(r => r.status)
    expect(statuses.filter(s => s === 200)).toHaveLength(5)
    expect(statuses.filter(s => s === 400)).toHaveLength(3)
    const stored = db.rows[0]!.evidence as Array<{ filename: string }>
    expect(stored).toHaveLength(5)
    expect(new Set(stored.map(e => e.filename)).size).toBe(5)
  })

  it('a JSON null evidence value is matched as JsonNull and replaced', async () => {
    await POST(post({ title: 'null evidence' }))
    db.rows[0]!.evidence = null
    expect((await attach('FB-1', png('only.png'))).status).toBe(200)
    expect(
      fakePrisma.feedback.updateMany.mock.calls[0]![0].where.evidence.equals
    ).toBe(Prisma.JsonNull)
    expect(
      (db.rows[0]!.evidence as Array<{ filename: string }>).map(e => e.filename)
    ).toEqual(['only.png'])
  })

  it('gives up with 409 after repeatedly losing the race', async () => {
    await POST(post({ title: 'busy' }))
    for (let i = 0; i < 6; i++)
      fakePrisma.feedback.updateMany.mockResolvedValueOnce({ count: 0 })
    expect((await attach('FB-1', png())).status).toBe(409)
    // maxEntries + 1 attempts: each lost race is someone else's append.
    expect(fakePrisma.feedback.updateMany).toHaveBeenCalledTimes(6)
  })
})
