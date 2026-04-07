'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { AnimatePresence } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../Modal'
import { Button } from '@/components/ui/button'
import { PRIORITY_CONFIG } from '../TaskFieldSelects'
import { useQuickDispatch } from '../../hooks/useQuickDispatch'
import type { NewTaskFormData } from './NewTaskModal'
import type { ApiPriority, ApiStatus, WorkspaceMemberInfo } from '../../types'
import { isSubmitShortcut } from '../../utils'

/** Parsed fields passed to the edit callback so NewTaskModal can be pre-filled. */
export interface QuickDispatchParsedFields {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
  dueDate: string | null
}

interface QuickDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  members: WorkspaceMemberInfo[]
  onSubmit: (data: NewTaskFormData) => Promise<void>
  /** Called when user clicks "Edit" — parent should open NewTaskModal with these fields pre-filled. */
  onEdit: (fields: QuickDispatchParsedFields) => void
  onSaveDraft?:
    | ((type: 'TASK', data: Record<string, unknown>) => Promise<void>)
    | undefined
}

export function QuickDispatchModal({
  isOpen,
  onClose,
  members,
  onSubmit,
  onEdit,
  onSaveDraft,
}: QuickDispatchModalProps) {
  const intl = useIntl()
  const { phase, input, setInput, result, error, parse, reset, backToInput } =
    useQuickDispatch()

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const handleSubmit = useCallback(() => {
    if (!result || !result.projectId) return

    const data: NewTaskFormData = {
      title: result.title,
      description: result.description,
      status: result.status as ApiStatus,
      priority: result.priority as ApiPriority,
      projectId: result.projectId,
      assigneeId: result.assigneeActorId ?? '',
      repositoryId: null,
      dueDate: result.dueDate,
    }

    reset()
    onClose()
    onSubmit(data).catch(() => {})
  }, [result, reset, onClose, onSubmit])

  const handleSaveDraft = useCallback(() => {
    if (!result || !onSaveDraft) return

    const formData: Record<string, unknown> = {
      title: result.title,
      description: result.description,
      status: result.status,
      priority: result.priority,
    }
    if (result.projectId) formData.projectId = result.projectId
    if (result.assigneeActorId) formData.assigneeId = result.assigneeActorId
    if (result.dueDate) formData.dueDate = result.dueDate

    reset()
    onClose()
    onSaveDraft('TASK', formData)
      .then(() => toast.success(intl.formatMessage({ id: 'drafts.saved' })))
      .catch(() => toast.error(intl.formatMessage({ id: 'drafts.saveFailed' })))
  }, [result, onSaveDraft, reset, onClose, intl])

  const handleEdit = useCallback(() => {
    if (!result) return

    const fields: QuickDispatchParsedFields = {
      title: result.title,
      description: result.description,
      status: result.status as ApiStatus,
      priority: result.priority as ApiPriority,
      projectId: result.projectId ?? '',
      assigneeId: result.assigneeActorId ?? '',
      dueDate: result.dueDate,
    }

    reset()
    onClose()
    onEdit(fields)
  }, [result, reset, onClose, onEdit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase === 'input' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        parse(input)
      }
      if (phase === 'preview' && isSubmitShortcut(e)) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        if (phase === 'preview') {
          backToInput()
        } else {
          handleClose()
        }
      }
    },
    [phase, input, parse, handleSubmit, backToInput, handleClose]
  )

  const priorityConfig =
    result && result.priority in PRIORITY_CONFIG
      ? PRIORITY_CONFIG[result.priority as ApiPriority]
      : null

  const memberName =
    result?.assigneeName ??
    members.find(m => m.actorId === result?.assigneeActorId)?.name ??
    null

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={intl.formatMessage({ id: 'quickDispatch.title' })}
        expandable={false}
        footer={
          phase === 'preview' ? (
            <div className='flex items-center gap-3 ml-auto'>
              <Button variant='ghost' onClick={backToInput}>
                {intl.formatMessage({ id: 'quickDispatch.back' })}
              </Button>
              <Button variant='outline' onClick={handleEdit}>
                {intl.formatMessage({ id: 'quickDispatch.edit' })}
              </Button>
              {onSaveDraft && (
                <Button variant='outline' onClick={handleSaveDraft}>
                  {intl.formatMessage({ id: 'drafts.saveDraft' })}
                </Button>
              )}
              <Button onClick={handleSubmit} disabled={!result?.projectId}>
                {intl.formatMessage({ id: 'quickDispatch.confirm' })}
              </Button>
            </div>
          ) : undefined
        }
      >
        {() => (
          <div onKeyDown={handleKeyDown}>
            {/* ── Input Phase ──────────────────────────── */}
            {(phase === 'input' || phase === 'loading') && (
              <div className='space-y-3'>
                <div className='relative'>
                  <input
                    autoFocus
                    className='w-full bg-transparent border-none p-0 text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
                    placeholder={intl.formatMessage({
                      id: 'quickDispatch.placeholder',
                    })}
                    type='text'
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={phase === 'loading'}
                  />
                </div>
                {phase === 'loading' && (
                  <div className='flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400'>
                    <Loader2 className='size-4 animate-spin' />
                    {intl.formatMessage({ id: 'quickDispatch.parsing' })}
                  </div>
                )}
                {error && (
                  <div className='rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400'>
                    {error}
                  </div>
                )}
                {result?.titleTooVague && (
                  <div className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
                    {intl.formatMessage({ id: 'quickDispatch.titleVague' })}
                  </div>
                )}
                {result?.missingProject && !result?.titleTooVague && (
                  <div className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
                    {intl.formatMessage({
                      id: 'quickDispatch.missingProject',
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Preview Phase (read-only card) ────────── */}
            {phase === 'preview' && result && (
              <div className='space-y-3'>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldTitle',
                  })}
                >
                  <span className='font-medium text-zinc-900 dark:text-zinc-100'>
                    {result.title}
                  </span>
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldProject',
                  })}
                >
                  <span>{result.projectName ?? '—'}</span>
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldPriority',
                  })}
                >
                  {priorityConfig && (
                    <span className='flex items-center gap-1.5'>
                      <priorityConfig.Icon
                        className={`size-3.5 ${priorityConfig.iconColor}`}
                      />
                      {priorityConfig.label}
                    </span>
                  )}
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldAssignee',
                  })}
                >
                  <span>
                    {memberName ??
                      intl.formatMessage({ id: 'quickDispatch.none' })}
                  </span>
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldDueDate',
                  })}
                >
                  <span>
                    {result.dueDate
                      ? new Date(result.dueDate).toLocaleDateString()
                      : intl.formatMessage({ id: 'quickDispatch.none' })}
                  </span>
                </FieldRow>
                {result.description && (
                  <FieldRow
                    label={intl.formatMessage({
                      id: 'quickDispatch.fieldDescription',
                    })}
                  >
                    <div
                      className='prose prose-sm max-w-none text-zinc-600 dark:prose-invert dark:text-zinc-400'
                      dangerouslySetInnerHTML={{
                        __html: result.description,
                      }}
                    />
                  </FieldRow>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-start gap-3'>
      <span className='w-20 shrink-0 text-sm text-zinc-500 dark:text-zinc-400 pt-0.5'>
        {label}
      </span>
      <div className='flex-1 text-sm text-zinc-700 dark:text-zinc-300'>
        {children}
      </div>
    </div>
  )
}
