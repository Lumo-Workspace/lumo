/**
 * @jest-environment node
 */

jest.mock('@/lib/api-client/base', () => ({
  apiFetch: jest.fn(),
  ApiClientError: class ApiClientError extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message)
    }
  },
}))

import { apiFetch } from '@/lib/api-client/base'
import { artifactsClient } from '@/lib/api-client/task-artifacts'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('artifactsClient.update', () => {
  it('PATCHes the artifact detail endpoint with the metadata payload', async () => {
    mockApiFetch.mockResolvedValueOnce({ artifact: { id: 'art_1' } })

    await artifactsClient.update('tsk_1', 'art_1', {
      kind: 'plan',
      title: 'Implementation plan',
    })

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/tasks/tsk_1/artifacts/art_1',
      {
        method: 'PATCH',
        body: { kind: 'plan', title: 'Implementation plan' },
      }
    )
  })
})

describe('artifactsClient.remove', () => {
  it('DELETEs the artifact detail endpoint', async () => {
    mockApiFetch.mockResolvedValueOnce(undefined)

    await artifactsClient.remove('tsk_1', 'art_1')

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/tasks/tsk_1/artifacts/art_1',
      { method: 'DELETE' }
    )
  })
})
