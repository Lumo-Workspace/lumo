'use client'

import { useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  ApiClientError,
  taskTemplatesClient,
  type TaskTemplateInput,
  type TaskTemplateItem,
} from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { clampTemplateName, copyTemplateKey } from '@/lib/task-templates/copy'
import { useTaskTemplates } from '../../hooks/useTaskTemplates'

const EMPTY_FORM: TaskTemplateInput = { key: '', name: '', content: '' }

interface TaskTemplatesSettingsPageProps {
  /** OWNER — may create, edit, delete and copy built-ins into the workspace. */
  canManage: boolean
}

/**
 * LUM-970: built-in + workspace task templates. A template is Markdown that
 * pre-fills a new task's description (web picker, `--template <key>`).
 */
export function TaskTemplatesSettingsPage({
  canManage,
}: TaskTemplatesSettingsPageProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const { templates, isLoading } = useTaskTemplates()

  const [editing, setEditing] = useState<TaskTemplateItem | null>(null)
  /** True while the create dialog is pre-filled from a built-in (LUM-972). */
  const [copying, setCopying] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<TaskTemplateInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<TaskTemplateItem | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates() })

  const openCreate = () => {
    setEditing(null)
    setCopying(false)
    setForm(EMPTY_FORM)
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (t: TaskTemplateItem) => {
    setEditing(t)
    setCopying(false)
    setForm({ key: t.key, name: t.name, content: t.content })
    setFormError(null)
    setDialogOpen(true)
  }

  /**
   * LUM-972: pre-fill the create dialog with a snapshot of a built-in in the
   * viewer's locale. Saving goes through the normal create path; the copy is
   * independent of later built-in changes.
   */
  const openCopy = (t: TaskTemplateItem) => {
    setEditing(null)
    setCopying(true)
    setForm({
      key: copyTemplateKey(
        t.key,
        templates.map(x => x.key)
      ),
      name: clampTemplateName(
        intl.formatMessage(
          { id: 'taskTemplate.settings.copyName' },
          { name: t.name }
        )
      ),
      content: t.content,
    })
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setFormError(null)
    try {
      if (editing?.id) await taskTemplatesClient.update(editing.id, form)
      else await taskTemplatesClient.create(form)
      await refresh()
      setDialogOpen(false)
    } catch (err) {
      const status = err instanceof ApiClientError ? err.status : 0
      setFormError(
        intl.formatMessage({
          id:
            status === 409
              ? 'taskTemplate.settings.duplicateKey'
              : status === 400
                ? 'taskTemplate.settings.invalid'
                : 'taskTemplate.settings.saveFailed',
        })
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting?.id) return
    try {
      await taskTemplatesClient.delete(deleting.id)
      await refresh()
    } catch {
      toast.error(
        intl.formatMessage({ id: 'taskTemplate.settings.deleteFailed' })
      )
    } finally {
      setDeleting(null)
    }
  }

  const canSave =
    form.key.trim() !== '' &&
    form.name.trim() !== '' &&
    form.content.trim() !== '' &&
    !saving

  return (
    <div className='max-w-2xl mx-auto px-8 py-10'>
      <div className='flex items-center justify-between mb-1'>
        <h1 className='text-xl font-semibold text-foreground'>
          {intl.formatMessage({ id: 'taskTemplate.settings.title' })}
        </h1>
        {canManage && (
          <Button size='sm' className='gap-1.5' onClick={openCreate}>
            <Plus size={14} />
            {intl.formatMessage({ id: 'taskTemplate.settings.create' })}
          </Button>
        )}
      </div>
      <p className='text-sm text-muted-foreground mb-6'>
        {intl.formatMessage({ id: 'taskTemplate.settings.description' })}
      </p>
      {!canManage && (
        <p className='text-xs text-muted-foreground mb-4'>
          {intl.formatMessage({ id: 'taskTemplate.settings.ownerOnly' })}
        </p>
      )}

      {isLoading ? (
        <div className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </div>
      ) : (
        <div className='border rounded-lg divide-y divide-border border-border'>
          {templates.map(t => (
            <div
              key={t.key}
              className='flex items-start gap-3 px-4 py-3 group'
              data-testid={`task-template-row-${t.key}`}
            >
              <FileText
                size={16}
                className='mt-0.5 shrink-0 text-muted-foreground'
              />
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium text-foreground'>
                    {t.name}
                  </span>
                  <code className='text-xs text-muted-foreground'>{t.key}</code>
                  {t.isSystem && (
                    <Badge variant='secondary'>
                      {intl.formatMessage({
                        id: 'taskTemplate.settings.builtIn',
                      })}
                    </Badge>
                  )}
                </div>
                {t.description && (
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    {t.description}
                  </p>
                )}
              </div>
              {canManage && t.isSystem && (
                <button
                  type='button'
                  aria-label={intl.formatMessage(
                    { id: 'taskTemplate.settings.copy' },
                    { name: t.name }
                  )}
                  title={intl.formatMessage(
                    { id: 'taskTemplate.settings.copy' },
                    { name: t.name }
                  )}
                  onClick={() => openCopy(t)}
                  className='p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors'
                >
                  <Copy size={14} />
                </button>
              )}
              {canManage && !t.isSystem && (
                <>
                  <button
                    type='button'
                    aria-label={intl.formatMessage({ id: 'common.edit' })}
                    onClick={() => openEdit(t)}
                    className='opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-sm text-muted-foreground hover:text-foreground transition-all'
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type='button'
                    aria-label={intl.formatMessage({ id: 'common.delete' })}
                    onClick={() => setDeleting(t)}
                    className='opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-sm text-muted-foreground hover:text-danger-text transition-all'
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className='max-w-lg'
          // Radix focuses the first input on open and the browser selects its
          // whole value, so in copy / edit mode the first keystroke would wipe
          // the pre-filled name. Focus it ourselves with the caret at the end.
          // (jsdom does not reproduce the selection — verified in a real
          // browser; see LUM-711.)
          onOpenAutoFocus={event => {
            const el = nameRef.current
            if (!el) return
            event.preventDefault()
            el.focus()
            el.setSelectionRange(el.value.length, el.value.length)
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({
                id: editing
                  ? 'taskTemplate.settings.edit'
                  : copying
                    ? 'taskTemplate.settings.copyTitle'
                    : 'taskTemplate.settings.create',
              })}
            </DialogTitle>
          </DialogHeader>
          {copying && (
            <p className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'taskTemplate.settings.copyHint' })}
            </p>
          )}
          <div className='space-y-4 py-2'>
            <div>
              <label
                htmlFor='task-template-name'
                className='text-xs font-medium text-muted-foreground mb-1.5 block'
              >
                {intl.formatMessage({ id: 'taskTemplate.settings.name' })}
              </label>
              <Input
                id='task-template-name'
                ref={nameRef}
                value={form.name}
                maxLength={80}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label
                htmlFor='task-template-key'
                className='text-xs font-medium text-muted-foreground mb-1.5 block'
              >
                {intl.formatMessage({ id: 'taskTemplate.settings.key' })}
              </label>
              <Input
                id='task-template-key'
                value={form.key}
                maxLength={40}
                className='font-mono'
                onChange={e =>
                  setForm(f => ({ ...f, key: e.target.value.toLowerCase() }))
                }
              />
              <p className='text-xs text-muted-foreground mt-1'>
                {intl.formatMessage({ id: 'taskTemplate.settings.keyHint' })}
              </p>
            </div>
            <div>
              <label
                htmlFor='task-template-content'
                className='text-xs font-medium text-muted-foreground mb-1.5 block'
              >
                {intl.formatMessage({ id: 'taskTemplate.settings.content' })}
              </label>
              <Textarea
                id='task-template-content'
                value={form.content}
                rows={10}
                className='font-mono text-xs'
                onChange={e =>
                  setForm(f => ({ ...f, content: e.target.value }))
                }
              />
              <p className='text-xs text-muted-foreground mt-1'>
                {intl.formatMessage({
                  id: 'taskTemplate.settings.contentHint',
                })}
              </p>
            </div>
            {formError && (
              <p className='text-xs text-danger-text'>{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button size='sm' onClick={handleSave} disabled={!canSave}>
              {intl.formatMessage({
                id: saving
                  ? 'common.saving'
                  : editing
                    ? 'common.save'
                    : 'common.create',
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={open => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent className='max-w-sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'taskTemplate.settings.deleteTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'taskTemplate.settings.deleteBody' },
                { name: deleting?.name ?? '' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={handleDelete}>
              {intl.formatMessage({ id: 'common.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
