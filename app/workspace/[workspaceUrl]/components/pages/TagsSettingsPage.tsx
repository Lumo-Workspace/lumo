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
import { PRESET_COLORS, CUSTOM_COLOR_PLACEHOLDER } from './tag-color-presets'

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
        setTags(prev =>
          prev.map(t =>
            t.id === editingTag.id
              ? {
                  ...data.tag,
                  taskCount: data.tag.taskCount ?? t.taskCount,
                  documentCount: data.tag.documentCount ?? t.documentCount,
                }
              : t
          )
        )
      } else {
        const data = await tagsClient.create<{ tag: ApiTagWithCounts }>(
          form.color ? { name: trimmed, color: form.color } : { name: trimmed }
        )
        const newTag = {
          ...data.tag,
          taskCount: data.tag.taskCount ?? 0,
          documentCount: data.tag.documentCount ?? 0,
        }
        setTags(prev =>
          [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name))
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
        <h1 className='text-xl font-semibold text-foreground'>
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
          <TagIcon size={32} className='mx-auto mb-3 text-muted-foreground' />
          <p className='text-sm font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'settings.tags.empty' })}
          </p>
          <p className='text-xs text-muted-foreground mt-1'>
            {intl.formatMessage({ id: 'settings.tags.emptyDescription' })}
          </p>
        </div>
      ) : (
        <div className='border rounded-lg divide-y divide-border border-border'>
          {tags.map(tag => (
            <div
              key={tag.id}
              className='flex items-center gap-3 px-4 py-3 group'
            >
              <TagBadgeNew tag={tag} />
              <span className='flex-1' />
              <span className='text-xs text-muted-foreground'>
                {tag.taskCount === 0 && tag.documentCount === 0
                  ? intl.formatMessage({ id: 'settings.tags.unused' })
                  : `${intl.formatMessage(
                      { id: 'settings.tags.tasks' },
                      { count: tag.taskCount }
                    )} · ${intl.formatMessage(
                      { id: 'settings.tags.docs' },
                      { count: tag.documentCount }
                    )}`}
              </span>
              <button
                onClick={() => openEdit(tag)}
                className='opacity-0 group-hover:opacity-100 p-1 rounded-sm text-muted-foreground hover:text-foreground transition-all'
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setDeleteTag(tag)}
                className='opacity-0 group-hover:opacity-100 p-1 rounded-sm text-muted-foreground hover:text-danger-text transition-all'
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
              <label className='text-xs font-medium text-muted-foreground mb-1.5 block'>
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
                <p className='text-xs text-danger-text mt-1'>{formError}</p>
              )}
            </div>
            {/* Color */}
            <div>
              <label className='text-xs font-medium text-muted-foreground mb-1.5 block'>
                {intl.formatMessage({ id: 'settings.tags.color' })}
              </label>
              <div className='flex items-center gap-2 flex-wrap'>
                {/* No color (auto) */}
                <button
                  onClick={() => setForm(prev => ({ ...prev, color: null }))}
                  className={`size-6 rounded-full border-2 transition-all ${
                    form.color === null
                      ? 'border-foreground scale-110'
                      : 'border-border'
                  } bg-gradient-to-br from-muted to-muted-foreground`}
                  title='Auto'
                />
                {/* Presets */}
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setForm(prev => ({ ...prev, color: c }))}
                    className={`size-6 rounded-full border-2 transition-all ${
                      form.color === c
                        ? 'border-foreground scale-110'
                        : 'border-border'
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
                  placeholder={CUSTOM_COLOR_PLACEHOLDER}
                  className='w-28 h-7 text-xs font-mono'
                  maxLength={7}
                />
                {form.color && (
                  <span
                    className='size-5 rounded-sm border border-border shrink-0'
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
              variant='destructive'
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
