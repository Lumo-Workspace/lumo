# Document Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add document sharing UI (member invites with role control + public read-only link) to the document editor.

**Architecture:** A `ShareDialog` component handles member search, role management, and public link toggling. The dialog is opened from a share button in the editor top bar or a clickable visibility badge. A new `/share/[token]` public page renders documents without authentication. Backend changes: add `publicToken` field to Document model and a public API endpoint.

**Tech Stack:** Next.js 14 App Router, Prisma, shadcn/ui (Dialog, Select, Switch), react-intl, crypto.randomUUID (for token generation).

**Spec:** `docs/superpowers/specs/2026-04-06-document-sharing-design.md`

---

## File Structure

| File                                                                   | Action | Responsibility                                              |
| ---------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `prisma/schema.prisma`                                                 | Modify | Add `publicToken` field to Document model                   |
| `lib/validation/schemas.ts`                                            | Modify | Add `publicToken` to updateDocumentSchema                   |
| `app/api/documents/[id]/route.ts`                                      | Modify | Handle `publicToken` updates in PATCH (owner only)          |
| `app/api/share/[token]/route.ts`                                       | Create | Public GET endpoint returning document content (no auth)    |
| `app/share/[token]/page.tsx`                                           | Create | Public read-only document page                              |
| `app/workspace/[workspaceUrl]/types.ts`                                | Modify | Add `publicToken` to ApiDocumentDetail                      |
| `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx`     | Create | Share dialog: member search, share list, public link toggle |
| `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` | Modify | Add share button, visibility badge, wire up ShareDialog     |
| `lib/i18n/zh.json`                                                     | Modify | Add sharing-related i18n keys                               |
| `lib/i18n/en.json`                                                     | Modify | Add sharing-related i18n keys                               |

---

### Task 1: Database — Add publicToken field

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add publicToken field to Document model**

In `prisma/schema.prisma`, find the Document model (around line 712). Add after the `sortOrder` field:

```prisma
publicToken  String?  @unique
```

- [ ] **Step 2: Generate and apply migration**

Run:

```bash
source ~/.nvm/nvm.sh && npx prisma migrate dev --name add-document-public-token
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add publicToken field to Document model [LUM-16]"
```

---

### Task 2: API — publicToken update + public endpoint

**Files:**

- Modify: `lib/validation/schemas.ts`
- Modify: `app/api/documents/[id]/route.ts`
- Create: `app/api/share/[token]/route.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add publicToken to validation schema**

In `lib/validation/schemas.ts`, add to `updateDocumentSchema` (after the `childOrder` field):

```typescript
publicToken: z.string().max(30).nullable().optional(),
```

- [ ] **Step 2: Handle publicToken in PATCH endpoint**

In `app/api/documents/[id]/route.ts`, add publicToken to the owner-only check (after line 208, the visibility owner check):

```typescript
// Only owner can change publicToken
if (parsed.data.publicToken !== undefined && role !== 'OWNER') {
  return NextResponse.json(
    { error: 'Only the owner can change public link' },
    { status: 403 }
  )
}
```

Then add to the `updateData` building section (after the `sortOrder` line around line 220):

```typescript
if (parsed.data.publicToken !== undefined)
  updateData.publicToken = parsed.data.publicToken
```

- [ ] **Step 3: Add publicToken to GET response**

In `app/api/documents/[id]/route.ts`, find the GET handler's document select/include. Add `publicToken: true` to the document select so it's included in the response. Check the existing select object and add the field.

- [ ] **Step 4: Add publicToken to ApiDocumentDetail type**

In `app/workspace/[workspaceUrl]/types.ts`, add to `ApiDocumentDetail`:

```typescript
export interface ApiDocumentDetail extends ApiDocument {
  content: string | null
  children: ApiDocument[]
  shares: ApiDocumentShare[]
  ancestors?: ApiDocumentAncestor[]
  publicToken?: string | null | undefined
}
```

- [ ] **Step 5: Create public share endpoint**

Create `app/api/share/[token]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const document = await prisma.document.findUnique({
    where: { publicToken: token },
    select: {
      title: true,
      emoji: true,
      content: true,
    },
  })

  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  return NextResponse.json({ document })
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/validation/schemas.ts "app/api/documents/[id]/route.ts" "app/api/share/[token]/route.ts" "app/workspace/[workspaceUrl]/types.ts"
git commit -m "feat: add publicToken API support and public share endpoint [LUM-16]"
```

---

### Task 3: ShareDialog component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx`
- Modify: `lib/i18n/zh.json`
- Modify: `lib/i18n/en.json`

