# Web Links as Task Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workspace members attach arbitrary http(s) URLs to a task as context. The server fetches OpenGraph metadata synchronously at submit time. Cards render in the task detail Timeline. `lumo task context <LUM-N>` surfaces them so agents see references during work.

**Architecture:** Mirror the existing `TaskSlackContext` feature 1:1 (data model, repository, service, API routes, Timeline section, task-context formatter). New external integration `lib/integrations/og-metadata/` handles the fetch + parse, with required SSRF guard. New npm dep: `node-html-parser`.

**Tech Stack:** Next.js App Router · Prisma + Postgres · Clerk auth · React Query · shadcn/ui · Tailwind · Jest · `node-html-parser` (new)

**Spec:** [`docs/superpowers/specs/2026-05-22-web-links-task-context-design.md`](../specs/2026-05-22-web-links-task-context-design.md)
**Branch:** `lumo/LUM-47-add-web-links-task-context` (already created from `origin/main`)
**PR title:** `feat: add web links as task context [LUM-47]`

---

## Conventions used in this plan

- `LUM-47` tag goes on every commit message.
- TDD where there is real logic (repo, service, OG fetcher, SSRF, parsers, markdown formatter). For pure glue (route boilerplate, locale JSON, UI mount points), tests are integration-only — verify by running `npm test` and visiting the preview.
- **`actorMemberId`** in this plan always means `WorkspaceMember.id` — NOT `clerkUserId`. The API routes call `requireWorkspaceMember(workspaceId, clerkUserId)` and pass `memberResult.id` into the service. Same convention as `TaskSlackContext`.
- Commit after every task. Re-run `npm test` and `npx tsc --noEmit` before committing if the change is non-trivial.

---

## Task 1: New npm dependency — `node-html-parser`

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json` (auto-updated by npm)

- [ ] **Step 1: Install the dep**

```bash
npm install node-html-parser@^7
```

Expected: `package.json` gains `"node-html-parser": "^7.x.y"` under `dependencies` (NOT `devDependencies`). Package-lock updates.

- [ ] **Step 2: Sanity-check it imports**

```bash
node -e "console.log(typeof require('node-html-parser').parse)"
```

Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-html-parser for OG metadata extraction [LUM-47]"
```

Note for PR description (track this): a new runtime dependency was added — `node-html-parser`. Used only by `lib/integrations/og-metadata/parse.ts` for HTML parsing on the server.

---

## Task 2: Prisma schema — add `TaskWebLink` model + relations

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the `TaskWebLink` model**

At the end of `prisma/schema.prisma` (after the last model, before any closing whitespace), append:

```prisma
model TaskWebLink {
  id          String   @id @default(cuid())
  taskId      String
  task        Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  url         String
  domain      String
  title       String?
  description String?
  note        String?
  imageUrl    String?
  faviconUrl  String?
  fetchedAt   DateTime?
  fetchError  String?
  createdById String
  createdBy   WorkspaceMember @relation("TaskWebLinkCreator", fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([taskId, createdAt])
}
```

- [ ] **Step 2: Add the back-relation on `Task`**

Find the `model Task {` block (around line 383 — search for `slackContexts TaskSlackContext[]` to find the right spot) and add immediately after the `slackContexts` line:

```prisma
  webLinks       TaskWebLink[]
```

- [ ] **Step 3: Add the back-relation on `WorkspaceMember`**

Find `model WorkspaceMember {` and the existing `createdSlackContexts TaskSlackContext[] @relation("TaskSlackContextCreator")` line (around line 272). Immediately after it, add:

```prisma
  createdWebLinks      TaskWebLink[]     @relation("TaskWebLinkCreator")
```

- [ ] **Step 4: Validate the schema parses**

```bash
npx prisma format
npx prisma validate
```

Expected: both commands exit 0. `prisma format` may rewrite indentation — that's fine.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add TaskWebLink model + relations [LUM-47]"
```

---

## Task 3: Generate + apply the migration

**Files:**

- Create: `prisma/migrations/<timestamp>_add_task_web_link/migration.sql` (Prisma generates the filename)

- [ ] **Step 1: Generate + apply the migration**

```bash
npx prisma migrate dev --name add_task_web_link
```

Expected: a new migration directory is created under `prisma/migrations/`, the SQL applies to the local dev DB, and `prisma generate` runs automatically.

**If checksum drift hits (P3008 / P3012)**, follow the recipe from `CLAUDE.md` → "Database Migrations" → "Dev":

1. Hand-write the migration SQL under `prisma/migrations/<timestamp>_add_task_web_link/migration.sql`
2. `npx prisma db execute --file prisma/migrations/<timestamp>_add_task_web_link/migration.sql`
3. `npx prisma migrate resolve --applied <timestamp>_add_task_web_link`
4. `npx prisma generate`
   Do **not** `prisma migrate reset` and do **not** edit `_prisma_migrations` without explicit user approval.

- [ ] **Step 2: Verify status**

```bash
npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 3: TypeScript still happy**

```bash
npx tsc --noEmit
```

Expected: no errors (the new Prisma client types resolve `prisma.taskWebLink.create` etc.).

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/
git commit -m "feat(db): migration for TaskWebLink [LUM-47]"
```

Note for PR description: schema change → requires `prisma migrate deploy` on next deploy.

---

## Task 4: OG fetcher — `constants.ts`

**Files:**

- Create: `lib/integrations/og-metadata/constants.ts`

No tests — pure constants.

- [ ] **Step 1: Write the constants file**

```ts
// lib/integrations/og-metadata/constants.ts

/** Per-request timeout in ms. Applies to each redirect hop too. */
export const TIMEOUT_MS = 5_000

/** Max HTML body bytes we'll read before aborting. */
export const MAX_BODY_BYTES = 3 * 1024 * 1024

/** Max redirect hops we'll follow. */
export const MAX_REDIRECTS = 5

/** User-Agent sent on outbound fetches. */
export const USER_AGENT = 'Lumo-LinkPreview/1.0'
```

- [ ] **Step 2: Commit**

```bash
git add lib/integrations/og-metadata/constants.ts
git commit -m "feat: add og-metadata constants [LUM-47]"
```

---

## Task 5: SSRF guard — `ssrf.ts` (TDD)

**Files:**

- Create: `lib/integrations/og-metadata/ssrf.ts`
- Create: `__tests__/integrations/og-metadata/ssrf.test.ts`

The guard resolves the URL hostname via DNS and rejects any address in a private/loopback/link-local/multicast range. Used by `fetch.ts` before every outbound request (including each redirect target).

- [ ] **Step 1: Write the failing test**

`__tests__/integrations/og-metadata/ssrf.test.ts`:

```ts
/** @jest-environment node */

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}))

import { lookup } from 'dns/promises'
import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'

