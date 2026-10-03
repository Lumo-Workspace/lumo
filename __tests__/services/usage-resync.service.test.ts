/**
 * @jest-environment node
 *
 * LUM-932 `lumo usage resync`: the service's planning rules with mocked
 * repositories — ownership, eligibility, per-session "only lower", target
 * split, dry run vs apply. The real-Postgres suite covers the writes.
 */
jest.mock('@/lib/repositories/usage-resync.repository', () => ({
  usageResyncRepository: {
    findFamilyForMember: jest.fn(),
    findUsageRows: jest.fn(async () => []),
    applyFamilyResync: jest.fn(async () => undefined),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn(async () => 'wm_1') },
}))

import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  usageResyncRepository,
  type ResyncSessionRow,
} from '@/lib/repositories/usage-resync.repository'
import { usageResyncService } from '@/lib/services/usage-resync.service'

const repo = usageResyncRepository as jest.Mocked<typeof usageResyncRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>

const identity = {
  user: { id: 'clerk_1' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}
const u = (
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number
) => ({ input, output, cacheRead, cacheCreation })
const flat = (i: number, o: number, r: number, c: number) => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: r,
  cacheCreationTokens: c,
})
const PRE = new Date('2026-10-02T00:00:00Z')

function row(
  id: string,
  byModel: Record<string, ReturnType<typeof u>> | null,
  extra: Partial<ResyncSessionRow> = {}
): ResyncSessionRow {
  const t = Object.values(byModel ?? {}).reduce(
    (a, v) =>
      u(
        a.input + v.input,
        a.output + v.output,
        a.cacheRead + v.cacheRead,
        a.cacheCreation + v.cacheCreation
      ),
    u(0, 0, 0, 0)
  )
  return {
    id,
    workspaceId: 'ws_1',
    lastActivityAt: PRE,
    usageResyncedAt: null,
    ...(byModel
      ? flat(t.input, t.output, t.cacheRead, t.cacheCreation)
      : flat(0, 0, 0, 0)),
    ...(byModel
      ? {}
      : {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
        }),
    usageByModel: byModel,
    liveUsageByModel: null,
    ...extra,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('usage resync corrects historical sessions from deduped transcripts', () => {
  it('refuses a caller who is not a workspace member', async () => {
    misc.findMemberIdForHook.mockResolvedValueOnce(null)
    await expect(
      usageResyncService.resync({ identity, dryRun: true, sessions: [] })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('reports a foreign or unknown session as not_found and looks it up by the caller member', async () => {
    repo.findFamilyForMember.mockResolvedValueOnce(null)
    const res = await usageResyncService.resync({
      identity,
      dryRun: true,
      sessions: [
        {
          sessionId: 's1',
          total: flat(1, 1, 1, 1),
          byModel: { m: u(1, 1, 1, 1) },
          bySubagent: { a1: { total: flat(0, 0, 0, 0), byModel: {} } },
        },
      ],
    })
    expect(res.results).toEqual([
      { sessionId: 's1', status: 'skipped', reason: 'not_found' },
    ])
    expect(repo.findFamilyForMember).toHaveBeenCalledWith('s1', 'wm_1', [
      's1:a1',
    ])
  })

  it('skips the family when a child was active after the cutoff', async () => {
    repo.findFamilyForMember.mockResolvedValueOnce({
      root: row('s1', { m: u(10, 10, 10, 10) }),
      children: [
        row(
          's1:a1',
          { m: u(10, 10, 10, 10) },
          {
            lastActivityAt: new Date('2026-10-03T07:13:35Z'),
          }
        ),
      ],
    })
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [
        {
          sessionId: 's1',
          total: flat(2, 2, 2, 2),
          byModel: { m: u(2, 2, 2, 2) },
          bySubagent: {
            a1: { total: flat(1, 1, 1, 1), byModel: { m: u(1, 1, 1, 1) } },
          },
        },
      ],
    })
    expect(res.results[0]).toEqual({
      sessionId: 's1',
      status: 'skipped',
      reason: 'active_after_cutoff',
    })
    expect(repo.applyFamilyResync).not.toHaveBeenCalled()
  })

  it('corrects only the sessions whose new total is lower and clamps the root share at zero', async () => {
    repo.findFamilyForMember.mockResolvedValueOnce({
      // Root stored 8; new root share = total − child = clamp(…) below.
      root: row('s1', { m: u(2, 2, 2, 2) }),
      children: [row('s1:a1', { m: u(40, 40, 40, 40) })],
    })
    repo.findUsageRows.mockResolvedValueOnce([
      { id: 'e1', sessionId: 's1:a1', usageByModel: { m: u(40, 40, 40, 40) } },
    ])
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [
        {
          sessionId: 's1',
          // Root share: m = 22−20 … input 2, output 2, cacheRead 0 (clamped
          // from −1), cacheCreation 3 → total 7 < 8 → corrected too.
          total: flat(22, 22, 19, 23),
          byModel: { m: u(22, 22, 19, 23) },
          bySubagent: {
            a1: {
              total: flat(20, 20, 20, 20),
              byModel: { m: u(20, 20, 20, 20) },
            },
          },
        },
      ],
    })
    expect(res.results[0]).toEqual({
      sessionId: 's1',
      status: 'resynced',
      before: 168,
      after: 87,
      sessionsCorrected: 2,
      rowsScaled: 1,
    })
    const write = repo.applyFamilyResync.mock.calls[0]![0]
    expect(write.workspaceMemberId).toBe('wm_1')
    const rootWrite = write.sessions.find(s => s.sessionId === 's1')!
    expect(rootWrite.usage).toEqual({
      ...flat(2, 2, 0, 3),
      usageByModel: { m: u(2, 2, 0, 3) },
    })
    const childWrite = write.sessions.find(s => s.sessionId === 's1:a1')!
    expect(childWrite.rows).toEqual([
      { id: 'e1', usageByModel: { m: u(20, 20, 20, 20) } },
    ])
  })

  it('leaves a not-lower session untouched while correcting its inflated child', async () => {
    repo.findFamilyForMember.mockResolvedValueOnce({
      root: row('s1', { m: u(1, 1, 1, 1) }),
      children: [row('s1:a1', { m: u(10, 10, 10, 10) })],
    })
    const res = await usageResyncService.resync({
      identity,
      dryRun: true,
      sessions: [
        {
          sessionId: 's1',
          total: flat(6, 6, 6, 6),
          byModel: { m: u(6, 6, 6, 6) },
          bySubagent: {
            a1: { total: flat(5, 5, 5, 5), byModel: { m: u(5, 5, 5, 5) } },
          },
        },
      ],
    })
    expect(res.results[0]).toEqual({
      sessionId: 's1',
      status: 'would_resync',
      before: 44,
      after: 24,
      sessionsCorrected: 1,
      rowsScaled: 0,
    })
    expect(repo.findUsageRows).toHaveBeenCalledWith(['s1:a1'])
    expect(repo.applyFamilyResync).not.toHaveBeenCalled()
  })

  it('reports already_resynced when the guarded write loses a race', async () => {
    repo.findFamilyForMember.mockResolvedValueOnce({
      root: row('s1', { m: u(10, 10, 10, 10) }),
      children: [],
    })
    repo.applyFamilyResync.mockRejectedValueOnce(
      Object.assign(new Error('changed'), { status: 409 })
    )
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [
        {
          sessionId: 's1',
          total: flat(1, 1, 1, 1),
          byModel: { m: u(1, 1, 1, 1) },
        },
      ],
    })
    expect(res.results[0]).toEqual({
      sessionId: 's1',
      status: 'skipped',
      reason: 'already_resynced',
    })
  })
})
