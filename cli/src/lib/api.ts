const DEFAULT_API_URL = 'https://www.uselumo.ai'

export function resolveApiUrl(): string {
  const url = process.env.LUMO_API_URL?.trim()
  return url && url.length > 0 ? url : DEFAULT_API_URL
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export interface VerifyResponse {
  user: { id: string; email: string; name: string }
  workspace: { id: string; slug: string; name: string }
  apiKey: { id: string; name: string; prefix: string }
}

export async function verifyToken(
  apiUrl: string,
  token: string
): Promise<VerifyResponse> {
  let res: Response
  try {
    res = await fetch(`${trimTrailingSlash(apiUrl)}/api/auth/verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach Lumo API at ${apiUrl} (${msg})`)
  }
  if (res.status === 401) {
    throw new Error('Invalid or revoked API key')
  }
  if (!res.ok) {
    throw new Error(`Verify failed: HTTP ${res.status}`)
  }
  return (await res.json()) as VerifyResponse
}
