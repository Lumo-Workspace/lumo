# User Profile (Avatar + Name) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Profile settings page where users can upload an avatar, edit their first/last name, and view their read-only email — all synced directly to Clerk with zero extra DB tables.

**Architecture:** Two new API routes (`PATCH /api/users/profile` for name, `POST /api/users/profile/avatar` for image) call Clerk's server-side SDK. The `ProfilePage` client component reads live data from `useUser()` and calls `user.reload()` after mutations so Clerk's client state refreshes automatically. Layout follows the existing Card-row style used by Workspace / Members / Integrations settings pages.

**Tech Stack:** Next.js 14 App Router, TypeScript, `@clerk/nextjs/server` (`clerkClient`, `requireAuth`), `@clerk/nextjs` (`useUser`), Tailwind CSS, shadcn/ui (`Button`, `Input`), sonner (`toast`)

---

## File Map

| File                                                            | Action | Responsibility                                                                    |
| --------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `app/api/users/profile/route.ts`                                | Create | `PATCH`: validate body, call Clerk `updateUser` for firstName/lastName            |
| `app/api/users/profile/avatar/route.ts`                         | Create | `POST`: parse FormData, validate size ≤ 2 MB, call Clerk `updateUserProfileImage` |
| `__tests__/api/users/profile.test.ts`                           | Create | Unit tests for both API routes                                                    |
| `app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx` | Create | Card-row UI: avatar upload, name form, read-only email                            |
| `app/workspace/[workspaceUrl]/settings/profile/page.tsx`        | Create | Thin route page that renders `<ProfilePage />`                                    |
| `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`       | Modify | Add Profile link (with `User` icon) to the Personal nav section                   |

---

## Task 1: API route — update name (`PATCH /api/users/profile`)

**Files:**

- Create: `app/api/users/profile/route.ts`

- [ ] **Step 1: Create the route file with the PATCH handler**

```typescript
// app/api/users/profile/route.ts
import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAuth } from '@/lib/auth'

/**
 * PATCH /api/users/profile
 * Updates the authenticated user's firstName and lastName in Clerk.
 * Body: { firstName: string; lastName: string }
 */
export async function PATCH(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const firstName = (body?.firstName ?? '').trim()
    const lastName = (body?.lastName ?? '').trim()

    if (!firstName && !lastName) {
      return NextResponse.json(
        { error: 'firstName or lastName is required' },
        { status: 400 }
      )
    }

    const client = await clerkClient()
    await client.users.updateUser(userId, { firstName, lastName })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PATCH /api/users/profile error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors for this file.

---

## Task 2: API route — upload avatar (`POST /api/users/profile/avatar`)

**Files:**

- Create: `app/api/users/profile/avatar/route.ts`

- [ ] **Step 1: Create the avatar upload route**

```typescript
// app/api/users/profile/avatar/route.ts
import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAuth } from '@/lib/auth'

const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

