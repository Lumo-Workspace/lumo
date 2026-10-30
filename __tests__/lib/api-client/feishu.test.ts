const mockApiFetch = jest.fn()
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...a: unknown[]) => mockApiFetch(...a),
}))

import { feishuApi } from '@/lib/api-client/feishu'

beforeEach(() => mockApiFetch.mockReset().mockResolvedValue({}))

describe('feishuApi (LUM-1341)', () => {
  it('reads and deletes the workspace install for the named workspace', async () => {
    await feishuApi.getInstallStatus('a b')
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/feishu/integration?workspaceUrl=a%20b'
    )
    await feishuApi.disconnectInstall('acme')
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/feishu/integration?workspaceUrl=acme',
      { method: 'DELETE' }
    )
  })

  it('reads and deletes the member account link', async () => {
    await feishuApi.getAccountStatus('acme')
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/feishu/account?workspaceUrl=acme'
    )
    await feishuApi.disconnectAccount('acme')
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/feishu/account?workspaceUrl=acme',
      { method: 'DELETE' }
    )
  })
})
