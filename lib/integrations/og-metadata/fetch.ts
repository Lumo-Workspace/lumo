// lib/integrations/og-metadata/fetch.ts
import {
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  TIMEOUT_MS,
  USER_AGENT,
} from './constants'
import { parseHtml, type OgData } from './parse'
import { assertExternalHost } from './ssrf'

export type FetchResult =
  | { ok: true; data: OgData; finalUrl: string }
  | { ok: false; error: string }

async function readWithLimit(
  body: ReadableStream<Uint8Array> | null
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!body) return { ok: true, text: '' }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return { ok: false, error: 'body too large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, error: 'read error' }
  }
  return {
    ok: true,
    text: new TextDecoder('utf-8').decode(
      Buffer.concat(chunks.map(c => Buffer.from(c)))
    ),
  }
}

async function singleFetch(url: string): Promise<Response | { error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    return res
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError')
      return { error: 'timeout' }
    return { error: 'network error' }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchOpenGraph(rawUrl: string): Promise<FetchResult> {
  let currentUrl = rawUrl
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        await assertExternalHost(currentUrl)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'host not allowed'
        return { ok: false, error: msg }
      }

      const res = await singleFetch(currentUrl)
      if ('error' in res) return { ok: false, error: res.error }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { ok: false, error: `http ${res.status}` }
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }

      if (!res.ok) return { ok: false, error: `http ${res.status}` }

      const ct = res.headers.get('content-type') ?? ''
      if (!/^(text\/html|application\/xhtml\+xml)/i.test(ct)) {
        return { ok: false, error: 'non-html content' }
      }

      const body = await readWithLimit(res.body)
      if (!body.ok) return { ok: false, error: body.error }

      const data = parseHtml(body.text, currentUrl)
      return { ok: true, data, finalUrl: currentUrl }
    }
    return { ok: false, error: 'too many redirects' }
  } catch {
    return { ok: false, error: 'internal fetch error' }
  }
}
