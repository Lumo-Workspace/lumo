import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// next/jest uses SWC: factory closures may only reference `mock`-prefixed vars.
const mockFindWithPermission = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockUpdateWithChildrenAndMentions =
  jest.fn<(...args: any[]) => Promise<unknown>>()
const mockUpsertEditor = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindByDocument = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockSnapshotOnSave = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindActorByMemberId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockGetActorClerkId = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockFindNameAndSlug = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockNotifyMentionDelta = jest.fn<(...args: any[]) => Promise<unknown>>()

// Collect fire-and-forget promises so the test can await them before asserting
// (the notify resolution runs inside an async waitUntil callback).
const mockBackgroundPromises: Promise<unknown>[] = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockBackgroundPromises.push(Promise.resolve(p))
  },
}))

async function flushBackground() {
  await Promise.all(mockBackgroundPromises)
}

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn(async () => ({
    users: { getUserList: jest.fn(async () => ({ data: [] })) },
  })),
}))
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...a: unknown[]) => mockFindWithPermission(...a),
    updateWithChildrenAndMentions: (...a: unknown[]) =>
      mockUpdateWithChildrenAndMentions(...a),
    upsertEditor: (...a: unknown[]) => mockUpsertEditor(...a),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByDocument: (...a: unknown[]) => mockFindByDocument(...a),
  },
}))
jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: {
    snapshotOnSave: (...a: unknown[]) => mockSnapshotOnSave(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: (...a: unknown[]) => mockFindActorByMemberId(...a),
  },
}))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: (...a: unknown[]) => mockGetActorClerkId(...a),
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findNameAndSlug: (...a: unknown[]) => mockFindNameAndSlug(...a),
  },
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: (...a: unknown[]) => mockNotifyMentionDelta(...a),
}))

async function getService() {
  const mod = await import('@/lib/services/document.service')
  return mod.documentService
}

const span = (clerkId: string) =>
  `<span class="mention" data-mention-type="user" data-id="${clerkId}">@u</span>`

beforeEach(() => {
  jest.clearAllMocks()
  mockBackgroundPromises.length = 0
  mockFindWithPermission.mockResolvedValue({
    id: 'doc1',
    number: 7,
    createdById: 'mem1',
    shares: [],
    content: '',
    slug: 'doc-slug',
    title: 'Doc',
  })
  mockUpdateWithChildrenAndMentions.mockResolvedValue({
    id: 'doc1',
    slug: 'doc-slug',
    title: 'Doc',
    emoji: null,
  })
  mockUpsertEditor.mockResolvedValue(undefined)
  mockFindByDocument.mockResolvedValue([])
  mockSnapshotOnSave.mockResolvedValue(undefined)
  mockFindActorByMemberId.mockResolvedValue({ id: 'a1' })
  mockGetActorClerkId.mockResolvedValue('author')
  mockFindNameAndSlug.mockResolvedValue({ name: 'WS', slug: 'ws' })
  mockNotifyMentionDelta.mockResolvedValue(undefined)
})

describe('updateDocument @mention notifications', () => {
  it('fires notifyMentionDelta with DOCUMENT_MENTIONED when body content changes', async () => {
    const documentService = await getService()
    await documentService.updateDocument('doc1', 'mem1', 'ws1', {
      content: span('u1'),
    })
    await flushBackground()

    expect(mockNotifyMentionDelta).toHaveBeenCalledTimes(1)
    const arg = mockNotifyMentionDelta.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(arg).toMatchObject({
      notificationType: 'DOCUMENT_MENTIONED',
      ref: { documentId: 'doc1' },
      oldHtml: '',
      newHtml: span('u1'),
      workspaceId: 'ws1',
      authorActorId: 'a1',
      authorClerkId: 'author',
    })
  })

  it('does not fire when content is not part of the update', async () => {
    const documentService = await getService()
    await documentService.updateDocument('doc1', 'mem1', 'ws1', {
      title: 'Renamed',
    })
    await flushBackground()
    expect(mockNotifyMentionDelta).not.toHaveBeenCalled()
  })
})
