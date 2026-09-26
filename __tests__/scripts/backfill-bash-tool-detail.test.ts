import {
  backfillBashToolDetail,
  type BackfillDeps,
} from '@/scripts/backfill-bash-tool-detail'

interface FakeRow {
  id: string
  toolName: string
  toolDetail: string | null
  payload: unknown
}

function bash(id: string, command: unknown): FakeRow {
  return {
    id,
    toolName: 'Bash',
    toolDetail: null,
    payload: { tool_name: 'Bash', tool_input: { command } },
  }
}

/** In-memory stand-in for the prisma-backed deps, honouring the same filters. */
function fakeDeps(rows: FakeRow[]): BackfillDeps & { fetches: number } {
  const deps = {
    fetches: 0,
    async fetchBatch(afterId: string | null, take: number) {
      deps.fetches += 1
      return rows
        .filter(
          r =>
            r.toolName === 'Bash' &&
            r.toolDetail === null &&
            (afterId === null || r.id > afterId)
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take)
        .map(r => ({ id: r.id, payload: r.payload }))
    },
    async update(category: string, ids: string[]) {
      let n = 0
      for (const r of rows) {
        if (ids.includes(r.id) && r.toolDetail === null) {
          r.toolDetail = category
          n += 1
        }
      }
      return n
    },
  }
  return deps
}

function fixture(): FakeRow[] {
  return [
    bash('a1', 'cat lib/a.ts'),
    bash('a2', 'npx jest'),
    bash('a3', 'lumo task status LUM-1'),
    bash('a4', 42), // unreadable command
    bash('a5', 'cd x && git push'),
    {
      id: 'a6',
      toolName: 'Read',
      toolDetail: null,
      payload: { tool_name: 'Read' },
    },
    { ...bash('a7', 'npx jest'), toolDetail: 'test' }, // already classified
  ]
}

describe('backfillBashToolDetail', () => {
  it('classifies unclassified Bash rows across batches', async () => {
    const rows = fixture()
    const deps = fakeDeps(rows)
    const result = await backfillBashToolDetail(deps, {
      dryRun: false,
      batchSize: 2,
    })
    expect(result).toMatchObject({ scanned: 5, unreadable: 1, updated: 4 })
    expect(deps.fetches).toBeGreaterThan(1)
    const detail = Object.fromEntries(rows.map(r => [r.id, r.toolDetail]))
    expect(detail).toEqual({
      a1: 'read',
      a2: 'test',
      a3: 'lumo',
      a4: null,
      a5: 'git-write',
      a6: null,
      a7: 'test',
    })
  })

  it('writes nothing on a dry run but still reports the counts', async () => {
    const rows = fixture()
    const deps = fakeDeps(rows)
    const update = jest.spyOn(deps, 'update')
    const result = await backfillBashToolDetail(deps, {
      dryRun: true,
      batchSize: 500,
    })
    expect(update).not.toHaveBeenCalled()
    expect(result.byCategory).toEqual({
      read: 1,
      test: 1,
      lumo: 1,
      'git-write': 1,
    })
    expect(
      rows.filter(r => r.toolName === 'Bash' && !r.toolDetail)
    ).toHaveLength(5)
  })

  it('is idempotent: a second run updates nothing', async () => {
    const rows = fixture()
    await backfillBashToolDetail(fakeDeps(rows), {
      dryRun: false,
      batchSize: 3,
    })
    const again = await backfillBashToolDetail(fakeDeps(rows), {
      dryRun: false,
      batchSize: 3,
    })
    expect(again.updated).toBe(0)
    expect(again.scanned).toBe(1) // only the unreadable row remains null
  })
})