const lookupMock = lookup as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('assertExternalHost', () => {
  it('allows a public IPv4 host', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(
      assertExternalHost('https://example.com/foo')
    ).resolves.toBeUndefined()
  })

  it('allows a public IPv6 host', async () => {
    lookupMock.mockResolvedValue([
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])
    await expect(
      assertExternalHost('https://example.com/foo')
    ).resolves.toBeUndefined()
  })

  it.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 private 10/8', '10.0.0.5'],
    ['IPv4 private 172.16/12', '172.16.99.1'],
    ['IPv4 private 192.168/16', '192.168.1.1'],
    ['IPv4 link-local 169.254/16', '169.254.169.254'],
    ['IPv4 multicast', '224.0.0.1'],
    ['IPv4 reserved 0/8', '0.0.0.5'],
  ])('rejects %s', async (_label, ip) => {
    lookupMock.mockResolvedValue([{ address: ip, family: 4 }])
    await expect(assertExternalHost('https://x.test/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it.each([
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local fe80::/10', 'fe80::1'],
    ['IPv6 unique-local fc00::/7', 'fc00::1'],
    ['IPv6 multicast ff00::/8', 'ff01::1'],
  ])('rejects %s', async (_label, ip) => {
    lookupMock.mockResolvedValue([{ address: ip, family: 6 }])
    await expect(assertExternalHost('https://x.test/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it('rejects IPv4-mapped IPv6 that maps to a private IPv4', async () => {
    // 10.0.0.1 expressed as ::ffff:10.0.0.1 / ::ffff:a00:1
    lookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.1', family: 6 }])
    await expect(assertExternalHost('https://x.test/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it('rejects when ANY resolved address is private (even if one is public)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
    await expect(assertExternalHost('https://example.com/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it('throws on malformed URL', async () => {
    await expect(assertExternalHost('not a url')).rejects.toThrow()
    expect(lookupMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx jest __tests__/integrations/og-metadata/ssrf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ssrf.ts`**

```ts
// lib/integrations/og-metadata/ssrf.ts
import { lookup } from 'dns/promises'
import net from 'net'

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some(p => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    throw new Error(`invalid IPv4: ${ip}`)
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  )
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  // 0.0.0.0/8
  if ((n & 0xff000000) === 0x00000000) return true
  // 10.0.0.0/8
  if ((n & 0xff000000) === 0x0a000000) return true
  // 127.0.0.0/8
  if ((n & 0xff000000) === 0x7f000000) return true
  // 169.254.0.0/16
  if ((n & 0xffff0000) === 0xa9fe0000) return true
  // 172.16.0.0/12
  if ((n & 0xfff00000) === 0xac100000) return true
  // 192.168.0.0/16
  if ((n & 0xffff0000) === 0xc0a80000) return true
  // 224.0.0.0/4 (multicast)
  if ((n & 0xf0000000) === 0xe0000000) return true
  // 240.0.0.0/4 (reserved)
  if ((n & 0xf0000000) === 0xf0000000) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  // IPv4-mapped IPv6: ::ffff:a.b.c.d — re-check against IPv4 rules.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return isPrivateIPv4(mapped[1])

  // Also normalize shortened ::ffff:HHHH:HHHH that browsers can emit.
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16)
    const lo = parseInt(hexMapped[2], 16)
    const dotted = [
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    ].join('.')
    return isPrivateIPv4(dotted)
  }

  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  if (lower === '::') return true
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true // fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7
  if (lower.startsWith('ff')) return true // ff00::/8 multicast
  return false
}

/**
 * Throws if the URL's hostname resolves to ANY private/loopback/link-local
 * address (IPv4 or IPv6). Call before every outbound fetch.
 */
export async function assertExternalHost(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl) // throws on malformed; caller's problem
  const host = u.hostname

  // Reject literal IP hostnames in private ranges before DNS even runs.
  const literalFamily = net.isIP(host)
  if (literalFamily === 4 && isPrivateIPv4(host)) {
    throw new Error('host not allowed (private IPv4 literal)')
  }
  if (literalFamily === 6 && isPrivateIPv6(host)) {
    throw new Error('host not allowed (private IPv6 literal)')
  }
  if (literalFamily !== 0) return

  const records = await lookup(host, { all: true })
  for (const r of records) {
    const bad =
      r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)
    if (bad) {
      throw new Error(`host not allowed (resolved to ${r.address})`)
    }
  }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
npx jest __tests__/integrations/og-metadata/ssrf.test.ts
```

Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/og-metadata/ssrf.ts __tests__/integrations/og-metadata/ssrf.test.ts
git commit -m "feat: add SSRF guard for og-metadata fetcher [LUM-47]"
```

---

## Task 6: OG parser — `parse.ts` (TDD)

**Files:**

- Create: `lib/integrations/og-metadata/parse.ts`
- Create: `__tests__/integrations/og-metadata/parse.test.ts`

Extracts title/description/imageUrl/faviconUrl from HTML, resolving relative URLs against the document URL.

- [ ] **Step 1: Write the failing test**

`__tests__/integrations/og-metadata/parse.test.ts`:

```ts
/** @jest-environment node */
import { parseHtml } from '@/lib/integrations/og-metadata/parse'

const BASE = 'https://example.com/article'

describe('parseHtml', () => {
  it('extracts full OG meta', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Desc">
        <meta property="og:image" content="https://cdn.example.com/og.png">
        <link rel="icon" href="https://example.com/favicon.png">
      </head></html>
    `
    expect(parseHtml(html, BASE)).toEqual({
      title: 'OG Title',
      description: 'OG Desc',
      imageUrl: 'https://cdn.example.com/og.png',
      faviconUrl: 'https://example.com/favicon.png',
    })
  })

  it('falls back to <title> and <meta name=description>', () => {
    const html = `
      <html><head>
        <title>Plain Title</title>
        <meta name="description" content="Plain desc">
      </head></html>
    `
    const result = parseHtml(html, BASE)
    expect(result.title).toBe('Plain Title')
    expect(result.description).toBe('Plain desc')
  })

  it('falls back to twitter:* tags', () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="TW Title">
        <meta name="twitter:description" content="TW Desc">
        <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      </head></html>
    `
    const result = parseHtml(html, BASE)
    expect(result.title).toBe('TW Title')
    expect(result.description).toBe('TW Desc')
    expect(result.imageUrl).toBe('https://cdn.example.com/tw.png')
  })

  it('resolves a relative og:image against the base URL', () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/static/og.png">
      </head></html>
    `
    expect(parseHtml(html, BASE).imageUrl).toBe(
      'https://example.com/static/og.png'
    )
  })

  it('resolves a relative favicon against the base URL', () => {
    const html = `
      <html><head>
        <link rel="icon" href="/favicon.ico">
      </head></html>
    `
    expect(parseHtml(html, BASE).faviconUrl).toBe(
      'https://example.com/favicon.ico'
    )
  })

  it('defaults faviconUrl to /favicon.ico on origin when no link tag present', () => {
    const html = `<html><head></head></html>`
    expect(parseHtml(html, BASE).faviconUrl).toBe(
      'https://example.com/favicon.ico'
    )
  })

  it('returns undefined fields when nothing is parseable', () => {
    const html = `<html><head></head><body>No meta here.</body></html>`
    expect(parseHtml(html, BASE).title).toBeUndefined()
    expect(parseHtml(html, BASE).description).toBeUndefined()
    expect(parseHtml(html, BASE).imageUrl).toBeUndefined()
  })

  it('prefers og:title over <title>', () => {
    const html = `
      <html><head>
        <title>Plain</title>
        <meta property="og:title" content="OG Wins">
      </head></html>
    `
    expect(parseHtml(html, BASE).title).toBe('OG Wins')
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx jest __tests__/integrations/og-metadata/parse.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parse.ts`**

```ts
// lib/integrations/og-metadata/parse.ts
import { parse } from 'node-html-parser'

export interface OgData {
  title?: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
}

function resolve(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).toString()
  } catch {
    return undefined
  }
}

export function parseHtml(html: string, baseUrl: string): OgData {
  const root = parse(html)

  const metaContent = (selector: string): string | undefined => {
    const el = root.querySelector(selector)
    const v = el?.getAttribute('content')
    return v?.trim() || undefined
  }

  const title =
    metaContent('meta[property="og:title"]') ??
    metaContent('meta[name="twitter:title"]') ??
    root.querySelector('title')?.text?.trim() ??
    undefined

  const description =
    metaContent('meta[property="og:description"]') ??
    metaContent('meta[name="twitter:description"]') ??
    metaContent('meta[name="description"]') ??
    undefined

  const ogImageRaw =
    metaContent('meta[property="og:image"]') ??
    metaContent('meta[name="twitter:image"]')
  const imageUrl = resolve(ogImageRaw, baseUrl)

  const linkIcon =
    root.querySelector('link[rel="icon"]') ??
    root.querySelector('link[rel="shortcut icon"]')
  const faviconHref = linkIcon?.getAttribute('href')
  const faviconUrl =
    resolve(faviconHref, baseUrl) ?? resolve('/favicon.ico', baseUrl)

  return { title, description, imageUrl, faviconUrl }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
npx jest __tests__/integrations/og-metadata/parse.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/og-metadata/parse.ts __tests__/integrations/og-metadata/parse.test.ts
git commit -m "feat: add HTML/OG parser [LUM-47]"
```

---

## Task 7: OG fetcher — `fetch.ts` (TDD)

**Files:**

- Create: `lib/integrations/og-metadata/fetch.ts`
- Create: `__tests__/integrations/og-metadata/fetch.test.ts`

Orchestrates: SSRF guard → manual redirect-following `fetch` with timeout + size cap → content-type check → parse. Returns `{ ok, data?, error? }`. Never throws.

- [ ] **Step 1: Write the failing test**

`__tests__/integrations/og-metadata/fetch.test.ts`:

```ts
/** @jest-environment node */

jest.mock('@/lib/integrations/og-metadata/ssrf', () => ({
  assertExternalHost: jest.fn().mockResolvedValue(undefined),
}))

import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'

const ssrfMock = assertExternalHost as jest.Mock
const fetchMock = jest.fn()
;(global as any).fetch = fetchMock

beforeEach(() => {
  jest.clearAllMocks()
  ssrfMock.mockResolvedValue(undefined)
})

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

describe('fetchOpenGraph', () => {
  it('returns ok with parsed OG meta', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        '<html><head><meta property="og:title" content="Hi"></head></html>'
      )
    )
    const result = await fetchOpenGraph('https://example.com/')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('Hi')
  })

  it('returns not-ok on non-html content-type', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const result = await fetchOpenGraph('https://example.com/data.json')
    expect(result).toEqual({ ok: false, error: 'non-html content' })
  })

  it('returns not-ok on http error status', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const result = await fetchOpenGraph('https://example.com/missing')
    expect(result).toEqual({ ok: false, error: 'http 404' })
  })

  it('returns not-ok when SSRF guard rejects', async () => {
    ssrfMock.mockRejectedValueOnce(new Error('host not allowed'))
    const result = await fetchOpenGraph('http://127.0.0.1/')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/host not allowed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns not-ok on timeout (AbortError)', async () => {
    fetchMock.mockImplementation(() => {
      const e = new Error('aborted')
      ;(e as any).name = 'AbortError'
      return Promise.reject(e)
    })
    const result = await fetchOpenGraph('https://example.com/slow')
    expect(result).toEqual({ ok: false, error: 'timeout' })
  })

  it('returns not-ok when body exceeds MAX_BODY_BYTES', async () => {
    // Build a stream that yields > 3MB
    const big = 'x'.repeat(4 * 1024 * 1024)
    fetchMock.mockResolvedValue(htmlResponse(big))
    const result = await fetchOpenGraph('https://example.com/big')
    expect(result).toEqual({ ok: false, error: 'body too large' })
  })

  it('re-checks SSRF on each redirect hop', async () => {
    // First call returns a 302 to a private host; fetch handles that
    // because we set redirect: 'manual'. The fetcher must call
    // assertExternalHost again on the redirect target and refuse.
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://10.0.0.1/' },
      })
    )
    ssrfMock
      .mockResolvedValueOnce(undefined) // initial URL ok
      .mockRejectedValueOnce(new Error('host not allowed')) // redirect blocked
    const result = await fetchOpenGraph('https://example.com/redirect')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/host not allowed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows up to MAX_REDIRECTS hops', async () => {
    // 5 redirects then a real response — must succeed.
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/hop${i + 1}` },
        })
      )
    }
    fetchMock.mockResolvedValueOnce(
      htmlResponse('<html><head><title>Final</title></head></html>')
    )
    const result = await fetchOpenGraph('https://example.com/start')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('Final')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('fails on too many redirects', async () => {
    for (let i = 0; i < 10; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/hop${i + 1}` },
        })
      )
    }
    const result = await fetchOpenGraph('https://example.com/loop')
    expect(result).toEqual({ ok: false, error: 'too many redirects' })
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx jest __tests__/integrations/og-metadata/fetch.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fetch.ts`**

```ts
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
  } catch (e) {
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
  } catch (e: any) {
    if (e?.name === 'AbortError') return { error: 'timeout' }
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
      } catch (e: any) {
        return { ok: false, error: e?.message ?? 'host not allowed' }
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
  } catch (e: any) {
    return { ok: false, error: 'internal fetch error' }
  }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
