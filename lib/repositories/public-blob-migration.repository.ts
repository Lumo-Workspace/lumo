import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-916 — every stored body that can hold an uploaded file's URL, for the
 * one-off public→private blob migration. No business logic: each source only
 * finds rows that mention a public blob and writes a rewritten body back.
 *
 * Text columns are the rich-text bodies the editor uploads images into (and
 * that people paste links into); the two JSON columns are serialised for the
 * scan and parsed back on write. The workspace of each row decides which
 * workspace's private copy its references point at.
 *
 * A write puts the row's `updatedAt` back: swapping a URL is not an edit, and
 * must not float every task/document with an image to "recently updated".
 */

/** Substring every public Vercel Blob URL contains. */
export const PUBLIC_BLOB_MARKER = '.public.blob.vercel-storage.com/'

export interface ReferenceRow {
  id: string
  /** null = a row owned by no workspace (a global document template). */
  workspaceId: string | null
  text: string
  /** null for models without an `updatedAt` column. */
  updatedAt: Date | null
}

export interface ReferenceSource {
  name: string
  findRows(): Promise<ReferenceRow[]>
  write(row: ReferenceRow, text: string): Promise<void>
}

const contains = { contains: PUBLIC_BLOB_MARKER }
/**
 * Naming `deletedAt` (an empty filter: any value) opts a Task / Document
 * read out of the soft-delete filter (LUM-918). Trashed rows still hold
 * references and can be restored, so the migration must see them: skipped,
 * their blobs would count as orphans (deleted with `--delete-orphans`,
 * breaking the images on restore) or stay public forever.
 */
const anyDeletedAt = { deletedAt: {} }
const keep = (row: ReferenceRow) =>
  row.updatedAt ? { updatedAt: row.updatedAt } : {}

type Found = {
  id: string
  workspaceId: string | null
  text: string | null
  updatedAt?: Date
}

function textSource(
  name: string,
  find: () => Promise<Found[]>,
  write: (row: ReferenceRow, text: string) => Promise<unknown>
): ReferenceSource {
  return {
    name,
    async findRows() {
      return (await find()).flatMap(r =>
        r.text
          ? [
              {
                id: r.id,
                workspaceId: r.workspaceId,
                text: r.text,
                updatedAt: r.updatedAt ?? null,
              },
            ]
          : []
      )
    },
    async write(row, text) {
      await write(row, text)
    },
  }
}

/** JSON columns: filter in memory (Prisma has no deep "contains" on jsonb). */
function jsonSource(
  name: string,
  findAll: () => Promise<
    Array<{
      id: string
      workspaceId: string | null
      value: Prisma.JsonValue
      updatedAt?: Date
    }>
  >,
  write: (row: ReferenceRow, value: Prisma.InputJsonValue) => Promise<unknown>
): ReferenceSource {
  return {
    name,
    async findRows() {
      return (await findAll()).flatMap(r => {
        const text = JSON.stringify(r.value)
        return text.includes(PUBLIC_BLOB_MARKER)
          ? [
              {
                id: r.id,
                workspaceId: r.workspaceId,
                text,
                updatedAt: r.updatedAt ?? null,
              },
            ]
          : []
      })
    },
    async write(row, text) {
      await write(row, JSON.parse(text) as Prisma.InputJsonValue)
    },
  }
}

