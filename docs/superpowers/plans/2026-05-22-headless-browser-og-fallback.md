# Headless-Browser OG Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the fast OG fetcher returns a Cloudflare/anti-bot block signal, escalate to a Chromium-rendered fetch inside the same HTTP request; frontend renders the new link optimistically so the user does not perceive the added latency.

**Architecture:** Sync escalation in the service layer (`fast → classifier → chromium`); no new tables, no queue, no polling. Frontend inserts a skeleton card with a `tempId` and swaps it with the server response when the POST resolves.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma, `puppeteer-core` + `@sparticuz/chromium-min`, react-intl, Jest.

**Spec:** `docs/superpowers/specs/2026-05-22-headless-browser-og-fallback-design.md`

---

## File Structure

**Create:**

- `lib/integrations/og-metadata/should-escalate.ts` — block-signal classifier (single pure function)
- `lib/integrations/og-metadata/fetch-chromium.ts` — Chromium-based OG fetcher with same `FetchResult` shape as `fetch.ts`
- `__tests__/integrations/og-metadata/should-escalate.test.ts` — 9 cases, one per known error string

**Modify:**

- `lib/services/task-web-link.service.ts` — compose fast + Chromium in `addWebLink` and `refreshWebLink`
- `__tests__/services/task-web-link.service.test.ts` — mock the new Chromium fetcher; add escalation cases
- `app/api/tasks/[id]/web-links/route.ts` — `export const maxDuration = 60` + `runtime = 'nodejs'`
- `app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts` — same
- `app/workspace/[workspaceUrl]/hooks/useWebLinks.ts` — optimistic insert with `tempId`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx` — close dialog immediately
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx` — pass fire-and-forget callback
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkCard.tsx` — render loading skeleton when `loading` flag is true
- `lib/i18n/*.json` — add `task.webLinks.card.loading` to all 17 locales
- `package.json` — `puppeteer-core` + `@sparticuz/chromium-min`

---

## Task 1: Install Chromium dependencies

**Files:**

- Modify: `package.json` (and lockfile)

- [ ] **Step 1: Install packages**

```bash
npm install puppeteer-core @sparticuz/chromium-min
```

Expected: install succeeds; `puppeteer-core` and `@sparticuz/chromium-min` appear under `dependencies` in `package.json`.

- [ ] **Step 2: Confirm types compile**

```bash
npx tsc --noEmit
```

Expected: no new errors. (If `@sparticuz/chromium-min` resolves to a version whose chromium pack URL version differs from `131`, note the version printed by `npm ls @sparticuz/chromium-min` — Task 3 uses it.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add puppeteer-core + @sparticuz/chromium-min [LUM-62]"
```

---

## Task 2: Block-signal classifier (TDD)

**Files:**

- Create: `__tests__/integrations/og-metadata/should-escalate.test.ts`
- Create: `lib/integrations/og-metadata/should-escalate.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/integrations/og-metadata/should-escalate.test.ts`:

```ts
/** @jest-environment node */
import { shouldEscalateToChromium } from '@/lib/integrations/og-metadata/should-escalate'

