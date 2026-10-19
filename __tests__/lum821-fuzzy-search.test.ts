/**
 * @jest-environment node
 *
 * LUM-821 fuzzy `task search`: the ranked pg_trgm query (parameterised,
 * AND across terms, short terms exact, number terms, LIKE escaping, the
 * tuned thresholds), the repository wiring (fuzzy → ranked ids → Prisma
 * filters → score order; exact path untouched), the route's `match` param,
 * and the CLI default. The SQL itself was validated against a real Postgres
 * with pg_trgm (see the PR); these pin its shape.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/task-query.service', () => ({
  taskQueryService: { findForWorkspace: jest.fn() },
}))
const mockFindMany = jest.fn()
const mockQueryRaw = jest.fn()
const mockTransaction = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: (...a: unknown[]) => mockFindMany(...a) },
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskQueryService } from '@/lib/services/task-query.service'
import {
  adjacentTranspositions,
  buildTextMatchSql,
  FUZZY_FALLBACK_SIMILARITY,
  FUZZY_STRICT,
  taskRepository,
} from '@/lib/repositories/task.repository'
import { GET } from '@/app/api/tasks/workspace/route'
import { buildTaskListPath } from '@/cli/src/commands/task-list'

beforeEach(() => jest.clearAllMocks())

describe('buildTextMatchSql', () => {
  it('ANDs one clause per term, scoped to the workspace, all values parameterised', () => {
    const q = buildTextMatchSql('ws1', ['oauht', 'redirect'], 500)
    expect(q.text).toContain('p."workspaceId" = $')
    expect(q.text.match(/\) AND \(/g)?.length).toBe(1)
    expect(q.text).toContain('ORDER BY score DESC')
    // user input only ever reaches the query as bind values
    expect(q.text).not.toContain('oauht')
    expect(q.values).toEqual(
      expect.arrayContaining(['ws1', 'oauht', '%oauht%', 'redirect', 500])
    )
  })

  it('fuzzy branch is the indexable strict <<% operator only (one threshold, 0.4)', () => {
    const q = buildTextMatchSql('ws1', ['serch'], 500)
    expect(q.text).toContain('<<% t."title"')
    expect(q.text).toContain('strict_word_similarity(')
    // the dropped word-similarity branch (prod: `probe` ≡ `oauht` in score) must not come back
    expect(q.text).not.toMatch(/(^|[^_])word_similarity\(/)
    expect(FUZZY_STRICT).toBe(0.4)
  })

  it('the matched title word is never under 4 letters (prod: `form` matched every "for")', () => {
    const q = buildTextMatchSql('ws1', ['form'], 500)
    expect(q.text).toMatch(/GREATEST\(length\(\$\d+\) - 1, \$\d+\)/)
    expect(q.values).toContain(4)
  })

  it('a fuzzy hit needs a title word at most one char shorter than the term (prod: `probe` matched "V4-Pro")', () => {
    const q = buildTextMatchSql('ws1', ['probe'], 500)
    expect(q.text).toContain('regexp_split_to_table(lower(t."title")')
    expect(q.text).toContain('length(w) >= GREATEST(length($')
    expect(q.text).toContain('similarity($')
  })

  it('terms under 4 chars stay exact (no trigram branch) — `bug` must not match "Budget"', () => {
    const q = buildTextMatchSql('ws1', ['bug'], 500)
    expect(q.text).not.toContain('<<%')
    expect(q.text).toContain('ILIKE')
  })

  it('number terms also match the task number', () => {
    const q = buildTextMatchSql('ws1', ['LUM-42'], 500)
    expect(q.text).toContain('t."number" = $')
    expect(q.values).toContain(42)
  })

  it('identifier / number terms never fuzzy-match (prod: `LUM-821` pulled in every title quoting `LUM-71`)', () => {
    for (const term of ['LUM-821', '4242']) {
      expect(buildTextMatchSql('ws1', [term], 500).text).not.toContain('<<%')
    }
    // a normal 4+ char word in the same query still does
    expect(buildTextMatchSql('ws1', ['LUM-821', 'serch'], 500).text).toContain(
      '<<%'
    )
  })

  it('escapes LIKE wildcards so `50%` / `a_b` match literally', () => {
    expect(buildTextMatchSql('ws1', ['50%'], 500).values).toContain('%50\\%%')
    expect(buildTextMatchSql('ws1', ['a_b'], 500).values).toContain('%a\\_b%')
  })
})

describe('adjacent transpositions (LUM-821 swap fallback)', () => {
  it('lists every one-adjacent-swap spelling, deduped, without the term itself', () => {
    expect(adjacentTranspositions('oauht')).toEqual([
      'aouht',
      'ouaht',
      'oahut',
      'oauth',
    ])
    // swapping two identical letters yields the term itself → dropped
    expect(adjacentTranspositions('seek')).toEqual(['esek', 'seke'])
  })

  it('the SQL only carries swap patterns on the fallback pass', () => {
    expect(buildTextMatchSql('ws1', ['oauht'], 500).values).not.toContain(
      '%oauth%'
    )
    const q = buildTextMatchSql('ws1', ['oauht'], 500, { tier: 'swap' })
    expect(q.values).toEqual(expect.arrayContaining(['%oauth%', '%oahut%']))
  })

  it('short and identifier terms never get swap variants', () => {
    for (const term of ['bug', 'LUM-821', '4242']) {
      const q = buildTextMatchSql('ws1', [term], 500, { tier: 'swap' })
      for (const v of adjacentTranspositions(term)) {
        expect(q.values).not.toContain(`%${v}%`)
      }
    }
  })
})

describe('taskRepository.findByWorkspaceWithFilters — tiered fallback (exact → trigram → swap)', () => {
  // exact tier = a bare $queryRaw; fuzzy / swap tiers = a $transaction batch
  // (set_config + ranked query). The mock records every $queryRaw build.
  const ranked = () =>
    mockQueryRaw.mock.calls
      .map(c => c[0])
      .filter(q => q && typeof q === 'object' && 'text' in q) as Array<{
      text: string
      values: unknown[]
    }>

  it('exact tier with hits: returns them ranked, and NEVER runs a typo tier (sweep: `content` must not widen to "context")', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { id: 't-best', score: 2 },
      { id: 't-other', score: 1 },
    ])
    mockFindMany.mockResolvedValue([{ id: 't-other' }, { id: 't-best' }])
    const rows = await taskRepository.findByWorkspaceWithFilters('ws1', {
      q: 'content',
      fuzzy: true,
      statuses: ['TODO'],
    })
    expect(rows.map(r => r.id)).toEqual(['t-best', 't-other'])
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(ranked()[0]!.text).not.toContain('<<%')
    const where = mockFindMany.mock.calls[0]![0].where
    expect(where.id).toEqual({ in: ['t-best', 't-other'] })
    expect(where.status).toEqual({ in: ['TODO'] })
  })

  it('no exact hits → trigram tier (threshold set tx-locally); swap tier not reached when it finds something', async () => {
    mockQueryRaw.mockResolvedValueOnce([]) // exact tier
    mockTransaction.mockResolvedValueOnce([
      [],
      [{ id: 't-search', score: 0.4 }],
    ])
    mockFindMany.mockResolvedValue([{ id: 't-search' }])
    await taskRepository.findByWorkspaceWithFilters('ws1', {
      q: 'serch',
      fuzzy: true,
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    const [, setCall, fuzzyQ] = mockQueryRaw.mock.calls
    expect(String(setCall![0].join('?'))).toContain(
      "set_config('pg_trgm.strict_word_similarity_threshold'"
    )
    expect(setCall!.slice(1)).toEqual([String(FUZZY_FALLBACK_SIMILARITY)])
    expect(fuzzyQ![0].text).toContain('<<%')
    expect(fuzzyQ![0].values).not.toContain('%esrch%')
  })

  it('no exact and no trigram hits → swap tier', async () => {
    mockQueryRaw.mockResolvedValueOnce([]) // exact tier
    mockTransaction
      .mockResolvedValueOnce([[], []]) // trigram tier: nothing
      .mockResolvedValueOnce([[], [{ id: 't-oauth', score: 0.85 }]])
    mockFindMany.mockResolvedValue([{ id: 't-oauth' }])
    const rows = await taskRepository.findByWorkspaceWithFilters('ws1', {
      q: 'oauht',
      fuzzy: true,
    })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(rows.map(r => r.id)).toEqual(['t-oauth'])
    const all = ranked()
    expect(all[all.length - 1]!.values).toContain('%oauth%')
  })

  it('no typo tiers when no term is typo-eligible', async () => {
    mockQueryRaw.mockResolvedValueOnce([])
    mockFindMany.mockResolvedValue([])
    await taskRepository.findByWorkspaceWithFilters('ws1', {
      q: 'bug LUM-9',
      fuzzy: true,
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('exact (fuzzy off): no raw query, Prisma substring clauses as before', async () => {
    mockFindMany.mockResolvedValue([])
    await taskRepository.findByWorkspaceWithFilters('ws1', { q: 'oauth' })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockFindMany.mock.calls[0]![0].where.AND).toHaveLength(1)
  })
})

describe('GET /api/tasks/workspace — match param', () => {
  const req = (qs: string) =>
    new Request(
      `http://localhost/api/tasks/workspace${qs}`
    ) as unknown as NextRequest
  beforeEach(() => {
    ;(requireIdentity as jest.Mock).mockResolvedValue({ workspaceId: 'w1' })
    ;(taskQueryService.findForWorkspace as jest.Mock).mockResolvedValue([])
  })
  it('match=fuzzy → fuzzy: true; default stays exact for the web board', async () => {
    await GET(req('?q=oauht&match=fuzzy'))
    await GET(req('?q=oauth'))
    const calls = (taskQueryService.findForWorkspace as jest.Mock).mock.calls
    expect(calls[0]![1]).toEqual({ q: 'oauht', fuzzy: true })
    expect(calls[1]![1]).toEqual({ q: 'oauth' })
  })
  it('an unknown match mode is 400', async () => {
    expect((await GET(req('?q=x&match=wild'))).status).toBe(400)
  })
})

describe('CLI task list --search query (was task search, LUM-1233)', () => {
  it('sends match=fuzzy by default and match=exact with --exact; no match param without a query', () => {
    const p = (o: object) =>
      new URL(`https://x${buildTaskListPath(o, { limit: 50, offset: 0 })}`)
        .searchParams
    expect(p({ q: 'oauht' }).get('match')).toBe('fuzzy')
    expect(p({ q: 'oauht', exact: true }).get('match')).toBe('exact')
    expect(p({}).has('match')).toBe(false)
  })
})
