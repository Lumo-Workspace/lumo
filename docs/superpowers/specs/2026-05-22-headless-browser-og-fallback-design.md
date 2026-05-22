# Headless-Browser Fallback for Blocked OG Fetches

**Task**: LUM-62
**Date**: 2026-05-22
**Status**: Approved, ready for implementation plan

## Context

LUM-47 introduced a task web-links feature that fetches Open Graph metadata via a fast `fetch()`-based pipeline (`lib/integrations/og-metadata/fetch.ts`). Cloudflare-protected sites (OpenAI, NYT, etc.) return 403 to this fetcher even with a real Chrome User-Agent, and the UI falls back to a "preview unavailable" card. Browser-rendered fetches succeed where bare HTTP fails because Cloudflare's first-tier challenge inspects whether real JS executed.

This spec adds a Chromium-based fallback: the fast fetcher tries first (sub-second on warm path), and on a block signal the same request escalates to a Chromium-rendered fetch inside the same HTTP handler.

## Goals

- Sites currently rendering "preview unavailable" because of 403 / CF challenge produce a populated preview card.
- The fast path for unblocked sites remains unchanged in latency.
- No new infrastructure (queue, cron, polling). One serverless function call end-to-end.
- User does not perceive latency growth — the dialog closes immediately and the card fills in optimistically.

## Non-Goals

- Authenticated previews (sites that require cookies / login).
- Manual title editing.
- Cloudflare arms-race (`puppeteer-extra-plugin-stealth`, residential proxies, CAPTCHA solving). When Chromium is also blocked, the link records the failure and the existing Refresh button is the recovery path.
- Background queues, Vercel cron, frontend polling, or any async job system.
- Cross-browser support (Firefox, WebKit).

## Architecture

### Backend flow

```
POST /api/tasks/[id]/web-links
POST /api/tasks/[id]/web-links/[linkId]/refresh
        │
        ▼
  taskWebLinkService.{add,refresh}
        │
        ▼
  fetchOpenGraph(url)              ← existing fast path, ≤5s
        │
        ├─ ok                      → write result, return
        │
        └─ { ok: false, error }
              │
              ▼
        shouldEscalateToChromium(error)?
              │
              ├─ no                → write fetchError, return
              │
              └─ yes
                    │
                    ▼
            fetchOpenGraphChromium(url)   ← new, 10–15s
                    │
                    ├─ ok          → write result, return
                    │
                    └─ fail        → write 'chromium: <reason>', return
```

The escalation happens **inside the same HTTP request**. The function holds open for the full Chromium duration. Optimistic frontend ensures the user does not block on this.

### Frontend flow

```
User submits URL in WebLinkAddDialog
        │
        ▼
Dialog calls useWebLinks.add(url) — no await
        │
        ▼
Dialog closes immediately
        │
        ▼
useWebLinks.add:
  1. insert { tempId, url, domain, loading: true } at head of webLinks state
  2. await POST /api/tasks/[id]/web-links
  3. on success → swap tempId entry with server response
     on error   → swap tempId entry with error-card representation
```

If the component unmounts while POST is in-flight, the POST still completes on the server. Next page load shows the result.

## Block-signal classifier

New module: `lib/integrations/og-metadata/should-escalate.ts`

| `fetchOpenGraph` error | Escalate? | Rationale                                             |
| ---------------------- | --------- | ----------------------------------------------------- |
| `'http 403'`           | ✅        | Canonical CF/WAF signal                               |
| `'non-html content'`   | ✅        | CF challenge pages often have mismatched Content-Type |
| `'timeout'`            | ✅        | JS-blocked first paint; Chromium waits for render     |
| `'http 401'`           | ❌        | Needs auth cookies Chromium does not have             |
| `'http 404'`           | ❌        | URL genuinely missing                                 |
| `'http 5xx'`           | ❌        | Origin failure, Chromium cannot fix                   |
| `'http 429'`           | ❌        | Rate-limited; Chromium would also be rate-limited     |
| `'body too large'`     | ❌        | Independent of client; resource is large              |
| `'network error'`      | ❌        | DNS/TCP/TLS failure; Chromium has same network        |

```ts
// lib/integrations/og-metadata/should-escalate.ts
export function shouldEscalateToChromium(fastError: string): boolean {
  return (
    fastError === 'http 403' ||
    fastError === 'non-html content' ||
    fastError === 'timeout'
  )
}
```

## Chromium fetcher

New module: `lib/integrations/og-metadata/fetch-chromium.ts`

```ts
export async function fetchOpenGraphChromium(
  rawUrl: string
): Promise<FetchResult>
```

- **Return type**: same `FetchResult` as `fetchOpenGraph`. Drop-in compatible — the service layer composes them without branching on type.
- **Stack**: `puppeteer-core` + `@sparticuz/chromium-min` (Vercel/Lambda community standard).
- **Internal deadline**: 12s total — 8s for `page.goto` (`waitUntil: 'domcontentloaded'`), 4s for OG extraction. Anything beyond → `{ ok: false, error: 'chromium: timeout' }`.
- **Attempts**: single attempt, no internal retry. Refresh button is the manual retry path.
- **Error tagging**: all Chromium failures prefixed `'chromium: '` (e.g. `'chromium: timeout'`, `'chromium: navigation failed'`, `'chromium: blocked by challenge'`) so the UI / logs can distinguish them from fast-path errors.
- **No stealth plugin**: vanilla `puppeteer-core` headless passes the majority of first-tier CF challenges. Stronger challenges accept-as-blocked.
- **OG extraction**: reuse the same OG-tag selection logic as the fast path. Concretely, the fetcher returns the rendered HTML and routes through the existing parser, rather than duplicating extraction inside Chromium.

