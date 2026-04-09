# Tag Management Settings Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-level Tag Management page at Settings → Tags where admins can view, create, edit (name + color), and delete tags with usage counts.

**Architecture:** Extend existing tag backend (repository → service → API) to include usage counts. Add a new settings page component following the MembersPage pattern — thin `page.tsx` wrapper + `TagsSettingsPage` client component with Dialog-based create/edit forms and AlertDialog delete confirmation.

**Tech Stack:** Next.js App Router, React, shadcn/ui (Dialog, AlertDialog, Select), Tailwind CSS, react-intl, lucide-react, existing `tagsClient` API client.

---

### Task 1: Backend — Add usage counts to tag list API

**Files:**

- Modify: `lib/repositories/tag.repository.ts:5-9` (findByWorkspace)
- Modify: `lib/services/tag.service.ts:14-17` (listTags)
- Modify: `app/api/tags/route.ts:18` (GET handler response mapping)

- [ ] **Step 1: Update repository to include `_count`**

In `lib/repositories/tag.repository.ts`, update `findByWorkspace`:

```typescript
async findByWorkspace(workspaceId: string) {
  return prisma.tag.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { taskTags: true, documentTags: true } },
    },
  })
},
```

- [ ] **Step 2: Map counts in the API route**

In `app/api/tags/route.ts`, update the GET handler to map the counts into flat fields:

```typescript
export async function GET(_request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const raw = await tagService.listTags(ws.workspaceId)
  const tags = raw.map(t => ({
    id: t.id,
    name: t.name,
    color: t.color,
    workspaceId: t.workspaceId,
    createdAt: t.createdAt,
    taskCount: t._count.taskTags,
    documentCount: t._count.documentTags,
  }))
  return NextResponse.json({ tags })
}
```

- [ ] **Step 3: Add `ApiTagWithCounts` type**

In `app/workspace/[workspaceUrl]/types.ts`, after the `ApiTag` interface, add:

```typescript
export interface ApiTagWithCounts extends ApiTag {
  taskCount: number
  documentCount: number
}
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/tag.repository.ts app/api/tags/route.ts app/workspace/\[workspaceUrl\]/types.ts
git commit -m "feat: add usage counts to tag list API [LUM-0]"
```

---

### Task 2: Frontend — Tags settings page + navigation

**Files:**

- Create: `app/workspace/[workspaceUrl]/settings/tags/page.tsx`
- Create: `app/workspace/[workspaceUrl]/components/pages/TagsSettingsPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx:33-48` (add Tags nav item)
- Modify: `lib/i18n/en.json` (add settings.tags + tag management i18n keys)
- Modify: `lib/i18n/zh.json` (add settings.tags + tag management i18n keys)

- [ ] **Step 1: Add i18n keys**

In `lib/i18n/en.json`, add after `"settings.integrations"`:

```json
"settings.tags": "Tags",
"settings.tags.title": "Tags",
"settings.tags.description": "Manage workspace tags used across tasks and documents.",
"settings.tags.empty": "No tags yet",
"settings.tags.emptyDescription": "Create tags to organize your tasks and documents.",
"settings.tags.createTag": "Create Tag",
"settings.tags.editTag": "Edit Tag",
"settings.tags.deleteTag": "Delete Tag",
"settings.tags.deleteConfirm": "This tag will be removed from {taskCount} {taskCount, plural, one {task} other {tasks}} and {docCount} {docCount, plural, one {document} other {documents}}. This cannot be undone.",
"settings.tags.name": "Name",
"settings.tags.color": "Color",
"settings.tags.usage": "Usage",
"settings.tags.custom": "Custom",
"settings.tags.namePlaceholder": "Tag name",
"settings.tags.tasks": "{count} {count, plural, one {task} other {tasks}}",
"settings.tags.docs": "{count} {count, plural, one {doc} other {docs}}",
"settings.tags.duplicateError": "A tag with this name already exists",
```

In `lib/i18n/zh.json`, add after `"settings.integrations"`:

```json
"settings.tags": "标签",
"settings.tags.title": "标签",
"settings.tags.description": "管理工作区中用于任务和文档的标签。",
"settings.tags.empty": "暂无标签",
"settings.tags.emptyDescription": "创建标签来整理你的任务和文档。",
"settings.tags.createTag": "创建标签",
"settings.tags.editTag": "编辑标签",
"settings.tags.deleteTag": "删除标签",
"settings.tags.deleteConfirm": "此标签将从 {taskCount} 个任务和 {docCount} 个文档中移除，此操作不可撤销。",
"settings.tags.name": "名称",
"settings.tags.color": "颜色",
"settings.tags.usage": "使用情况",
"settings.tags.custom": "自定义",
"settings.tags.namePlaceholder": "标签名称",
"settings.tags.tasks": "{count} 个任务",
"settings.tags.docs": "{count} 个文档",
"settings.tags.duplicateError": "已存在同名标签",
```

