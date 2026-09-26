import {
  backfillBashToolDetail,
  parseArgs,
  type BackfillDeps,
  type ReclassifyScope,
} from '@/scripts/backfill-bash-tool-detail'

interface FakeRow {
  id: string
  toolName: string
  toolDetail: string | null
  toolVerb: string | null
  payload: unknown
}

function bash(
  id: string,
  command: unknown,
  stored: { toolDetail?: string | null; toolVerb?: string | null } = {}
): FakeRow {
  return {
    id,
    toolName: 'Bash',
    toolDetail: stored.toolDetail ?? null,
    toolVerb: stored.toolVerb ?? null,
    payload: { tool_name: 'Bash', tool_input: { command } },
  }
}

/** In-memory stand-in for the prisma-backed deps, honouring the same filters. */
function fakeDeps(
  rows: FakeRow[],
  scope: ReclassifyScope = null
): BackfillDeps & { fetches: number } {
  const inSource = (r: FakeRow) =>
    r.toolName === 'Bash' && (scope === 'all' || r.toolDetail === scope)
  const deps = {
    fetches: 0,
    async fetchBatch(afterId: string | null, take: number) {
      deps.fetches += 1
      return rows
        .filter(r => inSource(r) && (afterId === null || r.id > afterId))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take)
        .map(r => ({
          id: r.id,
          payload: r.payload,
          toolDetail: r.toolDetail,
          toolVerb: r.toolVerb,
        }))
    },
    async update(
      value: { category: string; verb: string | null },
      ids: string[]
    ) {
      let n = 0
      for (const r of rows) {
        if (ids.includes(r.id) && r.toolName === 'Bash') {
          r.toolDetail = value.category
          r.toolVerb = value.verb
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
      toolVerb: null,
      payload: { tool_name: 'Read' },
    },
    bash('a7', 'npx jest', { toolDetail: 'test', toolVerb: 'jest' }),
  ]
}

const snapshot = (rows: FakeRow[]) =>
  Object.fromEntries(rows.map(r => [r.id, [r.toolDetail, r.toolVerb]]))

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
    expect(snapshot(rows)).toEqual({
      a1: ['read', 'cat'],
      a2: ['test', 'jest'],
      a3: ['lumo', 'lumo task'],
      a4: [null, null],
      a5: ['git-write', 'git push'],
      a6: [null, null],
      a7: ['test', 'jest'],
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
    expect(result.changed).toBe(4)
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

  it('reclassifies rows stored as other', async () => {
    const rows = [
      bash('b1', 'pytest tests/', { toolDetail: 'other' }),
      bash('b2', 'foo-new-tool --x', {
        toolDetail: 'other',
        toolVerb: 'foo-new-tool',
      }),
      bash('b3', 'npx jest', { toolDetail: 'test', toolVerb: 'jest' }),
      bash('b4', 'go test ./...'), // unclassified: not this mode's source
    ]
    const dry = await backfillBashToolDetail(fakeDeps(rows, 'other'), {
      dryRun: true,
      batchSize: 1,
    })
    expect(dry).toMatchObject({ scanned: 2, changed: 1, updated: 0 })

    const run = await backfillBashToolDetail(fakeDeps(rows, 'other'), {
      dryRun: false,
      batchSize: 1,
    })
    expect(run.updated).toBe(1)
    expect(snapshot(rows)).toEqual({
      b1: ['test', 'pytest'],
      b2: ['other', 'foo-new-tool'],
      b3: ['test', 'jest'],
      b4: [null, null],
    })

    const again = await backfillBashToolDetail(fakeDeps(rows, 'other'), {
      dryRun: false,
      batchSize: 1,
    })
    expect(again.updated).toBe(0)
  })

  it('reclassifies any category and fills toolVerb', async () => {
    const rows = [
      // Classified before toolVerb existed: category right, command missing.
      bash('d1', 'grep -rn x lib', { toolDetail: 'read' }),
      // A rule change moved it: stored read, now test.
      bash('d2', 'ps aux && pytest', { toolDetail: 'read', toolVerb: 'ps' }),
      // Already current: never written.
      bash('d3', 'cat a.ts', { toolDetail: 'read', toolVerb: 'cat' }),
      bash('d4', 'npx tsc', { toolDetail: 'check' }),
    ]
    const scoped = await backfillBashToolDetail(fakeDeps(rows, 'read'), {
      dryRun: false,
      batchSize: 2,
    })
    expect(scoped).toMatchObject({ scanned: 3, changed: 2, updated: 2 })
    expect(snapshot(rows)).toMatchObject({
      d1: ['read', 'grep'],
      d2: ['test', 'pytest'],
      d3: ['read', 'cat'],
      d4: ['check', null], // outside the 'read' scope
    })

    const all = await backfillBashToolDetail(fakeDeps(rows, 'all'), {
      dryRun: false,
      batchSize: 2,
    })
    expect(all).toMatchObject({ scanned: 4, changed: 1, updated: 1 })
    expect(rows.find(r => r.id === 'd4')!.toolVerb).toBe('tsc')

    const again = await backfillBashToolDetail(fakeDeps(rows, 'all'), {
      dryRun: false,
      batchSize: 2,
    })
    expect(again.changed).toBe(0)
  })

  it('reports the top unrecognised verbs among other rows', async () => {
    const rows = [
      bash('c1', 'frobnicate --all'),
      bash('c2', 'cd x && frobnicate && grep y z'),
      bash('c3', 'zorp build'),
      bash('c4', 'cat a.ts'),
      bash('c5', '# just a note\nfrobnicate'), // comment is not a verb
    ]
    const result = await backfillBashToolDetail(fakeDeps(rows), {
      dryRun: true,
      batchSize: 500,
    })
    expect(result.topOtherVerbs).toEqual([
      { verb: 'frobnicate', count: 3 },
      { verb: 'zorp', count: 1 },
    ])
  })
})

describe('parseArgs', () => {
  it('reads the reclassify scope, keeping --reclassify-other as an alias', () => {
    expect(parseArgs([]).reclassify).toBeNull()
    expect(parseArgs(['--reclassify-other']).reclassify).toBe('other')
    expect(parseArgs(['--reclassify=all']).reclassify).toBe('all')
    expect(parseArgs(['--reclassify=read', '--commit'])).toMatchObject({
      reclassify: 'read',
      dryRun: false,
    })
    expect(() => parseArgs(['--reclassify=bogus'])).toThrow(/--reclassify/)
  })
})
