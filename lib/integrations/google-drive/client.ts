import { refreshAccessToken } from './oauth'
import type { GoogleFileMetadata } from './types'

export class GoogleNeedsReauthError extends Error {
  constructor() {
    super('Google Drive integration needs re-auth')
    this.name = 'GoogleNeedsReauthError'
  }
}

export interface GoogleDriveClientTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export interface GoogleDriveClient {
  getMetadata(fileId: string): Promise<GoogleFileMetadata>
  exportMarkdown(fileId: string): Promise<string>
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const REFRESH_THRESHOLD_MS = 60_000

export function createGoogleDriveClient(opts: {
  tokens: GoogleDriveClientTokens
  onTokensRefreshed: (next: GoogleDriveClientTokens) => Promise<void>
}): GoogleDriveClient {
  let tokens = opts.tokens

  async function doRefresh(): Promise<boolean> {
    if (!tokens.refreshToken) return false
    const next = await refreshAccessToken(tokens.refreshToken).catch(() => null)
    if (!next) return false
    tokens = {
      // Google omits refresh_token on refresh — keep the existing one.
      accessToken: next.access_token,
      refreshToken: next.refresh_token ?? tokens.refreshToken,
      expiresAt: new Date(Date.now() + next.expires_in * 1000),
    }
    await opts.onTokensRefreshed(tokens)
    return true
  }

  async function ensureFresh(): Promise<void> {
    if (tokens.expiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS) return
    await doRefresh()
  }

  // `raw` lets exportMarkdown read text/* while getMetadata reads JSON.
  async function call(path: string): Promise<Response> {
    await ensureFresh()
    let res = await fetch(`${DRIVE_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (res.status === 401) {
      const ok = await doRefresh()
      if (!ok) throw new GoogleNeedsReauthError()
      res = await fetch(`${DRIVE_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (res.status === 401) throw new GoogleNeedsReauthError()
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(
        `Google Drive API ${res.status}: ${body.slice(0, 200)}`
      ) as Error & { status: number }
      err.status = res.status
      throw err
    }
    return res
  }

  return {
    async getMetadata(fileId) {
      const res = await call(
        `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`
      )
      return (await res.json()) as GoogleFileMetadata
    },
    async exportMarkdown(fileId) {
      const res = await call(
        `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('text/markdown')}`
      )
      return await res.text()
    },
  }
}
