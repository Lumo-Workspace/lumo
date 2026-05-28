import { refreshAccessToken } from './oauth'
import type {
  FigmaFileResponse,
  FigmaNodesResponse,
  FigmaImagesResponse,
} from './types'

export class FigmaNeedsReauthError extends Error {
  constructor() {
    super('Figma integration needs re-auth')
    this.name = 'FigmaNeedsReauthError'
  }
}

export interface FigmaClientTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export interface FigmaClient {
  getFile(fileKey: string): Promise<FigmaFileResponse>
  getNode(fileKey: string, nodeId: string): Promise<FigmaNodesResponse>
  getImage(fileKey: string, nodeId: string): Promise<string | null>
}

const FIGMA_API_BASE = 'https://api.figma.com/v1'
const REFRESH_THRESHOLD_MS = 60_000

export function createFigmaClient(opts: {
  tokens: FigmaClientTokens
  onTokensRefreshed: (next: FigmaClientTokens) => Promise<void>
}): FigmaClient {
  let tokens = opts.tokens

  async function ensureFresh(): Promise<void> {
    if (tokens.expiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS) return
    const next = await refreshAccessToken(tokens.refreshToken)
    tokens = {
      accessToken: next.access_token,
      refreshToken: next.refresh_token,
      expiresAt: new Date(Date.now() + next.expires_in * 1000),
    }
    await opts.onTokensRefreshed(tokens)
  }

  async function call<T>(path: string): Promise<T> {
    await ensureFresh()
    let res = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (res.status === 401) {
      const next = await refreshAccessToken(tokens.refreshToken).catch(
        () => null
      )
      if (!next) throw new FigmaNeedsReauthError()
      tokens = {
        accessToken: next.access_token,
        refreshToken: next.refresh_token,
        expiresAt: new Date(Date.now() + next.expires_in * 1000),
      }
      await opts.onTokensRefreshed(tokens)
      res = await fetch(`${FIGMA_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (res.status === 401) throw new FigmaNeedsReauthError()
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(
        `Figma API ${res.status}: ${body.slice(0, 200)}`
      ) as Error & { status: number }
      err.status = res.status
      throw err
    }
    return (await res.json()) as T
  }

  return {
    getFile(fileKey) {
      return call<FigmaFileResponse>(`/files/${fileKey}?depth=1`)
    },
    getNode(fileKey, nodeId) {
      const ids = encodeURIComponent(nodeId)
      return call<FigmaNodesResponse>(`/files/${fileKey}/nodes?ids=${ids}`)
    },
    async getImage(fileKey, nodeId) {
      const ids = encodeURIComponent(nodeId)
      const res = await call<FigmaImagesResponse>(
        `/images/${fileKey}?ids=${ids}&format=png&scale=2`
      )
      return res.images[nodeId] ?? null
    },
  }
}
