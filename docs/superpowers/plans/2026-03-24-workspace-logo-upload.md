# Workspace Logo Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow workspace owners to upload a cropped logo image, store it in GCS, and display it in the settings page and sidebar workspace-switcher.

**Architecture:** Browser-side crop (react-image-crop, 1:1) → POST FormData to Next.js API route → `@google-cloud/storage` uploads to GCS → URL written to `workspace.logoUrl` in Postgres. Sidebar and settings page read the field from the existing `/api/workspaces/me` endpoint.

**Tech Stack:** Next.js 14 App Router, Prisma (Neon Postgres), `@google-cloud/storage`, `react-image-crop` v11+, shadcn Dialog, sonner toasts, lucide-react Camera icon.

---

## File Map

| File                                                                      | Action | Responsibility                                           |
| ------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `prisma/schema.prisma`                                                    | Modify | Add `logoUrl String?` to Workspace model                 |
| `lib/gcs.ts`                                                              | Create | GCS Storage client singleton                             |
| `app/api/workspaces/me/logo/route.ts`                                     | Create | POST handler: validate → delete old → upload → update DB |
| `app/workspace/[workspaceUrl]/constants.ts`                               | Modify | Add `API.workspaces.logo`                                |
| `components/LogoUploader.tsx`                                             | Create | File picker + crop dialog + upload logic                 |
| `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx` | Modify | Replace static avatar with `<LogoUploader>`              |
| `app/workspace/[workspaceUrl]/components/Sidebar.tsx`                     | Modify | Add `workspaceLogoUrl` state + update switcher slot      |
| `app/workspace/[workspaceUrl]/components/MobileSidebar.tsx`               | Modify | Same changes as Sidebar.tsx                              |
| `.env.local`                                                              | Modify | Add GCS\_\* env vars                                     |

---

## Task 1: Install packages and add env vars

**Files:**

- Modify: `.env.local`

- [ ] **Step 1: Install the two new packages**

```bash
cd /path/to/lumo && npm install @google-cloud/storage react-image-crop
```

Expected: both appear in `package.json` dependencies, no peer-dep errors.

- [ ] **Step 2: Add GCS env vars to `.env.local`**

Add the following block after the `BLOB_READ_WRITE_TOKEN` section (around line 39):

```
# -------------------------------------------------------------
# Google Cloud Storage (for workspace logo uploads)
# Create a service account with Storage Object Admin role on your bucket.
# GCP Console → IAM → Service Accounts → Keys → Add Key → JSON
# Paste the private_key value with \n as literal backslash-n (not real newlines)
# Bucket must have Access Control = Fine-grained (UBLA disabled)
# -------------------------------------------------------------
GCS_PROJECT_ID="your-gcp-project-id"
GCS_BUCKET="your-bucket-name"
GCS_CLIENT_EMAIL="service-account@project.iam.gserviceaccount.com"
GCS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Fill in real values from your GCP service account JSON key file.

- [ ] **Step 3: Verify env vars are loaded**

```bash
node -e "require('dotenv').config({ path: '.env.local' }); console.log(process.env.GCS_BUCKET)"
```

Expected: prints your bucket name (not `undefined`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @google-cloud/storage and react-image-crop"
```

---

## Task 2: Prisma schema + migration

**Files:**

- Modify: `prisma/schema.prisma:59-73`

- [ ] **Step 1: Add `logoUrl` to the Workspace model**

Open `prisma/schema.prisma`. Find the `Workspace` model (around line 59). Add `logoUrl` after `slug`:

```prisma
model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String
  logoUrl   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members  WorkspaceMember[]
  teams    Team[]
  projects Project[]
  views    View[]
  invites  WorkspaceInvite[]

  @@map("workspaces")
}
```

- [ ] **Step 2: Generate and apply the migration locally**

```bash
npx prisma migrate dev --name add-workspace-logo
```

Expected output includes: `The following migration(s) have been applied: …add_workspace_logo`

- [ ] **Step 3: Verify the column exists**

```bash
npx prisma studio
```

Open the `workspaces` table — confirm `logoUrl` column is present (nullable).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add logoUrl to Workspace schema"
```

---

## Task 3: GCS client

**Files:**

- Create: `lib/gcs.ts`

- [ ] **Step 1: Create the GCS client file**

Create `lib/gcs.ts` with this exact content:

```ts
import { Storage } from '@google-cloud/storage'

/**
 * Singleton GCS Storage client.
 * Credentials come from env vars set in .env.local / production env.
 *
 * IMPORTANT: The bucket must have Access Control = Fine-grained (UBLA disabled).
 * If UBLA is enabled, makePublic() will throw a 400 error.
 */