npx jest __tests__/integrations/og-metadata/fetch.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/og-metadata/fetch.ts __tests__/integrations/og-metadata/fetch.test.ts
git commit -m "feat: add OG metadata fetcher with SSRF + size caps [LUM-47]"
```

---

## Task 8: OG fetcher — barrel `index.ts`

**Files:**

- Create: `lib/integrations/og-metadata/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
// lib/integrations/og-metadata/index.ts
//
// Server-only. Consumers should import from submodule paths
// (`@/lib/integrations/og-metadata/fetch` etc.) per the project's RSC
// boundary rule; this barrel exists for type re-exports only.

export type { OgData } from './parse'
export type { FetchResult } from './fetch'
```

- [ ] **Step 2: Commit**

```bash
git add lib/integrations/og-metadata/index.ts
git commit -m "feat: og-metadata barrel for type re-exports [LUM-47]"
```

---

## Task 9: Repository — `task-web-link.repository.ts` (TDD)

**Files:**

- Create: `lib/repositories/task-web-link.repository.ts`
- Modify: `lib/repositories/index.ts` (re-export the new repo, matching how existing repos are exported)
- Create: `__tests__/repositories/task-web-link.repository.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/repositories/task-web-link.repository.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskWebLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'

const create = prisma.taskWebLink.create as jest.Mock
const findMany = prisma.taskWebLink.findMany as jest.Mock
const findUnique = prisma.taskWebLink.findUnique as jest.Mock
const update = prisma.taskWebLink.update as jest.Mock
const deleteFn = prisma.taskWebLink.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskWebLinkRepository', () => {
  it('create writes all columns', async () => {
    create.mockResolvedValue({ id: 'wl_1' })
    const input = {
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      url: 'https://example.com/',
      domain: 'example.com',
      title: 'T',
      description: 'D',
      note: null,
      imageUrl: 'https://example.com/img.png',
      faviconUrl: 'https://example.com/favicon.ico',
      fetchedAt: new Date('2026-05-22T10:00:00Z'),
      fetchError: null,
      createdById: 'mem_1',
    }
    await taskWebLinkRepository.create(input)
    expect(create).toHaveBeenCalledWith({ data: input })
  })

  it('listByTask orders by createdAt desc', async () => {
    findMany.mockResolvedValue([])
    await taskWebLinkRepository.listByTask('tsk_1')
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: 'tsk_1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('getById finds by id and joins task → project → workspaceId', async () => {
    findUnique.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkRepository.getById('wl_1')
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  })

  it('updateFetch on success overwrites OG fields and clears fetchError', async () => {
    update.mockResolvedValue({})
    await taskWebLinkRepository.updateFetch('wl_1', {
      ok: true,
      title: 'New T',
      description: 'New D',
      imageUrl: 'https://x/i.png',
      faviconUrl: 'https://x/f.ico',
    })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      data: {
        title: 'New T',
        description: 'New D',
        imageUrl: 'https://x/i.png',
        faviconUrl: 'https://x/f.ico',
        fetchedAt: expect.any(Date),
        fetchError: null,
      },
    })
  })

  it('updateFetch on failure writes fetchError, preserves OG fields + fetchedAt', async () => {
    update.mockResolvedValue({})
    await taskWebLinkRepository.updateFetch('wl_1', {
      ok: false,
      error: 'timeout',
    })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      data: { fetchError: 'timeout' },
    })
  })

  it('delete removes by id', async () => {
    deleteFn.mockResolvedValue({})
    await taskWebLinkRepository.delete('wl_1')
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'wl_1' } })
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx jest __tests__/repositories/task-web-link.repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

```ts
// lib/repositories/task-web-link.repository.ts
import { prisma } from '@/lib/db/prisma'

export interface CreateTaskWebLinkInput {
  taskId: string
  workspaceId: string // denormalized for workspace-scoped queries; mirrors TaskSlackContext
  url: string
  domain: string
  title: string | null
  description: string | null
  note: string | null
  imageUrl: string | null
  faviconUrl: string | null
  fetchedAt: Date | null
  fetchError: string | null
  createdById: string // WorkspaceMember.id
}

export type UpdateFetchInput =
  | {
      ok: true
      title: string | null | undefined
      description: string | null | undefined
      imageUrl: string | null | undefined
      faviconUrl: string | null | undefined
    }
  | { ok: false; error: string }

export const taskWebLinkRepository = {
  async create(input: CreateTaskWebLinkInput) {
    return prisma.taskWebLink.create({ data: input })
  },

  async listByTask(taskId: string) {
    return prisma.taskWebLink.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async getById(id: string) {
    return prisma.taskWebLink.findUnique({
      where: { id },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  },

  /**
   * Two modes:
   * - Success: pass ok=true + new OG fields. Overwrites them all, sets
   *   fetchedAt to now, clears fetchError. NEVER touches `note`.
   * - Failure: pass ok=false + error string. Writes fetchError only —
   *   preserves prior OG fields and fetchedAt so the UI can still show
   *   the last-known-good preview alongside the new error.
   */
  async updateFetch(id: string, fetch: UpdateFetchInput) {
    if (fetch.ok) {
      return prisma.taskWebLink.update({
        where: { id },
        data: {
          title: fetch.title ?? null,
          description: fetch.description ?? null,
          imageUrl: fetch.imageUrl ?? null,
          faviconUrl: fetch.faviconUrl ?? null,
          fetchedAt: new Date(),
          fetchError: null,
        },
      })
    }
    return prisma.taskWebLink.update({
      where: { id },
      data: { fetchError: fetch.error },
    })
  },

  async delete(id: string) {
    return prisma.taskWebLink.delete({ where: { id } })
  },
}
```

- [ ] **Step 4: Re-export the repository from the barrel**

Edit `lib/repositories/index.ts`. Add an export line that matches the pattern already used for `taskSlackContextRepository` (search for it). It will look like:

```ts
export { taskWebLinkRepository } from './task-web-link.repository'
```

- [ ] **Step 5: Run the test, confirm it passes**

```bash
npx jest __tests__/repositories/task-web-link.repository.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/task-web-link.repository.ts lib/repositories/index.ts __tests__/repositories/task-web-link.repository.test.ts
git commit -m "feat: add TaskWebLink repository [LUM-47]"
```

---

## Task 10: Validation schema — `task-web-link.ts`

**Files:**

- Create: `lib/validation/task-web-link.ts`
- Create: `__tests__/validation/task-web-link.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/validation/task-web-link.test.ts`:

