const mockApiFetch = jest.fn().mockResolvedValue({})
jest.mock('@/lib/api-client/base', () => ({
  apiFetch: (...a: unknown[]) => mockApiFetch(...a),
}))
import { testCasesClient } from '@/lib/api-client/test-cases'

beforeEach(() => mockApiFetch.mockClear())

it('routes task cases under /api/tasks', async () => {
  await testCasesClient.list({ kind: 'task', id: 't-1' })
  expect(mockApiFetch).toHaveBeenCalledWith('/api/tasks/t-1/test-cases')
})

it('routes milestone cases and dispositions under /api/milestones', async () => {
  await testCasesClient.list({ kind: 'milestone', id: 'm-1' })
  await testCasesClient.disposeDefect({ kind: 'milestone', id: 'm-1' }, 'r-1', {
    disposition: 'KNOWN_DEFECT',
  })
  expect(mockApiFetch).toHaveBeenNthCalledWith(
    1,
    '/api/milestones/m-1/test-cases'
  )
  expect(mockApiFetch).toHaveBeenNthCalledWith(
    2,
    '/api/milestones/m-1/test-case-runs/r-1/disposition',
    expect.objectContaining({ method: 'POST' })
  )
})
