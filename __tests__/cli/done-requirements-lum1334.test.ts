/**
 * @jest-environment node
 *
 * LUM-1334 — the CLI side of the DONE requirements: `lumo workspace
 * done-requirements show|update` (every change exit-4 gated, OWNER only),
 * the `DONE_REQUIREMENT` rows in `task status`, the status digest that
 * decides one-step DONE, DONE readiness, the gate row, and the exit-5
 * blocker list.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import {
  buildDoneRequirementsUpdate,
  describeDoneRequirementChanges,
  formatDoneRequirements,
  workspaceDoneRequirements,
  workspaceDoneRequirementsUpdate,
  type DoneRequirementsView,
} from '@/cli/src/commands/workspace-done-requirements'
import {
  formatTaskStatus,
  splitNextActions,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import { assessDigest, digestClearsDone } from '@/cli/src/lib/status-digest'
import { requirementsRow } from '@/cli/src/lib/done-gate-format'
import {
  buildRemediation,
  collectDoneBlockers,
} from '@/cli/src/lib/blocked-error'

const OFF: DoneRequirementsView = {
  testCase: false,
  review: false,
  canEdit: true,
}

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>

function serve(responses: Array<{ body: unknown; status?: number }>): void {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => jest.restoreAllMocks())

const requirementRow = (
  requirement: 'TEST_CASE' | 'REVIEW',
  prNumber = 12
) => ({
  kind: 'DONE_REQUIREMENT' as const,
  requirement,
  prNumber,
  statement: `PR #${prNumber} has no ${requirement === 'TEST_CASE' ? 'passing test-case run' : 'review'} on its latest commit`,
  blocking: true as const,
})

function status(over: Partial<TaskStatusResponse> = {}): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-9001',
      title: 'Gate me',
      status: 'IN_REVIEW',
    },
    nextActions: [],
    securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [], scans: [] },
    ...over,
  } as TaskStatusResponse
}

describe('buildDoneRequirementsUpdate / describeDoneRequirementChanges', () => {
  it('maps on/off flags and rejects anything else', () => {
    expect(buildDoneRequirementsUpdate({})).toBeNull()
    expect(
      buildDoneRequirementsUpdate({ testCase: 'ON', review: 'off' })
    ).toEqual({ testCase: true, review: false })
    expect(() => buildDoneRequirementsUpdate({ review: 'yes' })).toThrow(
      /invalid --review "yes"/
    )
  })

  it('describes only the switches that change, both directions', () => {
    expect(
      describeDoneRequirementChanges(OFF, { testCase: true, review: false })
    ).toEqual([
      expect.stringMatching(
        /^Will require a passing test case .* workspace-wide/
      ),
    ])
    expect(
      describeDoneRequirementChanges(
        { ...OFF, review: true },
        { review: false }
      )
    ).toEqual([expect.stringMatching(/^Will stop requiring a review/)])
    expect(describeDoneRequirementChanges(OFF, { testCase: false })).toEqual([])
  })

  it('formats the settings', () => {
    const text = formatDoneRequirements({
      ...OFF,
      review: true,
      canEdit: false,
    })
    expect(text).toMatch(/Passing test case:\s+off/)
    expect(text).toMatch(/Review:\s+on/)
    expect(text).toMatch(/Only workspace owners/)
  })
})

describe('lumo workspace done-requirements', () => {
  it('show reads with GET', async () => {
    serve([{ body: OFF }])
    expect(await workspaceDoneRequirements({})).toBeUndefined()
    expect(calls.map(c => c.url)).toEqual([
      'https://api.lumo.test/api/workspaces/me/done-requirements',
    ])
    expect(out).toMatch(/Passing test case:\s+off/)
  })

  it('update without --confirm prints the envelope and sends no PATCH', async () => {
    serve([{ body: OFF }])
    expect(await workspaceDoneRequirementsUpdate({ testCase: 'on' })).toBe(4)
    expect(calls).toHaveLength(1)
    const env = JSON.parse(out)
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('workspace done-requirements update')
    expect(env.changes[0]).toMatch(/^Will require a passing test case/)
  })

  it('update with --confirm sends only the flags given', async () => {
    serve([{ body: OFF }, { body: { ...OFF, testCase: true } }])
    expect(
      await workspaceDoneRequirementsUpdate({ testCase: 'on', confirm: true })
    ).toBeUndefined()
    expect(calls[1]!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ testCase: true })
    expect(out).toMatch(/Done requirements saved/)
  })

  it('a no-op update sends nothing and needs no confirmation', async () => {
    serve([{ body: OFF }])
    expect(
      await workspaceDoneRequirementsUpdate({ review: 'off' })
    ).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('refuses a non-owner before asking for confirmation, and an empty update', async () => {
    serve([{ body: { ...OFF, canEdit: false } }])
    expect(await workspaceDoneRequirementsUpdate({ review: 'on' })).toBe(1)
    expect(err).toMatch(/only workspace owners/)
    expect(await workspaceDoneRequirementsUpdate({})).toBe(2)
  })
})

describe('task status, digest and readiness', () => {
  it('splits the rows into their own bucket, never advisory', () => {
    const split = splitNextActions([requirementRow('REVIEW')])
    expect(split.requirements).toHaveLength(1)
    expect(split.testCase).toHaveLength(0)
  })

  it('task status lists them as blocking, not "advisory only"', () => {
    const text = formatTaskStatus(
      status({ nextActions: [requirementRow('TEST_CASE')] })
    )
    expect(text).toMatch(/Next actions\n/)
    expect(text).not.toMatch(/advisory only/)
    expect(text).toMatch(
      /\[REQUIRED\] PR #12 has no passing test-case run[\s\S]*\(blocks DONE\)/
    )
  })

  it('the digest counts them, so one-step DONE does not fire', () => {
    const v = assessDigest({
      identifier: 'LUM-9001',
      status: {
        ok: true,
        value: status({
          nextActions: [
            requirementRow('TEST_CASE'),
            requirementRow('REVIEW', 13),
          ],
        }),
      },
      crossings: { status: 'ok', crossings: [], gateEnabled: true },
    })
    expect(v.blocking).toEqual([
      '2 missing requirements (PR #12 test case, PR #13 review)',
    ])
    expect(digestClearsDone(v)).toBe(false)
  })

  it('an unreadable requirements plane is "could not confirm"', () => {
    const v = assessDigest({
      identifier: 'LUM-9001',
      status: {
        ok: true,
        value: status({
          doneGate: { confirmed: false, unconfirmed: ['done requirements'] },
        }),
      },
      crossings: { status: 'ok', crossings: [], gateEnabled: true },
    })
    expect(v.unconfirmed).toEqual(['done requirements'])
    expect(digestClearsDone(v)).toBe(false)
  })

  it('the gate row names each PR, or what is required', () => {
    expect(
      requirementsRow({
        state: 'blocked',
        switches: { testCase: true, review: true },
        missing: [
          { requirement: 'TEST_CASE', prNumber: 12 },
          { requirement: 'REVIEW', prNumber: 12 },
        ],
      })
    ).toBe('✗ PR #12 needs a passing test case · PR #12 needs a review')
    expect(
      requirementsRow({
        state: 'clear',
        switches: { testCase: true, review: true },
        missing: [],
      })
    ).toBe("✓ passing test case + review on every PR's latest commit")
  })
})

describe('DONE_BLOCKED (exit 5)', () => {
  it('lists each requirement row as a blocker', async () => {
    serve([
      { body: status({ nextActions: [requirementRow('REVIEW')] }) },
      { body: { crossings: [], gateEnabled: true } },
    ])
    const r = await collectDoneBlockers({
      base: 'https://api.lumo.test',
      token: 'tok',
      identifier: 'LUM-9001',
    })
    expect(r.blockers).toEqual([
      {
        kind: 'DONE_REQUIREMENT',
        requirement: 'REVIEW',
        prNumber: 12,
        statement: expect.stringContaining('PR #12'),
      },
    ])
  })

  it('remediation says it is evidence the agent may supply, never fake', () => {
    const lines = buildRemediation(
      [
        {
          kind: 'DONE_REQUIREMENT',
          requirement: 'TEST_CASE',
          prNumber: 12,
          statement: 's',
        },
        {
          kind: 'DONE_REQUIREMENT',
          requirement: 'REVIEW',
          prNumber: 13,
          statement: 's',
        },
      ],
      [],
      { identifier: 'LUM-9001', dispositionUrl: 'https://x' }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^DONE_REQUIREMENT: /)
    expect(lines[0]).toContain('lumo task testcase run LUM-9001/TC<n>')
    expect(lines[0]).toContain('PR #13')
    expect(lines[0]).toContain('lumo review import')
    expect(lines[0]).toContain('never fake a run')
  })
})
