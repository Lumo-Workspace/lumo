/**
 * @jest-environment node
 *
 * LUM-1096 — every `/lumo` / `@Lumo` command reply: Block Kit layout, the
 * top-level `text` fallback, and `visibility` (errors/help/not linked are
 * ephemeral; results are in_channel). Prisma is mocked; the real service and
 * repository run on top of it.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: jest.fn() },
    team: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    actor: { findUnique: jest.fn() },
    task: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  },
}))

const USERS: Record<
  string,
  { firstName: string; lastName: string; email: string }
> = {
  user_1: { firstName: 'Dev', lastName: 'Person', email: 'dev@example.com' },
  user_2: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
}
function authUser(id: string) {
  const u = USERS[id]!
  return {
    id,
    firstName: u.firstName,
    lastName: u.lastName,
    username: null,
    imageUrl: '',
    primaryEmailAddressId: `em_${id}`,
    emailAddresses: [{ id: `em_${id}`, emailAddress: u.email }],
  }
}
jest.mock('@/lib/auth/users', () => ({
  isUserDirectoryConfigured: () => true,
  createUserDirectory: async () => ({
    getUser: async (id: string) => authUser(id),
    getUserList: async ({ userId }: { userId: string[] }) => ({
      data: userId.map(authUser),
    }),
  }),
}))

const mockTransition = jest.fn()
jest.mock('@/lib/task/state-machine', () => ({
  transitionTaskStatus: (...a: unknown[]) => mockTransition(...a),
}))

const mockCreateWithSequence = jest.fn()
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    createWithSequence: (...a: unknown[]) => mockCreateWithSequence(...a),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { handleCommand } from '@/lib/integrations/slack/commands'
import type { CommandResult } from '@/lib/integrations/slack/types'

const p = prisma as unknown as {
  workspaceMember: { findMany: jest.Mock }
  team: { findFirst: jest.Mock }
  project: { findFirst: jest.Mock }
  actor: { findUnique: jest.Mock }
  task: {
    findFirst: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    update: jest.Mock
  }
}

const SLACK_EMAILS: Record<string, string> = {
  U1: 'dev@example.com',
  U2: 'ada@example.com',
}

const MEMBERS = [
  { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
  { id: 'wm_2', clerkId: 'user_2', actor: { id: 'actor_2' } },
]

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `task_${n}`,
    number: n,
    title: `Task ${n}`,
    status: 'TODO',
    priority: 'MEDIUM',
    projectId: 'proj_1',
    assigneeActorId: null,
    assignee: null,
    project: { name: 'Backend' },
    team: { identifier: 'ENG', workspace: { slug: 'acme' } },
    ...extra,
  }
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
    async (args: { where: { id?: { in: string[] } } }) =>
      args.where.id
        ? MEMBERS.filter(m => args.where.id!.in.includes(m.id))
        : MEMBERS
  )
  p.actor.findUnique.mockImplementation(
    async (args: { where: { memberId: string } }) =>
      MEMBERS.find(m => m.id === args.where.memberId)?.actor ?? null
  )
  p.team.findFirst.mockResolvedValue({
    id: 'team_1',
    identifier: 'ENG',
    workspace: { slug: 'acme' },
  })
  p.project.findFirst.mockResolvedValue({ id: 'proj_1', name: 'Backend' })
  p.task.findFirst.mockResolvedValue(
    row(1, { title: 'Fix login', status: 'IN_PROGRESS', priority: 'HIGH' })
  )
  mockTransition.mockResolvedValue([])
})

const run = (text: string, user = 'U1') =>
  handleCommand(text, user, 'xoxb', 'ws_1')

function blocksJson(r: CommandResult) {
  return r.type === 'blocks' ? JSON.stringify(r.blocks) : ''
}

/** Every reply: non-empty text fallback, a visibility, no raw enum leak. */
function expectWellFormed(r: CommandResult) {
  expect(r.text.trim()).not.toBe('')
  expect(['in_channel', 'ephemeral']).toContain(r.visibility)
}

describe('help', () => {
  it('unknown command → ephemeral help card with header and text fallback', async () => {
    const r = await run('banana')
    expectWellFormed(r)
    expect(r.visibility).toBe('ephemeral')
    expect(r.type).toBe('blocks')
    const json = blocksJson(r)
    expect(json).toContain('"type":"header"')
    expect(json).toContain('Lumo commands')
    for (const cmd of [
      'status ENG-123',
      'assign ENG-123 @user',
      'done ENG-123',
      'in-review ENG-123',
      'my-tasks',
    ])
      expect(json).toContain(cmd)
    expect(r.text).toContain('Available commands')
  })

  it('a bare subcommand without its argument also gets the help card', async () => {
    const r = await run('status')
    expect(r.visibility).toBe('ephemeral')
    expect(blocksJson(r)).toContain('Lumo commands')
  })
})

