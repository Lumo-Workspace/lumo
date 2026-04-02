# Preferences Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Preferences page under Settings → Personal with theme (Light/Dark/System), language (中文/English), timezone, and per-event notification toggles for in-app and Slack channels.

**Architecture:** New `UserPreference` Prisma model (FK → WorkspaceMember.id). REST API (GET + PATCH). Client-side `usePreferences` hook with localStorage cache + optimistic updates. Theme powered by `next-themes` (already installed). Sidebar dark-mode toggle removed in favor of the new Preferences page.

**Tech Stack:** Prisma, Next.js API Routes, next-themes, shadcn/ui (Switch, Select), localStorage cache, Tailwind dark mode (`class` strategy).

---

## File Map

**New files:**

- `prisma/migrations/<timestamp>_add_user_preferences/migration.sql` — auto-generated
- `app/api/users/preferences/route.ts` — GET + PATCH handlers
- `app/workspace/[workspaceUrl]/settings/preferences/page.tsx` — thin route wrapper
- `app/workspace/[workspaceUrl]/components/pages/PreferencesPage.tsx` — main UI (3 cards)
- `app/workspace/[workspaceUrl]/hooks/usePreferences.ts` — fetch + cache + mutate hook
- `__tests__/api/users/preferences.test.ts` — API route tests

**Modified files:**

- `prisma/schema.prisma` — add `UserPreference` model + relation on WorkspaceMember
- `components/core/Providers.tsx` — wrap with `<ThemeProvider>` from next-themes
- `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx` — add Preferences nav item, remove dark-mode restoration
- `app/workspace/[workspaceUrl]/components/Sidebar.tsx` — remove dark-mode toggle, remove `isDarkMode`/`onToggleDarkMode` props
- `app/workspace/[workspaceUrl]/components/WorkspaceApp.tsx` — remove `useDarkMode()` import and usage, remove props from `<AppSidebar>`
- `app/workspace/[workspaceUrl]/constants.ts` — add `preferences` cache key, remove `darkMode` key

**Deleted files:**

- `app/workspace/[workspaceUrl]/hooks/useDarkMode.ts`

---

### Task 1: Prisma Schema + Migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_user_preferences/migration.sql` (auto-generated)

- [ ] **Step 1: Add UserPreference model to schema**

In `prisma/schema.prisma`, add after the last model:

```prisma
model UserPreference {
  id       String @id @default(cuid())
  memberId String @unique
  member   WorkspaceMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  // Appearance
  theme    String @default("system") // "light" | "dark" | "system"
  locale   String @default("en")     // "en" | "zh"
  timezone String @default("auto")   // IANA tz string or "auto"

  // In-app notification toggles
  notifyInAppAssigned   Boolean @default(true)
  notifyInAppComment    Boolean @default(true)
  notifyInAppAgentDone  Boolean @default(true)
  notifyInAppAgentInput Boolean @default(true)
  notifyInAppMention    Boolean @default(true)

  // Slack notification toggles
  notifySlackAssigned   Boolean @default(true)
  notifySlackComment    Boolean @default(true)
  notifySlackAgentDone  Boolean @default(true)
  notifySlackAgentInput Boolean @default(true)
  notifySlackMention    Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("user_preferences")
}
```

Add the reverse relation on `WorkspaceMember` — insert this line after the `apiKeys` relation:

```prisma
  preference         UserPreference?
```

- [ ] **Step 2: Generate and apply migration**

Run:

```bash
npx prisma migrate dev --name add_user_preferences
```

Expected: Migration created, `prisma generate` runs, no errors.

- [ ] **Step 3: Verify schema**

Run:

```bash
npx prisma validate
```

