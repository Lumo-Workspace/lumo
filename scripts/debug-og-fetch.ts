/**
 * Debug script for LUM-62 OG fallback.
 *
 * Usage:
 *   npx tsx scripts/debug-og-fetch.ts <url>
 *   npx tsx scripts/debug-og-fetch.ts https://guide.michelin.com/en/california/san-jose/restaurant/petiscos
 *
 * What it does:
 *   1. Calls fetchOpenGraph (the fast path) and prints the result.
 *   2. If the fast path didn't return ok with a title, calls
 *      fetchOpenGraphChromium and prints that result too.
 *   3. For both, separately prints the raw <title> the parser saw — so we
 *      can tell apart "missing tag" vs "empty tag" vs "whitespace-only tag".
 *
 * Bypasses the service layer / DB / classifier entirely. This isolates
 * fetch + parse so we can see what each layer actually returns on a target
 * URL, without re-running the dev server flow.
 */
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
import { parseHtml } from '@/lib/integrations/og-metadata/parse'
import { USER_AGENT } from '@/lib/integrations/og-metadata/constants'

function fmt(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') return JSON.stringify(v) // shows "" clearly
  return JSON.stringify(v, null, 2)
}

async function rawFetchAndDump(url: string, label: string): Promise<void> {
  console.log(`\n--- raw HTTP fetch (${label}) ---`)
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    const elapsed = Date.now() - t0
    console.log(`status: ${res.status}`)
    console.log(`content-type: ${res.headers.get('content-type')}`)
    console.log(`final url: ${res.url}`)
    console.log(`elapsed: ${elapsed}ms`)
    const text = await res.text()
    console.log(`body size: ${(text.length / 1024 / 1024).toFixed(2)} MB`)

    // Show what parseHtml extracts directly from the raw body
    const parsed = parseHtml(text, res.url)
    console.log(`parseHtml result:`)
    console.log(`  title:       ${fmt(parsed.title)}`)
    console.log(`  description: ${fmt(parsed.description)}`)
    console.log(`  imageUrl:    ${fmt(parsed.imageUrl)}`)
    console.log(`  faviconUrl:  ${fmt(parsed.faviconUrl)}`)

    // Sanity: raw <title> tag presence
    const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (titleMatch) {
      console.log(`raw <title> tag length: ${titleMatch[1].length} chars`)
      console.log(`raw <title> content:    ${fmt(titleMatch[1])}`)
    } else {
      console.log(`raw <title>: NOT PRESENT in body`)
    }

    // og:title presence
    const ogMatch = text.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i
    )
    if (ogMatch) {
      console.log(`raw og:title content: ${fmt(ogMatch[1])}`)
    } else {
      console.log(`raw og:title: NOT PRESENT in body`)
    }
  } catch (e) {
    console.log(`raw fetch threw: ${e instanceof Error ? e.message : e}`)
  }
}

async function main(): Promise<void> {
  const url = process.argv[2]
  if (!url) {
    console.error('usage: npx tsx scripts/debug-og-fetch.ts <url>')
    process.exit(1)
  }

  console.log(`Target: ${url}\n`)
  console.log(`UA: ${USER_AGENT}`)

  // 1. Raw layer
  await rawFetchAndDump(url, 'plain fetch')

  // 2. fetchOpenGraph (fast path with full LUM-62 logic)
  console.log(`\n--- fetchOpenGraph (fast path, #106 classifier rules) ---`)
  const t1 = Date.now()
  const fastResult = await fetchOpenGraph(url)
  console.log(`elapsed: ${Date.now() - t1}ms`)
  console.log(`result: ${fmt(fastResult)}`)

  // 3. fetchOpenGraphChromium (only if fast didn't get a title)
  const skipChromium = fastResult.ok && !!fastResult.data.title
  if (skipChromium) {
    console.log(
      `\n--- fetchOpenGraphChromium: SKIPPED (fast path got a title) ---`
    )
  } else {
    console.log(`\n--- fetchOpenGraphChromium (escalation path) ---`)
    const t2 = Date.now()
    const chromiumResult = await fetchOpenGraphChromium(url)
    console.log(`elapsed: ${Date.now() - t2}ms`)
    console.log(`result: ${fmt(chromiumResult)}`)
  }

  console.log('\nDone.')
}

main().catch(e => {
  console.error('script failed:', e)
  process.exit(1)
})
