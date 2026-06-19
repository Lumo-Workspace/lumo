/**
 * @jest-environment node
 *
 * LUM-547 — `lumo memory sync` runs code-anchor staleness detection after
 * downsync and reports stale candidates to the server; `--no-anchor-check`
 * skips it; the sync/detection path writes nothing to Memory.status.
 */
import {
  createRepoProbe,
  detectStaleCandidates,
  reportStaleCandidates,
  shouldRunAnchorCheck,
} from '@/cli/src/lib/anchor-staleness'
import type { AnchorProbe } from '../../shared/src/code-anchor'

describe('createRepoProbe — git-tracked existence (not the dirty working tree)', () => {
  const probe = createRepoProbe(process.cwd())

  it('reports a committed file as existing and a ghost path as absent', () => {
    expect(probe.fileExists('package.json')).toBe(true)
    expect(probe.fileExists('lib/__nope__/ghost.ts')).toBe(false)
  })

  it('reports a committed symbol as existing and a nonsense symbol as absent', () => {
    expect(probe.symbolExists('sanitizeField')).toBe(true)
    // Assemble the absent token at runtime so the full word never appears as a
    // literal in this (git-tracked) file — otherwise `git grep` would find it
    // here and the probe would (correctly) report it present.
    const absent = ['zqx', 'nosuch', 'symbol', '4717'].join('')
    expect(probe.symbolExists(absent)).toBe(false)
  })
})

describe('detectStaleCandidates', () => {
  const probe: AnchorProbe = {
    fileExists: p => p === 'lib/real.ts',
    symbolExists: n => n === 'realSymbol',
  }

  it('reports only the memories whose every anchor is dead', () => {
    const candidates = detectStaleCandidates(
      [
        { id: 'm-dead', body: 'gone: lib/gone.ts and `deadSymbol`' },
        { id: 'm-alive', body: 'still here: lib/real.ts' },
        { id: 'm-mixed', body: '`realSymbol` moved to lib/gone.ts' },
        { id: 'm-none', body: 'prefer async/await' },
      ],
      probe
    )
    expect(candidates.map(c => c.memoryId)).toEqual(['m-dead'])
    expect(candidates[0]!.deadAnchors).toEqual(
      expect.arrayContaining([
        { kind: 'file', value: 'lib/gone.ts' },
        { kind: 'symbol', value: 'deadSymbol' },
      ])
    )
  })
})

describe('reportStaleCandidates — POSTs to the stale-anchors endpoint only', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch
  })

  it('POSTs the candidates with bearer auth to the stale-anchors endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recorded: 1 }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await reportStaleCandidates(
      'https://api.test',
      'tok',
      'proj1',
      [
        {
          memoryId: 'm1',
          deadAnchors: [{ kind: 'file', value: 'lib/gone.ts' }],
        },
      ]
    )

    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://api.test/api/projects/proj1/memories/stale-anchors'
    )
    // invariant: detection NEVER calls an archive/retire/invalidate mutation
    expect(String(url)).not.toMatch(/retire|archive|invalidate/)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({
      candidates: [
        {
          memoryId: 'm1',
          deadAnchors: [{ kind: 'file', value: 'lib/gone.ts' }],
        },
      ],
    })
  })

  it('makes no network call when there are no candidates', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await reportStaleCandidates(
      'https://api.test',
      'tok',
      'proj1',
      []
    )
    expect(res.ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('shouldRunAnchorCheck — gating', () => {
  it('runs by default', () => {
    expect(shouldRunAnchorCheck({})).toBe(true)
  })
  it('skips when --no-anchor-check is given (anchorCheck === false)', () => {
    expect(shouldRunAnchorCheck({ anchorCheck: false })).toBe(false)
  })
  it('skips on --dry-run and --clean (no server write from a preview/rollback)', () => {
    expect(shouldRunAnchorCheck({ dryRun: true })).toBe(false)
    expect(shouldRunAnchorCheck({ clean: true })).toBe(false)
  })
})