Expected: "The schema is valid."

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add UserPreference model with theme, locale, timezone, notification toggles"
```

---

### Task 2: Preferences API Route + Tests

**Files:**

- Create: `app/api/users/preferences/route.ts`
- Create: `__tests__/api/users/preferences.test.ts`

- [ ] **Step 1: Write the test file**

Create `__tests__/api/users/preferences.test.ts`:

```typescript
/**
 * @jest-environment node
 */

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getUserWorkspace: jest.fn(),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { GET, PATCH } from '@/app/api/users/preferences/route'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const mockFindUnique = prisma.userPreference.findUnique as jest.Mock
const mockUpsert = prisma.userPreference.upsert as jest.Mock

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/users/preferences', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

const DEFAULTS = {
  theme: 'system',
  locale: 'en',
  timezone: 'auto',
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

beforeEach(() => jest.clearAllMocks())

// ── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/users/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has no workspace', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(403)
  })

  it('returns defaults when no preference record exists', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    mockFindUnique.mockResolvedValueOnce(null)

    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toMatchObject(DEFAULTS)
  })

  it('returns existing preference record', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    mockFindUnique.mockResolvedValueOnce({
      id: 'pref_1',
      memberId: 'mem_1',
      theme: 'dark',
      locale: 'zh',
      timezone: 'Asia/Shanghai',
      ...DEFAULTS,
      theme: 'dark',
      locale: 'zh',
    })

    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.theme).toBe('dark')
    expect(data.locale).toBe('zh')
  })
})

// ── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /api/users/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await PATCH(makeRequest('PATCH', { theme: 'dark' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid theme value', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const res = await PATCH(makeRequest('PATCH', { theme: 'neon' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid locale value', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const res = await PATCH(makeRequest('PATCH', { locale: 'fr' }))
    expect(res.status).toBe(400)
  })

  it('upserts preference and returns updated record', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const updated = {
      id: 'pref_1',
      memberId: 'mem_1',
      theme: 'dark',
      ...DEFAULTS,
      theme: 'dark',
    }
    mockUpsert.mockResolvedValueOnce(updated)

    const res = await PATCH(makeRequest('PATCH', { theme: 'dark' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.theme).toBe('dark')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'mem_1' },
        update: { theme: 'dark' },
        create: expect.objectContaining({ memberId: 'mem_1', theme: 'dark' }),
      })
    )
  })

  it('supports partial update of notification toggles', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const updated = { ...DEFAULTS, notifySlackComment: false }
    mockUpsert.mockResolvedValueOnce(updated)

    const res = await PATCH(makeRequest('PATCH', { notifySlackComment: false }))
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { notifySlackComment: false },
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/users/preferences.test.ts -v`

Expected: FAIL — cannot find module `@/app/api/users/preferences/route`

- [ ] **Step 3: Create the API route**

Create `app/api/users/preferences/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

const VALID_THEMES = ['light', 'dark', 'system'] as const
const VALID_LOCALES = ['en', 'zh'] as const

const BOOLEAN_FIELDS = [
  'notifyInAppAssigned',
  'notifyInAppComment',
  'notifyInAppAgentDone',
  'notifyInAppAgentInput',
  'notifyInAppMention',
  'notifySlackAssigned',
  'notifySlackComment',
  'notifySlackAgentDone',
  'notifySlackAgentInput',
  'notifySlackMention',
] as const

const DEFAULTS = {
  theme: 'system',
  locale: 'en',
  timezone: 'auto',
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

/** Strip internal fields, return only preference data. */
function toResponse(pref: Record<string, unknown>) {
  const { id, memberId, createdAt, updatedAt, ...rest } = pref
  return rest
}

async function resolveMember(userId: string) {
  const ws = await getUserWorkspace(userId)
  if (!ws) return null
  return ws.member
}

/**
 * GET /api/users/preferences
 * Returns the current user's preferences (or defaults if none saved).
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await resolveMember(userId)
    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
    }

    const pref = await prisma.userPreference.findUnique({
      where: { memberId: member.id },
    })

    return NextResponse.json(pref ? toResponse(pref) : DEFAULTS)
  } catch (error) {
    console.error('GET /api/users/preferences error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/users/preferences
 * Partially updates preferences. Only fields present in the body are changed.
 */
export async function PATCH(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await resolveMember(userId)
    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
    }

    const body = await request.json()
    const update: Record<string, unknown> = {}

    // Validate & collect theme
    if (body.theme !== undefined) {
      if (!VALID_THEMES.includes(body.theme)) {
        return NextResponse.json(
          {
            error: `Invalid theme. Must be one of: ${VALID_THEMES.join(', ')}`,
          },
          { status: 400 }
        )
      }
      update.theme = body.theme
    }

    // Validate & collect locale
    if (body.locale !== undefined) {
      if (!VALID_LOCALES.includes(body.locale)) {
        return NextResponse.json(
          {
            error: `Invalid locale. Must be one of: ${VALID_LOCALES.join(', ')}`,
          },
          { status: 400 }
        )
      }
      update.locale = body.locale
    }

    // Collect timezone (string, no strict validation — IANA list is huge)
    if (typeof body.timezone === 'string' && body.timezone.trim()) {
      update.timezone = body.timezone.trim()
    }

    // Collect boolean notification toggles
    for (const field of BOOLEAN_FIELDS) {
      if (typeof body[field] === 'boolean') {
        update[field] = body[field]
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      )
    }

    const pref = await prisma.userPreference.upsert({
      where: { memberId: member.id },
      update,
      create: { memberId: member.id, ...update },
    })

    return NextResponse.json(toResponse(pref))
  } catch (error) {
    console.error('PATCH /api/users/preferences error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/users/preferences.test.ts -v`

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/users/preferences/route.ts __tests__/api/users/preferences.test.ts
git commit -m "feat: add GET/PATCH /api/users/preferences with tests"
```

---

### Task 3: ThemeProvider Setup + Remove useDarkMode

**Files:**

- Modify: `components/core/Providers.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/WorkspaceApp.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/Sidebar.tsx`
- Modify: `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Delete: `app/workspace/[workspaceUrl]/hooks/useDarkMode.ts`

- [ ] **Step 1: Wrap app with ThemeProvider**

Edit `components/core/Providers.tsx`:

```typescript
'use client'

/**
 * Client-side Providers
 *
 * Wraps the app with necessary context providers
 * - ClerkProvider for authentication
 * - ThemeProvider for dark/light/system theme
 */

import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'

interface ProvidersProps {
  children: React.ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ClerkProvider>
      <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
        {children}
      </ThemeProvider>
    </ClerkProvider>
  )
}
```

- [ ] **Step 2: Remove dark-mode props from Sidebar**

Edit `app/workspace/[workspaceUrl]/components/Sidebar.tsx`:

Remove `isDarkMode` and `onToggleDarkMode` from the `AppSidebarProps` interface:

```typescript
interface AppSidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  unreadCount: number
}
```

Remove them from the destructured props:

```typescript
export function AppSidebar({
  currentPage,
  onNavigate,
  unreadCount,
}: AppSidebarProps) {
```

Remove the entire `SidebarFooter` block (lines 256-269):

```typescript
      {/* Footer: dark mode toggle */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onToggleDarkMode}
              tooltip={isDarkMode ? 'Dark Mode' : 'Light Mode'}
            >
              {isDarkMode ? <Moon /> : <Sun />}
              <span>{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
```

Remove the `Moon` and `Sun` imports from lucide-react if they are no longer used elsewhere in the file.

- [ ] **Step 3: Remove useDarkMode from WorkspaceApp**

Edit `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`:

Remove the import (line 37):

```typescript
import { useDarkMode } from './hooks/useDarkMode'
```

Remove the hook call (line 372):

```typescript
const { isDarkMode, toggle: handleToggleDarkMode } = useDarkMode()
```

Remove the props from `<AppSidebar>` (around line 798):

```typescript
isDarkMode = { isDarkMode }
onToggleDarkMode = { handleToggleDarkMode }
```

So it becomes:

```typescript
<AppSidebar
  currentPage={currentPage}
  onNavigate={navigateTo}
  unreadCount={unreadCount}
/>
```

- [ ] **Step 4: Remove dark-mode restoration from SettingsShell**

Edit `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`:

Remove the useEffect block (lines 31-35):

```typescript
useEffect(() => {
  // Restore dark mode on direct navigation to settings URL
  const dark = localStorage.getItem(CACHE_KEY.darkMode) === 'true'
  document.documentElement.classList.toggle('dark', dark)
}, [])
```

Remove the `useEffect` import if no longer used. Remove the `CACHE_KEY` import if no longer used.

- [ ] **Step 5: Update constants.ts**

Edit `app/workspace/[workspaceUrl]/constants.ts`:

Remove `darkMode` from CACHE_KEY, add `preferences`:

```typescript
export const CACHE_KEY = {
  preferences: 'lumo:preferences',
  tasks: 'lumo:tasks',
  // ... rest unchanged
}
```

- [ ] **Step 6: Delete useDarkMode hook**

```bash
rm app/workspace/[workspaceUrl]/hooks/useDarkMode.ts
```

- [ ] **Step 7: Verify build compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: No errors. If there are errors about missing `isDarkMode` prop, check that all usages have been removed.

- [ ] **Step 8: Run all tests**

Run: `npx jest`

Expected: All tests pass. If any tests reference `useDarkMode`, update or remove them.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: replace useDarkMode with next-themes ThemeProvider, remove sidebar toggle"
```

---

### Task 4: usePreferences Hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/usePreferences.ts`

- [ ] **Step 1: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/usePreferences.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { apiFetch } from '../utils'
import { CACHE_KEY } from '../constants'
import { toast } from 'sonner'

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  locale: 'en' | 'zh'
  timezone: string
  notifyInAppAssigned: boolean
  notifyInAppComment: boolean
  notifyInAppAgentDone: boolean
  notifyInAppAgentInput: boolean
  notifyInAppMention: boolean
  notifySlackAssigned: boolean
  notifySlackComment: boolean
  notifySlackAgentDone: boolean
  notifySlackAgentInput: boolean
  notifySlackMention: boolean
}

const DEFAULTS: Preferences = {
  theme: 'system',
  locale: 'en',
  timezone: 'auto',
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

function loadCache(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(CACHE_KEY.preferences)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function saveCache(prefs: Preferences): void {
  try {
    localStorage.setItem(CACHE_KEY.preferences, JSON.stringify(prefs))
  } catch {
    // localStorage may be full — non-critical
  }
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(loadCache)
  const [loading, setLoading] = useState(true)
  const { setTheme } = useTheme()
  const mountedRef = useRef(true)

  // Fetch from API on mount, update cache if different
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    async function fetch() {
      try {
        const res = await apiFetch('/api/users/preferences')
        if (!res.ok) return
        const data = (await res.json()) as Preferences
        if (cancelled) return
        setPrefs(data)
        saveCache(data)
        setTheme(data.theme)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [setTheme])

  // Apply theme whenever prefs.theme changes
  useEffect(() => {
    setTheme(prefs.theme)
  }, [prefs.theme, setTheme])

  // Optimistic update: change local state + cache immediately, PATCH in background
  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      const prev = prefs
      const next = { ...prev, ...patch }
      setPrefs(next)
      saveCache(next)

      try {
        const res = await apiFetch('/api/users/preferences', {
          method: 'PATCH',
          body: patch,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'Save failed')
        }
      } catch (err) {
        // Revert on failure
        setPrefs(prev)
        saveCache(prev)
        toast.error(
          err instanceof Error ? err.message : 'Failed to save preference'
        )
      }
    },
    [prefs]
  )

  return { prefs, loading, updatePreferences }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/usePreferences.ts
git commit -m "feat: add usePreferences hook with cache-first + optimistic update"
```

---

### Task 5: PreferencesPage UI + Navigation

**Files:**

- Create: `app/workspace/[workspaceUrl]/settings/preferences/page.tsx`
- Create: `app/workspace/[workspaceUrl]/components/pages/PreferencesPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`

- [ ] **Step 1: Create the route page**

Create `app/workspace/[workspaceUrl]/settings/preferences/page.tsx`:

```typescript
import { PreferencesPage } from '../../components/pages/PreferencesPage'

export default function Page() {
  return <PreferencesPage />
}
```

- [ ] **Step 2: Create PreferencesPage component**

Create `app/workspace/[workspaceUrl]/components/pages/PreferencesPage.tsx`:

```typescript
'use client'

import { Sun, Moon, Monitor, Globe, Clock } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences } from '../../hooks/usePreferences'
import type { Preferences } from '../../hooks/usePreferences'

// ── Timezone helpers ─────────────────────────────────────────────────────────

const COMMON_TIMEZONES = [
  'auto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

function getTimezoneLabel(tz: string): string {
  if (tz === 'auto') {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      return `Auto (${detected})`
    } catch {
      return 'Auto (browser)'
    }
  }
  return tz.replace(/_/g, ' ')
}

// ── Notification event definitions ───────────────────────────────────────────

interface NotifyRow {
  label: string
  inAppKey: keyof Preferences
  slackKey: keyof Preferences
}

const NOTIFY_EVENTS: NotifyRow[] = [
  {
    label: 'Task assigned to me',
    inAppKey: 'notifyInAppAssigned',
    slackKey: 'notifySlackAssigned',
  },
  {
    label: 'New comment on my tasks',
    inAppKey: 'notifyInAppComment',
    slackKey: 'notifySlackComment',
  },
  {
    label: 'Agent completed / needs review',
    inAppKey: 'notifyInAppAgentDone',
    slackKey: 'notifySlackAgentDone',
  },
  {
    label: 'Agent waiting for input',
    inAppKey: 'notifyInAppAgentInput',
    slackKey: 'notifySlackAgentInput',
  },
  {
    label: 'Mentioned in a comment',
    inAppKey: 'notifyInAppMention',
    slackKey: 'notifySlackMention',
  },
]

// ── Theme button ─────────────────────────────────────────────────────────────

function ThemeOption({
  value,
  current,
  icon: Icon,
  label,
  onSelect,
}: {
  value: Preferences['theme']
  current: Preferences['theme']
  icon: React.ElementType
  label: string
  onSelect: (v: Preferences['theme']) => void
}) {
  const active = value === current
  return (
    <button
      onClick={() => onSelect(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium'
          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function PreferencesPage() {
  const { prefs, loading, updatePreferences } = usePreferences()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          Preferences
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Customize your experience.
        </p>

        {/* ── Card 1: Appearance ──────────────────────────────────────── */}
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 mb-6'>
          {/* Theme row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-2'>
              <Sun size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                Theme
              </p>
            </div>
            <div className='flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5'>
              <ThemeOption
                value='light'
                current={prefs.theme}
                icon={Sun}
                label='Light'
                onSelect={v => updatePreferences({ theme: v })}
              />
              <ThemeOption
                value='dark'
                current={prefs.theme}
                icon={Moon}
                label='Dark'
                onSelect={v => updatePreferences({ theme: v })}
              />
              <ThemeOption
                value='system'
                current={prefs.theme}
                icon={Monitor}
                label='System'
                onSelect={v => updatePreferences({ theme: v })}
              />
            </div>
          </div>

          {/* Language row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-2'>
              <Globe size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                Language
              </p>
            </div>
            <Select
              value={prefs.locale}
              onValueChange={v =>
                updatePreferences({ locale: v as Preferences['locale'] })
              }
              disabled={loading}
            >
              <SelectTrigger className='w-32 h-8 text-sm'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='en'>English</SelectItem>
                <SelectItem value='zh'>中文</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Timezone row */}
          <div className='flex items-center justify-between px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Clock size={14} className='text-zinc-400' />
              <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                Timezone
              </p>
            </div>
            <Select
              value={prefs.timezone}
              onValueChange={v => updatePreferences({ timezone: v })}
              disabled={loading}
            >
              <SelectTrigger className='w-48 h-8 text-sm'>
                <SelectValue>
                  {getTimezoneLabel(prefs.timezone)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map(tz => (
                  <SelectItem key={tz} value={tz}>
                    {getTimezoneLabel(tz)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Card 2: In-App Notifications ────────────────────────────── */}
        <h2 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2'>
          In-App Notifications
        </h2>
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 mb-6'>
          {NOTIFY_EVENTS.map((evt, i) => (
            <div
              key={evt.inAppKey}
              className={`flex items-center justify-between px-4 py-3 ${
                i < NOTIFY_EVENTS.length - 1
                  ? 'border-b border-zinc-100 dark:border-zinc-800'
                  : ''
              }`}
            >
              <p className='text-sm text-zinc-700 dark:text-zinc-300'>
                {evt.label}
              </p>
              <Switch
                checked={prefs[evt.inAppKey] as boolean}
                onCheckedChange={v =>
                  updatePreferences({ [evt.inAppKey]: v })
                }
                disabled={loading}
              />
            </div>
          ))}
        </div>

        {/* ── Card 3: Slack Notifications ─────────────────────────────── */}
        <h2 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2'>
          Slack Notifications
        </h2>
        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900'>
          {NOTIFY_EVENTS.map((evt, i) => (
            <div
              key={evt.slackKey}
              className={`flex items-center justify-between px-4 py-3 ${
                i < NOTIFY_EVENTS.length - 1
                  ? 'border-b border-zinc-100 dark:border-zinc-800'
                  : ''
              }`}
            >
              <p className='text-sm text-zinc-700 dark:text-zinc-300'>
                {evt.label}
              </p>
              <Switch
                checked={prefs[evt.slackKey] as boolean}
                onCheckedChange={v =>
                  updatePreferences({ [evt.slackKey]: v })
                }
                disabled={loading}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add Preferences to SettingsShell navigation**

Edit `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`:

Add `Settings2` to the lucide-react imports:

```typescript
import {
  ArrowLeft,
  Building2,
  Users,
  Puzzle,
  KeyRound,
  User,
  Settings2,
} from 'lucide-react'
```

Insert Preferences between Profile and API Keys in `personalItems`:

```typescript
const personalItems = [
  {
    label: 'Profile',
    href: `/workspace/${workspaceUrl}/settings/profile`,
    icon: User,
  },
  {
    label: 'Preferences',
    href: `/workspace/${workspaceUrl}/settings/preferences`,
    icon: Settings2,
  },
  {
    label: 'API Keys',
    href: `/workspace/${workspaceUrl}/settings/api-keys`,
    icon: KeyRound,
  },
]
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Run all tests**

Run: `npx jest`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add PreferencesPage with theme, language, timezone, notification controls"
```

---

### Task 6: Migrate Existing Dark Mode Users

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/usePreferences.ts`

- [ ] **Step 1: Add migration logic to usePreferences**

At the beginning of the `useEffect` that fetches preferences, add a one-time migration from the old `lumo:darkMode` localStorage key. Edit the fetch `useEffect` in `usePreferences.ts`:

After `mountedRef.current = true` and before `async function fetch()`, add:

```typescript
// One-time migration from old darkMode localStorage key
const oldDarkMode = localStorage.getItem('lumo:darkMode')
if (oldDarkMode !== null) {
  localStorage.removeItem('lumo:darkMode')
  const migrated = oldDarkMode === 'true' ? 'dark' : 'light'
  setPrefs(prev => {
    const next = { ...prev, theme: migrated as Preferences['theme'] }
    saveCache(next)
    return next
  })
  setTheme(migrated)
  // Fire-and-forget API update
  apiFetch('/api/users/preferences', {
    method: 'PATCH',
    body: { theme: migrated },
  }).catch(() => {})
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/usePreferences.ts
git commit -m "feat: migrate existing darkMode localStorage to preferences API"
```