describe('shouldEscalateToChromium', () => {
  it.each([
    ['http 403', true],
    ['non-html content', true],
    ['timeout', true],
    ['http 401', false],
    ['http 404', false],
    ['http 500', false],
    ['http 429', false],
    ['body too large', false],
    ['network error', false],
  ])('returns %j for %s', (error, expected) => {
    expect(shouldEscalateToChromium(error)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
npx jest __tests__/integrations/og-metadata/should-escalate.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/integrations/og-metadata/should-escalate'`.

- [ ] **Step 3: Implement the classifier**

`lib/integrations/og-metadata/should-escalate.ts`:

```ts
// lib/integrations/og-metadata/should-escalate.ts
//
// Decide whether a fast-fetch failure justifies escalating to the Chromium
// fallback. Conservative: only signals that plausibly mean "real browser
// might succeed" return true.
export function shouldEscalateToChromium(fastError: string): boolean {
  return (
    fastError === 'http 403' ||
    fastError === 'non-html content' ||
    fastError === 'timeout'
  )
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
npx jest __tests__/integrations/og-metadata/should-escalate.test.ts
```

Expected: PASS (9 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/og-metadata/should-escalate.ts __tests__/integrations/og-metadata/should-escalate.test.ts
git commit -m "feat: add block-signal classifier for OG fallback [LUM-62]"
```

---

## Task 3: Chromium OG fetcher

**Files:**

- Create: `lib/integrations/og-metadata/fetch-chromium.ts`

No unit tests — puppeteer is impractical to mock; verification is manual + the service-layer tests in Task 4.

- [ ] **Step 1: Create the fetcher**

`lib/integrations/og-metadata/fetch-chromium.ts`:

```ts
// lib/integrations/og-metadata/fetch-chromium.ts
//
// Chromium-rendered fallback for Cloudflare-protected sites. Same FetchResult
// shape as fetchOpenGraph so service-layer composition is symmetric.
//
// All errors are prefixed 'chromium: ' so logs and UI can distinguish.
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import { USER_AGENT } from './constants'
import { parseHtml } from './parse'
import { assertExternalHost } from './ssrf'
import type { FetchResult } from './fetch'

// chromium-min downloads the binary on first invocation; the URL version MUST
// match the installed @sparticuz/chromium-min major. If the install in Task 1
// produced a different version, bump this URL accordingly.
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ||
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'

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
      defaultViewport: chromium.defaultViewport,
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
    const data = parseHtml(html, finalUrl)
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
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `puppeteer-core` / `@sparticuz/chromium-min` type issues appear, install `@types/...` if available or add a narrow `// @ts-expect-error` comment with reason.

- [ ] **Step 3: Commit**

```bash
git add lib/integrations/og-metadata/fetch-chromium.ts
git commit -m "feat: add chromium-based OG fetcher [LUM-62]"
```

---

## Task 4: Service-layer escalation (TDD)

**Files:**

- Modify: `__tests__/services/task-web-link.service.test.ts`
- Modify: `lib/services/task-web-link.service.ts`

- [ ] **Step 1: Extend the test setup to mock the Chromium fetcher**

Add the new jest.mock and import at the top of `__tests__/services/task-web-link.service.test.ts` (next to the existing `fetchOpenGraph` mock at line 11):

```ts
jest.mock('@/lib/integrations/og-metadata/fetch-chromium', () => ({
  fetchOpenGraphChromium: jest.fn(),
}))
```

And in the import section (after the existing `fetchOpenGraph` import around line 16):

```ts
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
```

And in the variable block (around line 24):

```ts
const chromiumMock = fetchOpenGraphChromium as jest.Mock
```

Also update `beforeEach` (line 26) to reset the chromium mock:

```ts
beforeEach(() => {
  jest.clearAllMocks()
})
```

(`jest.clearAllMocks()` already resets all mocks — no change needed if that's already there.)

- [ ] **Step 2: Update the existing `'timeout'` test to expect escalation**

The existing test at line 37–47 uses `error: 'timeout'` (now a block signal). It still asserts URL normalization, which works whether or not Chromium is invoked, but the test must mock Chromium so the code path doesn't throw. Replace lines 37–47 (the `'normalizes URL...'` test) with:

```ts
it('normalizes URL (lowercase scheme/host, strips fragment) before storing', async () => {
  ogMock.mockResolvedValue({ ok: false, error: 'http 404' }) // non-escalating
  repoCreate.mockResolvedValue({ id: 'wl_1' })
  await taskWebLinkService.addWebLink(baseInput)
  expect(repoCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://example.com/path?x=1',
      domain: 'example.com',
    })
  )
  expect(chromiumMock).not.toHaveBeenCalled()
})
```

(Using `'http 404'` keeps the test focused on normalization without dragging in escalation.)

- [ ] **Step 3: Add the four new escalation test cases**

Append inside the `describe('taskWebLinkService.addWebLink', ...)` block, after the existing tests:

```ts
it('does not call chromium when fast fetch succeeds', async () => {
  ogMock.mockResolvedValue({
    ok: true,
    data: { title: 't', description: 'd', imageUrl: 'i', faviconUrl: 'f' },
    finalUrl: 'https://example.com/path?x=1',
  })
  repoCreate.mockResolvedValue({ id: 'wl_ok' })
  await taskWebLinkService.addWebLink(baseInput)
  expect(chromiumMock).not.toHaveBeenCalled()
})

it('escalates to chromium on block signal and writes success', async () => {
  ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
  chromiumMock.mockResolvedValue({
    ok: true,
    data: {
      title: 'Real',
      description: 'desc',
      imageUrl: 'https://x.test/i.png',
      faviconUrl: 'https://x.test/f.ico',
    },
    finalUrl: 'https://example.com/path?x=1',
  })
  repoCreate.mockResolvedValue({ id: 'wl_cr' })
  await taskWebLinkService.addWebLink(baseInput)
  expect(chromiumMock).toHaveBeenCalledWith('https://example.com/path?x=1')
  expect(repoCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Real',
      description: 'desc',
      imageUrl: 'https://x.test/i.png',
      faviconUrl: 'https://x.test/f.ico',
      fetchedAt: expect.any(Date),
      fetchError: null,
    })
  )
})

it('writes chromium failure error when chromium also fails', async () => {
  ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
  chromiumMock.mockResolvedValue({
    ok: false,
    error: 'chromium: timeout',
  })
  repoCreate.mockResolvedValue({ id: 'wl_fail' })
  await taskWebLinkService.addWebLink(baseInput)
  expect(repoCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      title: null,
      fetchedAt: null,
      fetchError: 'chromium: timeout',
    })
  )
})

it('does not escalate on non-block-signal failures', async () => {
  ogMock.mockResolvedValue({ ok: false, error: 'http 404' })
  repoCreate.mockResolvedValue({ id: 'wl_404' })
  await taskWebLinkService.addWebLink(baseInput)
  expect(chromiumMock).not.toHaveBeenCalled()
  expect(repoCreate).toHaveBeenCalledWith(
    expect.objectContaining({ fetchError: 'http 404' })
  )
})
```

Also add a `refreshWebLink` escalation test (mirrors LUM-47's refresh tests — find the existing `describe('taskWebLinkService.refreshWebLink', ...)` block, append):

```ts
it('escalates to chromium on refresh when fast returns block signal', async () => {
  repoGetById.mockResolvedValue({
    id: 'wl_1',
    url: 'https://blocked.test/x',
    task: { project: { workspaceId: 'ws_1' } },
  })
  ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
  chromiumMock.mockResolvedValue({
    ok: true,
    data: {
      title: 'After',
      description: 'desc',
      imageUrl: undefined,
      faviconUrl: undefined,
    },
    finalUrl: 'https://blocked.test/x',
  })
  repoUpdateFetch.mockResolvedValue({ id: 'wl_1' })
  await taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
  expect(chromiumMock).toHaveBeenCalledWith('https://blocked.test/x')
  expect(repoUpdateFetch).toHaveBeenCalledWith(
    'wl_1',
    expect.objectContaining({ ok: true, title: 'After' })
  )
})
```

- [ ] **Step 4: Run tests, expect failure**

```bash
npx jest __tests__/services/task-web-link.service.test.ts
```

Expected: FAIL — escalation cases fail because the service hasn't been wired yet (Chromium not called, or wrong fetchError shape).

- [ ] **Step 5: Update the service to compose fast + Chromium**

Replace `lib/services/task-web-link.service.ts` lines 1–94 with:

```ts
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
import { shouldEscalateToChromium } from '@/lib/integrations/og-metadata/should-escalate'
import type { FetchResult } from '@/lib/integrations/og-metadata/fetch'

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

// Single entrypoint: try fast, escalate to chromium on block signal.
async function fetchWithFallback(url: string): Promise<FetchResult> {
  const fast = await fetchOpenGraph(url)
  if (fast.ok) return fast
  if (!shouldEscalateToChromium(fast.error)) return fast
  console.info(
    `[og] escalating to chromium: ${new URL(url).hostname} reason=${fast.error}`
  )
  return fetchOpenGraphChromium(url)
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
    const og = await fetchWithFallback(url)

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
    const og = await fetchWithFallback(link.url)
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

- [ ] **Step 6: Run tests, expect pass**

```bash
npx jest __tests__/services/task-web-link.service.test.ts
```

Expected: all tests pass, including the 4 new add-escalation cases and 1 new refresh case.

- [ ] **Step 7: Commit**

```bash
git add lib/services/task-web-link.service.ts __tests__/services/task-web-link.service.test.ts
git commit -m "feat: escalate to chromium fetcher on block signal [LUM-62]"
```

---

## Task 5: Route runtime + maxDuration

**Files:**

- Modify: `app/api/tasks/[id]/web-links/route.ts`
- Modify: `app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts`

- [ ] **Step 1: Add runtime + maxDuration to the create/list route**

In `app/api/tasks/[id]/web-links/route.ts`, immediately after the imports (before `type Params = ...` on line 8), add:

```ts
export const runtime = 'nodejs'
export const maxDuration = 60
```

- [ ] **Step 2: Add runtime + maxDuration to the refresh route**

In `app/api/tasks/[id]/web-links/[linkId]/refresh/route.ts`, immediately after the imports (before `type Params = ...` on line 6), add the same two lines:

```ts
export const runtime = 'nodejs'
export const maxDuration = 60
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/\[id\]/web-links/route.ts app/api/tasks/\[id\]/web-links/\[linkId\]/refresh/route.ts
git commit -m "feat: extend maxDuration for web-link OG fetch routes [LUM-62]"
```

---

## Task 6: Optimistic insert in `useWebLinks`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useWebLinks.ts`

- [ ] **Step 1: Replace the hook body**

Replace the entire contents of `app/workspace/[workspaceUrl]/hooks/useWebLinks.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { webLinksClient } from '@/lib/api-client/task-web-links'
import type { TaskWebLink } from '@prisma/client'

// Optimistic placeholders share TaskWebLink's shape (so WebLinkCard works
// uniformly) but carry a tempId + loading flag. Server rows never have these.
export type OptimisticWebLink = TaskWebLink & {
  tempId?: string
  loading?: boolean
}

interface UseWebLinksResult {
  webLinks: OptimisticWebLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: { url: string; note?: string }) => void
  remove: (linkId: string) => Promise<void>
  refreshOne: (linkId: string) => Promise<void>
}

function makeOptimisticPlaceholder(
  payload: { url: string; note?: string },
  taskId: string
): OptimisticWebLink {
  let domain = ''
  try {
    domain = new URL(payload.url.trim()).hostname.toLowerCase()
  } catch {
    domain = payload.url
  }
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  // Cast: the optimistic row has only the fields the card reads; the rest are
  // never displayed during the loading state. We satisfy TaskWebLink's shape
  // with safe defaults.
  return {
    id: tempId,
    tempId,
    taskId,
    workspaceId: '',
    url: payload.url,
    domain,
    title: null,
    description: null,
    note: payload.note ?? null,
    imageUrl: null,
    faviconUrl: null,
    fetchedAt: null,
    fetchError: null,
    createdById: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    loading: true,
  }
}

export function useWebLinks(taskId: string, enabled = true): UseWebLinksResult {
  const [webLinks, setWebLinks] = useState<OptimisticWebLink[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { webLinks } = await webLinksClient.list(taskId)
      setWebLinks(webLinks)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  const add = useCallback(
    (payload: { url: string; note?: string }) => {
      const placeholder = makeOptimisticPlaceholder(payload, taskId)
      setWebLinks(prev => [placeholder, ...prev])
      void (async () => {
        try {
          const { webLink } = await webLinksClient.add(taskId, payload)
          setWebLinks(prev =>
            prev.map(l => (l.tempId === placeholder.tempId ? webLink : l))
          )
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'add failed'
          setWebLinks(prev =>
            prev.map(l =>
              l.tempId === placeholder.tempId
                ? { ...l, loading: false, fetchError: msg }
                : l
            )
          )
        }
      })()
    },
    [taskId]
  )

  const remove = useCallback(
    async (linkId: string) => {
      await webLinksClient.remove(taskId, linkId)
      setWebLinks(prev => prev.filter(l => l.id !== linkId))
    },
    [taskId]
  )

  const refreshOne = useCallback(
    async (linkId: string) => {
      const { webLink } = await webLinksClient.refresh(taskId, linkId)
      setWebLinks(prev => prev.map(l => (l.id === linkId ? webLink : l)))
    },
    [taskId]
  )

  return { webLinks, loading, error, refresh, add, remove, refreshOne }
}
```

Key changes from before:

- `add` is no longer async (returns `void`); it kicks off a background promise.
- Exposes `OptimisticWebLink` type.
- Optimistic insert with `tempId`, swap on success, decorate with `fetchError` on failure.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors (callers of `add` may need updating in later tasks — that's fine, will be addressed there).

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/hooks/useWebLinks.ts
git commit -m "feat: optimistic web-link insert in useWebLinks [LUM-62]"
```

---

## Task 7: Dialog closes immediately

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx`

- [ ] **Step 1: Update the dialog's `onSubmit` contract to be synchronous**

Replace the `Props` interface and `handleSubmit` in `WebLinkAddDialog.tsx`:

Replace lines 6–10:

```ts
interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (payload: { url: string; note?: string }) => void
}
```

Replace lines 25–41 (`handleSubmit`):

```ts
const handleSubmit = () => {
  setErrorMsg(null)
  const trimmedNote = note.trim()
  try {
    onSubmit(trimmedNote ? { url, note: trimmedNote } : { url })
    setUrl('')
    setNote('')
    onClose()
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : 'Failed to add link. Please try again.'
    setErrorMsg(msg)
  }
}
```

The new `handleSubmit` removes all `setSubmitting` calls. Also delete the now-unused state declaration at line 21:

```ts
const [submitting, setSubmitting] = useState(false)
```

And simplify the submit button's disabled prop on line 99:

```ts
disabled={url.length === 0}
```

(Was: `disabled={submitting || url.length === 0}`.) No other references to `submitting` remain.

- [ ] **Step 2: Update WebLinkSection's `onSubmit` prop to match**

In `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx`, replace lines 74–77 (the inline `onSubmit={async payload => { await add(payload) }}`):

```tsx
onSubmit={payload => add(payload)}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. (The hook's new `add: (payload) => void` signature now matches the dialog's `onSubmit: (payload) => void`.)

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/WebLinkAddDialog.tsx app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/WebLinkSection.tsx
git commit -m "feat: close web-link dialog immediately on submit [LUM-62]"
```

---

## Task 8: Loading skeleton in `WebLinkCard`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkCard.tsx`

The optimistic placeholder has `loading: true`, `title: null`, `imageUrl: null`. It already falls into the fallback variant. We only need to swap the "Preview unavailable" text for "Loading preview…" when `loading` is truthy, and hide the action buttons (Refresh / Trash) during loading.

- [ ] **Step 1: Update the `Props` interface to accept the optimistic shape**

Replace lines 6–12 of `WebLinkCard.tsx`:

```ts
import type { OptimisticWebLink } from '../../../hooks/useWebLinks'

interface Props {
  link: OptimisticWebLink
  onRefresh: (linkId: string) => Promise<void>
  onRemove: (linkId: string) => Promise<void>
}
```

(Move the `import type { TaskWebLink } from '@prisma/client'` line; if it's no longer used, remove it entirely.)

- [ ] **Step 2: Swap fallback text and disable actions when loading**

In the fallback variant block, locate the "Preview unavailable" `<p>` (lines 152–157) and the action buttons (lines 159–188). Replace them with this conditional version:

```tsx
<p
  className={`mt-0.5 text-xs ${
    link.loading
      ? 'text-zinc-400 dark:text-zinc-500'
      : 'text-amber-600 dark:text-amber-400'
  }`}
>
  {link.loading
    ? intl.formatMessage({
        id: 'task.webLinks.card.loading',
        defaultMessage: 'Loading preview…',
      })
    : intl.formatMessage({
        id: 'task.webLinks.error.fetchFailed',
        defaultMessage: 'Preview unavailable',
      })}
</p>
```

And gate the action-button group (lines 159–188, the `<div className='flex items-center gap-1 flex-shrink-0 ml-1'>` containing the Refresh + Trash buttons) on `!link.loading`. Concretely, prepend `{!link.loading && (` before that opening `<div>` and append `)}` after its closing `</div>`:

```tsx
{
  !link.loading && (
    <div className='flex items-center gap-1 flex-shrink-0 ml-1'>
      <button
        onClick={e => {
          e.preventDefault()
          void handleRefresh()
        }}
        disabled={busy}
        title={intl.formatMessage({
          id: 'task.webLinks.card.refresh',
          defaultMessage: 'Refresh preview',
        })}
        className='p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50'
      >
        <RefreshCw size={14} />
      </button>
      <button
        onClick={e => {
          e.preventDefault()
          void handleRemove()
        }}
        disabled={busy}
        title={intl.formatMessage({
          id: 'task.webLinks.card.delete',
          defaultMessage: 'Delete',
        })}
        className='p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50'
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
```

(Action buttons inside the **rich** variant block — lines 89–118 — can stay as-is. A rich-preview entry by definition has a `title`, which an optimistic row never does, so the loading state never reaches that branch.)

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Visual smoke check (manual)**

```bash
npm run dev
```

Open a task in the browser, paste a URL, hit submit. Expected:

- Dialog closes immediately.
- A new card appears at the top of the list with the domain/URL visible and "Loading preview…" text (no buttons).
- Within ~1–15s, the card swaps to the populated state (rich card if title fetched, fallback "Preview unavailable" if both fast and Chromium failed, error decoration if the POST itself failed).

Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/WebLinkCard.tsx
git commit -m "feat: render loading skeleton on optimistic web-link card [LUM-62]"
```

---

## Task 9: Locale keys

**Files:**

- Modify all 17 locale files in `lib/i18n/`.

Add the key `"task.webLinks.card.loading"` immediately after `"task.webLinks.card.refresh"` in each file (line numbers vary per locale; locate by search-and-insert).

- [ ] **Step 1: Add translations per locale**

| File                   | New entry                                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| `lib/i18n/en.json`     | `"task.webLinks.card.loading": "Loading preview…",`                     |
| `lib/i18n/en-AU.json`  | `"task.webLinks.card.loading": "Loading preview…",`                     |
| `lib/i18n/en-GB.json`  | `"task.webLinks.card.loading": "Loading preview…",`                     |
| `lib/i18n/de.json`     | `"task.webLinks.card.loading": "Vorschau wird geladen…",`               |
| `lib/i18n/es.json`     | `"task.webLinks.card.loading": "Cargando vista previa…",`               |
| `lib/i18n/es-419.json` | `"task.webLinks.card.loading": "Cargando vista previa…",`               |
| `lib/i18n/fr.json`     | `"task.webLinks.card.loading": "Chargement de l'aperçu…",`              |
| `lib/i18n/hi.json`     | `"task.webLinks.card.loading": "प्रीव्यू लोड हो रहा है…",`              |
| `lib/i18n/id.json`     | `"task.webLinks.card.loading": "Memuat pratinjau…",`                    |
| `lib/i18n/ja.json`     | `"task.webLinks.card.loading": "プレビューを読み込み中…",`              |
| `lib/i18n/ko.json`     | `"task.webLinks.card.loading": "미리보기 로드 중…",`                    |
| `lib/i18n/ms.json`     | `"task.webLinks.card.loading": "Memuatkan pratonton…",`                 |
| `lib/i18n/ru.json`     | `"task.webLinks.card.loading": "Загрузка предварительного просмотра…",` |
| `lib/i18n/vi.json`     | `"task.webLinks.card.loading": "Đang tải bản xem trước…",`              |
| `lib/i18n/zh-CN.json`  | `"task.webLinks.card.loading": "正在加载预览…",`                        |
| `lib/i18n/zh-TW.json`  | `"task.webLinks.card.loading": "正在載入預覽…",`                        |

For each file: open it, find the line containing `"task.webLinks.card.refresh"`, and insert the new line after it (preserving JSON validity — same indentation, trailing comma if there are following keys).

- [ ] **Step 2: Validate JSON**

```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "ok: $f" || echo "BAD: $f"; done
```

Expected: every line reads `ok: <path>`.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/*.json
git commit -m "i18n: add web-link card loading key across all locales [LUM-62]"
```

---

## Task 10: Full verification + PR

**Files:** none modified — runs the gates required by CLAUDE.md's PR Checklist.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. No console.log warnings introduced.

- [ ] **Step 2: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual end-to-end verification**

```bash
npm run dev
```

For each scenario, observe the UI and the dev-server console:

1. **CF-protected site** — add `https://openai.com` to a task. Dialog closes immediately. Skeleton card appears. Within ~10–15s the card swaps to rich preview with OpenAI's title/description. Console shows one log line `[og] escalating to chromium: openai.com reason=http 403`.
2. **Unprotected site** — add `https://github.com`. Skeleton flashes briefly (<1s) then card swaps to rich preview. No escalation log line.
3. **404** — add `https://example.com/this-does-not-exist`. Skeleton appears, then card swaps to fallback "Preview unavailable" within ~1s. No escalation log line (`http 404` is not a block signal).
4. **Cancel mid-flight** — paste a slow link, hit add, then navigate away from the task tab before the POST returns. Re-enter the task — the link is present (server completed the POST).

If any scenario fails, do not proceed — debug and fix before PR.

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin lumo/LUM-62-headless-browser-og-fallback
```

```bash
gh pr create --title "feat: headless browser OG fallback [LUM-62]" --body "$(cat <<'EOF'
## Summary
- Adds a Chromium fallback in the OG-metadata fetch pipeline: fast `fetch()` first, escalates to `puppeteer-core + @sparticuz/chromium-min` on block-signal errors (`http 403`, `non-html content`, `timeout`).
- Frontend renders an optimistic skeleton card on submit so the 10–15s Chromium path doesn't block the dialog.
- No schema changes; existing `fetchedAt` / `fetchError` semantics carry the outcome.

## New dependencies
- `puppeteer-core` — Chromium driver
- `@sparticuz/chromium-min` — Vercel-friendly Chromium binary loader

Both are direct runtime deps, ~50MB added to function bundle (within Vercel Pro's 250MB limit).

## Test plan
- [x] Block-signal classifier — 9 cases (1 per known error string)
- [x] Service composition — fast ok skips chromium; block signal escalates and writes result; chromium fail writes `chromium: …` error; non-block signal does not escalate
- [x] Refresh path — block-signal escalation on refresh
- [ ] Manual: openai.com → preview populated via Chromium (~10–15s)
- [ ] Manual: github.com → still hits fast path (<1s, no escalation log)
- [ ] Manual: 404 URL → fallback "Preview unavailable" (no escalation)
- [ ] Manual: dialog closes immediately, skeleton card visible until response
- [ ] `npm test` clean
- [ ] `npx tsc --noEmit` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened, URL printed. Return the URL to the user.

---

## Out of scope (deferred per spec)

- Vercel cron orphan-job cleaner (not needed with sync architecture)
- Auto-retry on Chromium failure (Refresh button is the manual path)
- Stealth plugin / proxies (only if post-deploy block rate is unacceptable)
- Warm-pool browser reuse
- Authenticated previews / manual title editing
