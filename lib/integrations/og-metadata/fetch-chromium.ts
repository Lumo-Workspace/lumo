// lib/integrations/og-metadata/fetch-chromium.ts
//
// Chromium-rendered fallback for Cloudflare-protected sites. Same FetchResult
// shape as fetchOpenGraph so service-layer composition is symmetric.
//
// All errors are prefixed 'chromium: ' so logs and UI can distinguish.
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import { parseHtml } from './parse'
import { assertExternalHost } from './ssrf'
import type { FetchResult } from './fetch'

// chromium-min downloads a Linux binary tar on first invocation; the URL
// version MUST match the installed @sparticuz/chromium-min major (v148.0.0
// per package.json). Recent releases use arch-suffixed asset names — the
// older un-suffixed pattern returns 404. Vercel/Lambda is x64; arm64 is
// possible on Graviton — pick at runtime.
const CHROMIUM_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ||
  `https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.${CHROMIUM_ARCH}.tar`

// chromium-min ships ONLY Linux binaries. On macOS / Windows local-dev
// machines we have to point puppeteer at a system-installed Chrome. The
// pattern recommended by @sparticuz/chromium's README is the IS_LOCAL env
// var; we also fall back to platform detection so a Mac/Win dev who forgot
// to set the env gets a useful error instead of "Unexpected status code:
// 404." (which is what chromium-min throws when the pack download fails).
const IS_LOCAL_DEV =
  process.env.IS_LOCAL === '1' ||
  process.platform === 'darwin' ||
  process.platform === 'win32'

const LOCAL_CHROME_PATH =
  process.env.CHROME_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : '')

const NAV_TIMEOUT_MS = 8_000
const TOTAL_BUDGET_MS = 12_000

// Realistic Chrome UA. The whole point of escalating to Chromium is to look
// like a real browser; using our 'Lumo-LinkPreview/1.0' UA defeats it — CF
// pairs UA against the full sec-ch-ua / accept-language header matrix Chrome
// emits, and a "Lumo bot" with Chrome fingerprints reads as a fake and gets
// 404'd. Strip puppeteer's "HeadlessChrome" giveaway by setting an explicit
// stable Chrome UA. Update major version periodically — out-of-date UAs
// trigger fingerprinting suspicion too.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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
    browser = IS_LOCAL_DEV
      ? await puppeteer.launch({
          args: [],
          defaultViewport: null,
          executablePath: LOCAL_CHROME_PATH,
          headless: true,
        })
      : await puppeteer.launch({
          args: chromium.args,
          defaultViewport: null,
          executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
          headless: true,
        })

    const page = await browser.newPage()
    await page.setUserAgent(CHROME_UA)

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
    const data = parseHtml(html, finalUrl)
    // If even Chromium's rendered DOM has no title, accept it as blocked —
    // typically a CF challenge page that survived JS execution, or a site
    // that genuinely has no metadata. Surfacing this as an error lets the
    // UI show "Preview unavailable" rather than a blank rich card.
    if (!data.title) {
      return { ok: false, error: 'chromium: empty extraction' }
    }
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
