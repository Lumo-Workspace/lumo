import { documentService } from '@/lib/services/document.service'

const mockGetMaxSortOrder = jest.fn()
const mockCreate = jest.fn()
const mockSyncMentions = jest.fn()
const mockGetTemplateForCreation = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    getMaxSortOrder: (...a: any[]) => mockGetMaxSortOrder(...a),
    create: (...a: any[]) => mockCreate(...a),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { syncDocumentTags: jest.fn(), findByDocument: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {},
}))
jest.mock('@/lib/services/document-template.service', () => ({
  documentTemplateService: {
    getTemplateForCreation: (...a: any[]) => mockGetTemplateForCreation(...a),
  },
}))
jest.mock('@/lib/services/content-summary.service', () => ({
  contentSummaryService: { summarize: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: any) => p }))
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: async () => ({ getUserList: async () => ({ data: [] }) }),
}))

beforeEach(() => {
  mockGetMaxSortOrder.mockResolvedValue(0)
  mockSyncMentions.mockResolvedValue(undefined)
  mockGetTemplateForCreation.mockReset()
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({
    id: 'doc_1',
    slug: '1-untitled',
    createdBy: { id: 'm_1', clerkId: 'clerk_1' },
  })
  // Stub the mention-sync side effect so create resolves without a DB.
  jest
    .spyOn(documentService, 'syncDocumentMentions')
    .mockImplementation(mockSyncMentions)
})

afterEach(() => jest.restoreAllMocks())

describe('createDocument with templateId', () => {
  it('uses the template HTML as the new document content', async () => {
    mockGetTemplateForCreation.mockResolvedValue({
      content: '<h1>PRD</h1>',
      emoji: '📋',
    })

    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
      templateId: 't_1',
    })

    expect(mockGetTemplateForCreation).toHaveBeenCalledWith('ws_1', 't_1')
    const createArg = mockCreate.mock.calls[0][0]
    expect(createArg.content).toBe('<h1>PRD</h1>')
    expect(createArg.emoji).toBe('📋')
  })

  it('does not consult the template service when no templateId is given', async () => {
    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
    })
    expect(mockGetTemplateForCreation).not.toHaveBeenCalled()
  })

  it('prefers explicit contentMarkdown over templateId', async () => {
    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
      templateId: 't_1',
      contentMarkdown: '# Explicit',
    })
    expect(mockGetTemplateForCreation).not.toHaveBeenCalled()
    const createArg = mockCreate.mock.calls[0][0]
    // markdownToHtml('# Explicit') → an <h1>
    expect(createArg.content).toContain('Explicit')
  })

  it('keeps the caller emoji over the template emoji when both are present', async () => {
    mockGetTemplateForCreation.mockResolvedValue({
      content: '<h1>PRD</h1>',
      emoji: '📋',
    })
    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
      templateId: 't_1',
      emoji: '🚀',
    })
    const createArg = mockCreate.mock.calls[0][0]
    expect(createArg.emoji).toBe('🚀')
  })
})