export const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: {
    client_email: process.env.GCS_CLIENT_EMAIL,
    // Service account JSON keys store the PEM key with literal \n characters.
    // In .env files these are stored as backslash-n; replace at runtime.
    private_key: process.env.GCS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
})

export const logoBucket = storage.bucket(process.env.GCS_BUCKET!)
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/gcs.ts
git commit -m "feat: add GCS storage client"
```

---

## Task 4: API constant

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts:17-22`

- [ ] **Step 1: Add `logo` to `API.workspaces`**

Open `app/workspace/[workspaceUrl]/constants.ts`. Find the `workspaces` block (lines 17-22):

```ts
  workspaces: {
    me: '/api/workspaces/me',
    members: '/api/workspaces/members',
    memberById: (id: string) => `/api/workspaces/members/${id}`,
    leaveWorkspace: '/api/workspaces/members/me',
  },
```

Add `logo` as the second entry:

```ts
  workspaces: {
    me: '/api/workspaces/me',
    logo: '/api/workspaces/me/logo',
    members: '/api/workspaces/members',
    memberById: (id: string) => `/api/workspaces/members/${id}`,
    leaveWorkspace: '/api/workspaces/members/me',
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/constants.ts
git commit -m "feat: add API.workspaces.logo constant"
```

---

## Task 5: Upload API route

**Files:**

- Create: `app/api/workspaces/me/logo/route.ts`

This route follows the exact same auth pattern as `app/api/workspaces/me/route.ts` — study that file first if anything is unclear.

- [ ] **Step 1: Create the route file**

Create `app/api/workspaces/me/logo/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { logoBucket } from '@/lib/gcs'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

/**
 * POST /api/workspaces/me/logo
 * Accepts multipart/form-data with a "file" field.
 * Deletes the previous logo from GCS (if any), uploads the new one, updates the DB.
 * Caller must be workspace OWNER.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }
    if (ws.member.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can change the logo' },
        { status: 403 }
      )
    }

    // ── Parse & validate ──────────────────────────────────────────────────────
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'File must be PNG, JPEG, or WebP' },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File must be 2 MB or smaller' },
        { status: 400 }
      )
    }

    // ── Delete old GCS object ─────────────────────────────────────────────────
    const oldLogoUrl = ws.workspace.logoUrl
    if (oldLogoUrl) {
      try {
        // Extract object path from URL, e.g.:
        // https://storage.googleapis.com/bucket-name/workspaces/id/logo-123.jpg
        // → "workspaces/id/logo-123.jpg"
        const bucketName = process.env.GCS_BUCKET!
        const prefix = `https://storage.googleapis.com/${bucketName}/`
        if (oldLogoUrl.startsWith(prefix)) {
          const objectPath = oldLogoUrl.slice(prefix.length)
          await logoBucket.file(objectPath).delete()
        }
      } catch {
        // Ignore — file may already be gone
      }
    }

    // ── Upload new object ─────────────────────────────────────────────────────
    const ext = extFromMime(file.type)
    const objectPath = `workspaces/${ws.workspaceId}/logo-${Date.now()}.${ext}`
    const gcFile = logoBucket.file(objectPath)

    const buffer = Buffer.from(await file.arrayBuffer())
    await gcFile.save(buffer, { contentType: file.type })
    await gcFile.makePublic()

    const logoUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${objectPath}`

    // ── Persist ───────────────────────────────────────────────────────────────
    await prisma.workspace.update({
      where: { id: ws.workspaceId },
      data: { logoUrl },
    })

    return NextResponse.json({ logoUrl })
  } catch (error) {
    console.error('POST /api/workspaces/me/logo error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

> **Prerequisite:** This step requires the Prisma client to have been regenerated after the migration in Task 2. `prisma migrate dev` (Task 2, Step 2) runs `prisma generate` automatically. If you skipped or re-ran migrations manually without generating, run `npx prisma generate` first — otherwise TypeScript will error on `ws.workspace.logoUrl` not existing on the type.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`), sign in as a workspace owner, then run from a terminal:

```bash
# Replace with a real PNG file path and your workspace cookie
curl -X POST http://localhost:3000/api/workspaces/me/logo \
  -H "Cookie: <your-session-cookie>" \
  -F "file=@/path/to/test-logo.png"
```

Expected response: `{"logoUrl":"https://storage.googleapis.com/..."}`.
Also verify in GCP Console that the object exists in the bucket.

- [ ] **Step 4: Commit**

