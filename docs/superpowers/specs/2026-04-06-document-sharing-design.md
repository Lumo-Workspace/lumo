# Document Sharing — Design Spec

## Overview

Add a sharing UI to the document editor: member-based sharing with role control (VIEWER/EDITOR/MANAGER), and public link sharing (read-only). The backend API already exists — this spec covers the frontend UI, the public access page, and the `publicToken` field addition.

## Entry Points

### Top Bar Share Button

A blue "分享" button in the document editor top bar, positioned to the right of the breadcrumb. Clicking opens the share dialog.

```
┌─────────────────────────────────────────────────────────┐
│ 文档 > 项目计划 > Q2 目标          PRIVATE  [🔗 分享]  │
├─────────────────────────────────────────────────────────┤
│ 📝 Q2 目标                                              │
│ PRIVATE · 已保存                                        │
│                                                          │
│ Content...                                               │
└─────────────────────────────────────────────────────────┘
```

### Metadata Visibility Badge

The existing visibility text (PRIVATE/SHARED/WORKSPACE) in the metadata area becomes a clickable badge. Clicking it opens the same share dialog. Visual treatment: `bg-muted rounded px-2 py-0.5 cursor-pointer hover:bg-muted/80`.

## Share Dialog

Centered modal dialog (shadcn `Dialog`, `sm:max-w-md`). Three sections:

### 1. Invite Members

```
┌──────────────────────────────────────────┐
│ 分享文档                                  │
│ 📝 Q2 目标                               │
├──────────────────────────────────────────┤
│ [搜索成员...        ] [可编辑 ▼] [邀请]  │
├──────────────────────────────────────────┤
│ 已分享                                    │
│ 🟦 Chao Li          创建者      所有者   │
│ 🟨 Zhang Wei        zhang@...   编辑 ▼   │
│                                  移除     │
├──────────────────────────────────────────┤
│ 🌐 公开链接                              │
│ 任何人可通过链接查看            [关/开]   │
│ https://...token...       [复制链接]      │
└──────────────────────────────────────────┘
```

**Search input:** Text input that filters workspace members by name. Displays a dropdown of matching members below the input. Selecting a member fills the input; user picks a role from the dropdown and clicks "邀请".

**Role selector:** Dropdown with options: 可查看 (VIEWER), 可编辑 (EDITOR), 管理者 (MANAGER). Default: EDITOR.

**Invite button:** Calls `POST /api/documents/[id]/shares` with `{ memberId, role }`. Optimistically adds the member to the list. The API auto-upgrades visibility from PRIVATE to SHARED.

### 2. Current Shares List

Shows all current shares plus the document owner.

- **Owner row:** Avatar + name + "创建者" subtitle + "所有者" label (not editable)
- **Share rows:** Avatar + name + email/subtitle + role dropdown. Dropdown includes the three roles plus "移除" option (red text, separated by divider).
- **Role change:** Calls `PATCH /api/documents/[id]/shares/[shareId]` with `{ role }`. Optimistic update.
- **Remove:** Calls `DELETE /api/documents/[id]/shares/[shareId]`. Optimistic removal from list. If no shares remain, auto-downgrade visibility back to PRIVATE via `PATCH /api/documents/[id]` with `{ visibility: 'PRIVATE' }`.

### 3. Public Link

- **Toggle switch:** Enables/disables public link sharing.
- **On enable:** Generate a `publicToken` (nanoid, 21 chars), save via `PATCH /api/documents/[id]` with `{ publicToken }`. Show the link `{origin}/share/{token}` and a "复制链接" button.
- **On disable:** Set `publicToken` to `null` via PATCH. Hide the link.
- **Link display:** Only shown when toggle is on. Read-only input with the full URL + copy button.

## Data Model Changes

### Document Model

Add one field to the `Document` model in `prisma/schema.prisma`:

```prisma
publicToken  String?  @unique
```

This is a nullable, unique random string. When non-null, the document is accessible via `/share/[token]`.

### API Changes

#### `PATCH /api/documents/[id]`

Add `publicToken` to the updateDocumentSchema:

```typescript
publicToken: z.string().max(30).nullable().optional(),
```

Only the document owner can set/clear the publicToken (same permission as visibility changes).

#### `GET /api/share/[token]` (new)

Public endpoint — no authentication required.

- Looks up document by `publicToken`
- Returns `{ title, emoji, content }` — minimal fields for read-only display
- Returns 404 if token not found or document deleted
- Does NOT return children, shares, ancestors, or any workspace data

## Public Access Page

### Route

`app/share/[token]/page.tsx` — a Next.js page outside the workspace layout. No sidebar, no navigation, no authentication required.

### Layout

```
┌─────────────────────────────────────────┐
│                                          │
│          📝 Q2 目标                      │
│                                          │
│   第二季度的核心目标是完成以下            │
│   三个方面...                            │
│                                          │
│   • 目标一                               │
│   • 目标二                               │
│                                          │
└─────────────────────────────────────────┘
```

- Centered content, `max-w-3xl mx-auto px-8 py-12`
- Document emoji + title as heading (`text-3xl font-bold`)
- Document content rendered with the same `DescriptionEditor` component in read-only mode (or raw HTML render if simpler)
- No edit controls, no sidebar, no breadcrumb
- If token is invalid: show "Document not found" centered message

## Component Structure

```
DocumentEditorPage
├── ShareButton (top bar, blue button)
├── VisibilityBadge (metadata area, clickable)
└── ShareDialog (centered Dialog)
    ├── MemberSearch (input + dropdown)
    ├── ShareList (current shares + owner)
    │   └── ShareRow (avatar + name + role dropdown)
    └── PublicLinkToggle (switch + link + copy)

app/share/[token]/page.tsx (standalone)
└── PublicDocumentView (read-only content)
```

### Files to Create/Modify

- **New:** `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx` — the share dialog with all three sections
- **New:** `app/share/[token]/page.tsx` — public access page
- **New:** `app/api/share/[token]/route.ts` — public API endpoint
- **Modify:** `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — add share button in top bar, visibility badge click handler
- **Modify:** `prisma/schema.prisma` — add `publicToken` field to Document
- **Modify:** `lib/validation/schemas.ts` — add `publicToken` to updateDocumentSchema
- **Modify:** `app/api/documents/[id]/route.ts` — allow updating `publicToken` (owner only)
- **Modify:** `app/workspace/[workspaceUrl]/types.ts` — add `publicToken` to ApiDocumentDetail

## Members Data

The share dialog needs the workspace members list for the search input. Use the existing `useMembers` hook (already used in WorkspaceApp). Pass `members` as a prop to ShareDialog from WorkspaceApp or DocumentEditorPage.

## Optimistic Updates

- **Add share:** Insert into local shares list immediately, POST in background
- **Change role:** Update role in list immediately, PATCH in background
- **Remove share:** Remove from list immediately, DELETE in background. If last share removed, update visibility badge to PRIVATE
- **Toggle public link:** Show/hide link immediately, PATCH publicToken in background

## Edge Cases

- **Owner cannot be removed:** Owner row has no dropdown/remove option, shows "所有者" label
- **Self-remove:** If a non-owner removes their own share, close the dialog (they lose access)
- **Concurrent edits:** Refresh shares list when dialog opens (always fetch fresh data)
- **publicToken collision:** Use nanoid (21 chars) — collision probability is negligible. The unique constraint in DB handles the edge case.
