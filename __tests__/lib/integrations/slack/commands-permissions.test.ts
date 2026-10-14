/**
 * @jest-environment node
 *
 * LUM-1102 — Slack `done` / `in-review` / `assign` write through the same
 * service entry as the web `PATCH /api/tasks/[id]` and the CLI
 * (`updateTaskWithSideEffects`), so they get the same checks:
 *   - only an active member of the install's workspace may write;
 *   - DONE passes the DONE gate (Slack, like the CLI, never overrides it);
 *   - a status change emits the `task.statusChanged` core event (the
 *     security plugin's IN_REVIEW policy check listens to it).
 * A refusal is a reply only the caller sees, and the task is left unchanged.
 *
 * The real Slack command, Slack service, Slack repository and task-state
 * service run; Prisma, the task repository and the side-effect fan-out are
 * mocked.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: jest.fn() },
    team: { findFirst: jest.fn() },
    task: { findFirst: jest.fn(), update: jest.fn() },
    actor: { findUnique: jest.fn() },
  },
}))

const USERS: Record<string, { firstName: string; email: string }> = {
  user_1: { firstName: 'Dev', email: 'dev@example.com' },
  user_2: { firstName: 'Ada', email: 'ada@example.com' },
  user_gone: { firstName: 'Gone', email: 'gone@example.com' },
}
// LUM-1115: the member lookup asks the directory by email (one call); like
// the real directory, an unknown email or id is simply absent from `data`.
jest.mock('@/lib/auth/users', () => ({
  createUserDirectory: async () => ({
    getUserList: async ({
      userId = [],
      emailAddress = [],
    }: {
      userId?: string[]
      emailAddress?: string[]
    }) => ({
      data: Object.keys(USERS)
        .filter(
          id =>
            userId.includes(id) ||
            emailAddress.some(
              e => e.toLowerCase() === USERS[id]!.email.toLowerCase()
            )
        )
        .map(id => ({
          id,
          firstName: USERS[id]!.firstName,
          lastName: '',
          username: null,
          primaryEmailAddressId: `em_${id}`,
          emailAddresses: [{ id: `em_${id}`, emailAddress: USERS[id]!.email }],
        })),
    }),
  }),
}))

const mockFindForUpdate = jest.fn()
const mockRepoUpdate = jest.fn()
const mockFindActorById = jest.fn()
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: (...a: unknown[]) => mockFindForUpdate(...a),
    update: (...a: unknown[]) => mockRepoUpdate(...a),
    findActorById: (...a: unknown[]) => mockFindActorById(...a),
  },
}))

const mockReadDoneVerdict = jest.fn()
jest.mock('@/lib/services/done-verdict.service', () => ({
  readDoneVerdict: (...a: unknown[]) => mockReadDoneVerdict(...a),
}))

const mockDispatchSideEffects = jest.fn()
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchUpdateTaskSideEffects: (...a: unknown[]) =>
    mockDispatchSideEffects(...a),
}))

const mockEmitCoreEvent = jest.fn()
jest.mock('@/lib/plugins/events', () => ({
  emitCoreEvent: (...a: unknown[]) => mockEmitCoreEvent(...a),
}))

// The DONE-time fan-out is fire-and-forget; none of it is under test here.
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: () => {} }))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: () => {},
}))
jest.mock('@/lib/services/retrospective.service', () => ({
  captureRetrospectiveSnapshotInBackground: () => {},
}))
jest.mock('@/lib/services/memory/fold-dispatch', () => ({
  dispatchProjectFold: async () => {},
}))
jest.mock('@/lib/services/run-summary-dispatch', () => ({
  dispatchRunSummaries: async () => {},
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {},
}))

import { prisma } from '@/lib/db/prisma'
import { handleCommand } from '@/lib/integrations/slack/commands'

const p = prisma as unknown as {
  workspaceMember: { findMany: jest.Mock }
  team: { findFirst: jest.Mock }
  task: { findFirst: jest.Mock; update: jest.Mock }
  actor: { findUnique: jest.Mock }
}

const SLACK_EMAILS: Record<string, string> = {
  U1: 'dev@example.com',
  U2: 'ada@example.com',
  // A Slack user whose Lumo membership was deactivated.
  U_GONE: 'gone@example.com',
}

// The workspace's member rows, deactivated one included: the mocked query
// honours a `deactivatedAt: null` filter, so dropping the active-member
// filter would let U_GONE through and fail the tests below.
const MEMBER_ROWS = [
  {
    id: 'wm_1',
    clerkId: 'user_1',
    actor: { id: 'actor_1' },
    deactivatedAt: null,
  },
  {
    id: 'wm_2',
    clerkId: 'user_2',
    actor: { id: 'actor_2' },
    deactivatedAt: null,
  },
  {
    id: 'wm_gone',
    clerkId: 'user_gone',
    actor: { id: 'actor_gone' },
    deactivatedAt: new Date('2026-10-01T00:00:00Z'),
  },
]

const TASK_ROW = {
  id: 'task_1',
  number: 1,
  title: 'Fix login',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  projectId: 'proj_1',
  dueDate: null,
  description: null,
  assignee: null,
  project: { name: 'Backend', workspaceId: 'ws_1' },
  team: { identifier: 'ENG', workspace: { slug: 'acme' } },
}

const BLOCKED = {
  decision: 'BLOCKED',
  blockers: [
    {
      plane: 'SECURITY_FINDING',
      total: 1,
      byRule: [['hardcoded-secret', 1]],
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
  global.fetch = jest.fn(async (url: string) => {
    const user = new URL(String(url)).searchParams.get('user') ?? ''
    const email = SLACK_EMAILS[user]
    return {
      json: async () =>
        email
          ? { ok: true, user: { profile: { email } } }
          : { ok: false, error: 'user_not_found' },
    }
  }) as unknown as typeof fetch
  p.workspaceMember.findMany.mockImplementation(
    async (args: {
      where: {
        workspaceId: string
        deactivatedAt?: null
        clerkId?: { in: string[] }
      }
    }) =>
      MEMBER_ROWS.filter(
        m =>
          args.where.workspaceId === 'ws_1' &&
          (!args.where.clerkId || args.where.clerkId.in.includes(m.clerkId)) &&
          (!('deactivatedAt' in args.where) || m.deactivatedAt === null)
      ).map(({ deactivatedAt: _d, ...m }) => m)
  )
  p.team.findFirst.mockResolvedValue({
    id: 'team_1',
    identifier: 'ENG',
    workspace: { slug: 'acme' },
  })
  p.task.findFirst.mockResolvedValue(TASK_ROW)
  mockFindForUpdate.mockResolvedValue({
    ...TASK_ROW,
    assigneeActorId: null,
    sprintId: null,
    milestoneId: null,
    workStartedAt: new Date('2026-10-01T00:00:00Z'),
  })
  mockRepoUpdate.mockImplementation(
    async (id: string, _ws: string, data: Record<string, unknown>) => ({
      ...TASK_ROW,
      id,
      ...data,
      teamId: 'team_1',
      sprintId: 'sprint_1',
      milestoneId: null,
    })
  )
  mockFindActorById.mockResolvedValue({
    id: 'actor_2',
    type: 'HUMAN',
    workspaceId: 'ws_1',
  })
  mockReadDoneVerdict.mockResolvedValue({ decision: 'CLEAR', blockers: [] })
})

const run = (text: string, user = 'U1') =>
  handleCommand(text, user, 'xoxb', 'ws_1')

/** Nothing was written to the task by any path. */
function expectTaskUnchanged() {
  expect(mockRepoUpdate).not.toHaveBeenCalled()
  expect(p.task.update).not.toHaveBeenCalled()
}