- [ ] **Step 1: Add i18n keys**

Add to `lib/i18n/zh.json`:

```json
"share.title": "分享文档",
"share.searchPlaceholder": "搜索成员...",
"share.invite": "邀请",
"share.sharedWith": "已分享",
"share.owner": "所有者",
"share.creator": "创建者",
"share.viewer": "可查看",
"share.editor": "可编辑",
"share.manager": "管理者",
"share.remove": "移除",
"share.publicLink": "公开链接",
"share.publicLinkDesc": "任何人可通过链接查看",
"share.copyLink": "复制链接",
"share.copied": "已复制",
"share.button": "分享"
```

Add to `lib/i18n/en.json`:

```json
"share.title": "Share document",
"share.searchPlaceholder": "Search members...",
"share.invite": "Invite",
"share.sharedWith": "Shared with",
"share.owner": "Owner",
"share.creator": "Creator",
"share.viewer": "Can view",
"share.editor": "Can edit",
"share.manager": "Manager",
"share.remove": "Remove",
"share.publicLink": "Public link",
"share.publicLinkDesc": "Anyone with the link can view",
"share.copyLink": "Copy link",
"share.copied": "Copied",
"share.button": "Share"
```

- [ ] **Step 2: Create ShareDialog component**

Create `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx`:

```typescript
'use client'

import { useState, useCallback, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Link2, Copy, Check, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ApiDocumentShare,
  DocShareRole,
  DocVisibility,
} from '../../types'
import type { WorkspaceMemberInfo } from '../../types'
import { API } from '../../constants'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  documentTitle: string
  documentEmoji: string | null
  visibility: DocVisibility
  publicToken: string | null | undefined
  shares: ApiDocumentShare[]
  owner: { id: string; name: string; imageUrl: string | null }
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
  onSharesChange: (shares: ApiDocumentShare[]) => void
  onVisibilityChange: (visibility: DocVisibility) => void
  onPublicTokenChange: (token: string | null) => void
}

function MemberAvatar({
  name,
  imageUrl,
  size = 28,
}: {
  name: string
  imageUrl: string | null
  size?: number
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className='rounded-full'
        style={{ width: size, height: size }}
      />
    )
  }
  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div
      className='rounded-full bg-muted flex items-center justify-content font-medium text-muted-foreground'
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {initials}
    </div>
  )
}

export function ShareDialog({
  open,
  onOpenChange,
  documentId,
  documentTitle,
  documentEmoji,
  visibility,
  publicToken,
  shares,
  owner,
  members,
  currentMemberId,
  onSharesChange,
  onVisibilityChange,
  onPublicTokenChange,
}: ShareDialogProps) {
  const intl = useIntl()
  const [searchQuery, setSearchQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<DocShareRole>('EDITOR')
  const [copied, setCopied] = useState(false)

  // Filter members: exclude owner and already-shared members
  const sharedMemberIds = useMemo(
    () => new Set([owner.id, ...shares.map(s => s.memberId)]),
    [owner.id, shares]
  )
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return members.filter(
      m =>
        !sharedMemberIds.has(m.id) &&
        (m.name.toLowerCase().includes(q) ||
          (m.email && m.email.toLowerCase().includes(q)))
    )
  }, [members, searchQuery, sharedMemberIds])

  // Invite a member
  const handleInvite = useCallback(
    (memberId: string) => {
      const member = members.find(m => m.id === memberId)
      if (!member) return

      // Optimistic: add to shares list
      const optimisticShare: ApiDocumentShare = {
        id: `temp-${crypto.randomUUID()}`,
        memberId: member.id,
        member: {
          id: member.id,
          name: member.name,
          imageUrl: member.imageUrl,
        },
        role: inviteRole,
        createdAt: new Date().toISOString(),
      }
      const newShares = [...shares, optimisticShare]
      onSharesChange(newShares)
      if (visibility === 'PRIVATE') {
        onVisibilityChange('SHARED')
      }
      setSearchQuery('')

      // Background: POST to API
      fetch(API.documents.shares(documentId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, role: inviteRole }),
      })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data?.share) {
            // Replace temp share with real one
            onSharesChange(
              newShares.map(s =>
                s.id === optimisticShare.id ? data.share : s
              )
            )
          }
        })
    },
    [
      members,
      shares,
      inviteRole,
      visibility,
      documentId,
      onSharesChange,
      onVisibilityChange,
    ]
  )

  // Change share role
  const handleRoleChange = useCallback(
    (shareId: string, newRole: string) => {
      if (newRole === 'REMOVE') {
        // Remove the share
        const share = shares.find(s => s.id === shareId)
        const newShares = shares.filter(s => s.id !== shareId)
        onSharesChange(newShares)

        // If last share removed, downgrade to PRIVATE
        if (newShares.length === 0) {
          onVisibilityChange('PRIVATE')
          fetch(API.documents.byId(documentId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visibility: 'PRIVATE' }),
          })
        }

        // If removing self, close dialog
        if (share?.memberId === currentMemberId) {
          onOpenChange(false)
        }

        fetch(API.documents.shareById(documentId, shareId), {
          method: 'DELETE',
        })
        return
      }

      // Update role
      onSharesChange(
        shares.map(s =>
          s.id === shareId ? { ...s, role: newRole as DocShareRole } : s
        )
      )
      fetch(API.documents.shareById(documentId, shareId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
    },
    [shares, documentId, currentMemberId, onSharesChange, onVisibilityChange, onOpenChange]
  )

  // Toggle public link
  const handleTogglePublicLink = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 21)
        onPublicTokenChange(token)
        fetch(API.documents.byId(documentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken: token }),
        })
      } else {
        onPublicTokenChange(null)
        fetch(API.documents.byId(documentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken: null }),
        })
      }
    },
    [documentId, onPublicTokenChange]
  )

  // Copy public link
  const handleCopyLink = useCallback(() => {
    if (!publicToken) return
    const url = `${window.location.origin}/share/${publicToken}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [publicToken])

  const roleLabel = (role: string) => {
    switch (role) {
      case 'VIEWER':
        return intl.formatMessage({ id: 'share.viewer', defaultMessage: 'Can view' })
      case 'EDITOR':
        return intl.formatMessage({ id: 'share.editor', defaultMessage: 'Can edit' })
      case 'MANAGER':
        return intl.formatMessage({ id: 'share.manager', defaultMessage: 'Manager' })
      default:
        return role
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'share.title', defaultMessage: 'Share document' })}
          </DialogTitle>
          <p className='text-sm text-muted-foreground'>
            {documentEmoji ? `${documentEmoji} ` : ''}
            {documentTitle || 'Untitled'}
          </p>
        </DialogHeader>

        {/* Invite section */}
        <div className='relative'>
          <div className='flex gap-2'>
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'share.searchPlaceholder',
                defaultMessage: 'Search members...',
              })}
              className='flex-1 h-9 text-sm'
            />
            <Select
              value={inviteRole}
              onValueChange={v => setInviteRole(v as DocShareRole)}
            >
              <SelectTrigger className='w-24 h-9 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='VIEWER'>{roleLabel('VIEWER')}</SelectItem>
                <SelectItem value='EDITOR'>{roleLabel('EDITOR')}</SelectItem>
                <SelectItem value='MANAGER'>{roleLabel('MANAGER')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search results dropdown */}
          {filteredMembers.length > 0 && (
            <div className='absolute left-0 right-0 top-full mt-1 bg-popover border rounded-md shadow-md z-50 max-h-40 overflow-y-auto'>
              {filteredMembers.map(m => (
                <button
                  key={m.id}
                  type='button'
                  className='flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-left'
                  onClick={() => handleInvite(m.id)}
                >
                  <MemberAvatar
                    name={m.name}
                    imageUrl={m.imageUrl}
                    size={24}
                  />
                  <div className='flex-1 truncate'>
                    <span className='font-medium'>{m.name}</span>
                    {m.email && (
                      <span className='text-muted-foreground ml-2'>
                        {m.email}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Current shares */}
        <div className='space-y-1'>
          <div className='text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'share.sharedWith', defaultMessage: 'Shared with' })}
          </div>

          {/* Owner row */}
          <div className='flex items-center gap-2.5 py-1.5'>
            <MemberAvatar name={owner.name} imageUrl={owner.imageUrl} />
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-medium truncate'>{owner.name}</div>
              <div className='text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'share.creator', defaultMessage: 'Creator' })}
              </div>
            </div>
            <span className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'share.owner', defaultMessage: 'Owner' })}
            </span>
          </div>

          {/* Share rows */}
          {shares.map(share => (
            <div key={share.id} className='flex items-center gap-2.5 py-1.5'>
              <MemberAvatar
                name={share.member.name}
                imageUrl={share.member.imageUrl}
              />
              <div className='flex-1 min-w-0'>
                <div className='text-sm font-medium truncate'>
                  {share.member.name}
                </div>
              </div>
              <Select
                value={share.role}
                onValueChange={v => handleRoleChange(share.id, v)}
              >
                <SelectTrigger className='w-24 h-7 text-xs border-none shadow-none'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='VIEWER'>
                    {roleLabel('VIEWER')}
                  </SelectItem>
                  <SelectItem value='EDITOR'>
                    {roleLabel('EDITOR')}
                  </SelectItem>
                  <SelectItem value='MANAGER'>
                    {roleLabel('MANAGER')}
                  </SelectItem>
                  <SelectSeparator />
                  <SelectItem
                    value='REMOVE'
                    className='text-destructive focus:text-destructive'
                  >
                    {intl.formatMessage({ id: 'share.remove', defaultMessage: 'Remove' })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {/* Public link section */}
        <div className='border-t pt-3 space-y-2'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm font-medium flex items-center gap-1.5'>
                <Globe size={14} />
                {intl.formatMessage({ id: 'share.publicLink', defaultMessage: 'Public link' })}
              </div>
              <div className='text-xs text-muted-foreground'>
                {intl.formatMessage({
                  id: 'share.publicLinkDesc',
                  defaultMessage: 'Anyone with the link can view',
                })}
              </div>
            </div>
            <Switch
              checked={!!publicToken}
              onCheckedChange={handleTogglePublicLink}
            />
          </div>

          {publicToken && (
            <div className='flex gap-2'>
              <Input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/share/${publicToken}`}
                className='flex-1 h-8 text-xs bg-muted'
              />
              <Button
                variant='outline'
                size='sm'
                className='h-8 gap-1'
                onClick={handleCopyLink}
              >
                {copied ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
                {copied
                  ? intl.formatMessage({ id: 'share.copied', defaultMessage: 'Copied' })
                  : intl.formatMessage({ id: 'share.copyLink', defaultMessage: 'Copy link' })}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx" lib/i18n/zh.json lib/i18n/en.json
git commit -m "feat: add ShareDialog component with member invites and public link [LUM-16]"
```

---

### Task 4: Integrate into DocumentEditorPage

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

- [ ] **Step 1: Add members and currentMemberId props to DocumentEditorPage**

In `DocumentEditorPage.tsx`, update the props interface:

```typescript
import type { WorkspaceMemberInfo } from '../../types'

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onTitleChanged?: (id: string, title: string) => void
  members: WorkspaceMemberInfo[]
  currentMemberId: string | undefined
}
```

Add `members` and `currentMemberId` to the destructured props.

- [ ] **Step 2: Add share dialog state and imports**

Add imports at the top of DocumentEditorPage:

```typescript
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShareDialog } from '../document/ShareDialog'
```

Add state inside the component (after the `saveTimer` ref):

```typescript
const [shareDialogOpen, setShareDialogOpen] = useState(false)
```

- [ ] **Step 3: Add share button and visibility badge to the layout**

Replace the current breadcrumb and metadata section in the return JSX. The breadcrumb gets wrapped in a flex row with the share button on the right:

Replace this section (lines 194-224):

```typescript
<DocumentBreadcrumb
  ancestors={ancestors}
  current={{
    id: doc.id,
    title: title || doc.title,
    emoji: doc.emoji,
  }}
  onNavigate={id => {
    if (id) onNavigateToDocument(id)
    else onNavigateToDocuments()
  }}
/>

{/* Emoji + Title */}
<div className='flex items-start gap-3 mb-4'>
```

With:

```typescript
{/* Top bar: breadcrumb + share button */}
<div className='flex items-center justify-between mb-4'>
  <DocumentBreadcrumb
    ancestors={ancestors}
    current={{
      id: doc.id,
      title: title || doc.title,
      emoji: doc.emoji,
    }}
    onNavigate={id => {
      if (id) onNavigateToDocument(id)
      else onNavigateToDocuments()
    }}
  />
  <Button
    size='sm'
    className='gap-1.5 h-8'
    onClick={() => setShareDialogOpen(true)}
  >
    <Link2 size={14} />
    {intl.formatMessage({ id: 'share.button', defaultMessage: 'Share' })}
  </Button>
</div>

{/* Emoji + Title */}
<div className='flex items-start gap-3 mb-4'>
```

Replace the metadata visibility text:

```typescript
<span>{doc.visibility}</span>
```

With a clickable badge:

```typescript
<button
  type='button'
  className='bg-muted rounded px-2 py-0.5 hover:bg-muted/80 transition-colors'
  onClick={() => setShareDialogOpen(true)}
>
  {doc.visibility}
</button>
```

- [ ] **Step 4: Add ShareDialog and handlers**

Add callbacks for the ShareDialog just before the return statement (after `getSaveStatusText`):

```typescript
const handleSharesChange = useCallback((newShares: ApiDocumentShare[]) => {
  setDoc(prev => (prev ? { ...prev, shares: newShares } : prev))
}, [])

const handleVisibilityChange = useCallback((newVisibility: DocVisibility) => {
  setDoc(prev => (prev ? { ...prev, visibility: newVisibility } : prev))
}, [])

const handlePublicTokenChange = useCallback((token: string | null) => {
  setDoc(prev => (prev ? { ...prev, publicToken: token } : prev))
}, [])
```

Add the necessary type imports at the top:

```typescript
import type {
  ApiDocumentDetail,
  ApiDocumentAncestor,
  ApiDocumentShare,
  DocVisibility,
  WorkspaceMemberInfo,
} from '../../types'
```

Add the ShareDialog JSX right before the closing `</div>` of the component (after the editor `</div>`):

```typescript
{/* Share Dialog */}
<ShareDialog
  open={shareDialogOpen}
  onOpenChange={setShareDialogOpen}
  documentId={doc.id}
  documentTitle={title || doc.title}
  documentEmoji={doc.emoji}
  visibility={doc.visibility}
  publicToken={doc.publicToken}
  shares={doc.shares}
  owner={doc.createdBy}
  members={members}
  currentMemberId={currentMemberId}
  onSharesChange={handleSharesChange}
  onVisibilityChange={handleVisibilityChange}
  onPublicTokenChange={handlePublicTokenChange}
/>
```

- [ ] **Step 5: Pass members to DocumentEditorPage from WorkspaceApp**

In `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`, find the `document-editor` case where `DocumentEditorPage` is rendered. Add the `members` and `currentMemberId` props:

```typescript
<DocumentEditorPage
  documentId={selectedDocumentId}
  onNavigateToDocument={navigateToDocument}
  onNavigateToDocuments={() => {
    setCurrentPage('documents')
    window.history.pushState(
      null,
      '',
      `/workspace/${workspaceUrl}/documents`
    )
  }}
  onTitleChanged={(id, title) => docTree.renameNode(id, title)}
  members={members}
  currentMemberId={currentMemberId}
/>
```

Also add a `fetchMembers()` call when navigating to document-editor page. Find the page-change side effects `useEffect` and add:

```typescript
if (currentPage === 'document-editor') fetchMembers()
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx" "app/workspace/[workspaceUrl]/WorkspaceApp.tsx"
git commit -m "feat: integrate ShareDialog into DocumentEditorPage with share button and visibility badge [LUM-16]"
```

---

### Task 5: Public document page

**Files:**

- Create: `app/share/[token]/page.tsx`

- [ ] **Step 1: Create the public document page**

Create `app/share/[token]/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function PublicDocumentPage({ params }: PageProps) {
  const { token } = await params

  const document = await prisma.document.findUnique({
    where: { publicToken: token },
    select: {
      title: true,
      emoji: true,
      content: true,
    },
  })

  if (!document) {
    notFound()
  }

  return (
    <div className='min-h-screen bg-background'>
      <div className='max-w-3xl mx-auto px-8 py-12'>
        <h1 className='text-3xl font-bold mb-8'>
          {document.emoji ? `${document.emoji} ` : ''}
          {document.title || 'Untitled'}
        </h1>
        {document.content ? (
          <div
            className='prose prose-sm dark:prose-invert max-w-none'
            dangerouslySetInnerHTML={{ __html: document.content }}
          />
        ) : (
          <p className='text-muted-foreground'>No content</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the page works**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/share/[token]/page.tsx"
git commit -m "feat: add public document page at /share/[token] [LUM-16]"
```

---

### Task 6: Final cleanup and verification

- [ ] **Step 1: Check for unused imports**

Search for any unused imports of old types or components. Remove them.

- [ ] **Step 2: Full TypeScript check**

Run: `source ~/.nvm/nvm.sh && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Manual smoke test**

Verify in browser:

1. Document editor shows blue "分享" button to the right of the breadcrumb
2. Clicking "分享" opens the share dialog
3. Clicking the visibility badge (PRIVATE/SHARED/etc) also opens the share dialog
4. Search filters workspace members by name
5. Clicking a search result adds them with the selected role
6. Visibility auto-updates from PRIVATE to SHARED when first share is added
7. Role dropdown on shared members works (change role, remove)
8. Removing last share downgrades visibility to PRIVATE
9. Toggle "Public link" on: generates link, copy button works
10. Toggle "Public link" off: hides link
11. Open public link in incognito: shows read-only document content
12. Invalid public link token: shows 404

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: cleanup and finalize document sharing [LUM-16]"
```