```ts
import { createWebLinkBodySchema } from '@/lib/validation/task-web-link'

describe('createWebLinkBodySchema', () => {
  it('accepts a valid https URL with note', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com/foo',
      note: 'context',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid http URL', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'http://example.com/',
    })
    expect(result.success).toBe(true)
  })

  it('accepts URL without note', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com/',
    })
    expect(result.success).toBe(true)
  })

  it('rejects javascript: scheme', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'javascript:alert(1)',
    })
    expect(result.success).toBe(false)
  })

  it('rejects data: scheme', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'data:text/plain,abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed URL', () => {
    const result = createWebLinkBodySchema.safeParse({ url: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('rejects URLs longer than 2048', () => {
    const long = 'https://example.com/' + 'a'.repeat(2100)
    const result = createWebLinkBodySchema.safeParse({ url: long })
    expect(result.success).toBe(false)
  })

  it('rejects notes longer than 500', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com/',
      note: 'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run, see fail**

```bash
npx jest __tests__/validation/task-web-link.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/validation/task-web-link.ts
import { z } from 'zod'

export const createWebLinkBodySchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine(u => {
      try {
        const p = new URL(u).protocol
        return p === 'http:' || p === 'https:'
      } catch {
        return false
      }
    }, 'Only http/https URLs are supported'),
  note: z.string().max(500).optional(),
})

export type CreateWebLinkBody = z.infer<typeof createWebLinkBodySchema>
```

- [ ] **Step 4: Run, see pass**

```bash
npx jest __tests__/validation/task-web-link.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/task-web-link.ts __tests__/validation/task-web-link.test.ts
git commit -m "feat: add task-web-link Zod schema [LUM-47]"
```

---

## Task 11: Service — `task-web-link.service.ts` (TDD)

**Files:**

- Create: `lib/services/task-web-link.service.ts`
- Create: `__tests__/services/task-web-link.service.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/services/task-web-link.service.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    getById: jest.fn(),
    updateFetch: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/og-metadata/fetch', () => ({
  fetchOpenGraph: jest.fn(),
}))

import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'

const repoCreate = taskWebLinkRepository.create as jest.Mock
const repoListByTask = taskWebLinkRepository.listByTask as jest.Mock
const repoGetById = taskWebLinkRepository.getById as jest.Mock
const repoUpdateFetch = taskWebLinkRepository.updateFetch as jest.Mock
const repoDelete = taskWebLinkRepository.delete as jest.Mock
const ogMock = fetchOpenGraph as jest.Mock

beforeEach(() => jest.clearAllMocks())

const baseInput = {
  taskId: 'tsk_1',
  workspaceId: 'ws_1',
  url: 'HTTPS://Example.COM/path?x=1#frag',
  note: undefined,
  actorMemberId: 'mem_1',
}

describe('taskWebLinkService.addWebLink', () => {
  it('normalizes URL (lowercase scheme/host, strips fragment) before storing', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'timeout' })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/path?x=1',
        domain: 'example.com',
      })
    )
  })

  it('writes OG fields on fetch success', async () => {
    ogMock.mockResolvedValue({
      ok: true,
      data: {
        title: 'Hi',
        description: 'There',
        imageUrl: 'https://example.com/i.png',
        faviconUrl: 'https://example.com/f.ico',
      },
      finalUrl: 'https://example.com/path?x=1',
    })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hi',
        description: 'There',
        imageUrl: 'https://example.com/i.png',
        faviconUrl: 'https://example.com/f.ico',
        fetchedAt: expect.any(Date),
        fetchError: null,
      })
    )
  })

  it('writes nulls + fetchError on fetch failure (still stores the row)', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 404' })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: null,
        description: null,
        imageUrl: null,
        faviconUrl: null,
        fetchedAt: null,
        fetchError: 'http 404',
      })
    )
  })

  it('stores user note in `note` column, independent of fetched description', async () => {
    ogMock.mockResolvedValue({
      ok: true,
      data: { description: 'OG says this' },
      finalUrl: 'https://example.com/',
    })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink({
      ...baseInput,
      note: 'user typed this',
    })
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        note: 'user typed this',
        description: 'OG says this',
      })
    )
  })

  it('uses actorMemberId for createdById', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'x' })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'mem_1' })
    )
  })
})

describe('taskWebLinkService.refreshWebLink', () => {
  it('throws 404 if link not found', async () => {
    repoGetById.mockResolvedValue(null)
    await expect(
      taskWebLinkService.refreshWebLink('wl_X', 'ws_1')
    ).rejects.toMatchObject({ message: 'not_found', status: 404 })
  })

  it('throws 404 if link belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
      task: { project: { workspaceId: 'ws_OTHER' } },
    })
    await expect(
      taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('on fetch success: updates OG fields and clears fetchError', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
      task: { project: { workspaceId: 'ws_1' } },
    })
    ogMock.mockResolvedValue({
      ok: true,
      data: { title: 'Refreshed' },
      finalUrl: 'https://example.com/',
    })
    repoUpdateFetch.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    expect(repoUpdateFetch).toHaveBeenCalledWith('wl_1', {
      ok: true,
      title: 'Refreshed',
      description: undefined,
      imageUrl: undefined,
      faviconUrl: undefined,
    })
  })

  it('on fetch failure: writes fetchError (preserves OG fields)', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
      task: { project: { workspaceId: 'ws_1' } },
    })
    ogMock.mockResolvedValue({ ok: false, error: 'timeout' })
    repoUpdateFetch.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    expect(repoUpdateFetch).toHaveBeenCalledWith('wl_1', {
      ok: false,
      error: 'timeout',
    })
  })
})

describe('taskWebLinkService.unlinkWebLink', () => {
  it('throws 404 if not found', async () => {
    repoGetById.mockResolvedValue(null)
    await expect(
      taskWebLinkService.unlinkWebLink('wl_X', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 if link belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      task: { project: { workspaceId: 'ws_OTHER' } },
    })
    await expect(
      taskWebLinkService.unlinkWebLink('wl_1', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deletes when workspace matches', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      task: { project: { workspaceId: 'ws_1' } },
    })
    repoDelete.mockResolvedValue({})
    await taskWebLinkService.unlinkWebLink('wl_1', 'ws_1')
    expect(repoDelete).toHaveBeenCalledWith('wl_1')
  })
})

describe('taskWebLinkService.listForTask', () => {
  it('delegates to repo.listByTask', async () => {
    repoListByTask.mockResolvedValue([{ id: 'wl_1' }])
    const result = await taskWebLinkService.listForTask('tsk_1')
    expect(result).toEqual([{ id: 'wl_1' }])
    expect(repoListByTask).toHaveBeenCalledWith('tsk_1')
  })
})
```

- [ ] **Step 2: Run, see fail**

```bash
npx jest __tests__/services/task-web-link.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

`taskWebLinkRepository.getById` (defined in Task 9) already returns the link joined to `task.project.workspaceId`, so the service can enforce the workspace boundary directly.

```ts
// lib/services/task-web-link.service.ts
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function normalizeUrl(raw: string): { url: string; domain: string } {
  const u = new URL(raw.trim())
  u.protocol = u.protocol.toLowerCase()
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  return { url: u.toString(), domain: u.hostname }
}

export interface AddWebLinkInput {
  taskId: string
  workspaceId: string
  url: string
  note?: string
  actorMemberId: string
}

export const taskWebLinkService = {
  async listForTask(taskId: string) {
    return taskWebLinkRepository.listByTask(taskId)
  },

  async addWebLink(input: AddWebLinkInput) {
    const { url, domain } = normalizeUrl(input.url)
    const og = await fetchOpenGraph(url)

    const payload = og.ok
      ? {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          url,
          domain,
          title: og.data.title ?? null,
          description: og.data.description ?? null,
          note: input.note ?? null,
          imageUrl: og.data.imageUrl ?? null,
          faviconUrl: og.data.faviconUrl ?? null,
          fetchedAt: new Date(),
          fetchError: null,
          createdById: input.actorMemberId,
        }
      : {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          url,
          domain,
          title: null,
          description: null,
          note: input.note ?? null,
          imageUrl: null,
          faviconUrl: null,
          fetchedAt: null,
          fetchError: og.error,
          createdById: input.actorMemberId,
        }

    return taskWebLinkRepository.create(payload)
  },

  async refreshWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    const og = await fetchOpenGraph(link.url)
    if (og.ok) {
      return taskWebLinkRepository.updateFetch(linkId, {
        ok: true,
        title: og.data.title,
        description: og.data.description,
        imageUrl: og.data.imageUrl,
        faviconUrl: og.data.faviconUrl,
      })
    }
    return taskWebLinkRepository.updateFetch(linkId, {
      ok: false,
      error: og.error,
    })
  },

  async unlinkWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    await taskWebLinkRepository.delete(linkId)
  },
}
```

- [ ] **Step 4: Run the service test, see pass**

```bash
npx jest __tests__/services/task-web-link.service.test.ts
```

