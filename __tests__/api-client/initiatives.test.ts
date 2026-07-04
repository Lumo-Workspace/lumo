jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))

import { initiativesClient } from '@/lib/api-client/initiatives'
import { apiFetch } from '@/lib/api-client/base'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('initiativesClient', () => {
  it('list GETs the initiatives endpoint', async () => {
    mockApiFetch.mockResolvedValue({ initiatives: [] })
    await initiativesClient.list()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/initiatives')
  })

  it('getDetail GETs the per-initiative endpoint', async () => {
    mockApiFetch.mockResolvedValue({ initiative: { identifier: 'LUM-INIT-1' } })
    await initiativesClient.getDetail('init-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/initiatives/init-1')
  })
})
