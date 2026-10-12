/**
 * @jest-environment node
 *
 * LUM-928 — Slack command replies interpolate stored task titles, project
 * names and the user's own arguments into mrkdwn. Each must be escaped so a
 * title like `<!channel>` or `<https://evil|ok>` renders as literal text.
 */
const mockTx = {
  team: { update: jest.fn() },
  task: { create: jest.fn() },
}

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: jest.fn() },
    team: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    task: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  createClerkClient: () => ({
    users: {
      getUser: async () => ({
        primaryEmailAddressId: 'em_1',
        emailAddresses: [{ id: 'em_1', emailAddress: 'dev@example.com' }],
      }),
    },
  }),
}))

jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(async () => 'actor_1'),
}))

import { prisma } from '@/lib/db/prisma'
import { handleCommand } from '@/lib/integrations/slack/commands'

const p = prisma as unknown as {
  workspaceMember: { findMany: jest.Mock }
  team: { findFirst: jest.Mock }
  project: { findFirst: jest.Mock }
  task: {
    findFirst: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    findUniqueOrThrow: jest.Mock
  }
}

const INJECT = '<!channel> <!here> <https://evil.example|ok> & co'
const ESCAPED =
  '&lt;!channel&gt; &lt;!here&gt; &lt;https://evil.example|ok&gt; &amp; co'

function noControlSequences(result: unknown) {
  const json = JSON.stringify(result)
  expect(json).not.toMatch(/<!channel>|<!here>|<https:\/\/evil/)
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({
    json: async () => ({
      ok: true,
      user: { profile: { email: 'dev@example.com' } },
    }),
  })) as unknown as typeof fetch
  p.workspaceMember.findMany.mockResolvedValue([
    { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
  ])
  p.team.findFirst.mockResolvedValue({
    id: 'team_1',
    identifier: 'ENG',
    workspace: { slug: 'acme' },
  })
  p.project.findFirst.mockResolvedValue({ id: 'proj_1', name: 'Backend' })
  mockTx.team.update.mockResolvedValue({ taskSeq: 8 })
  mockTx.task.create.mockImplementation(async ({ data }) => ({
    id: 'task_1',
    ...data,
  }))
  p.task.findUniqueOrThrow.mockImplementation(async () => ({
    id: 'task_1',
    number: 8,
    title: mockTx.task.create.mock.calls[0][0].data.title,
    team: { identifier: 'ENG' },
    assignee: null,
  }))
})

describe('Slack command reply mrkdwn escaping', () => {
  it('command replies escape mention and link injection', async () => {
    // status: stored title and project name
    p.task.findFirst.mockResolvedValue({
      id: 'task_1',
      number: 1,
      title: `Title ${INJECT}`,
      status: 'TODO',
      priority: 'HIGH',
      projectId: 'proj_1',
      assigneeActorId: null,
      project: { name: `Proj ${INJECT}` },
      team: { identifier: 'ENG', workspace: { slug: 'acme' } },
    })
    const status = await handleCommand('status ENG-1', 'U1', 'xoxb', 'ws_1')
    noControlSequences(status)
    const statusText = JSON.stringify(status)
    expect(statusText).toContain(`Title ${ESCAPED}`)
    expect(statusText).toContain(`Project: Proj ${ESCAPED}`)

    // create: the title the user typed is echoed in the confirmation
    const created = await handleCommand(
      `create "New ${INJECT.replace(/"/g, '')}" in eng`,
      'U1',
      'xoxb',
      'ws_1'
    )
    noControlSequences(created)
    expect(JSON.stringify(created)).toContain(`New ${ESCAPED}`)

    // my-tasks: stored titles in the list
    p.task.findMany.mockResolvedValue([
      {
        id: 'task_2',
        number: 2,
        title: `Mine ${INJECT}`,
        status: 'TODO',
        priority: 'LOW',
        team: { identifier: 'ENG', workspace: { slug: 'acme' } },
        project: { name: 'Backend' },
      },
    ])
    p.task.count.mockResolvedValue(1)
    const mine = await handleCommand('my-tasks', 'U1', 'xoxb', 'ws_1')
    noControlSequences(mine)
    expect(JSON.stringify(mine)).toContain(`Mine ${ESCAPED}`)

    // not-found: the user's own argument is echoed back escaped
    p.task.findFirst.mockResolvedValue(null)
    const notFound = await handleCommand(
      'status <!channel>',
      'U1',
      'xoxb',
      'ws_1'
    )
    expect(notFound).toEqual({
      type: 'text',
      text: 'Task `&lt;!channel&gt;` not found.',
      visibility: 'ephemeral',
    })
  })

  it('leaves ordinary command replies readable', async () => {
    const created = await handleCommand(
      'create "Fix bug" in eng',
      'U1',
      'xoxb',
      'ws_1'
    )
    expect(JSON.stringify(created)).toContain('ENG-8 · Fix bug')
  })
})
