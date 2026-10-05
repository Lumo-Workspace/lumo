/**
 * @jest-environment node
 *
 * LUM-922 — the public→private blob migration's reference scan against a REAL
 * Postgres (every migration replayed into PGlite), through the soft-delete
 * client production uses (LUM-918). Trashed tasks and documents still hold
 * references and can be restored, so the scan must see them: otherwise their
 * blobs read as orphans (deleted by `--delete-orphans`) or stay public.
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

import {
  publicBlobMigrationRepository,
  type ReferenceRow,
} from '@/lib/repositories/public-blob-migration.repository'

jest.setTimeout(180_000)

const WS = 'ws_blobmig'
const MEMBER = 'm_blobmig'
const HOST = 'https://store1.public.blob.vercel-storage.com'
const TASK_IMG = `${HOST}/documents/t/1748000000000-aaa111.png`
const DOC_IMG = `${HOST}/documents/d/1748000000001-bbb222.png`
const DOC_MD_IMG = `${HOST}/documents/d/1748000000002-ccc333.png`

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  const db = harness.prisma!
  await db.workspace.create({ data: { id: WS, name: 'Blob WS', slug: WS } })
  await db.workspaceMember.create({
    data: {
      id: MEMBER,
      workspaceId: WS,
      clerkId: 'clerk_blobmig',
      role: 'OWNER',
    },
  })
  await db.team.create({
    data: {
      id: 'team_blobmig',
      workspaceId: WS,
      name: 'Eng',
      identifier: 'BM',
    },
  })
  await db.project.create({
    data: {
      id: 'proj_blobmig',
      workspaceId: WS,
      teamId: 'team_blobmig',
      createdByMemberId: MEMBER,
      name: 'Blob project',
    },
  })
  const trashedAt = new Date('2026-09-30T00:00:00Z')
  await db.task.create({
    data: {
      id: 't_trashed',
      number: 1,
      title: 'Trashed task',
      projectId: 'proj_blobmig',
      workspaceId: WS,
      teamId: 'team_blobmig',
      description: `<p><img src="${TASK_IMG}"></p>`,
      deletedAt: trashedAt,
    },
  })
  await db.document.create({
    data: {
      id: 'd_trashed',
      number: 1,
      slug: 'd-trashed',
      title: 'Trashed doc',
      content: `<p><img src="${DOC_IMG}"></p>`,
      sourceMarkdown: `![x](${DOC_MD_IMG})`,
      workspaceId: WS,
      createdById: MEMBER,
      visibility: 'WORKSPACE',
      deletedAt: trashedAt,
    },
  })
})

afterAll(async () => {
  await harness.stop()
})

async function rowsOf(name: string): Promise<ReferenceRow[]> {
  const source = publicBlobMigrationRepository.referenceSources.find(
    s => s.name === name
  )
  if (!source) throw new Error(`no source ${name}`)
  return source.findRows()
}

describe('public blob migration on a real database', () => {
  it('trashed task and document references still count', async () => {
    // Sanity: the client really hides trashed rows from ordinary reads.
    expect(
      await holder.client!.task.findMany({ where: { id: 't_trashed' } })
    ).toEqual([])
    expect(
      await holder.client!.document.findMany({ where: { id: 'd_trashed' } })
    ).toEqual([])

    expect(await rowsOf('task.description')).toEqual([
      expect.objectContaining({
        id: 't_trashed',
        workspaceId: WS,
        text: expect.stringContaining(TASK_IMG),
      }),
    ])
    expect(await rowsOf('document.content')).toEqual([
      expect.objectContaining({
        id: 'd_trashed',
        workspaceId: WS,
        text: expect.stringContaining(DOC_IMG),
      }),
    ])
    expect(await rowsOf('document.sourceMarkdown')).toEqual([
      expect.objectContaining({
        id: 'd_trashed',
        workspaceId: WS,
        text: expect.stringContaining(DOC_MD_IMG),
      }),
    ])

    // Evidence under a trashed task resolves to its workspace, so it is
    // migrated rather than kept public / treated as an orphan.
    expect(
      await publicBlobMigrationRepository.findTaskWorkspaceId('t_trashed')
    ).toBe(WS)
    expect(
      await publicBlobMigrationRepository.findTaskWorkspaceId('t_missing')
    ).toBeNull()
  })
})