describe('done — the DONE gate applies (as for the web and CLI)', () => {
  it('an open DONE blocker refuses the move: ephemeral reason, task unchanged', async () => {
    mockReadDoneVerdict.mockResolvedValue(BLOCKED)
    const r = await run('done ENG-1')
    expect(r.visibility).toBe('ephemeral')
    expect(r.text).toMatch(
      /^Couldn't move ENG-1 to Done: Cannot move this task to DONE/
    )
    expect(r.text).toContain('hardcoded-secret')
    expect(mockReadDoneVerdict).toHaveBeenCalledWith('task_1', 'ws_1')
    expectTaskUnchanged()
    expect(mockEmitCoreEvent).not.toHaveBeenCalled()
  })

  it('gate clear → moved, in_channel, recorded as the caller', async () => {
    const r = await run('done ENG-1')
    expect(r.visibility).toBe('in_channel')
    expect(r.text).toBe('ENG-1 · Fix login moved to ✅ Done')
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'task_1',
      'ws_1',
      expect.objectContaining({ status: 'DONE' })
    )
    expect(mockDispatchSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor_1', actorClerkId: 'user_1' })
    )
    expect(mockEmitCoreEvent).toHaveBeenCalledWith('task.statusChanged', {
      taskId: 'task_1',
      status: 'DONE',
    })
  })
})

describe('in-review — same entry as the web status change', () => {
  it('emits task.statusChanged so the IN_REVIEW policy check runs', async () => {
    const r = await run('in-review ENG-1')
    expect(r.visibility).toBe('in_channel')
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'task_1',
      'ws_1',
      expect.objectContaining({ status: 'IN_REVIEW' })
    )
    expect(mockEmitCoreEvent).toHaveBeenCalledWith('task.statusChanged', {
      taskId: 'task_1',
      status: 'IN_REVIEW',
    })
    // The DONE gate is DONE-only.
    expect(mockReadDoneVerdict).not.toHaveBeenCalled()
  })
})

describe('assign — same entry as the web assignee change', () => {
  it('assigns through the shared service, validating the assignee', async () => {
    const r = await run('assign ENG-1 <@U2>')
    expect(r.visibility).toBe('in_channel')
    expect(mockFindActorById).toHaveBeenCalledWith('actor_2', 'ws_1')
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'task_1',
      'ws_1',
      expect.objectContaining({ assigneeActorId: 'actor_2' })
    )
    expect(mockDispatchSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor_1', actorClerkId: 'user_1' })
    )
  })

  it('an assignee the service rejects → ephemeral reason, task unchanged', async () => {
    mockFindActorById.mockResolvedValue({
      id: 'actor_2',
      type: 'HUMAN',
      workspaceId: 'ws_other',
    })
    const r = await run('assign ENG-1 <@U2>')
    expect(r).toEqual({
      type: 'text',
      text: "Couldn't assign ENG-1: Assignee is not part of this workspace",
      visibility: 'ephemeral',
    })
    expectTaskUnchanged()
  })
})

describe('only active members of the install workspace may write', () => {
  it.each([['done ENG-1'], ['in-review ENG-1'], ['assign ENG-1 <@U2>']])(
    '%s by a deactivated / non-member → ephemeral, task unchanged',
    async cmd => {
      const r = await run(cmd, 'U_GONE')
      expect(r.visibility).toBe('ephemeral')
      expect(r.text).toMatch(/isn't linked to a Lumo account/)
      expectTaskUnchanged()
      expect(p.workspaceMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: 'ws_1',
            deactivatedAt: null,
          }),
        })
      )
    }
  )

  it('the task write is pinned to the install workspace', async () => {
    await run('done ENG-1')
    expect(p.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task_1', workspaceId: 'ws_1' } })
    )
    expect(mockFindForUpdate).toHaveBeenCalledWith('task_1', 'ws_1')
  })
})