```bash
git add app/api/workspaces/me/logo/route.ts
git commit -m "feat: add POST /api/workspaces/me/logo upload route"
```

---

## Task 6: LogoUploader component

**Files:**

- Create: `components/LogoUploader.tsx`

This component handles three phases: (1) avatar display with hover overlay, (2) crop dialog, (3) upload with loading state.

- [ ] **Step 1: Create the component**

Create `components/LogoUploader.tsx`:

```tsx
'use client'

import { useRef, useState, useCallback } from 'react'
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

interface LogoUploaderProps {
  currentLogoUrl: string | null | undefined
  workspaceName: string
  /** Called with the new public GCS URL after a successful upload. */
  onUpload: (logoUrl: string) => void
  /** API endpoint — pass API.workspaces.logo */
  uploadUrl: string
}

function initCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 80 }, 1, width, height),
    width,
    height
  )
}

export function LogoUploader({
  currentLogoUrl,
  workspaceName,
  onUpload,
  uploadUrl,
}: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [sizeError, setSizeError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [uploading, setUploading] = useState(false)

  // Initials fallback
  const initials = workspaceName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  // ── File picker handler ────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Guard before reset: if no file (user cancelled picker) or ref gone, bail early
    if (!fileInputRef.current || !file) return
    fileInputRef.current.value = '' // reset so re-selecting same file fires again
    if (file.size > MAX_BYTES) {
      setSizeError('File must be 2 MB or smaller')
      return
    }
    setSizeError(null)
    const objectUrl = URL.createObjectURL(file)
    setSrcUrl(objectUrl)
    setDialogOpen(true)
  }

  // ── Crop image ready ───────────────────────────────────────────────────────
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget
      setCrop(initCrop(naturalWidth, naturalHeight))
    },
    []
  )

  // ── Save (crop → upload) ───────────────────────────────────────────────────
  async function handleSave() {
    const img = imgRef.current
    if (!img || !crop || !srcUrl) return

    // Draw the cropped region onto a canvas
    const canvas = document.createElement('canvas')
    const scaleX = img.naturalWidth / img.width
    const scaleY = img.naturalHeight / img.height
    const pixelCrop = {
      x: (crop.x / 100) * img.width * scaleX,
      y: (crop.y / 100) * img.height * scaleY,
      width: (crop.width / 100) * img.width * scaleX,
      height: (crop.height / 100) * img.height * scaleY,
    }
    const size = Math.min(pixelCrop.width, pixelCrop.height, 512)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(
      img,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      size,
      size
    )

    canvas.toBlob(
      async blob => {
        if (!blob) {
          toast.error('Failed to process image')
          return
        }
        if (blob.size > MAX_BYTES) {
          toast.error('Cropped image is too large. Try a smaller crop.')
          return
        }

        setUploading(true)
        try {
          const formData = new FormData()
          formData.append('file', blob, 'logo.jpg')
          const res = await fetch(uploadUrl, { method: 'POST', body: formData })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Upload failed')
          onUpload(data.logoUrl as string)
          setDialogOpen(false)
          URL.revokeObjectURL(srcUrl)
          setSrcUrl(null)
          toast.success('Logo updated')
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : 'Upload failed, please try again'
          )
        } finally {
          setUploading(false)
        }
      },
      'image/jpeg',
      0.9
    )
  }

  function handleCancel() {
    setDialogOpen(false)
    if (srcUrl) URL.revokeObjectURL(srcUrl)
    setSrcUrl(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        onChange={handleFileChange}
      />

      {/* Clickable avatar */}
      <div className='flex flex-col items-end gap-1'>
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          className='relative group size-10 rounded-lg overflow-hidden shrink-0'
        >
          {currentLogoUrl ? (
            <img
              src={currentLogoUrl}
              alt={workspaceName}
              className='size-full object-cover'
            />
          ) : (
            <div className='size-full bg-zinc-800 dark:bg-zinc-700 flex items-center justify-center text-sm font-bold text-white'>
              {initials || '?'}
            </div>
          )}
          {/* Hover overlay */}
          <div className='absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
            <Camera size={16} className='text-white' />
          </div>
        </button>
        {sizeError && <p className='text-xs text-red-500'>{sizeError}</p>}
      </div>

      {/* Crop dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={open => {
          if (!open) handleCancel()
        }}
      >
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Crop logo</DialogTitle>
          </DialogHeader>
          {srcUrl && (
            <div className='flex justify-center'>
              <ReactCrop
                crop={crop}
                onChange={c => setCrop(c)}
                aspect={1}
                circularCrop={false}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={srcUrl}
                  alt='crop preview'
                  onLoad={handleImageLoad}
                  className='max-h-[360px] max-w-full object-contain'
                />
              </ReactCrop>
            </div>
          )}
          <DialogFooter>
            <Button variant='ghost' onClick={handleCancel} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={uploading}>
              {uploading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/LogoUploader.tsx
git commit -m "feat: add LogoUploader component with crop dialog"
```