Expected: all PASS. (Repository tests were already green from Task 9.)

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/services/task-web-link.service.ts __tests__/services/task-web-link.service.test.ts
git commit -m "feat: add task-web-link service [LUM-47]"
```

---

## Task 12: API route — `GET` + `POST /api/tasks/[id]/web-links`

**Files:**

- Create: `app/api/tasks/[id]/web-links/route.ts`

The route is structurally identical to `app/api/tasks/[id]/slack-contexts/route.ts`. We're not writing a separate handler test for the wrapper logic — `Task 14` exercises the route end-to-end with mocked service.

- [ ] **Step 1: Write the route**

```ts
// app/api/tasks/[id]/web-links/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'
import { createWebLinkBodySchema } from '@/lib/validation/task-web-link'
import { zodError } from '@/lib/api/helpers'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const webLinks = await taskWebLinkService.listForTask(id)
    return NextResponse.json({ webLinks })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('GET /api/tasks/[id]/web-links error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = createWebLinkBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const webLink = await taskWebLinkService.addWebLink({
      taskId: id,
      workspaceId: task.project.workspaceId,
      url: parsed.data.url,
      note: parsed.data.note,
      actorMemberId: memberResult.id,
    })
    return NextResponse.json({ webLink }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('POST /api/tasks/[id]/web-links error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/tasks/[id]/web-links/route.ts
git commit -m "feat: add GET/POST /api/tasks/[id]/web-links [LUM-47]"
```

---

## Task 13: API route — `DELETE` + `POST refresh`

**Files:**

- Create: `app/api/tasks/[id]/web-links/[linkId]/route.ts`
- Create: `app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts`

- [ ] **Step 1: Write the DELETE route**

```ts
// app/api/tasks/[id]/web-links/[linkId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'

type Params = { params: Promise<{ id: string; linkId: string }> }

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, linkId } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await taskWebLinkService.unlinkWebLink(linkId, task.project.workspaceId)
    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('DELETE /api/tasks/[id]/web-links/[linkId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Write the refresh route**

```ts
// app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'

type Params = { params: Promise<{ id: string; linkId: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, linkId } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const webLink = await taskWebLinkService.refreshWebLink(
      linkId,
      task.project.workspaceId
    )
    return NextResponse.json({ webLink })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error(
      'POST /api/tasks/[id]/web-links/[linkId]/refresh error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/[id]/web-links/[linkId]/route.ts app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts
git commit -m "feat: add DELETE + refresh routes for web-links [LUM-47]"
```

---

## Task 14: API route end-to-end tests

**Files:**

- Create: `__tests__/api/tasks/web-links.test.ts`

Patterned on `__tests__/api/tasks/slack-contexts.test.ts`. Mocks `@/lib/auth`, `@/lib/repositories`, and `@/lib/services/task-web-link.service`.

- [ ] **Step 1: Write the test file**

```ts
/** @jest-environment node */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findWithProjectWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/task-web-link.service', () => ({
  taskWebLinkService: {
    listForTask: jest.fn(),
    addWebLink: jest.fn(),
    unlinkWebLink: jest.fn(),
    refreshWebLink: jest.fn(),
  },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'
import { GET, POST } from '@/app/api/tasks/[id]/web-links/route'
import { DELETE } from '@/app/api/tasks/[id]/web-links/[linkId]/route'
import { POST as REFRESH } from '@/app/api/tasks/[id]/web-links/[linkId]/refresh/route'

const authMock = requireAuth as jest.Mock
const memberMock = requireWorkspaceMember as jest.Mock
const findTaskMock = taskRepository.findWithProjectWorkspaceId as jest.Mock
const listMock = taskWebLinkService.listForTask as jest.Mock
const addMock = taskWebLinkService.addWebLink as jest.Mock
const unlinkMock = taskWebLinkService.unlinkWebLink as jest.Mock
const refreshMock = taskWebLinkService.refreshWebLink as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  authMock.mockResolvedValue({ userId: 'usr_clerk' })
  findTaskMock.mockResolvedValue({
    id: 'tsk_1',
    project: { workspaceId: 'ws_1' },
  })
  memberMock.mockResolvedValue({
    id: 'mem_1',
    workspaceId: 'ws_1',
    clerkId: 'usr_clerk',
  })
})

function jsonReq(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

const paramsP = (p: object) => ({ params: Promise.resolve(p) })

describe('GET /api/tasks/[id]/web-links', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when task not found', async () => {
    findTaskMock.mockResolvedValue(null)
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_X' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when not a workspace member', async () => {
    memberMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(403)
  })

  it('returns webLinks on success', async () => {
    listMock.mockResolvedValue([{ id: 'wl_1' }])
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ webLinks: [{ id: 'wl_1' }] })
  })
})

describe('POST /api/tasks/[id]/web-links', () => {
  it('returns 400 on invalid body (missing url)', async () => {
    const res = await POST(jsonReq({ note: 'x' }), paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on javascript: URL', async () => {
    const res = await POST(
      jsonReq({ url: 'javascript:alert(1)' }),
      paramsP({ id: 'tsk_1' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 201 with webLink on success', async () => {
    addMock.mockResolvedValue({ id: 'wl_1', url: 'https://example.com/' })
    const res = await POST(
      jsonReq({ url: 'https://example.com/', note: 'ctx' }),
      paramsP({ id: 'tsk_1' })
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      webLink: { id: 'wl_1', url: 'https://example.com/' },
    })
    expect(addMock).toHaveBeenCalledWith({
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      url: 'https://example.com/',
      note: 'ctx',
      actorMemberId: 'mem_1',
    })
  })
})

describe('DELETE /api/tasks/[id]/web-links/[linkId]', () => {
  it('returns 204 on success', async () => {
    unlinkMock.mockResolvedValue(undefined)
    const res = await DELETE(
      {} as NextRequest,
      paramsP({ id: 'tsk_1', linkId: 'wl_1' })
    )
    expect(res.status).toBe(204)
    expect(unlinkMock).toHaveBeenCalledWith('wl_1', 'ws_1')
  })

  it('propagates 404 from service', async () => {
    unlinkMock.mockRejectedValue(
      Object.assign(new Error('not_found'), { status: 404 })
    )
    const res = await DELETE(
      {} as NextRequest,
      paramsP({ id: 'tsk_1', linkId: 'wl_X' })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST refresh', () => {
  it('returns updated webLink', async () => {
    refreshMock.mockResolvedValue({ id: 'wl_1', title: 'Updated' })
    const res = await REFRESH(
      {} as NextRequest,
      paramsP({ id: 'tsk_1', linkId: 'wl_1' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      webLink: { id: 'wl_1', title: 'Updated' },
    })
  })
})
```

- [ ] **Step 2: Run, see pass**

```bash
npx jest __tests__/api/tasks/web-links.test.ts
```

Expected: all PASS. (The routes already exist from Task 12+13, so these tests should be green immediately.)

- [ ] **Step 3: Run the full suite to confirm nothing else broke**

```bash
npm test -- --silent
```

Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add __tests__/api/tasks/web-links.test.ts
git commit -m "test: end-to-end coverage for web-link API routes [LUM-47]"
```

---

## Task 15: API client — `lib/api-client/task-web-links.ts`

**Files:**

- Create: `lib/api-client/task-web-links.ts`

Mirrors `lib/api-client/slack-contexts.ts` — fetch-based helpers used by React Query hooks.

- [ ] **Step 1: Write the client**

```ts
// lib/api-client/task-web-links.ts
import type { TaskWebLink } from '@prisma/client'

interface ApiResponse<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

async function request<T>(
  input: RequestInfo,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(input, init)
  if (res.status === 204) {
    return { ok: true, status: 204, data: undefined as unknown as T }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        (body && (body as { error?: string }).error) ?? `HTTP ${res.status}`,
    }
  }
  return { ok: true, status: res.status, data: body as T }
}

export const webLinksClient = {
  list(taskId: string): Promise<ApiResponse<{ webLinks: TaskWebLink[] }>> {
    return request(`/api/tasks/${taskId}/web-links`, { method: 'GET' })
  },

  add(taskId: string, payload: { url: string; note?: string }) {
    return request<{ webLink: TaskWebLink }>(`/api/tasks/${taskId}/web-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  remove(taskId: string, linkId: string) {
    return request<void>(`/api/tasks/${taskId}/web-links/${linkId}`, {
      method: 'DELETE',
    })
  },

  refresh(taskId: string, linkId: string) {
    return request<{ webLink: TaskWebLink }>(
      `/api/tasks/${taskId}/web-links/${linkId}/refresh`,
      { method: 'POST' }
    )
  },
}
```

> If `lib/api-client/slack-contexts.ts` uses a slightly different envelope (e.g. throws on non-2xx rather than returning `{ ok }`), follow that pattern instead and adjust the hooks file accordingly. Open it side-by-side before writing this file to confirm.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/api-client/task-web-links.ts
git commit -m "feat: add web-links api-client [LUM-47]"
```

---

## Task 16: React Query hooks — `useWebLinks.ts`

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useWebLinks.ts`

Open `app/workspace/[workspaceUrl]/hooks/useSlackContexts.ts` before writing this — copy its query-key + mutation-invalidation pattern exactly so the hooks blend into the existing query cache.

- [ ] **Step 1: Read the Slack hooks file**

```bash
sed -n '1,200p' app/workspace/\[workspaceUrl\]/hooks/useSlackContexts.ts
```

Note the exported names (e.g. `useSlackContexts(taskId)`, `useLinkSlackContext()`, `useUnlinkSlackContext()`, `useRefreshSlackContext()`) and the `queryKey` array shape. Mirror them.

- [ ] **Step 2: Write the hooks file**

Structure (use the exact React Query version and import paths the Slack file uses):

```ts
// app/workspace/[workspaceUrl]/hooks/useWebLinks.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { webLinksClient } from '@/lib/api-client/task-web-links'

const webLinksKey = (taskId: string) => ['task', taskId, 'web-links'] as const

export function useWebLinks(taskId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: webLinksKey(taskId),
    queryFn: async () => {
      const res = await webLinksClient.list(taskId)
      if (!res.ok) throw new Error(res.error ?? 'Failed to load web links')
      return res.data!.webLinks
    },
    enabled: options?.enabled ?? true,
  })
}

export function useAddWebLink(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { url: string; note?: string }) => {
      const res = await webLinksClient.add(taskId, payload)
      if (!res.ok) throw new Error(res.error ?? 'Failed to add link')
      return res.data!.webLink
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: webLinksKey(taskId) }),
  })
}

export function useRemoveWebLink(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (linkId: string) => {
      const res = await webLinksClient.remove(taskId, linkId)
      if (!res.ok) throw new Error(res.error ?? 'Failed to delete link')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: webLinksKey(taskId) }),
  })
}

export function useRefreshWebLink(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (linkId: string) => {
      const res = await webLinksClient.refresh(taskId, linkId)
      if (!res.ok) throw new Error(res.error ?? 'Failed to refresh link')
      return res.data!.webLink
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: webLinksKey(taskId) }),
  })
}
```

> If the Slack version uses a centralized `queryKeys` factory (search for `queryKeys` in `lib/`), use it here too. Don't duplicate key strings.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/hooks/useWebLinks.ts
git commit -m "feat: add web-links React Query hooks [LUM-47]"
```

---

## Task 17: `WebLinkAddDialog.tsx`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx`

shadcn `Dialog` with URL + Notes inputs. Calls `useAddWebLink`. Open `AddSlackContextDialog.tsx` first and clone its structural pattern (Dialog/DialogContent/DialogHeader/Form/submit-button skeleton); the only domain difference is two inputs instead of one and a different i18n namespace.

- [ ] **Step 1: Read the Slack dialog**

```bash
sed -n '1,250p' app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/AddSlackContextDialog.tsx
```

- [ ] **Step 2: Implement the dialog**

Skeleton (adapt imports and styling exactly to match the Slack dialog):

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useAddWebLink } from '../../hooks/useWebLinks'

interface Props {
  taskId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WebLinkAddDialog({ taskId, open, onOpenChange }: Props) {
  const intl = useIntl()
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = useAddWebLink(taskId)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await add.mutateAsync({ url, note: note || undefined })
      setUrl('')
      setNote('')
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add link')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'task.webLinks.dialog.title' })}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='weblink-url'>
              {intl.formatMessage({ id: 'task.webLinks.dialog.urlLabel' })}
            </Label>
            <Input
              id='weblink-url'
              type='url'
              required
              autoFocus
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'task.webLinks.dialog.urlPlaceholder',
              })}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='weblink-note'>
              {intl.formatMessage({ id: 'task.webLinks.dialog.noteLabel' })}
            </Label>
            <Textarea
              id='weblink-note'
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button type='submit' disabled={add.isPending}>
              {intl.formatMessage({ id: 'task.webLinks.dialog.submit' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

If `common.cancel` does not already exist (check `lib/i18n/en.json`), use whatever cancel key the Slack dialog uses — it definitely has one.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. (Component-level tests are intentionally skipped — manual preview verification in Task 23 covers it.)

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/WebLinkAddDialog.tsx
git commit -m "feat: add WebLinkAddDialog component [LUM-47]"
```

---

## Task 18: `WebLinkCard.tsx`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkCard.tsx`

Renders a single link with two visual states:

1. **Rich** — has at least a `title`; show image (if any) + title + (`note ?? description`) + domain · time + actions menu
2. **Fallback** — no title (fetch failed or no metadata); show favicon + domain + raw URL + "Preview unavailable" + time + actions menu

Both states share an outer `<a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">` wrapper.

- [ ] **Step 1: Open the Slack card to mirror layout**

```bash
sed -n '1,300p' app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/SlackContextCard.tsx
```

- [ ] **Step 2: Implement**

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useState } from 'react'
import type { TaskWebLink } from '@prisma/client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, RotateCw, Trash2 } from 'lucide-react'
import { useRefreshWebLink, useRemoveWebLink } from '../../hooks/useWebLinks'
import { formatDistanceToNow } from 'date-fns'

interface Props {
  taskId: string
  link: TaskWebLink
}

function isSafeHttpUrl(u: string | null | undefined): u is string {
  if (!u) return false
  try {
    const p = new URL(u).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

export function WebLinkCard({ taskId, link }: Props) {
  const intl = useIntl()
  const refresh = useRefreshWebLink(taskId)
  const remove = useRemoveWebLink(taskId)
  const [busy, setBusy] = useState(false)

  const onRefresh = async () => {
    setBusy(true)
    try {
      await refresh.mutateAsync(link.id)
    } finally {
      setBusy(false)
    }
  }
  const onRemove = async () => {
    if (
      !window.confirm(intl.formatMessage({ id: 'task.webLinks.confirmDelete' }))
    )
      return
    setBusy(true)
    try {
      await remove.mutateAsync(link.id)
    } finally {
      setBusy(false)
    }
  }

  const hasPreview = !!link.title
  const safeImage = isSafeHttpUrl(link.imageUrl) ? link.imageUrl : null
  const safeFavicon = isSafeHttpUrl(link.faviconUrl) ? link.faviconUrl : null
  const body = link.note ?? link.description ?? null

  return (
    <div
      className={`relative rounded-md border p-3 ${busy ? 'opacity-50' : ''}`}
    >
      <a
        href={isSafeHttpUrl(link.url) ? link.url : '#'}
        target='_blank'
        rel='noopener noreferrer'
        referrerPolicy='no-referrer'
        className='flex gap-3'
      >
        {hasPreview && safeImage ? (
          <img
            src={safeImage}
            alt=''
            referrerPolicy='no-referrer'
            className='h-[72px] w-[120px] flex-shrink-0 rounded object-cover'
          />
        ) : safeFavicon ? (
          <img
            src={safeFavicon}
            alt=''
            referrerPolicy='no-referrer'
            className='h-8 w-8 flex-shrink-0 rounded'
          />
        ) : null}
        <div className='min-w-0 flex-1'>
          {hasPreview ? (
            <>
              <div className='line-clamp-1 font-medium'>{link.title}</div>
              {body ? (
                <div className='mt-1 line-clamp-2 text-sm text-muted-foreground'>
                  {body}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className='line-clamp-1 font-medium'>{link.domain}</div>
              <div className='mt-1 line-clamp-1 text-sm text-muted-foreground'>
                {link.url}
              </div>
              <div className='mt-1 text-xs text-muted-foreground italic'>
                {intl.formatMessage({ id: 'task.webLinks.error.fetchFailed' })}
              </div>
            </>
          )}
          <div className='mt-2 text-xs text-muted-foreground'>
            {link.domain} ·{' '}
            {formatDistanceToNow(link.createdAt, { addSuffix: true })}
          </div>
        </div>
      </a>
      <div className='absolute right-2 top-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon'>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={onRefresh} disabled={busy}>
              <RotateCw className='mr-2 h-4 w-4' />
              {intl.formatMessage({ id: 'task.webLinks.card.refresh' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onRemove}
              disabled={busy}
              className='text-destructive'
            >
              <Trash2 className='mr-2 h-4 w-4' />
              {intl.formatMessage({ id: 'task.webLinks.card.delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/WebLinkCard.tsx
git commit -m "feat: add WebLinkCard component [LUM-47]"
```

---

## Task 19: `WebLinkSection.tsx`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx`

Section header + "Add" button + list of `WebLinkCard`s. Mirrors `SlackContextSection.tsx`.

- [ ] **Step 1: Open the Slack section to mirror its Accordion wrapper / header / empty state**

```bash
sed -n '1,200p' app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/SlackContextSection.tsx
```

- [ ] **Step 2: Implement**

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWebLinks } from '../../../hooks/useWebLinks'
import { WebLinkAddDialog } from '../WebLinkAddDialog'
import { WebLinkCard } from '../WebLinkCard'

interface Props {
  taskId: string
}

export function WebLinkSection({ taskId }: Props) {
  const intl = useIntl()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: links = [], isLoading } = useWebLinks(taskId)

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>
          {intl.formatMessage({ id: 'task.webLinks.sectionTitle' })}
          {links.length > 0 ? ` (${links.length})` : ''}
        </h3>
        <Button size='sm' variant='ghost' onClick={() => setDialogOpen(true)}>
          <Plus className='mr-1 h-4 w-4' />
          {intl.formatMessage({ id: 'task.webLinks.addButton' })}
        </Button>
      </div>
      {isLoading ? null : links.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'task.webLinks.empty' })}
        </p>
      ) : (
        <div className='space-y-2'>
          {links.map(link => (
            <WebLinkCard key={link.id} taskId={taskId} link={link} />
          ))}
        </div>
      )}
      <WebLinkAddDialog
        taskId={taskId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
```

> If the Slack section is wrapped in an `<Accordion>` from `ContextTab.tsx`'s parent, the parent (Task 20) is responsible for wrapping our section the same way — keep this component free of accordion logic.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/WebLinkSection.tsx
git commit -m "feat: add WebLinkSection component [LUM-47]"
```

---

## Task 20: Mount in `ContextTab.tsx`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab.tsx`

`SlackContextSection` is mounted around line 58–64 inside an `<Accordion>`. Add a sibling entry for `WebLinkSection` next to it.

- [ ] **Step 1: Open ContextTab**

```bash
sed -n '1,120p' app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/ContextTab.tsx
```

- [ ] **Step 2: Add the import**

At the top of the file, near the existing `SlackContextSection` import, add:

```tsx
import { WebLinkSection } from './sections/WebLinkSection'
```

- [ ] **Step 3: Mount the new section**

Find the existing `<SlackContextSection>` JSX block and add a sibling Accordion item / wrapper for `<WebLinkSection taskId={taskId} />` immediately after it. The exact wrapping (`<AccordionItem value="web-links">...`) must match the Slack item's structure so they render uniformly.

> Read the Slack item's wrapper carefully — copy the trigger label pattern, the `value` attribute (use `"web-links"`), and the icon convention.

- [ ] **Step 4: TypeScript check + lint**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/ContextTab.tsx
git commit -m "feat: mount WebLinkSection in ContextTab [LUM-47]"
```

---

## Task 21: I18n keys across all 16 locales

**Files:**

- Modify: every JSON file in `lib/i18n/`

Locale list (16): `en`, `en-AU`, `en-GB`, `de`, `es`, `es-419`, `fr`, `hi`, `id`, `ja`, `ko`, `ms`, `ru`, `vi`, `zh-CN`, `zh-TW`.

Keys to add (12):

| Key                                   | Purpose                                    |
| ------------------------------------- | ------------------------------------------ |
| `task.webLinks.sectionTitle`          | Section header                             |
| `task.webLinks.empty`                 | Empty-state message                        |
| `task.webLinks.addButton`             | "Add link" button                          |
| `task.webLinks.dialog.title`          | Dialog title                               |
| `task.webLinks.dialog.urlLabel`       | URL input label                            |
| `task.webLinks.dialog.urlPlaceholder` | URL input placeholder                      |
| `task.webLinks.dialog.noteLabel`      | Notes input label                          |
| `task.webLinks.dialog.submit`         | Submit button                              |
| `task.webLinks.error.invalidUrl`      | Invalid URL error                          |
| `task.webLinks.error.urlTooLong`      | URL too long error                         |
| `task.webLinks.error.noteTooLong`     | Note too long error                        |
| `task.webLinks.error.fetchFailed`     | Preview unavailable label on fallback card |
| `task.webLinks.card.refresh`          | Card action: Refresh preview               |
| `task.webLinks.card.delete`           | Card action: Delete                        |
| `task.webLinks.confirmDelete`         | Delete-confirm prompt                      |

(That's actually 15 — I miscounted in the table header; the row count is the source of truth.)

- [ ] **Step 1: Add the English source (en.json) — pin the canonical wording**

Open `lib/i18n/en.json`. The Slack-context keys were added in the same area; place these in the same alphabetical/nested location. Suggested values:

```json
{
  "task.webLinks.sectionTitle": "Web Links",
  "task.webLinks.empty": "No links yet",
  "task.webLinks.addButton": "Add link",
  "task.webLinks.dialog.title": "Add a web link",
  "task.webLinks.dialog.urlLabel": "URL",
  "task.webLinks.dialog.urlPlaceholder": "https://…",
  "task.webLinks.dialog.noteLabel": "Notes (optional)",
  "task.webLinks.dialog.submit": "Add link",
  "task.webLinks.error.invalidUrl": "URL must start with http:// or https://",
  "task.webLinks.error.urlTooLong": "URL is too long",
  "task.webLinks.error.noteTooLong": "Notes must be 500 characters or fewer",
  "task.webLinks.error.fetchFailed": "Preview unavailable",
  "task.webLinks.card.refresh": "Refresh preview",
  "task.webLinks.card.delete": "Delete",
  "task.webLinks.confirmDelete": "Delete this link?"
}
```

(Match the file's existing JSON shape — if it uses nested objects like `{"task": {"webLinks": {"sectionTitle": "Web Links"}}}` rather than flat dotted keys, follow the existing shape.)

- [ ] **Step 2: Add the Chinese translations (zh-CN.json)**

```json
{
  "task.webLinks.sectionTitle": "网页链接",
  "task.webLinks.empty": "暂无链接",
  "task.webLinks.addButton": "添加链接",
  "task.webLinks.dialog.title": "添加网页链接",
  "task.webLinks.dialog.urlLabel": "URL",
  "task.webLinks.dialog.urlPlaceholder": "https://…",
  "task.webLinks.dialog.noteLabel": "备注（可选）",
  "task.webLinks.dialog.submit": "添加",
  "task.webLinks.error.invalidUrl": "URL 必须以 http:// 或 https:// 开头",
  "task.webLinks.error.urlTooLong": "URL 太长",
  "task.webLinks.error.noteTooLong": "备注最多 500 字符",
  "task.webLinks.error.fetchFailed": "暂无预览",
  "task.webLinks.card.refresh": "刷新预览",
  "task.webLinks.card.delete": "删除",
  "task.webLinks.confirmDelete": "确定删除此链接？"
}
```

- [ ] **Step 3: Add the remaining 14 locales**

For each of `en-AU`, `en-GB`, `de`, `es`, `es-419`, `fr`, `hi`, `id`, `ja`, `ko`, `ms`, `ru`, `vi`, `zh-TW`:

1. Open the locale file.
2. Find an existing `task.slackContext.*` (or equivalent) block to use as a tone reference for that locale.
3. Add the same 15 keys, **fully translated into the target language** — never paste English into a non-English locale.

Recent commit `a6071e3f i18n: add milestone keys across all locales [LUM-61]` is the precedent — diff it to see exactly how keys are laid out across all 16 files and follow the same conventions per locale.

- [ ] **Step 4: Verify no English fallbacks slipped in**

```bash
for f in lib/i18n/*.json; do
  if [ "$f" != "lib/i18n/en.json" ] && [ "$f" != "lib/i18n/en-AU.json" ] && [ "$f" != "lib/i18n/en-GB.json" ]; then
    if grep -q '"Web Links"' "$f" 2>/dev/null; then
      echo "WARN: English string in $f"
    fi
  fi
done
```

Expected: no warnings. Spot-check a couple of locales by opening them and reading the new strings.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. (i18n types may force every key to exist in every file — if so, this catches missing keys for free.)

- [ ] **Step 6: Commit**

```bash
git add lib/i18n/
git commit -m "i18n: add web-links keys across all locales [LUM-47]"
```

---

## Task 22: Task context formatter — `renderWebLinkSection` (TDD)

**Files:**

- Modify: `lib/services/task-context.service.ts`
- Modify: `__tests__/services/task-context-service-slack.test.ts` (or add a new sibling `task-context-service-web-links.test.ts`)

Append a `## Web Links` block to the markdown returned by `getContextForIdentifier`, mirroring `renderSlackContextSection`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/services/task-context-service-web-links.test.ts`:

```ts
/** @jest-environment node */
import { renderWebLinkSection } from '@/lib/services/task-context.service'

describe('renderWebLinkSection', () => {
  it('returns empty string when no links', () => {
    expect(renderWebLinkSection([])).toBe('')
  })

  it('renders a link with title + note', () => {
    const md = renderWebLinkSection([
      {
        url: 'https://example.com/article',
        domain: 'example.com',
        title: 'Building distributed systems',
        description: 'A deep dive into consensus.',
        note: 'Cited in design review.',
        fetchedAt: new Date('2026-05-22T10:00:00Z'),
        fetchError: null,
      },
    ])
    expect(md).toContain('## Web Links')
    expect(md).toContain(
      '[Building distributed systems](https://example.com/article)'
    )
    expect(md).toContain('example.com')
    expect(md).toContain('Cited in design review.')
  })

  it('falls back to OG description when no note', () => {
    const md = renderWebLinkSection([
      {
        url: 'https://x/',
        domain: 'x',
        title: 'T',
        description: 'OG says',
        note: null,
        fetchedAt: new Date('2026-05-22T10:00:00Z'),
        fetchError: null,
      },
    ])
    expect(md).toContain('OG says')
  })

  it('falls back to bare URL when no title', () => {
    const md = renderWebLinkSection([
      {
        url: 'https://example.com/long/path',
        domain: 'example.com',
        title: null,
        description: null,
        note: null,
        fetchedAt: null,
        fetchError: 'http 404',
      },
    ])
    expect(md).toContain('https://example.com/long/path')
    expect(md).toContain('(no preview available)')
  })
})
```

- [ ] **Step 2: Run, see fail**

```bash
npx jest __tests__/services/task-context-service-web-links.test.ts
```

Expected: FAIL — `renderWebLinkSection` not exported.

- [ ] **Step 3: Implement `renderWebLinkSection` in `lib/services/task-context.service.ts`**

Add this function next to `renderSlackContextSection`:

```ts
export function renderWebLinkSection(
  links: Array<{
    url: string
    domain: string
    title: string | null
    description: string | null
    note: string | null
    fetchedAt: Date | null
    fetchError: string | null
  }>
): string {
  if (links.length === 0) return ''

  const lines: string[] = ['## Web Links', '']

  for (const l of links) {
    const titleLine = l.title
      ? `- [${l.title}](${l.url}) — ${l.domain}`
      : `- ${l.url} — ${l.domain}${l.fetchedAt ? '' : '   _(no preview available)_'}`
    lines.push(titleLine)
    const body = l.note ?? l.description
    if (body) lines.push(`  > ${body.replace(/\n+/g, ' ')}`)
  }
  lines.push('')

  return lines.join('\n')
}
```

(Keep it `export function` so the test can import it directly.)

- [ ] **Step 4: Run, see pass**

```bash
npx jest __tests__/services/task-context-service-web-links.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-context.service.ts __tests__/services/task-context-service-web-links.test.ts
git commit -m "feat: add renderWebLinkSection to task-context formatter [LUM-47]"
```

---

## Task 23: Wire web-links into `getContextForIdentifier`

**Files:**

- Modify: `lib/services/task-context.service.ts`

Today `getContextForIdentifier` queries Slack contexts and appends `renderSlackContextSection(...)` to the markdown. Add a parallel query + append for web links.

- [ ] **Step 1: Read the existing assembly logic**

```bash
sed -n '145,250p' lib/services/task-context.service.ts
```

Identify the two pieces:

1. Where Slack contexts are loaded (`taskSlackContextRepository.listByTask(resolved.id)` — around line 173)
2. Where they're appended to the markdown (`renderSlackContextSection(slackContexts...)` — around line 225)

- [ ] **Step 2: Add the parallel query + render**

Above the existing Slack-context load, add a web-links load:

```ts
const webLinks = await taskWebLinkRepository.listByTask(resolved.id)
```

(Import `taskWebLinkRepository` from `@/lib/repositories/task-web-link.repository` at the top of the file.)

In the markdown-assembly section, immediately after the Slack section is appended, append the web-link section:

```ts
markdownParts.push(renderWebLinkSection(webLinks))
```

(Use whatever the local variable for the assembled markdown actually is in this file — `markdownParts` is illustrative.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test -- --silent
```

Expected: no regressions. (End-to-end verification of `lumo task context LUM-47` happens in Task 24, once at least one link is in the DB.)

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-context.service.ts
git commit -m "feat: surface web links in task context output [LUM-47]"
```

---

## Task 24: Manual preview verification

**Files:** none

Per CLAUDE.md, UI changes require browser verification before claiming done. Run the dev server and exercise the feature.

- [ ] **Step 1: Start the dev server**

If a preview server is available (`preview_start` MCP), use it. Otherwise `npm run dev`.

- [ ] **Step 2: Run through the happy path**

1. Open a task detail page on `localhost:3000`.
2. In the Context tab, find the Web Links section.
3. Click "Add link".
4. Enter `https://anthropic.com/` and submit.
5. **Expect**: dialog closes, card appears with Anthropic's title/description/og:image.

- [ ] **Step 3: Run the fetch-failure fallback path**

1. Click "Add link" again.
2. Enter `https://example.com/this-page-does-not-exist-1234abcd` and submit.
3. **Expect**: dialog closes, card appears in the fallback variant (favicon, domain, raw URL, "Preview unavailable").

- [ ] **Step 4: Test the invalid-URL inline error**

1. Click "Add link".
2. Enter `javascript:alert(1)` and submit.
3. **Expect**: dialog stays open, error message visible: "URL must start with http:// or https://".

- [ ] **Step 5: Test refresh**

1. On any card, open the menu and click "Refresh preview".
2. **Expect**: card briefly dims (busy state), then re-renders with whatever the latest fetch returned. If the page now has different OG, the card reflects it.

- [ ] **Step 6: Test delete**

1. On any card, open the menu, click "Delete", confirm.
2. **Expect**: card disappears from the list. Hard-reload the page — card stays gone.

- [ ] **Step 7: Switch locale to zh-CN, verify all strings**

In whatever UI knob switches locale (or via the app's locale cookie), switch to `zh-CN` and reload the task page. Every visible string in the Web Links section + dialog must be in Chinese — no English residue.

- [ ] **Step 8: Verify task context output**

In a terminal:

```bash
lumo task context LUM-47
```

The output must include a `## Web Links` section listing the links that survived deletion in step 6. Output for a link with `note` must show the note; output for the fallback link must include `(no preview available)`.

- [ ] **Step 9: Commit any final tweaks discovered during verification**

If the verification surfaced issues, fix them with targeted commits. Otherwise no commit.

---

## Task 25: Final verification + push + PR

**Files:** none

- [ ] **Step 1: Full check**

```bash
npm test -- --silent
npx tsc --noEmit
```

Both must be clean. If `grep -r "console.log" lib/ app/api/tasks/[id]/web-links/ app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/WebLink*` finds anything, remove it.

- [ ] **Step 2: Sanity-check the migration status**

```bash
npx prisma migrate status
```

Expected: clean.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin lumo/LUM-47-add-web-links-task-context
```

- [ ] **Step 4: Open the PR**

Use `gh pr create`. Title: `feat: add web links as task context [LUM-47]`. Body:

```
## Summary

- Adds the `TaskWebLink` model + relations on `Task` and `WorkspaceMember`
- New API routes: `GET/POST /api/tasks/[id]/web-links`, `DELETE` + `POST refresh` on the `[linkId]` sub-route
- New `lib/integrations/og-metadata/` integration: synchronous OG fetcher with SSRF guard, redirect handling, 5s timeout, 3MB body cap
- New Timeline section in the task detail Context tab with add/refresh/delete UI
- `lumo task context <LUM-N>` now includes a `## Web Links` section
- All 16 locale files updated (en, en-AU, en-GB, de, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW)

## Schema change

Requires `prisma migrate deploy` on next deploy. CI/CD picks it up automatically.

## New dependency

- `node-html-parser@^7` (runtime). Used only by the server-side OG parser.

## Audit follow-up (out of scope)

Delete is allowed by any workspace member, matching `TaskSlackContext` behavior. If we want a "deleted by X" audit trail later, hang it off the existing Activity event stream.

## Test plan

- [ ] `npm test` green
- [ ] `npx tsc --noEmit` clean
- [ ] Manual preview verification complete (see plan task 24)
```

---

## Self-Review Checklist (run before declaring the plan ready)

1. **Spec coverage**: every requirement in `docs/superpowers/specs/2026-05-22-web-links-task-context-design.md` traces to a task.
   - Data model → Task 2
   - Migration → Task 3
   - OG fetcher (constants/SSRF/parse/fetch/barrel) → Tasks 4–8
   - Repository → Task 9
   - Validation → Task 10
   - Service → Task 11
   - API routes (GET/POST/DELETE/refresh) → Tasks 12–13
   - API route tests → Task 14
   - API client + hooks → Tasks 15–16
   - UI components (Dialog/Card/Section) → Tasks 17–19
   - Mount in ContextTab → Task 20
   - I18n → Task 21
   - Task context formatter + wiring → Tasks 22–23
   - Manual verification → Task 24
   - PR → Task 25
2. **Placeholders**: no TBD/TODO/etc. found.
3. **Type consistency**: `actorMemberId` used everywhere; service returns `Promise<TaskWebLink>` consistently; `webLinks` envelope on GET / `webLink` on POST/refresh; `WorkspaceMember.id` as the FK target throughout.

---

**Plan complete.**
