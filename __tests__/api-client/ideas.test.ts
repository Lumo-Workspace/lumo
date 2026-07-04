jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))

import { ideasClient } from '@/lib/api-client/ideas'
import { apiFetch } from '@/lib/api-client/base'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('ideasClient', () => {
  it('listPool GETs the ideas pool endpoint', async () => {
    mockApiFetch.mockResolvedValue({ ideas: [] })
    await ideasClient.listPool()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/ideas')
  })

  it('capture POSTs the statement payload', async () => {
    mockApiFetch.mockResolvedValue({ idea: { identifier: 'LUM-I1' } })
    await ideasClient.capture({ statement: 'ship it' })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/ideas', {
      method: 'POST',
      body: { statement: 'ship it' },
    })
  })
})