---

## Task 7: Wire LogoUploader into WorkspaceSettingsPage

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx`

**Note on the GET route:** `GET /api/workspaces/me` requires **no changes**. It already returns `result.workspace` which is the full Prisma `Workspace` object. Once the migration is applied, Prisma includes all scalar fields (including `logoUrl`) automatically in query results. `data.workspace.logoUrl` will be present in the JSON response without any route modification.

- [ ] **Step 1: Extend the `Workspace` interface**

Find the `Workspace` interface at lines 20-24 and add `logoUrl`:

```ts
interface Workspace {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
}
```

- [ ] **Step 2: Add the `LogoUploader` import**

Add at the top of the file, after the existing imports:

```ts
import { LogoUploader } from '@/components/LogoUploader'
import { API } from '../../constants' // already imported — ensure it's there
```

- [ ] **Step 3: Replace the static logo avatar with `<LogoUploader>`**

Find the logo row (around line 162-174):

```tsx
{
  /* Logo row */
}
;<div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
  <div>
    <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>Logo</p>
    <p className='text-xs text-zinc-400 mt-0.5'>
      Recommended size is 256×256px
    </p>
  </div>
  <div className='size-10 rounded-lg bg-zinc-800 dark:bg-zinc-700 flex items-center justify-center text-sm font-bold text-white shrink-0'>
    {initials || '?'}
  </div>
</div>
```

Replace the closing `<div>` (the initials avatar) with `<LogoUploader>`:

```tsx
{
  /* Logo row */
}
;<div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
  <div>
    <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>Logo</p>
    <p className='text-xs text-zinc-400 mt-0.5'>
      Recommended size is 256×256px
    </p>
  </div>
  <LogoUploader
    currentLogoUrl={workspace?.logoUrl}
    workspaceName={workspace?.name ?? ''}
    uploadUrl={API.workspaces.logo}
    onUpload={url => setWorkspace(w => (w ? { ...w, logoUrl: url } : w))}
  />
</div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual test in browser**

1. Open `http://localhost:3000/workspace/<slug>/settings/workspace`
2. Click the avatar — file picker should open
3. Select a PNG/JPG — crop dialog should appear
4. Adjust crop, click Save — spinner, then success toast
5. Logo preview should update immediately in the settings page

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/WorkspaceSettingsPage.tsx
git commit -m "feat: wire LogoUploader into WorkspaceSettingsPage"
```

---

## Task 8: Update Sidebar

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/Sidebar.tsx:60-103`

- [ ] **Step 1: Add `workspaceLogoUrl` state**

After the existing `workspaceName` state on line 60, add:

```ts
const [workspaceName, setWorkspaceName] = useState<string>('')
const [workspaceLogoUrl, setWorkspaceLogoUrl] = useState<string | null>(null)
```

- [ ] **Step 2: Extend the fetch to read `logoUrl`**

Find the `useEffect` fetch (lines 62-68):

```ts
useEffect(() => {
  fetch(API.workspaces.me)
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data?.workspace?.name) setWorkspaceName(data.workspace.name)
    })
    .catch(() => {})
}, [])
```

Add the `logoUrl` read:

```ts
useEffect(() => {
  fetch(API.workspaces.me)
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data?.workspace?.name) setWorkspaceName(data.workspace.name)
      if (data?.workspace?.logoUrl) setWorkspaceLogoUrl(data.workspace.logoUrl)
    })
    .catch(() => {})
}, [])
```

- [ ] **Step 3: Replace the avatar slot in the workspace-switcher button**

Find the avatar slot (lines 92-103):

```tsx
{
  user?.imageUrl ? (
    <img
      src={user.imageUrl}
      className='size-8 rounded-full object-cover shrink-0'
      alt='avatar'
      referrerPolicy='no-referrer'
    />
  ) : (
    <div className='size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-bold shrink-0'>
      {initials}
    </div>
  )
}
```

Replace with the three-way fallback:

```tsx
{
  workspaceLogoUrl ? (
    <img
      src={workspaceLogoUrl}
      alt={workspaceName}
      className='size-8 rounded-lg object-cover shrink-0'
    />
  ) : user?.imageUrl ? (
    <img
      src={user.imageUrl}
      className='size-8 rounded-full object-cover shrink-0'
      alt='avatar'
      referrerPolicy='no-referrer'
    />
  ) : (
    <div className='size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-bold shrink-0'>
      {initials}
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual test**

1. After uploading a logo in settings, navigate back to the workspace app
2. The workspace-switcher slot (top-left of sidebar) should show the logo (rounded-lg, not rounded-full)
3. If no logo, it should still show the Clerk user avatar as before

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/Sidebar.tsx
git commit -m "feat: show workspace logo in sidebar switcher"
```

---

## Task 9: Update MobileSidebar

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/MobileSidebar.tsx:44-98`

This mirrors the Sidebar changes exactly.

- [ ] **Step 1: Add `workspaceLogoUrl` state**

After the `workspaceName` state (around line 44):

```ts
const [workspaceName, setWorkspaceName] = useState('')
const [workspaceLogoUrl, setWorkspaceLogoUrl] = useState<string | null>(null)
```

- [ ] **Step 2: Extend the fetch to read `logoUrl`**

Find the `useEffect` fetch (lines 46-53):

```ts
useEffect(() => {
  fetch(API.workspaces.me)
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data?.workspace?.name) setWorkspaceName(data.workspace.name)
    })
    .catch(() => {})
}, [])
```

Add:

```ts
useEffect(() => {
  fetch(API.workspaces.me)
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data?.workspace?.name) setWorkspaceName(data.workspace.name)
      if (data?.workspace?.logoUrl) setWorkspaceLogoUrl(data.workspace.logoUrl)
    })
    .catch(() => {})
}, [])
```

- [ ] **Step 3: Replace the avatar slot in the mobile header**

Find the avatar slot (lines 88-98):

```tsx
{
  user?.imageUrl ? (
    <img
      src={user.imageUrl}
      className='size-8 rounded-full object-cover shrink-0'
      alt='avatar'
      referrerPolicy='no-referrer'
    />
  ) : (
    <div className='size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-bold shrink-0'>
      {initials}
    </div>
  )
}
```

Replace with three-way fallback (same as Sidebar):

```tsx
{
  workspaceLogoUrl ? (
    <img
      src={workspaceLogoUrl}
      alt={workspaceName}
      className='size-8 rounded-lg object-cover shrink-0'
    />
  ) : user?.imageUrl ? (
    <img
      src={user.imageUrl}
      className='size-8 rounded-full object-cover shrink-0'
      alt='avatar'
      referrerPolicy='no-referrer'
    />
  ) : (
    <div className='size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-bold shrink-0'>
      {initials}
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/MobileSidebar.tsx
git commit -m "feat: show workspace logo in mobile sidebar switcher"
```

---

## Task 10: Final verification + production migration

- [ ] **Step 1: Full end-to-end test**

1. Start dev server: `npm run dev`
2. Sign in as workspace owner
3. Go to `/workspace/<slug>/settings/workspace`
4. Upload a logo:
   - Click the avatar → file picker opens ✓
   - Select an image → crop dialog appears ✓
   - Adjust crop → click Save → spinner → success toast ✓
   - Logo preview updates in settings immediately ✓
5. Navigate to `/workspace/<slug>/my-tasks` (or any page)
   - Sidebar workspace-switcher shows the new logo (square/rounded-lg) ✓
6. Open the mobile menu (if on small screen) — same logo appears ✓
7. Upload a second logo → GCP Console shows only the new object (old one deleted) ✓

- [ ] **Step 2: Run production migration**

```bash
DATABASE_URL="<your-production-db-url>" npx prisma migrate deploy
```

Expected: `Applied 1 migration(s) … add_workspace_logo`

- [ ] **Step 3: Add GCS env vars to production**

In Vercel Dashboard (or your deployment platform), add the four `GCS_*` environment variables with production values. Redeploy.

- [ ] **Step 4: Document GCS env vars for future developers**

> ⚠️ **WARNING: Do NOT commit `.env.local` if it contains real credentials.** The file already contains real values for `DATABASE_URL`, `CLERK_SECRET_KEY`, `RESEND_API_KEY`, and others. Committing it would expose production secrets. Instead, document the new variables in a safe location (e.g., your team's internal wiki or Vercel environment variable dashboard).

If your project uses `.env.example` as a template file with placeholder values (no real secrets), you may create it and commit it:

```bash
# Only do this if you have a separate .env.example with fake/placeholder values
git add .env.example
git commit -m "chore: document GCS env vars in env.example"
```