### Browser lifecycle

```ts
const browser = await puppeteer.launch({
  /* chromium-min args */
})
try {
  const page = await browser.newPage()
  await page.setUserAgent(USER_AGENT)
  await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 8000 })
  const html = await page.content()
  return parseOpenGraph(html, page.url())
} finally {
  await browser.close()
}
```

Browser is launched per request (no warm-pool reuse) — `@sparticuz/chromium-min` cold start is ~5–8s, which we accept. Pooling adds complexity not justified by the expected escalation rate.

## Schema

No changes to `TaskWebLink`. `fetchedAt` / `fetchError` semantics from LUM-47 are sufficient — the escalation is internal to the request, and the row reflects only the final outcome.

## Routes and config

Two routes need extended `maxDuration`:

- `app/api/tasks/[id]/web-links/route.ts` → add `export const maxDuration = 60;`
- `app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts` → add `export const maxDuration = 60;`

Both must also opt out of Edge runtime if currently on it (Chromium requires Node runtime). Set `export const runtime = 'nodejs';` on both routes if not already implied.

## Dependencies

New entries in `package.json`:

- `puppeteer-core` (latest stable, ~23.x)
- `@sparticuz/chromium-min` (latest matching Chromium version with `puppeteer-core`)

Per CLAUDE.md, the PR description must call these out.

## Frontend changes

### `WebLinkAddDialog.tsx`

- `onSubmit` no longer awaits `props.onSubmit(...)`. Instead: fires it, then immediately calls `onOpenChange(false)` to close the dialog and resets local form state.
- Error display for the synchronous-validation case (invalid URL format) remains in the dialog; runtime POST errors surface in the card (see below).

### `useWebLinks.ts`

- `add(url, note)`:
  1. Synchronously generate `tempId`, derive `domain` from `url`, insert `{ tempId, url, domain, note, loading: true, ... }` at head of `webLinks` state.
  2. Call `webLinksClient.add(url, note)` (no await change — function stays async, but the dialog doesn't await its result).
  3. On success: `setWebLinks(prev => prev.map(x => x.tempId === tempId ? response : x))`.
  4. On failure: `setWebLinks(prev => prev.map(x => x.tempId === tempId ? { ...x, loading: false, fetchError: msg } : x))`.
- The `WebLink` type in the hook gains optional `tempId` and `loading` fields for the optimistic phase.

### `WebLinkCard.tsx`

- When `loading: true` (optimistic phase): render the existing card skeleton (favicon placeholder, domain visible, title/description shimmer). Avoid layout shift when real data lands.
- The "loading" visual state already exists in some form for the LUM-47 dialog spinner — adapt the same styling to the card.

### i18n

Add new keys for the optimistic skeleton state (e.g. `webLinks.card.loading`) across **all** locale files per CLAUDE.md i18n rules.

## Testing

### Automated

- `lib/integrations/og-metadata/__tests__/should-escalate.test.ts` — 9 cases, one per known `fetchOpenGraph` error string.
- `lib/services/__tests__/task-web-link.service.test.ts` — mock `fetchOpenGraph` and `fetchOpenGraphChromium`, verify:
  - fast `ok` → Chromium not called
  - fast fail with block signal → Chromium called, result written
  - fast fail without block signal → Chromium not called, `fetchError` written
  - Chromium fail → `fetchError` written with `'chromium: '` prefix

`fetchOpenGraphChromium` itself is not unit-tested — puppeteer is impractical to mock and the value of the test is dominated by real-site behavior, which manual + post-deploy verification covers.

### Manual

- Add a link to `https://openai.com` (CF-protected) → fast 403 → escalation → preview populated with OG data.
- Add a link to `https://github.com` (unprotected) → fast path returns sub-second, no Chromium invocation (verify via logs).
- Add a link to a known 404 → no escalation, error card shown.
- Add a link, close the modal mid-flight, navigate away → return to task detail, link is present.
- Add 3 blocked links in quick succession → all eventually populate; verify per-request function logs.

## Operational notes

- Chromium escalation occupies a serverless function for 10–15s. With Vercel Pro concurrent function limits (1000 invocations on Pro), this is well within bounds for expected load (humans adding links one at a time).
- Bundle impact: ~50MB from `@sparticuz/chromium-min`. Within Pro's 250MB function bundle limit.
- Cost: each escalation = ~10–15s of GB-seconds compute. Negligible at current usage.
- Logs: every escalation emits a single info log line `[og] escalating to chromium: <domain> reason=<fastError>` so we can monitor escalation rate and tune the classifier later if needed.

## Out of scope (deferred)

- **Auto-retry on Chromium failure**: deferred until escalation-failure rate is known. Refresh button suffices for v1.
- **Vercel cron orphan-job cleaner**: not needed with the sync architecture (no orphan state to clean).
- **Stealth plugins / proxies**: only if block rate post-deploy is unacceptable.
- **Warm-pool browser reuse**: cold-start cost is acceptable given expected request rate.
- **OG parser improvements** (cheerio etc.): orthogonal to the CF problem; revisit separately if extraction quality is the bottleneck.

## Open questions

None at design time. All five brainstorm-phase open questions are resolved:

1. Job state representation → no job (sync architecture).
2. Worker trigger → no worker (sync architecture).
3. Block-signal classifier → see classifier table above.
4. Retry policy → no auto-retry; manual Refresh button.
5. CF challenge handling → vanilla Chromium, accept-as-blocked on hard challenges.
