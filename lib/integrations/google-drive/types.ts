export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string // only returned on first consent / prompt=consent
  expires_in: number // seconds
  scope: string
  token_type: 'Bearer'
}

export interface GoogleUserInfo {
  sub: string // stable Google user id
  email?: string
  email_verified?: boolean
}

export interface GoogleFileMetadata {
  id: string
  name: string
  mimeType: string
}
