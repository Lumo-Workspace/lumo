jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))
import { apiFetch } from '@/lib/api-client/base'
import { milestonesClient } from '@/lib/api-client/milestones'
const m = apiFetch as jest.Mock
beforeEach(() => jest.clearAllMocks())

describe('milestonesClient.listByWorkspace', () => {
  it('omits the filter param for the active default', () => {
    milestonesClient.listByWorkspace()
    expect(m).toHaveBeenCalledWith('/api/milestones/workspace')
  })
  it('appends ?filter=all for non-default', () => {
    milestonesClient.listByWorkspace('all')
    expect(m).toHaveBeenCalledWith('/api/milestones/workspace?filter=all')
  })
})
