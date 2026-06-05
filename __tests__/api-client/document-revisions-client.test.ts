import { documentRevisionsApi } from '@/lib/api-client/documents'

const mockFetch = jest.fn()
jest.mock('@/lib/api-client/base', () => ({
  apiFetch: (...a: any[]) => mockFetch(...a),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockResolvedValue({})
})

it('list hits the revisions collection URL', async () => {
  await documentRevisionsApi.list('d1')
  expect(mockFetch).toHaveBeenCalledWith('/api/documents/d1/revisions')
})

it('createManual POSTs the label', async () => {
  await documentRevisionsApi.createManual('d1', { label: 'v1' })
  expect(mockFetch).toHaveBeenCalledWith('/api/documents/d1/revisions', {
    method: 'POST',
    body: { label: 'v1' },
  })
})

it('get hits a single revision URL', async () => {
  await documentRevisionsApi.get('d1', 'r1')
  expect(mockFetch).toHaveBeenCalledWith('/api/documents/d1/revisions/r1')
})

it('restore POSTs to the restore URL', async () => {
  await documentRevisionsApi.restore('d1', 'r1')
  expect(mockFetch).toHaveBeenCalledWith(
    '/api/documents/d1/revisions/r1/restore',
    {
      method: 'POST',
    }
  )
})
