# Workspace Logo Upload — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Allow workspace owners to upload a custom logo from the Workspace Settings page. The cropped image is uploaded through a Next.js API route to Google Cloud Storage (GCS). The logo is then displayed in the Settings page and in the sidebar workspace-switcher button.

---

## Architecture

```
User selects file
  → Client-side size check on original file (≤ 2 MB)
  → Browser: react-image-crop dialog (1:1 square)
  → User confirms crop
  → canvas.toBlob (JPEG quality 0.9) → size check on final blob (≤ 2 MB)
  → FormData POST to /api/workspaces/me/logo
  → API: auth (owner) → validate MIME + size → delete old GCS object → upload new → update DB
  → Return { logoUrl }
  → WorkspaceSettingsPage updates local state (preview in settings)
  → On next navigation back to workspace app, Sidebar self-fetches and shows new logo
```

---

## New Packages

```bash
npm install @google-cloud/storage react-image-crop
```

- `@google-cloud/storage` — Node.js GCS SDK for server-side upload
- `react-image-crop` v11+ — browser-side crop UI, React 19 compatible

Both are absent from `package.json` and must be installed before implementation.

---

## Data Layer

### Prisma Schema

```prisma
model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String
  logoUrl   String?       // ← new
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ...
}
```

After editing the schema, run:

```bash
npx prisma migrate dev --name add-workspace-logo
```

Deploy to production with `prisma migrate deploy`.

### API Response

`GET /api/workspaces/me` already returns workspace fields via `getUserWorkspace` with `include: { workspace: true }`. Once `logoUrl` is added to the schema, Prisma will include it automatically — no query changes needed.

Update the local `Workspace` interface in `WorkspaceSettingsPage.tsx` to add `logoUrl?: string | null`.

---

## GCS Client — `lib/gcs.ts`

```ts
import { Storage } from '@google-cloud/storage'

export const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: {
    client_email: process.env.GCS_CLIENT_EMAIL,
    // GCP service account keys contain literal \n in .env; replace at runtime.
    private_key: process.env.GCS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
})

export const logoBucket = storage.bucket(process.env.GCS_BUCKET!)
```

### Environment Variables

Add to `.env.local` and `.env.example`:

```
GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET=your-bucket-name
GCS_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
# Paste PEM key with \n as literal backslash-n, not real newlines
GCS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

### GCS Bucket Requirements

**Uniform Bucket-Level Access (UBLA) must be disabled** on the bucket. `file.makePublic()` (per-object ACL) throws a 400 at runtime if UBLA is enabled (Google's default for new buckets). Verify in GCP Console → Storage → Bucket → Permissions → Access Control = **Fine-grained**.

If UBLA cannot be disabled, configure the bucket as publicly readable at the bucket level instead, and remove the `makePublic()` call from the upload route.

---

## API Route — `app/api/workspaces/me/logo/route.ts`

- **Auth:** Same pattern as existing workspace routes — `requireAuth` + `getUserWorkspace`; reject with 403 if `ws.member.role !== 'OWNER'`
- **Parsing:** Native App Router formData — no multer/busboy:
  ```ts
  const formData = await request.formData()
  const file = formData.get('file') as File
  ```
- **Validation:** MIME type (`image/png | image/jpeg | image/webp`), size ≤ 2 MB (`file.size`)
- **Body size limit:** Next.js App Router default handles up to 4 MB for route handlers. A 2 MB file with multipart envelope stays well under this limit — no extra config needed.
- **Old logo cleanup:** Read `ws.workspace.logoUrl` from DB. If it's a URL pointing to this GCS bucket, extract the object path and call `logoBucket.file(path).delete()`. Wrap in try/catch and ignore 404 (file already gone).
- **Upload path:** `workspaces/{workspaceId}/logo-{Date.now()}.{ext}` (timestamp prevents CDN cache collisions on re-upload)
- **After upload:** `await gcFile.makePublic()` → build public URL → `prisma.workspace.update({ data: { logoUrl } })`
- **Response:** `{ logoUrl: string }`
- **Errors:** 400 (invalid file), 403 (not owner), 500 (GCS or DB failure)

---

## API Constants

In `app/workspace/[workspaceUrl]/constants.ts`, add `logo` under `API.workspaces`:

```ts
export const API = {
  workspaces: {
    me: '/api/workspaces/me',
    logo: '/api/workspaces/me/logo',   // ← new
  },
  ...
}
```

---

## Frontend

### `LogoUploader` component — `components/LogoUploader.tsx`

Props:

```ts
interface LogoUploaderProps {
  currentLogoUrl: string | null | undefined
  workspaceName: string
  onUpload: (logoUrl: string) => void
}
```

Behaviour:

1. Renders a square avatar (same size/style as the existing initials placeholder).
2. Hover: semi-transparent dark overlay + `<Camera>` icon (lucide-react).
3. Click → hidden `<input type="file" accept="image/png,image/jpeg,image/webp">`.
4. On file select:
   - Check `file.size ≤ 2 * 1024 * 1024`; if over, show inline error and abort.
   - Open shadcn `<Dialog>` with `<ReactCrop aspect={1}>`.
5. Dialog footer: **Cancel** + **Save** buttons.
6. On Save:
   - `canvas.toBlob(blob => …, 'image/jpeg', 0.9)`
   - Check `blob.size ≤ 2 * 1024 * 1024`; if over, show error toast and abort.
   - POST `FormData` to `API.workspaces.logo`.
   - Spinner on Save button while in-flight.
7. On success: call `onUpload(logoUrl)`, close dialog, show success toast.
8. On error: show error toast, keep dialog open.
9. Use plain `<img>` (not `next/image`) to avoid needing `next.config.mjs` remotePatterns.

### `WorkspaceSettingsPage` changes

- Extend local `Workspace` interface: add `logoUrl?: string | null`.
- Replace the static initials avatar with `<LogoUploader currentLogoUrl={workspace.logoUrl} workspaceName={workspace.name} onUpload={url => setWorkspace(w => ({ ...w!, logoUrl: url }))} />`.
- No callback to `WorkspaceApp` needed — settings and workspace app are in separate layout trees.

### Sidebar changes (`Sidebar.tsx` and `MobileSidebar.tsx`)

Both `Sidebar.tsx` and `MobileSidebar.tsx` have an identical workspace-switcher slot. Both need the same changes.

**State addition:** Add a new state variable:

```ts
const [workspaceLogoUrl, setWorkspaceLogoUrl] = useState<string | null>(null)
```

**Fetch update:** The existing `useEffect` fetch already calls `GET /api/workspaces/me` and reads `data.workspace.name`. Extend it to also read `logoUrl`:

```ts
if (data?.workspace?.name) setWorkspaceName(data.workspace.name)
if (data?.workspace?.logoUrl) setWorkspaceLogoUrl(data.workspace.logoUrl)
```

**Workspace-switcher slot:** Replace the current `user.imageUrl` / initials avatar (the `size-8` circle) with a three-way fallback:

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

**Update timing:** `WorkspaceSettingsPage` and the Sidebar live in separate Next.js layout trees and are never mounted simultaneously. After saving a logo in Settings and navigating back to the workspace, the Sidebar re-mounts and re-fetches, picking up the new `logoUrl` automatically. No cross-component callback or shared context is required.

---

## File Size Validation — Two Checkpoints

| Checkpoint            | What is checked                 | Reason                                                       |
| --------------------- | ------------------------------- | ------------------------------------------------------------ |
| After file picker     | `file.size` (original file)     | Fast-fail before opening crop dialog                         |
| After `canvas.toBlob` | `blob.size` (re-encoded output) | Encoded size may differ from original after crop + re-encode |

Both limits: `≤ 2 * 1024 * 1024` bytes.

---

## Error Handling

| Scenario                 | Handling                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| File > 2 MB (original)   | Inline error under avatar; crop dialog not opened                       |
| File > 2 MB (after crop) | Error toast; upload not sent                                            |
| Wrong MIME type          | `<input accept>` limits picker; API validates again as defence-in-depth |
| GCS UBLA enabled         | `makePublic()` throws 400 → API returns 500 → toast "Upload failed"     |
| GCS upload failure       | 500 → toast "Upload failed, please try again"                           |
| Not workspace owner      | 403 (settings page is already owner-gated)                              |

---

## Files Changed / Created

| File                                                                      | Type                                                                        |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                    | Modified — add `logoUrl String?`                                            |
| `prisma/migrations/…`                                                     | New migration                                                               |
| `lib/gcs.ts`                                                              | New — GCS Storage client                                                    |
| `app/api/workspaces/me/logo/route.ts`                                     | New — upload API route                                                      |
| `app/workspace/[workspaceUrl]/constants.ts`                               | Modified — add `API.workspaces.logo`                                        |
| `components/LogoUploader.tsx`                                             | New — crop + upload UI component                                            |
| `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx` | Modified — use LogoUploader, extend Workspace type                          |
| `app/workspace/[workspaceUrl]/components/Sidebar.tsx`                     | Modified — add `workspaceLogoUrl` state, extend fetch, update switcher slot |
| `app/workspace/[workspaceUrl]/components/MobileSidebar.tsx`               | Modified — same changes as Sidebar.tsx                                      |
| `.env.example`                                                            | Modified — add GCS\_\* env vars                                             |

---

## Out of Scope

- User-facing logo deletion
- Server-side image resizing with `sharp`
- Multiple logo sizes / variants
- Magic-bytes MIME validation (can be added later with `file-type` package)