- [ ] **Step 2: Add Tags nav item to SettingsShell**

In `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`:

Add `Tag` to the lucide-react import:

```typescript
import {
  ArrowLeft,
  Building2,
  Users,
  Puzzle,
  KeyRound,
  User,
  Settings2,
  Bell,
  Tag,
} from 'lucide-react'
```

Add a new item to `adminItems` after Integrations:

```typescript
{
  label: intl.formatMessage({ id: 'settings.tags' }),
  href: `/workspace/${workspaceUrl}/settings/tags`,
  icon: Tag,
},
```

Also add the same item to `memberItems` after Integrations (tags are useful for all members).

- [ ] **Step 3: Create `TagsSettingsPage` component**

Create `app/workspace/[workspaceUrl]/components/pages/TagsSettingsPage.tsx`:

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Plus, Pencil, Trash2, Tag as TagIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { tagsClient } from '@/lib/api-client'
import type { ApiTagWithCounts } from '../../types'
import { TagBadgeNew } from '../document/TagPicker'

// ── Color presets (reuse the text colors from TagPicker DEFAULT_COLORS) ───
const PRESET_COLORS = [
  '#1d4ed8', // blue
  '#166534', // green
  '#92400e', // amber
  '#3730a3', // indigo
  '#9d174d', // pink
  '#9a3412', // orange
  '#115e59', // teal
  '#991b1b', // red
]

interface TagFormState {
  name: string
  color: string | null
}

