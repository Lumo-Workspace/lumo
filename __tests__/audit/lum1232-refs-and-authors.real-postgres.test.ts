/**
 * @jest-environment node
 *
 * LUM-1232 batch G against a REAL Postgres (every migration replayed):
 * - G1: the audit log names a boundary-crossing target by its `<TEAM>-X<n>`
 *   ref, and only for crossings in the viewer's workspace;
 * - G2: comment authors come back with display names, looked up only among
 *   the viewer workspace's actors.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/auth/user-profiles', () => ({
  lookupUserProfiles: jest.fn(
    async (ids: string[]) =>
      new Map(ids.map(id => [id, { name: `Name ${id}`, email: null }]))
  ),
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: {},
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: jest.fn(),
}))
jest.mock('@/lib/integrations/pusher', () => ({ pushTaskEvent: jest.fn() }))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
}))

import { listAuditEvents } from '@/lib/services/audit-query.service'
import { commentService } from '@/lib/services/comment.service'

jest.setTimeout(180_000)

const WS = 'ws_g'
const OTHER = 'ws_g_other'
const db = () => harness.prisma!

async function seedWorkspace(id: string, team: string) {
  await db().workspace.create({ data: { id, name: id, slug: `slug-${id}` } })
  await db().workspaceMember.create({
    data: {
      id: `m_${id}`,
      workspaceId: id,
      clerkId: `clerk_${id}`,
      role: 'OWNER',
    },
  })
  await db().team.create({
    data: { id: `team_${id}`, workspaceId: id, name: id, identifier: team },
  })
  await db().project.create({
    data: {
      id: `proj_${id}`,
      workspaceId: id,
      teamId: `team_${id}`,
      createdByMemberId: `m_${id}`,
      name: id,
    },
  })
  await db().task.create({
    data: {
      id: `task_${id}`,
      projectId: `proj_${id}`,
      workspaceId: id,
      teamId: `team_${id}`,
      number: 1,
      title: 'refs',
    },
  })
}

beforeAll(async () => {
  await harness.start()
  await seedWorkspace(WS, 'LUM')
  await seedWorkspace(OTHER, 'OTH')
  await db().boundaryCrossing.create({
    data: {
      id: 'cr_mine',
      taskId: `task_${WS}`,
      workspaceId: WS,
      number: 928,
      category: 'DESTRUCTIVE_DB_COMMAND',
      detail: 'x',
    },
  })
  await db().boundaryCrossing.create({
    data: {
      id: 'cr_other',
      taskId: `task_${OTHER}`,
      workspaceId: OTHER,
      number: 5,
      category: 'DESTRUCTIVE_DB_COMMAND',
      detail: 'x',
    },
  })
  const ev = (id: string, targetId: string) => ({
    id,
    workspaceId: WS,
    actorType: 'MEMBER' as const,
    actorId: `clerk_${WS}`,
    actorMemberId: `m_${WS}`,
    source: 'CLI' as const,
    action: 'boundary_crossing.dispositioned',
    targetType: 'boundary_crossing',
    targetId,
    createdAt: new Date('2026-10-17T07:07:37.000Z'),
  })
  // An audit row in WS that names the other workspace's crossing id must not
  // learn that crossing's ref.
  await db().auditEvent.createMany({
    data: [ev('ev_mine', 'cr_mine'), ev('ev_foreign', 'cr_other')],
  })

  await db().actor.create({
    data: {
      id: 'act_member',
      workspaceId: WS,
      type: 'HUMAN',
      memberId: `m_${WS}`,
    },
  })
  await db().actor.create({
    data: {
      id: 'act_gh',
      workspaceId: WS,
      type: 'GITHUB_USER',
      externalIdentity: 'github:octo',
    },
  })
  await db().actor.create({
    data: {
      id: 'act_foreign',
      workspaceId: OTHER,
      type: 'GITHUB_USER',
      externalIdentity: 'github:elsewhere',
    },
  })
  await db().comment.create({
    data: {
      id: 'c1',
      taskId: `task_${WS}`,
      authorActorId: 'act_member',
      body: '<p>hi</p>',
    },
  })
  await db().comment.create({
    data: {
      id: 'c2',
      taskId: `task_${WS}`,
      parentId: 'c1',
      authorActorId: 'act_gh',
      body: '<p>reply</p>',
    },
  })
  await db().comment.create({
    data: {
      id: 'c3',
      taskId: `task_${WS}`,
      authorActorId: 'act_foreign',
      body: '<p>odd</p>',
    },
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('G1 — audit target refs (real SQL)', () => {
  it('own crossing → LUM-X928; a foreign crossing id stays unresolved', async () => {
    const page = await listAuditEvents(
      { workspaceId: WS, memberId: `m_${WS}`, clerkId: `clerk_${WS}` },
      {},
      new Date('2026-10-18T00:00:00.000Z')
    )
    const byId = new Map(page.events.map(e => [e.id, e.targetRef]))
    expect(byId.get('ev_mine')).toBe('LUM-X928')
    expect(byId.get('ev_foreign')).toBeNull()
  })
})

describe('G2 — comment author names (real SQL)', () => {
  it('member and GitHub authors are named; a foreign actor is not', async () => {
    const thread = await commentService.getCommentsWithAuthors(`task_${WS}`, WS)
    const byId = new Map(
      thread.flatMap(c => [c, ...c.replies]).map(c => [c.id, c.authorName])
    )
    expect(byId.get('c1')).toBe(`Name clerk_${WS}`)
    expect(byId.get('c2')).toBe('@octo')
    expect(byId.get('c3')).toBeNull()
  })
})
