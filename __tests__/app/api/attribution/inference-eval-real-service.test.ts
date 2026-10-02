/**
 * @jest-environment node
 *
 * LUM-932 P2: the inference-eval route through the real service and engine.
 * Only auth, member lookup and the attribution repository are mocked.
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    listExplicitRootSessionsForMember: jest.fn(),
    loadFamily: jest.fn(),
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
    commitFamilyAttribution: jest.fn(),
  },
}))

import { verifyBearer } from '@/lib/auth/bearer'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { extractAttributionSignals } from '@/lib/attribution/signals'
import { GET } from '@/app/api/attribution/inference-eval/route'

const repo = attributionRepository as unknown as Record<
  | 'listExplicitRootSessionsForMember'
  | 'loadFamily'
  | 'resolveIdentifiers'
  | 'taskIdsForBranches'
  | 'commitFamilyAttribution',
  jest.Mock
>
const bearer = verifyBearer as jest.Mock
const findMember = miscRepository.findMemberIdForHook as jest.Mock
const identity = { user: { id: 'u1' }, workspace: { id: 'ws' } }

const req = (qs = '', auth = true) =>
  new Request(`http://x/api/attribution/inference-eval${qs}`, {
    headers: auth ? { Authorization: 'Bearer k' } : {},
  })

let n = 0
function event(
  sessionId: string,
  type: string,
  branch: string,
  extra: Record<string, unknown> = {}
) {
  const payload = { _lumo_branch: branch, cwd: '/work', ...extra }
  n += 1
  return {
    id: `e${n}`,
    sessionId,
    type,
    createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, n)),
    attributionSignals: extractAttributionSignals(type, payload),
    payload: null,
    payloadPrunedAt: null,
  }
}

function family(id: string, events: ReturnType<typeof event>[]) {
  return {
    workspaceId: 'ws',
    sessions: [
      {
        id,
        parentSessionId: null,
        agentId: null,
        taskId: 't12',
        bindingSource: 'ATTACH',
        startedAt: new Date(Date.UTC(2026, 9, 2)),
      },
    ],
    events,
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  n = 0
  bearer.mockResolvedValue(identity)
  findMember.mockResolvedValue('m1')
  repo.resolveIdentifiers.mockImplementation(
    async (_ws: string, ids: string[]) =>
      new Map(
        ids.flatMap(i =>
          i === 'LUM-12' ? [[i, 't12']] : i === 'LUM-13' ? [[i, 't13']] : []
        ) as [string, string][]
      )
  )
  repo.taskIdsForBranches.mockResolvedValue(new Map())
  repo.listExplicitRootSessionsForMember.mockResolvedValue(['sa', 'sb'])
  const fams: Record<string, ReturnType<typeof family>> = {
    sa: family('sa', [
      event('sa', 'USER_PROMPT_SUBMIT', 'lumo/LUM-12-x', { prompt: 'go' }),
      event('sa', 'USER_PROMPT_SUBMIT', 'lumo/LUM-12-x', { prompt: 'more' }),
    ]),
    sb: family('sb', [
      event('sb', 'USER_PROMPT_SUBMIT', 'main', { prompt: 'do LUM-13 now' }),
      event('sb', 'USER_PROMPT_SUBMIT', 'main', { prompt: 'continue LUM-13' }),
    ]),
  }
  repo.loadFamily.mockImplementation(async (id: string) => fams[id] ?? null)
})

describe('inference-eval route with the real service', () => {
  it('scores two attached sessions with the real engine and defaults to a 7 day window', async () => {
    const before = Date.now()
    const res = await GET(req())
    const after = Date.now()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      sessionsEvaluated: 2,
      sessionCorrect: 1,
      sessionWrong: 1,
      sessionUnlabeled: 0,
      turns: 4,
      correct: 2,
      wrong: 2,
      unlabeled: 0,
      days: 7,
    })
    expect(body.correct + body.wrong + body.unlabeled).toBe(body.turns)

    expect(repo.listExplicitRootSessionsForMember).toHaveBeenCalledTimes(1)
    const [memberId, since, limit] =
      repo.listExplicitRootSessionsForMember.mock.calls[0]!
    expect(memberId).toBe('m1')
    expect(limit).toBe(50)
    const week = 7 * 86_400_000
    expect(since.getTime()).toBeGreaterThanOrEqual(before - week)
    expect(since.getTime()).toBeLessThanOrEqual(after - week)
    expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
  })

  it('401 without a bearer token', async () => {
    bearer.mockResolvedValue(null)
    expect((await GET(req('', false))).status).toBe(401)
    expect(repo.listExplicitRootSessionsForMember).not.toHaveBeenCalled()
  })

  it('400 for days=0', async () => {
    expect((await GET(req('?days=0'))).status).toBe(400)
    expect(repo.listExplicitRootSessionsForMember).not.toHaveBeenCalled()
  })
})
