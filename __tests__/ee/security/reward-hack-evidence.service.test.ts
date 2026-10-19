/**
 * @jest-environment node
 *
 * LUM-1234 Task 11 — the web evidence view of a REWARD_HACK finding. Drives
 * the real service, its repository, the member repository and the session
 * access rule over a mocked Prisma client: only a member of the finding's
 * workspace gets a view; a session the viewer may not open (not its member,
 * not a workspace OWNER) contributes no step and no prompt and marks the
 * view restricted; pruned events are left out; every text is redacted.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prSecurityFinding: { findUnique: jest.fn() },
    workspaceMember: { findUnique: jest.fn() },
    session: { findMany: jest.fn() },
    hookEvent: { findMany: jest.fn() },
    task: { findFirst: jest.fn() },
    taskSlackContext: { findMany: jest.fn() },
    taskWebLink: { findMany: jest.fn() },
    taskFigmaLink: { findMany: jest.fn() },
    documentMention: { findMany: jest.fn() },
    comment: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: jest.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { rewardHackEvidenceService } from '@/ee/security/services/reward-hack-evidence.service'

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>

interface SessionRow {
  id: string
  workspaceId: string
  workspaceMemberId: string
  parentSessionId: string | null
}
interface EventRow {
  id: string
  sessionId: string
  workspaceId: string
  type: string
  toolName: string | null
  payload: unknown
  createdAt: Date
}

const WS = 'ws1'
const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 10, min))

let sessions: SessionRow[]
let events: EventRow[]

function inList(where: unknown, value: string): boolean {
  if (!where) return true
  const w = where as { in?: string[] }
  if (Array.isArray(w.in)) return w.in.includes(value)
  return where === value
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    kind: 'REWARD_HACK',
    title: 'Weakened the failing assertion instead of fixing the bug',
    detail:
      'Replaced the status assertion with toBeDefined so it always passes.',
    evidence: JSON.stringify({
      eventIds: ['ev-edit', 'ev-prompt', 'ev-stop'],
      sessionIds: ['s1'],
    }),
    scan: { taskId: 't1', workspaceId: WS },
    ...overrides,
  }
}

function viewer(role: 'MEMBER' | 'OWNER', id: string) {
  p.workspaceMember!.findUnique!.mockResolvedValue({
    id,
    workspaceId: WS,
    role,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  sessions = [
    {
      id: 's1',
      workspaceId: WS,
      workspaceMemberId: 'm-own',
      parentSessionId: null,
    },
  ]
  events = [
    {
      id: 'ev-prompt',
      sessionId: 's1',
      workspaceId: WS,
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: { prompt: 'Make the login test pass' },
      createdAt: at(1),
    },
    {
      id: 'ev-edit',
      sessionId: 's1',
      workspaceId: WS,
      type: 'POST_TOOL_USE',
      toolName: 'Edit',
      payload: {
        tool_name: 'Edit',
        tool_input: {
          file_path: '/repo/src/login.test.ts',
          old_string: 'expect(res.status).toBe(200)',
          new_string: 'expect(res.status).toBeDefined()',
        },
      },
      createdAt: at(2),
    },
    {
      id: 'ev-stop',
      sessionId: 's1',
      workspaceId: WS,
      type: 'STOP',
      toolName: null,
      payload: { last_assistant_message: 'All tests pass now.' },
      createdAt: at(3),
    },
  ]
  p.prSecurityFinding!.findUnique!.mockResolvedValue(finding())
  p.session!.findMany!.mockImplementation(
    async (args: { where: { id?: unknown; workspaceId?: string } }) =>
      sessions.filter(
        s =>
          inList(args.where.id, s.id) &&
          (!args.where.workspaceId || s.workspaceId === args.where.workspaceId)
      )
  )
  p.hookEvent!.findMany!.mockImplementation(
    async (args: {
      where: {
        id?: unknown
        sessionId?: unknown
        workspaceId?: string
        type?: string
        createdAt?: { lte?: Date }
      }
    }) => {
      const w = args.where
      return events
        .filter(
          e =>
            inList(w.id, e.id) &&
            inList(w.sessionId, e.sessionId) &&
            (!w.workspaceId || e.workspaceId === w.workspaceId) &&
            inList(w.type, e.type) &&
            (!w.createdAt?.lte || e.createdAt <= w.createdAt.lte)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }
  )
  p.task!.findFirst!.mockResolvedValue({
    title: 'Fix login',
    description: 'Login must return 200 for valid users.',
  })
  for (const m of [
    'taskSlackContext',
    'taskWebLink',
    'taskFigmaLink',
    'documentMention',
    'comment',
  ]) {
    p[m]!.findMany!.mockResolvedValue([])
  }
})

describe('rewardHackEvidenceService.getForViewer', () => {
  it('returns null for a viewer who is not a member of the finding workspace', async () => {
    p.workspaceMember!.findUnique!.mockResolvedValue(null)
    await expect(
      rewardHackEvidenceService.getForViewer('f1', 'clerk-x')
    ).resolves.toBeNull()
    expect(p.workspaceMember!.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId_clerkId: { workspaceId: WS, clerkId: 'clerk-x' },
        }),
      })
    )
  })

  it('returns null for a finding that is not REWARD_HACK, or does not exist', async () => {
    viewer('OWNER', 'm-owner')
    p.prSecurityFinding!.findUnique!.mockResolvedValue(
      finding({ kind: 'SECRET' })
    )
    await expect(
      rewardHackEvidenceService.getForViewer('f1', 'clerk-o')
    ).resolves.toBeNull()
    p.prSecurityFinding!.findUnique!.mockResolvedValue(null)
    await expect(
      rewardHackEvidenceService.getForViewer('f1', 'clerk-o')
    ).resolves.toBeNull()
  })

  it('returns null when the finding is on another task than the one asked for', async () => {
    viewer('OWNER', 'm-owner')
    await expect(
      rewardHackEvidenceService.getForViewer('f1', 'clerk-o', {
        taskId: 'other-task',
      })
    ).resolves.toBeNull()
  })

  it('another MEMBER (not the session member, not OWNER) gets the summary and requirement only, restricted', async () => {
    viewer('MEMBER', 'm-other')
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-m')
    expect(view).not.toBeNull()
    expect(view!.restricted).toBe(true)
    expect(view!.prompts).toEqual([])
    expect(view!.steps).toEqual([])
    expect(view!.summary).toBe(
      'Weakened the failing assertion instead of fixing the bug'
    )
    expect(view!.requirementExcerpt).toContain('Login must return 200')
    // The judge's prose follows the session rule: not for this viewer.
    expect(view!.explanation).toBe('')
    expect(JSON.stringify(view)).not.toContain('toBeDefined so it always')
    expect(JSON.stringify(view)).not.toContain('Make the login test pass')
    // The event payloads of a session the viewer may not open are never read.
    expect(p.hookEvent!.findMany).not.toHaveBeenCalled()
  })

  it('the session member sees the prompt text, the steps and links-ready ids', async () => {
    viewer('MEMBER', 'm-own')
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    expect(view!.restricted).toBe(false)
    expect(view!.explanation).toBe(
      'Replaced the status assertion with toBeDefined so it always passes.'
    )
    expect(view!.prompts).toEqual([
      {
        eventId: 'ev-prompt',
        sessionId: 's1',
        text: 'Make the login test pass',
      },
    ])
    expect(view!.steps).toEqual([
      {
        eventId: 'ev-edit',
        sessionId: 's1',
        kind: 'tool',
        label: 'Edit /repo/src/login.test.ts',
        detail: 'expect(res.status).toBeDefined()',
      },
      {
        eventId: 'ev-stop',
        sessionId: 's1',
        kind: 'stop',
        label: '',
        detail: 'All tests pass now.',
      },
    ])
  })

  it('a Codex apply_patch step is labelled by its first file plus a count, its patch as the detail', async () => {
    viewer('MEMBER', 'm-own')
    const patch =
      '*** Begin Patch\n*** Update File: /repo/src/score.ts\n@@\n+  if (input === 42) return 7\n*** Add File: /repo/src/score.test.ts\n+it()\n*** End Patch'
    events[1] = {
      ...events[1]!,
      toolName: 'apply_patch',
      payload: { tool_name: 'apply_patch', tool_input: { command: patch } },
    }
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    const step = view!.steps.find(s => s.eventId === 'ev-edit')!
    expect(step.label).toBe('apply_patch /repo/src/score.ts (+1 more)')
    expect(step.detail).toContain('if (input === 42) return 7')
  })

  it('a Bash step that writes a file names the file and keeps its command', async () => {
    viewer('MEMBER', 'm-own')
    const command =
      "cd /repo && sed -i 's/toBe(200)/toBeDefined()/' src/login.test.ts"
    events[1] = {
      ...events[1]!,
      toolName: 'Bash',
      payload: { tool_name: 'Bash', tool_input: { command } },
    }
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    const step = view!.steps.find(s => s.eventId === 'ev-edit')!
    expect(step.label).toBe(`Bash /repo/src/login.test.ts: ${command}`)
  })

  it('a Bash step that writes nothing keeps the plain command label', async () => {
    viewer('MEMBER', 'm-own')
    events[1] = {
      ...events[1]!,
      toolName: 'Bash',
      payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    }
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    const step = view!.steps.find(s => s.eventId === 'ev-edit')!
    expect(step.label).toBe('Bash: npm test')
  })

  it('a workspace OWNER who is not the session member sees the evidence too', async () => {
    viewer('OWNER', 'm-owner')
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-o')
    expect(view!.restricted).toBe(false)
    expect(view!.prompts.map(x => x.text)).toEqual(['Make the login test pass'])
    expect(view!.steps).toHaveLength(2)
  })

  it('adds the user prompt that started the turn of a cited step', async () => {
    viewer('MEMBER', 'm-own')
    p.prSecurityFinding!.findUnique!.mockResolvedValue(
      finding({
        evidence: JSON.stringify({ eventIds: ['ev-edit'], sessionIds: ['s1'] }),
      })
    )
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    expect(view!.prompts).toEqual([
      {
        eventId: 'ev-prompt',
        sessionId: 's1',
        text: 'Make the login test pass',
      },
    ])
  })

  it('leaves out events whose payload was pruned', async () => {
    viewer('MEMBER', 'm-own')
    for (const e of events) {
      if (e.id !== 'ev-stop') {
        e.payload = { _lumo_pruned: { at: '2026-10-18T00:00:00Z' } }
      }
    }
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    expect(view!.prompts).toEqual([])
    expect(view!.steps.map(s => s.eventId)).toEqual(['ev-stop'])
    expect(view!.restricted).toBe(false)
  })

  it('a subagent session whose parent the viewer may not open is restricted', async () => {
    viewer('MEMBER', 'm-own')
    sessions = [
      {
        id: 'p1:agent1',
        workspaceId: WS,
        workspaceMemberId: 'm-own',
        parentSessionId: 'p1',
      },
      {
        id: 'p1',
        workspaceId: WS,
        workspaceMemberId: 'm-someone-else',
        parentSessionId: null,
      },
    ]
    for (const e of events) e.sessionId = 'p1:agent1'
    p.prSecurityFinding!.findUnique!.mockResolvedValue(
      finding({
        evidence: JSON.stringify({
          eventIds: ['ev-edit', 'ev-prompt'],
          sessionIds: ['p1:agent1'],
        }),
      })
    )
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    expect(view!.restricted).toBe(true)
    expect(view!.steps).toEqual([])
    expect(view!.prompts).toEqual([])
  })

  it('only reads events of the cited sessions in the finding workspace', async () => {
    viewer('OWNER', 'm-owner')
    events.push({
      id: 'ev-foreign',
      sessionId: 's-foreign',
      workspaceId: 'ws-other',
      type: 'STOP',
      toolName: null,
      payload: { last_assistant_message: 'not this finding' },
      createdAt: at(4),
    })
    p.prSecurityFinding!.findUnique!.mockResolvedValue(
      finding({
        evidence: JSON.stringify({
          eventIds: ['ev-stop', 'ev-foreign'],
          sessionIds: ['s1', 's-foreign'],
        }),
      })
    )
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-o')
    expect(view!.steps.map(s => s.eventId)).toEqual(['ev-stop'])
    // A cited session that is not in the workspace (or gone) is not a
    // permission gap — nothing of it exists to show.
    expect(view!.restricted).toBe(false)
    for (const call of p.hookEvent!.findMany!.mock.calls) {
      expect(call[0].where.workspaceId).toBe(WS)
    }
  })

  it('redacts secrets in prompts, step details and the requirement excerpt, and clips long text', async () => {
    viewer('MEMBER', 'm-own')
    const key = ['AK', 'IA', 'Q'.repeat(16)].join('')
    events[0]!.payload = { prompt: `use ${key} for the test` }
    ;(
      events[1]!.payload as { tool_input: Record<string, string> }
    ).tool_input.new_string = `const k = '${key}'\n${'x'.repeat(5000)}`
    p.task!.findFirst!.mockResolvedValue({
      title: 'Fix login',
      description: `Credentials: ${key}\n${'y'.repeat(5000)}`,
    })
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-own')
    expect(JSON.stringify(view)).not.toContain(key)
    expect(view!.prompts[0]!.text).toContain('for the test')
    expect(view!.steps[0]!.detail.length).toBeLessThanOrEqual(501)
    expect(view!.requirementExcerpt.length).toBeLessThanOrEqual(1501)
    expect(view!.requirementExcerpt).toContain('Credentials:')
  })

  it('a malformed evidence column reads as no cited events', async () => {
    viewer('OWNER', 'm-owner')
    p.prSecurityFinding!.findUnique!.mockResolvedValue(
      finding({ evidence: 'not json' })
    )
    const view = await rewardHackEvidenceService.getForViewer('f1', 'clerk-o')
    expect(view).toMatchObject({ steps: [], prompts: [], restricted: false })
  })
})
