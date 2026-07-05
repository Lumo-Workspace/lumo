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

  it('create POSTs the goal + assumption payload', async () => {
    mockApiFetch.mockResolvedValue({ initiative: { identifier: 'LUM-INIT-2' } })
    await initiativesClient.create({
      name: 'Ship it',
      assumptionNote: 'a bet',
    })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/initiatives', {
      method: 'POST',
      body: { name: 'Ship it', assumptionNote: 'a bet' },
    })
  })
})
