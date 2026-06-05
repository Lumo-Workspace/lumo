import { documentTemplateService } from '@/lib/services/document-template.service'

const mockListVisible = jest.fn()
const mockFindById = jest.fn()

jest.mock('@/lib/repositories/document-template.repository', () => ({
  documentTemplateRepository: {
    listVisible: (...args: any[]) => mockListVisible(...args),
    findById: (...args: any[]) => mockFindById(...args),
  },
}))

beforeEach(() => {
  mockListVisible.mockReset()
  mockFindById.mockReset()
})

describe('documentTemplateService.listTemplates', () => {
  it('delegates to the repository', async () => {
    mockListVisible.mockResolvedValue([{ id: 't_1', key: 'prd' }])
    const result = await documentTemplateService.listTemplates('ws_1')

    expect(mockListVisible).toHaveBeenCalledWith('ws_1')
    expect(result).toEqual([{ id: 't_1', key: 'prd' }])
  })
})

describe('documentTemplateService.getTemplateForCreation', () => {
  it('returns content + emoji for a system template', async () => {
    mockFindById.mockResolvedValue({
      id: 't_1',
      content: '<h1>PRD</h1>',
      emoji: '📋',
      workspaceId: null,
    })

    const result = await documentTemplateService.getTemplateForCreation(
      'ws_1',
      't_1'
    )
    expect(result).toEqual({ content: '<h1>PRD</h1>', emoji: '📋' })
  })

  it('returns content + emoji for a template owned by the same workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 't_2',
      content: '<h1>X</h1>',
      emoji: null,
      workspaceId: 'ws_1',
    })

    const result = await documentTemplateService.getTemplateForCreation(
      'ws_1',
      't_2'
    )
    expect(result).toEqual({ content: '<h1>X</h1>', emoji: null })
  })

  it('throws 404 when the template does not exist', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      documentTemplateService.getTemplateForCreation('ws_1', 'missing')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when the template belongs to another workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 't_3',
      content: '<h1>Y</h1>',
      emoji: null,
      workspaceId: 'ws_OTHER',
    })
    await expect(
      documentTemplateService.getTemplateForCreation('ws_1', 't_3')
    ).rejects.toMatchObject({ status: 404 })
  })
})