export const referenceSources: ReferenceSource[] = [
  textSource(
    'task.description',
    async () =>
      (
        await prisma.task.findMany({
          where: { description: contains, ...anyDeletedAt },
          select: {
            id: true,
            description: true,
            updatedAt: true,
            project: { select: { workspaceId: true } },
          },
        })
      ).map(r => ({
        id: r.id,
        workspaceId: r.project.workspaceId,
        text: r.description,
        updatedAt: r.updatedAt,
      })),
    (row, description) =>
      prisma.task.update({
        where: { id: row.id },
        data: { description, ...keep(row) },
      })
  ),
  textSource(
    'comment.body',
    async () =>
      (
        await prisma.comment.findMany({
          where: { body: contains },
          select: {
            id: true,
            body: true,
            updatedAt: true,
            task: { select: { project: { select: { workspaceId: true } } } },
          },
        })
      ).map(r => ({
        id: r.id,
        workspaceId: r.task.project.workspaceId,
        text: r.body,
        updatedAt: r.updatedAt,
      })),
    (row, body) =>
      prisma.comment.update({
        where: { id: row.id },
        data: { body, ...keep(row) },
      })
  ),
  textSource(
    'document.content',
    async () =>
      (
        await prisma.document.findMany({
          where: { content: contains, ...anyDeletedAt },
          select: {
            id: true,
            content: true,
            workspaceId: true,
            updatedAt: true,
          },
        })
      ).map(r => ({ ...r, text: r.content })),
    (row, content) =>
      prisma.document.update({
        where: { id: row.id },
        data: { content, ...keep(row) },
      })
  ),
  textSource(
    'document.sourceMarkdown',
    async () =>
      (
        await prisma.document.findMany({
          where: { sourceMarkdown: contains, ...anyDeletedAt },
          select: {
            id: true,
            sourceMarkdown: true,
            workspaceId: true,
            updatedAt: true,
          },
        })
      ).map(r => ({ ...r, text: r.sourceMarkdown })),
    (row, sourceMarkdown) =>
      prisma.document.update({
        where: { id: row.id },
        data: { sourceMarkdown, ...keep(row) },
      })
  ),
  textSource(
    'documentRevision.content',
    async () =>
      (
        await prisma.documentRevision.findMany({
          where: { content: contains },
          select: {
            id: true,
            content: true,
            workspaceId: true,
            updatedAt: true,
          },
        })
      ).map(r => ({ ...r, text: r.content })),
    (row, content) =>
      prisma.documentRevision.update({
        where: { id: row.id },
        data: { content, ...keep(row) },
      })
  ),
  textSource(
    'documentRevision.sourceMarkdown',
    async () =>
      (
        await prisma.documentRevision.findMany({
          where: { sourceMarkdown: contains },
          select: {
            id: true,
            sourceMarkdown: true,
            workspaceId: true,
            updatedAt: true,
          },
        })
      ).map(r => ({ ...r, text: r.sourceMarkdown })),
    (row, sourceMarkdown) =>
      prisma.documentRevision.update({
        where: { id: row.id },
        data: { sourceMarkdown, ...keep(row) },
      })
  ),
  textSource(
    'documentTemplate.content',
    async () =>
      (
        await prisma.documentTemplate.findMany({
          where: { content: contains },
          select: {
            id: true,
            content: true,
            workspaceId: true,
            updatedAt: true,
          },
        })
      ).map(r => ({ ...r, text: r.content })),
    (row, content) =>
      prisma.documentTemplate.update({
        where: { id: row.id },
        data: { content, ...keep(row) },
      })
  ),
  textSource(
    'documentComment.body',
    async () =>
      (
        await prisma.documentComment.findMany({
          where: { body: contains },
          select: {
            id: true,
            body: true,
            updatedAt: true,
            document: { select: { workspaceId: true } },
          },
        })
      ).map(r => ({
        id: r.id,
        workspaceId: r.document.workspaceId,
        text: r.body,
        updatedAt: r.updatedAt,
      })),
    (row, body) =>
      prisma.documentComment.update({
        where: { id: row.id },
        data: { body, ...keep(row) },
      })
  ),
  textSource(
    'milestone.description',
    async () =>
      (
        await prisma.milestone.findMany({
          where: { description: contains },
          select: {
            id: true,
            description: true,
            updatedAt: true,
            project: { select: { workspaceId: true } },
          },
        })
      ).map(r => ({
        id: r.id,
        workspaceId: r.project.workspaceId,
        text: r.description,
        updatedAt: r.updatedAt,
      })),
    (row, description) =>
      prisma.milestone.update({
        where: { id: row.id },
        data: { description, ...keep(row) },
      })
  ),
  textSource(
    'project.description',
    async () =>
      (
        await prisma.project.findMany({
          where: { description: contains },
          select: {
            id: true,
            description: true,
            workspaceId: true,
            updatedAt: true,
          },
        })
      ).map(r => ({ ...r, text: r.description })),
    (row, description) =>
      prisma.project.update({
        where: { id: row.id },
        data: { description, ...keep(row) },
      })
  ),
  jsonSource(
    'testCaseRun.evidence',
    async () =>
      (
        await prisma.testCaseRun.findMany({
          select: {
            id: true,
            evidence: true,
            testCase: {
              select: {
                task: {
                  select: { project: { select: { workspaceId: true } } },
                },
                // LUM-1135: milestone-owned cases have no task.
                milestone: {
                  select: { project: { select: { workspaceId: true } } },
                },
              },
            },
          },
        })
      ).flatMap(r => {
        const owner = r.testCase.task ?? r.testCase.milestone
        return owner
          ? [
              {
                id: r.id,
                value: r.evidence,
                workspaceId: owner.project.workspaceId,
              },
            ]
          : []
      }),
    (row, evidence) =>
      prisma.testCaseRun.update({ where: { id: row.id }, data: { evidence } })
  ),
  jsonSource(
    'draft.data',
    async () =>
      (
        await prisma.draft.findMany({
          select: { id: true, data: true, workspaceId: true, updatedAt: true },
        })
      ).map(r => ({ ...r, value: r.data })),
    (row, data) =>
      prisma.draft.update({
        where: { id: row.id },
        data: { data, ...keep(row) },
      })
  ),
]

export const publicBlobMigrationRepository = {
  referenceSources,

  async findTaskWorkspaceId(taskId: string): Promise<string | null> {
    const task = await prisma.task.findFirst({
      where: { id: taskId, ...anyDeletedAt },
      select: { project: { select: { workspaceId: true } } },
    })
    return task?.project.workspaceId ?? null
  },
}