describe('status', () => {
  it('in_channel card: readable status/priority, assignee name, project, link', async () => {
    p.task.findFirst.mockResolvedValue(
      row(1, {
        title: 'Fix login',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignee: {
          type: 'HUMAN',
          memberId: 'wm_2',
          externalIdentity: null,
          agent: null,
        },
      })
    )
    const r = await run('status ENG-1')
    expectWellFormed(r)
    expect(r.visibility).toBe('in_channel')
    const json = blocksJson(r)
    expect(json).toContain('ENG-1 · Fix login')
    expect(json).toContain('🔵 In progress')
    expect(json).toContain('🟠 High')
    expect(json).not.toContain('IN_PROGRESS')
    expect(json).toContain('Assignee: Ada Lovelace')
    expect(json).toContain('Project: Backend')
    expect(json).toContain(
      'https://lumo.test/workspace/acme/projects/backend/tasks/ENG-1'
    )
    expect(r.text).toContain('ENG-1 · Fix login')
    expect(r.text).toContain('Ada Lovelace')
  })

  it('says Unassigned when nobody is assigned', async () => {
    const r = await run('status ENG-1')
    expect(blocksJson(r)).toContain('Assignee: Unassigned')
  })

  it('names an agent assignee by its profile name', async () => {
    p.task.findFirst.mockResolvedValue(
      row(1, {
        assignee: {
          type: 'AGENT',
          memberId: null,
          externalIdentity: null,
          agent: { name: 'Coding Agent' },
        },
      })
    )
    expect(blocksJson(await run('status ENG-1'))).toContain(
      'Assignee: Coding Agent'
    )
  })

  it('escapes the assignee name (LUM-928)', async () => {
    p.task.findFirst.mockResolvedValue(
      row(1, {
        assignee: {
          type: 'GITHUB_USER',
          memberId: null,
          externalIdentity: 'github:<!channel>',
          agent: null,
        },
      })
    )
    const r = await run('status ENG-1')
    expect(JSON.stringify(r)).not.toContain('<!channel>')
    expect(blocksJson(r)).toContain('Assignee: &lt;!channel&gt;')
  })

  it('a task with no project links to /my-tasks/<id>, never /projects//tasks/', async () => {
    p.task.findFirst.mockResolvedValue(row(1, { project: null }))
    const r = await run('status ENG-1')
    const json = blocksJson(r)
    expect(json).not.toContain('/projects//tasks/')
    expect(json).toContain('https://lumo.test/workspace/acme/my-tasks/ENG-1')
  })

  it('not found → ephemeral, argument escaped', async () => {
    p.task.findFirst.mockResolvedValue(null)
    const r = await run('status ENG-404')
    expect(r).toEqual({
      type: 'text',
      text: 'Task `ENG-404` not found.',
      visibility: 'ephemeral',
    })
  })

  it('queries are pinned to the Slack install workspace', async () => {
    await run('status eng-1')
    expect(p.team.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: 'ws_1',
      identifier: 'ENG',
    })
    expect(p.task.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: 'ws_1',
      teamId: 'team_1',
      number: 1,
    })
  })
})

