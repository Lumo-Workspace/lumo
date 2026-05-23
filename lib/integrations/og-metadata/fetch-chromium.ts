// lib/integrations/og-metadata/fetch-chromium.ts
//
// Chromium-rendered fallback for Cloudflare-protected sites. Same FetchResult
// shape as fetchOpenGraph so service-layer composition is symmetric.
//
// All errors are prefixed 'chromium: ' so logs and UI can distinguish.
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import { USER_AGENT } from './constants'
import { extractOgData } from './extract'
import { assertExternalHost } from './ssrf'
import type { FetchResult } from './fetch'

// chromium-min downloads the binary on first invocation; the URL version MUST
// match the installed @sparticuz/chromium-min major. Installed version is
// v148.0.0 (from Task 1).
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ||
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.tar'

const NAV_TIMEOUT_MS = 8_000
const TOTAL_BUDGET_MS = 12_000

export async function fetchOpenGraphChromium(
  rawUrl: string
): Promise<FetchResult> {
  try {
    await assertExternalHost(rawUrl)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'host not allowed'
    return { ok: false, error: `chromium: ${msg}` }
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: null,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    })

    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)

    const remaining = Math.max(0, deadline - Date.now())
    if (remaining === 0) {
      return { ok: false, error: 'chromium: timeout' }
    }
    try {
      await page.goto(rawUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(NAV_TIMEOUT_MS, remaining),
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'navigation failed'
      if (/timeout/i.test(msg)) return { ok: false, error: 'chromium: timeout' }
      return { ok: false, error: `chromium: navigation failed` }
    }

    if (Date.now() >= deadline) {
      return { ok: false, error: 'chromium: timeout' }
    }

    const html = await page.content()
    const finalUrl = page.url()
    const data = await extractOgData(html, finalUrl)
    return { ok: true, data, finalUrl }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return { ok: false, error: `chromium: ${msg}` }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