/**
 * POST /api/users/profile/avatar
 * Uploads a new avatar image directly to Clerk.
 * Body: FormData with a "file" field (JPG, PNG, or WebP).
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File must be 2 MB or smaller' },
        { status: 400 }
      )
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only JPG, PNG, and WebP are allowed' },
        { status: 400 }
      )
    }

    const client = await clerkClient()
    await client.users.updateUserProfileImage(userId, { file })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/users/profile/avatar error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

---

## Task 3: Unit tests for both API routes

**Files:**

- Create: `__tests__/api/users/profile.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// __tests__/api/users/profile.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { clerkClient } from '@clerk/nextjs/server'
import { PATCH } from '@/app/api/users/profile/route'
import { POST } from '@/app/api/users/profile/avatar/route'

const mockRequireAuth = requireAuth as jest.Mock
const mockClerkClient = clerkClient as jest.Mock

function makeJsonRequest(body: unknown, method = 'PATCH'): Request {
  return new Request('http://localhost/api/users/profile', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeFormRequest(file: File): Request {
  const fd = new FormData()
  fd.append('file', file)
  return new Request('http://localhost/api/users/profile/avatar', {
    method: 'POST',
    body: fd,
  })
}

beforeEach(() => jest.clearAllMocks())

// ── PATCH /api/users/profile ──────────────────────────────────────────────────

describe('PATCH /api/users/profile', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await PATCH(
      makeJsonRequest({ firstName: 'Chao', lastName: 'Li' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when both firstName and lastName are empty', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const res = await PATCH(makeJsonRequest({ firstName: '  ', lastName: '' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/firstName or lastName/)
  })

  it('calls clerkClient updateUser and returns ok:true', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const mockUpdateUser = jest.fn().mockResolvedValueOnce({})
    mockClerkClient.mockResolvedValueOnce({
      users: { updateUser: mockUpdateUser },
    })

    const res = await PATCH(
      makeJsonRequest({ firstName: 'Chao', lastName: 'Li' })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(mockUpdateUser).toHaveBeenCalledWith('user_abc', {
      firstName: 'Chao',
      lastName: 'Li',
    })
  })
})

// ── POST /api/users/profile/avatar ───────────────────────────────────────────

describe('POST /api/users/profile/avatar', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const file = new File(['data'], 'avatar.png', { type: 'image/png' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(401)
  })

  it('returns 400 when file exceeds 2 MB', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    // Create a file just over 2 MB
    const bigData = new Uint8Array(2 * 1024 * 1024 + 1)
    const file = new File([bigData], 'big.png', { type: 'image/png' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/2 MB/)
  })

  it('returns 400 for disallowed file type', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const file = new File(['data'], 'avatar.gif', { type: 'image/gif' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/JPG, PNG/)
  })

  it('calls clerkClient updateUserProfileImage and returns ok:true', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const mockUpdateImage = jest.fn().mockResolvedValueOnce({})
    mockClerkClient.mockResolvedValueOnce({
      users: { updateUserProfileImage: mockUpdateImage },
    })
    const file = new File(['data'], 'avatar.png', { type: 'image/png' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(mockUpdateImage).toHaveBeenCalledWith('user_abc', { file })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (routes don't exist yet — that's expected only if running tests before Task 1/2; if Tasks 1 & 2 are done, run now)**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npm test -- --testPathPattern="profile" --no-coverage 2>&1 | tail -20
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && git add \
  app/api/users/profile/route.ts \
  app/api/users/profile/avatar/route.ts \
  __tests__/api/users/profile.test.ts && \
git commit -m "feat: add profile API routes (PATCH name, POST avatar)"
```

---

## Task 4: ProfilePage component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx`

- [ ] **Step 1: Create the ProfilePage component**

```tsx
// app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx
'use client'

import { useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '../../utils' // used for PATCH /api/users/profile (JSON)

export function ProfilePage() {
  const { user, isLoaded } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameInitialized, setNameInitialized] = useState(false)

  // Initialize name fields once user data loads
  if (isLoaded && user && !nameInitialized) {
    setFirstName(user.firstName ?? '')
    setLastName(user.lastName ?? '')
    setNameInitialized(true)
  }

  const handleAvatarClick = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so the same file can be re-selected if needed
    e.target.value = ''

    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be 2 MB or smaller')
      return
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Only JPG, PNG, and WebP are allowed')
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      // Use raw fetch — apiFetch forces Content-Type: application/json which breaks FormData
      const res = await fetch('/api/users/profile/avatar', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error ?? 'Upload failed')
      }
      await user?.reload()
      toast.success('Avatar updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSaveName = async () => {
    setSavingName(true)
    try {
      const res = await apiFetch('/api/users/profile', {
        method: 'PATCH',
        body: { firstName, lastName },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error ?? 'Save failed')
      }
      await user?.reload()
      toast.success('Name updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingName(false)
    }
  }

  const initials =
    [user?.firstName?.[0], user?.lastName?.[0]]
      .filter(Boolean)
      .join('')
      .toUpperCase() || '?'

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          Profile
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Manage your personal information.
        </p>

        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900'>
          {/* Avatar row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-3'>
              {isLoaded && user?.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt='Avatar'
                  className='w-9 h-9 rounded-full object-cover'
                />
              ) : (
                <div className='w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-semibold'>
                  {initials}
                </div>
              )}
              <div>
                <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                  Avatar
                </p>
                <p className='text-xs text-zinc-400'>
                  JPG, PNG or WebP. Max 2 MB
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/jpeg,image/png,image/webp'
              className='hidden'
              onChange={handleFileChange}
            />
            <Button
              variant='outline'
              size='sm'
              onClick={handleAvatarClick}
              disabled={uploading || !isLoaded}
            >
              {uploading ? (
                <Loader2 size={14} className='animate-spin mr-1.5' />
              ) : (
                <Upload size={14} className='mr-1.5' />
              )}
              Upload
            </Button>
          </div>

          {/* Name row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100 shrink-0 mr-4'>
              Name
            </p>
            <div className='flex items-center gap-2'>
              <Input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder='First name'
                className='w-28 h-8 text-sm'
                disabled={savingName || !isLoaded}
              />
              <Input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder='Last name'
                className='w-28 h-8 text-sm'
                disabled={savingName || !isLoaded}
              />
              <Button
                size='sm'
                onClick={handleSaveName}
                disabled={savingName || !isLoaded}
              >
                {savingName ? (
                  <Loader2 size={14} className='animate-spin' />
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>

          {/* Email row (read-only) */}
          <div className='flex items-center justify-between px-4 py-3'>
            <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
              Email
            </p>
            <p className='text-sm text-zinc-400'>
              {isLoaded ? (user?.emailAddresses[0]?.emailAddress ?? '—') : '…'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

---

## Task 5: Route page + SettingsShell nav link

**Files:**

- Create: `app/workspace/[workspaceUrl]/settings/profile/page.tsx`
- Modify: `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`

- [ ] **Step 1: Create the thin route page**

```typescript
// app/workspace/[workspaceUrl]/settings/profile/page.tsx
import { ProfilePage } from '../../components/pages/ProfilePage'

export default function ProfileSettingsPage() {
  return <ProfilePage />
}
```

- [ ] **Step 2: Update SettingsShell — add Profile nav item**

In `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`:

**Change the import line** (add `User` to the lucide-react imports):

```typescript
// Before:
import { ArrowLeft, Building2, Users, Puzzle, KeyRound } from 'lucide-react'

// After:
import {
  ArrowLeft,
  Building2,
  Users,
  Puzzle,
  KeyRound,
  User,
} from 'lucide-react'
```

**Change the `personalItems` array** (add Profile before API Keys):

```typescript
// Before:
const personalItems = [
  {
    label: 'API Keys',
    href: `/workspace/${workspaceUrl}/settings/api-keys`,
    icon: KeyRound,
  },
]

// After:
const personalItems = [
  {
    label: 'Profile',
    href: `/workspace/${workspaceUrl}/settings/profile`,
    icon: User,
  },
  {
    label: 'API Keys',
    href: `/workspace/${workspaceUrl}/settings/api-keys`,
    icon: KeyRound,
  },
]
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npm test -- --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && git add \
  app/workspace/\[workspaceUrl\]/components/pages/ProfilePage.tsx \
  app/workspace/\[workspaceUrl\]/settings/profile/page.tsx \
  app/workspace/\[workspaceUrl\]/settings/SettingsShell.tsx && \
git commit -m "feat: add Profile settings page with avatar upload and name edit"
```

---

## Verification Checklist

After implementation, manually verify:

1. Navigate to `Settings → Personal → Profile` — page renders with card layout
2. Current avatar (or initials) shown in Avatar row
3. Click **Upload**, pick a PNG ≤ 2 MB — avatar updates without page reload
4. Pick a file > 2 MB — toast error "File must be 2 MB or smaller"
5. Edit First/Last name, click **Save** — name updates, sidebar/header reflects change after reload
6. Email row shows correct email, is not editable
7. API Keys still shows in Personal section below Profile
