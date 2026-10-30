/** A user_access_token as Lumo keeps it (times already absolute). */
export interface FeishuUserToken {
  accessToken: string
  expiresAt: Date
  /** Null when `offline_access` was not granted. */
  refreshToken: string | null
  refreshExpiresAt: Date | null
  /** What Feishu actually granted (it may trim the request). */
  scopes: string[]
}

export interface FeishuUserInfo {
  /** The user's id within this app. */
  openId: string
  /** The Feishu tenant (organization) the user signed in to. */
  tenantKey: string
  name: string | null
}

export interface FeishuTenantToken {
  token: string
  expiresAt: Date
}

export interface FeishuTenantInfo {
  tenantKey: string
  name: string
}
