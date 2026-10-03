/**
 * @jest-environment node
 *
 * LUM-923 — a GDPR export covers everything still stored, trash included
 * (the user's ruling): trashed tasks and documents are exported with their
 * `deletedAt`, so the comments of a trashed task —
 * read through relation filters the soft-delete extension never touched —
 * no longer point at a task the archive does not contain. Real Postgres,
 * read through the same soft-delete extension as the production client.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)
const holder: { client: import('@prisma/client').PrismaClient | null } = {
  client: null,
}

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.client
  },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: jest.fn().mockResolvedValue(new Map()),
}))

import { buildWorkspaceArchive } from '@/lib/services/workspace-export.service'
import { readZipText } from '@/lib/archive/zip'

jest.setTimeout(180_000)

const WS = 'ws_xtrash'
const MEMBER = 'm_xtrash'
const TRASHED_AT = new Date('2026-09-30T00:00:00.000Z')

async function seed() {
  const db = harness.prisma!
  await db.workspace.create({ data: { id: WS, name: 'X', slug: WS } })
  await db.workspaceMember.create({
    data: { id: MEMBER, workspaceId: WS, clerkId: 'clerk_x', role: 'OWNER' },
  })
  await db.team.create({
    data: { id: 'team_x', workspaceId: WS, name: 'Eng', identifier: 'XT' },
  })
  await db.project.create({
    data: {
      id: 'proj_x',
      workspaceId: WS,
      teamId: 'team_x',
      createdByMemberId: MEMBER,
      name: 'P',
    },
  })
  for (const [id, number, deletedAt] of [
    ['t_live', 1, null],
    ['t_trashed', 2, TRASHED_AT],
  ] as const) {
    await db.task.create({
      data: {
        id,
        number,
        title: id,
        projectId: 'proj_x',
        teamId: 'team_x',
        deletedAt,
      },
    })
    await db.comment.create({ data: { taskId: id, body: `<p>${id}</p>` } })
  }
  for (const [id, number, deletedAt] of [
    ['d_live', 1, null],
    ['d_trashed', 2, TRASHED_AT],
  ] as const) {
    await db.document.create({
      data: {
        id,
        number,
        slug: id,
        title: id,
        content: `<p>${id}</p>`,
        workspaceId: WS,
        createdById: MEMBER,
        visibility: 'WORKSPACE',
        deletedAt,
      },
    })
  }
}

const ndjson = (text: string | undefined) =>
  (text ?? '')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as Record<string, unknown>)

let files: Record<string, string>

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  await seed()
  const { bytes } = await buildWorkspaceArchive(WS, TRASHED_AT)
  files = await readZipText(bytes)
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-923 export trash: the archive includes the trash', () => {
  it('LUM-923 export trash: trashed tasks and documents are exported with their deletedAt', () => {
    const tasks = ndjson(files['tasks.ndjson'])
    expect(tasks.map(t => t.id).sort()).toEqual(['t_live', 't_trashed'])
    expect(tasks.find(t => t.id === 't_live')?.deletedAt).toBeNull()
    expect(tasks.find(t => t.id === 't_trashed')?.deletedAt).toBe(
      TRASHED_AT.toISOString()
    )

    const docs = ndjson(files['documents.ndjson'])
    expect(docs.map(d => d.id).sort()).toEqual(['d_live', 'd_trashed'])
    expect(docs.find(d => d.id === 'd_trashed')?.deletedAt).toBe(
      TRASHED_AT.toISOString()
    )
    const md = docs.find(d => d.id === 'd_trashed')?.markdownPath as string
    expect(files[md]).toContain('d_trashed')
  })

  it('LUM-923 export trash: every exported comment taskId resolves to an exported task', () => {
    const taskIds = new Set(ndjson(files['tasks.ndjson']).map(t => t.id))
    const comments = ndjson(files['comments.ndjson'])
    expect(comments).toHaveLength(2)
    for (const row of comments) {
      expect(taskIds.has(row.taskId as string)).toBe(true)
    }
  })
})