describe('done / in-review', () => {
  it('done → in_channel, readable new status, link', async () => {
    const r = await run('done ENG-1')
    expectWellFormed(r)
    expect(r.visibility).toBe('in_channel')
    expect(mockTransition).toHaveBeenCalledWith('task_1', 'proj_1', 'DONE', {
      currentStatus: 'IN_PROGRESS',
    })
    expect(r.text).toBe('ENG-1 · Fix login moved to ✅ Done')
    expect(blocksJson(r)).toContain('Open in Lumo ↗')
    expect(blocksJson(r)).not.toMatch(/"DONE"|marked as Done/)
  })

  it('in-review → 👀 In review', async () => {
    const r = await run('in-review ENG-1')
    expect(mockTransition).toHaveBeenCalledWith(
      'task_1',
      'proj_1',
      'IN_REVIEW',
      expect.anything()
    )
    expect(r.text).toBe('ENG-1 · Fix login moved to 👀 In review')
  })

  it('Slack user not linked → ephemeral, nothing changes', async () => {
    const r = await run('done ENG-1', 'U_UNKNOWN')
    expect(r.visibility).toBe('ephemeral')
    expect(r.text).toMatch(/isn't linked to a Lumo account/)
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('task not found → ephemeral', async () => {
    p.task.findFirst.mockResolvedValue(null)
    const r = await run('done ENG-9')
    expect(r.visibility).toBe('ephemeral')
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('an invalid transition → ephemeral generic error', async () => {
    mockTransition.mockRejectedValue(new Error('invalid transition'))
    const r = await run('done ENG-1')
    expect(r).toEqual({
      type: 'text',
      text: 'Something went wrong. Please try again.',
      visibility: 'ephemeral',
    })
  })
})

describe('assign', () => {
  it('says who the task was assigned to', async () => {
    const r = await run('assign ENG-1 <@U2|ada>')
    expectWellFormed(r)
    expect(r.visibility).toBe('in_channel')
    expect(r.text).toBe('ENG-1 · Fix login assigned to Ada Lovelace')
    expect(blocksJson(r)).toContain('assigned to *Ada Lovelace*')
    expect(p.task.update).toHaveBeenCalledWith({
      where: { id: 'task_1', workspaceId: 'ws_1' },
      data: { assigneeActorId: 'actor_2' },
    })
  })

  it('target without a linked Lumo account → ephemeral, no update', async () => {
    const r = await run('assign ENG-1 <@U_NOBODY>')
    expect(r.visibility).toBe('ephemeral')
    expect(r.text).toMatch(/doesn't have a linked Lumo account/)
    expect(p.task.update).not.toHaveBeenCalled()
  })

  it('target member without an actor row is never assigned null', async () => {
    p.workspaceMember.findMany.mockResolvedValue([
      MEMBERS[0],
      { id: 'wm_2', clerkId: 'user_2', actor: null },
    ])
    const r = await run('assign ENG-1 <@U2>')
    expect(r.visibility).toBe('ephemeral')
    expect(p.task.update).not.toHaveBeenCalled()
  })

  it('not a mention → ephemeral usage hint', async () => {
    const r = await run('assign ENG-1 ada')
    expect(r.visibility).toBe('ephemeral')
    expect(r.text).toMatch(/Invalid user format/)
  })

  it('invoking user not linked → ephemeral', async () => {
    const r = await run('assign ENG-1 <@U2>', 'U_UNKNOWN')
    expect(r.visibility).toBe('ephemeral')
  })
})

describe('create', () => {
  it('created → in_channel card with link', async () => {
    mockCreateWithSequence.mockResolvedValue({
      id: 'task_8',
      number: 8,
      title: 'Ship it',
      status: 'TODO',
      priority: 'MEDIUM',
    })
    const r = await run('create "Ship it" in eng')
    expectWellFormed(r)
    expect(r.visibility).toBe('in_channel')
    expect(r.text).toBe('✅ Created ENG-8 · Ship it')
    expect(blocksJson(r)).toContain(
      'https://lumo.test/workspace/acme/projects/backend/tasks/ENG-8'
    )
    expect(mockCreateWithSequence).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_1', title: 'Ship it' })
    )
  })

  it('bad format → ephemeral usage', async () => {
    const r = await run('create Ship it in ENG')
    expect(r.visibility).toBe('ephemeral')
    expect(r.text).toMatch(/^Usage:/)
  })

  it('unknown team → ephemeral', async () => {
    p.team.findFirst.mockResolvedValue(null)
    const r = await run('create "Ship it" in NOPE')
    expect(r).toEqual({
      type: 'text',
      text: 'Team `NOPE` not found.',
      visibility: 'ephemeral',
    })
  })

  it('not linked → ephemeral', async () => {
    const r = await run('create "Ship it" in ENG', 'U_UNKNOWN')
    expect(r.visibility).toBe('ephemeral')
    expect(mockCreateWithSequence).not.toHaveBeenCalled()
  })
})

describe('my-tasks', () => {
  it('more than 5 open tasks → header, first 5, "Showing 5 of N", view-all button', async () => {
    p.task.findMany.mockResolvedValue([1, 2, 3, 4, 5].map(n => row(n)))
    p.task.count.mockResolvedValue(12)
    const r = await run('my-tasks')
    expectWellFormed(r)
    expect(r.visibility).toBe('in_channel')
    expect(p.task.findMany.mock.calls[0][0]).toMatchObject({
      take: 5,
      where: { workspaceId: 'ws_1', assigneeActorId: 'actor_1' },
    })
    expect(p.task.count.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'ws_1',
      assigneeActorId: 'actor_1',
    })
    const json = blocksJson(r)
    expect(json).toContain('"type":"header"')
    expect(json).toContain("Dev Person's open tasks")
    expect(json).toContain('Showing 5 of 12 open tasks')
    expect(json).toContain('View all in Lumo ↗')
    expect(json).toContain('"url":"https://lumo.test/workspace/acme/my-tasks"')
    expect(json.match(/"type":"section"/g)).toHaveLength(5)
    expect(r.text).toContain('Showing 5 of 12 open tasks')
    expect(r.text).toContain('ENG-1 · Task 1')
  })

  it('5 or fewer → count without "Showing"', async () => {
    p.task.findMany.mockResolvedValue([row(1), row(2)])
    p.task.count.mockResolvedValue(2)
    const r = await run('my-tasks')
    const json = blocksJson(r)
    expect(json).toContain('2 open tasks')
    expect(json).not.toContain('Showing')
  })

  it('no open tasks → in_channel text', async () => {
    p.task.findMany.mockResolvedValue([])
    p.task.count.mockResolvedValue(0)
    const r = await run('my-tasks')
    expect(r).toEqual({
      type: 'text',
      text: 'You have no open tasks. 🎉',
      visibility: 'in_channel',
    })
  })

  it('member without an actor row → no query for unassigned tasks', async () => {
    p.workspaceMember.findMany.mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1', actor: null },
    ])
    const r = await run('my-tasks')
    expect(p.task.findMany).not.toHaveBeenCalled()
    expect(r.text).toBe('You have no open tasks. 🎉')
  })

  it('not linked → ephemeral', async () => {
    const r = await run('my-tasks', 'U_UNKNOWN')
    expect(r.visibility).toBe('ephemeral')
    expect(p.task.findMany).not.toHaveBeenCalled()
  })
})
