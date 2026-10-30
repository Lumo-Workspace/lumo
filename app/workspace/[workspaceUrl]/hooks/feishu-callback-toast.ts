/**
 * LUM-1341 — the i18n key for a Feishu callback's `feishu_error=<reason>`.
 * Known reasons get their own message; anything else is the generic failure.
 */
const REASON_KEYS: Record<string, string> = {
  tenant_mismatch: 'feishu.error.tenantMismatch',
  not_installed: 'feishu.error.notInstalled',
  no_refresh_token: 'feishu.error.noRefreshToken',
  not_owner: 'feishu.error.notOwner',
  expired: 'feishu.error.expired',
  tenant_taken: 'feishu.error.tenantTaken',
  reinstall_required: 'feishu.error.reinstallRequired',
  app_url_not_configured: 'feishu.error.appUrlNotConfigured',
}

export function feishuErrorMessageId(reason: string): string {
  return REASON_KEYS[reason] ?? 'feishu.connectFailed'
}
