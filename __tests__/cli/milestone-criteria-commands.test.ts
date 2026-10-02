/**
 * @jest-environment node
 *
 * LUM-643: `lumo milestone criteria set / list / verdict` — CLI round-trip
 * against a mocked API. Covers the request shapes (PUT contract, GET list,
 * POST verdict), the X-Lumo-Session-Id steward provenance header, the
 * criterion id-prefix selector, and the printed gate state.
 */
const mockReadCredentials = jest.fn()
const mockResolveMilestoneId = jest.fn()
const mockReadFileUtf8 = jest.fn()

jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: (...a: unknown[]) => mockReadCredentials(...a),
}))
jest.mock('@/cli/src/lib/api', () => ({
  resolveAuthedApiUrl: (u: string) => u,
  trimTrailingSlash: (u: string) => u.replace(/\/+$/, ''),
}))
jest.mock('@/cli/src/lib/resolve', () => ({
  resolveMilestoneId: (...a: unknown[]) => mockResolveMilestoneId(...a),
}))
jest.mock('@/cli/src/lib/doc-input', () => ({
  readFileUtf8: async (...a: unknown[]) => mockReadFileUtf8(...a),
  unreadableFileMessage: (p: string) => `Error: cannot read ${p}`,
}))
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: (p: string) => ({ ok: true, resolved: p }),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { milestoneCriteriaSet } from '@/cli/src/commands/milestone-criteria-set'
import { milestoneCriteriaList } from '@/cli/src/commands/milestone-criteria-list'
import {
  milestoneCriteriaVerdict,
  resolveCriterionSelector,
} from '@/cli/src/commands/milestone-criteria-verdict'

function exitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmexit000001abcdef',
    statement: 'Prod deploy carries every LUM-64x migration',
    referentKind: 'EXTERNAL_FACT',
    source: 'AGENT_DRAFT',
    verdict: null,
    verdictNote: null,
    verdictEvidence: null,
    verdictAt: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const fetchMock = jest.fn()
let stdoutSpy: jest.SpyInstance
let stderrSpy: jest.SpyInstance
const originalSessionId = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  mockReadCredentials.mockReturnValue({
    token: 'key-1',
    apiUrl: 'http://api.test',
    workspaceSlug: 'lumo',
  })
  mockResolveMilestoneId.mockResolvedValue({
    id: 'm-1',
    name: 'Agent-Native Milestones',
    projectId: 'p-1',
  })
  process.env.CLAUDE_CODE_SESSION_ID = 'cc-steward-1'
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
  if (originalSessionId === undefined) {
    delete process.env.CLAUDE_CODE_SESSION_ID
  } else {
    process.env.CLAUDE_CODE_SESSION_ID = originalSessionId
  }
})

function stdoutText(): string {
  return stdoutSpy.mock.calls.map(c => String(c[0])).join('')
}

describe('lumo milestone criteria CLI (LUM-643)', () => {
  it('milestone criteria commands round-trip set list verdict', async () => {
    // ── set ──────────────────────────────────────────────────────────────
    mockReadFileUtf8.mockReturnValue(
      JSON.stringify([
        {
          statement: 'Prod deploy carries every LUM-64x migration',
          referentKind: 'EXTERNAL_FACT',
        },
      ])
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ criteria: [exitRow()] }))

    const setResult = await milestoneCriteriaSet('Agent-Native Milestones', {
      file: 'exit-criteria.json',
    })
    expect(setResult).toBeUndefined()

    const [setUrl, setInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]
    expect(setUrl).toBe('http://api.test/api/milestones/m-1/criteria')
    expect(setInit.method).toBe('PUT')
    // Steward/session provenance rides the header on the draft.
    expect(setInit.headers['X-Lumo-Session-Id']).toBe('cc-steward-1')
    expect(JSON.parse(String(setInit.body))).toEqual({
      source: 'AGENT_DRAFT',
      criteria: [
        {
          statement: 'Prod deploy carries every LUM-64x migration',
          referentKind: 'EXTERNAL_FACT',
        },
      ],
    })
    expect(stdoutText()).toContain('Exit contract set (1 criteria)')

    // ── list ─────────────────────────────────────────────────────────────
    stdoutSpy.mockClear()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        criteria: [exitRow(), exitRow({ id: 'cmexit000002ghijkl' })],
        unresolvedCount: 2,
      })
    )
    await milestoneCriteriaList('Agent-Native Milestones', {})
    const listCall = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(listCall[0]).toBe('http://api.test/api/milestones/m-1/criteria')
    expect(stdoutText()).toContain('[PENDING]')
    expect(stdoutText()).toContain(
      '2 unresolved (pending or NOT_MET) — the close gate refuses status→COMPLETED'
    )

    // ── verdict (id-prefix selector, --met with evidence) ────────────────
    stdoutSpy.mockClear()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          criteria: [exitRow(), exitRow({ id: 'cmexit000002ghijkl' })],
          unresolvedCount: 2,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          criterion: exitRow({
            verdict: 'MET',
            verdictEvidence: 'prisma migrate status @ prod',
            verdictAt: '2026-07-02T00:00:00.000Z',
          }),
        })
      )
    const verdictResult = await milestoneCriteriaVerdict(
      'Agent-Native Milestones',
      'cmexit000001',
      { met: true, evidence: 'prisma migrate status @ prod' }
    )
    expect(verdictResult).toBeUndefined()

    const [verdictUrl, verdictInit] = fetchMock.mock.calls[3] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]
    expect(verdictUrl).toBe(
      'http://api.test/api/milestones/m-1/criteria/cmexit000001abcdef/verdict'
    )
    expect(verdictInit.method).toBe('POST')
    expect(verdictInit.headers['X-Lumo-Session-Id']).toBe('cc-steward-1')
    expect(JSON.parse(String(verdictInit.body))).toEqual({
      verdict: 'MET',
      evidence: 'prisma migrate status @ prod',
    })
    expect(stdoutText()).toContain('Adjudicated MET')
    expect(stdoutText()).toContain('[MET]')
  })

  it('verdict refuses ambiguous or short criterion selectors before any write', async () => {
    const rows = [
      { id: 'cmexit000001abcdef', statement: 'a' },
      { id: 'cmexit000002ghijkl', statement: 'b' },
    ]
    // Shared prefix of both ids → ambiguous.
    const ambiguous = resolveCriterionSelector('cmexit', rows)
    expect(ambiguous).toMatchObject({ ok: false })
    // Too short to be a selector at all.
    const short = resolveCriterionSelector('cmex', rows)
    expect(short).toMatchObject({ ok: false })
    // Unique prefix resolves.
    expect(resolveCriterionSelector('cmexit000002', rows)).toEqual({
      ok: true,
      id: 'cmexit000002ghijkl',
    })

    // End-to-end: --met and --unmet together is refused with no fetch.
    const result = await milestoneCriteriaVerdict('Milestone', 'cmexit000001', {
      met: true,
      unmet: true,
    })
    expect(result).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
