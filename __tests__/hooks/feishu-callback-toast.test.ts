import { feishuErrorMessageId } from '@/app/workspace/[workspaceUrl]/hooks/feishu-callback-toast'

describe('feishuErrorMessageId (LUM-1341)', () => {
  it('maps each known callback reason to its own message', () => {
    expect(feishuErrorMessageId('tenant_mismatch')).toBe(
      'feishu.error.tenantMismatch'
    )
    expect(feishuErrorMessageId('not_installed')).toBe(
      'feishu.error.notInstalled'
    )
    expect(feishuErrorMessageId('no_refresh_token')).toBe(
      'feishu.error.noRefreshToken'
    )
    expect(feishuErrorMessageId('not_owner')).toBe('feishu.error.notOwner')
    expect(feishuErrorMessageId('expired')).toBe('feishu.error.expired')
    expect(feishuErrorMessageId('tenant_taken')).toBe(
      'feishu.error.tenantTaken'
    )
    expect(feishuErrorMessageId('reinstall_required')).toBe(
      'feishu.error.reinstallRequired'
    )
    expect(feishuErrorMessageId('app_url_not_configured')).toBe(
      'feishu.error.appUrlNotConfigured'
    )
  })

  it('falls back to the generic failure', () => {
    expect(feishuErrorMessageId('invalid_state')).toBe('feishu.connectFailed')
    expect(feishuErrorMessageId('1')).toBe('feishu.connectFailed')
  })
})