export function TagsSettingsPage() {
  const intl = useIntl()
  const [tags, setTags] = useState<ApiTagWithCounts[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<ApiTagWithCounts | null>(null)
  const [form, setForm] = useState<TagFormState>({ name: '', color: null })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete state
  const [deleteTag, setDeleteTag] = useState<ApiTagWithCounts | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchTags = useCallback(async () => {
    try {
      const data = await tagsClient.list<{ tags: ApiTagWithCounts[] }>()
      setTags(data.tags)
    } catch {
      // silently handle
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  // ── Create / Edit ──────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingTag(null)
    setForm({ name: '', color: null })
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (tag: ApiTagWithCounts) => {
    setEditingTag(tag)
    setForm({ name: tag.name, color: tag.color })
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const trimmed = form.name.trim()
    if (!trimmed) return
    setSaving(true)
    setFormError(null)
    try {
      if (editingTag) {
        const data = await tagsClient.update<{ tag: ApiTagWithCounts }>(
          editingTag.id,
          { name: trimmed, color: form.color }
        )
        setTags(prev => prev.map(t => (t.id === editingTag.id ? data.tag : t)))
      } else {
        const data = await tagsClient.create<{ tag: ApiTagWithCounts }>({
          name: trimmed,
          color: form.color ?? undefined,
        })
        setTags(prev =>
          [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name))
        )
      }
      setDialogOpen(false)
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setFormError(intl.formatMessage({ id: 'settings.tags.duplicateError' }))
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTag) return
    setDeleting(true)
    try {
      await tagsClient.delete(deleteTag.id)
      setTags(prev => prev.filter(t => t.id !== deleteTag.id))
      setDeleteTag(null)
    } catch {
      // silently handle
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className='max-w-2xl mx-auto px-8 py-10'>
      {/* Header */}
      <div className='flex items-center justify-between mb-1'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100'>
          {intl.formatMessage({ id: 'settings.tags.title' })}
        </h1>
        <Button size='sm' className='gap-1.5' onClick={openCreate}>
          <Plus size={14} />
          {intl.formatMessage({ id: 'settings.tags.createTag' })}
        </Button>
      </div>
      <p className='text-sm text-muted-foreground mb-6'>
        {intl.formatMessage({ id: 'settings.tags.description' })}
      </p>

      {/* List */}
      {loading ? (
        <div className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </div>
      ) : tags.length === 0 ? (
        <div className='text-center py-12'>
          <TagIcon
            size={32}
            className='mx-auto mb-3 text-zinc-300 dark:text-zinc-600'
          />
          <p className='text-sm font-medium text-zinc-500'>
            {intl.formatMessage({ id: 'settings.tags.empty' })}
          </p>
          <p className='text-xs text-muted-foreground mt-1'>
            {intl.formatMessage({ id: 'settings.tags.emptyDescription' })}
          </p>
        </div>
      ) : (
        <div className='border rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800 border-zinc-200 dark:border-zinc-800'>
          {tags.map(tag => (
            <div
              key={tag.id}
              className='flex items-center gap-3 px-4 py-3 group'
            >
              <TagBadgeNew tag={tag} />
              <span className='flex-1' />
              <span className='text-xs text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'settings.tags.tasks' },
                  { count: tag.taskCount }
                )}
                {' · '}
                {intl.formatMessage(
                  { id: 'settings.tags.docs' },
                  { count: tag.documentCount }
                )}
              </span>
              <button
                onClick={() => openEdit(tag)}
                className='opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-all'
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setDeleteTag(tag)}
                className='opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-red-500 transition-all'
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>
              {editingTag
                ? intl.formatMessage({ id: 'settings.tags.editTag' })
                : intl.formatMessage({ id: 'settings.tags.createTag' })}
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-4 py-2'>
            {/* Name */}
            <div>
              <label className='text-xs font-medium text-zinc-500 mb-1.5 block'>
                {intl.formatMessage({ id: 'settings.tags.name' })}
              </label>
              <Input
                value={form.name}
                onChange={e => {
                  setForm(prev => ({ ...prev, name: e.target.value }))
                  setFormError(null)
                }}
                placeholder={intl.formatMessage({
                  id: 'settings.tags.namePlaceholder',
                })}
                maxLength={30}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSave()
                  }
                }}
              />
              {formError && (
                <p className='text-xs text-destructive mt-1'>{formError}</p>
              )}
            </div>
            {/* Color */}
            <div>
              <label className='text-xs font-medium text-zinc-500 mb-1.5 block'>
                {intl.formatMessage({ id: 'settings.tags.color' })}
              </label>
              <div className='flex items-center gap-2 flex-wrap'>
                {/* No color (auto) */}
                <button
                  onClick={() => setForm(prev => ({ ...prev, color: null }))}
                  className={`size-6 rounded-full border-2 transition-all ${
                    form.color === null
                      ? 'border-zinc-900 dark:border-zinc-100 scale-110'
                      : 'border-zinc-200 dark:border-zinc-700'
                  } bg-gradient-to-br from-zinc-200 to-zinc-400 dark:from-zinc-600 dark:to-zinc-400`}
                  title='Auto'
                />
                {/* Presets */}
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setForm(prev => ({ ...prev, color: c }))}
                    className={`size-6 rounded-full border-2 transition-all ${
                      form.color === c
                        ? 'border-zinc-900 dark:border-zinc-100 scale-110'
                        : 'border-zinc-200 dark:border-zinc-700'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              {/* Custom hex input */}
              <div className='flex items-center gap-2 mt-2'>
                <span className='text-xs text-muted-foreground'>
                  {intl.formatMessage({ id: 'settings.tags.custom' })}:
                </span>
                <Input
                  value={form.color ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    setForm(prev => ({
                      ...prev,
                      color: v || null,
                    }))
                  }}
                  placeholder='#3730a3'
                  className='w-28 h-7 text-xs font-mono'
                  maxLength={7}
                />
                {form.color && (
                  <span
                    className='size-5 rounded border border-zinc-200 dark:border-zinc-700 shrink-0'
                    style={{ backgroundColor: form.color }}
                  />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || saving}
              size='sm'
            >
              {saving
                ? intl.formatMessage({ id: 'common.saving' })
                : editingTag
                  ? intl.formatMessage({ id: 'common.save' })
                  : intl.formatMessage({ id: 'common.create' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteTag !== null}
        onOpenChange={open => {
          if (!open) setDeleteTag(null)
        }}
      >
        <AlertDialogContent className='max-w-sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'settings.tags.deleteTag' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTag &&
                intl.formatMessage(
                  { id: 'settings.tags.deleteConfirm' },
                  {
                    taskCount: deleteTag.taskCount,
                    docCount: deleteTag.documentCount,
                  }
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting
                ? intl.formatMessage({ id: 'common.deleting' })
                : intl.formatMessage({ id: 'common.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 4: Create the page wrapper**

Create `app/workspace/[workspaceUrl]/settings/tags/page.tsx`:

```tsx
import { TagsSettingsPage } from '../../components/pages/TagsSettingsPage'

export default function TagsPage() {
  return <TagsSettingsPage />
}
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/settings/tags/page.tsx \
  app/workspace/\[workspaceUrl\]/components/pages/TagsSettingsPage.tsx \
  app/workspace/\[workspaceUrl\]/settings/SettingsShell.tsx \
  lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: add tag management settings page [LUM-0]"
```
