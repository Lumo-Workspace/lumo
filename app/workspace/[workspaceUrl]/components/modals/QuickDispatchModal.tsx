'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { AnimatePresence } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../Modal'
import { Button } from '@/components/ui/button'
import {
  StatusSelect,
  ProjectSelect,
  AssigneeSelect,
  PrioritySelect,
  DueDatePicker,
  PRIORITY_CONFIG,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
import { DescriptionEditor } from '../DescriptionEditor'
import { useQuickDispatch } from '../../hooks/useQuickDispatch'
import type { NewTaskFormData } from './NewTaskModal'
import type {
  ApiProject,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { isSubmitShortcut } from '../../utils'

interface QuickDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  projects: ApiProject[]
  members: WorkspaceMemberInfo[]
  onSubmit: (data: NewTaskFormData) => Promise<void>
}

export function QuickDispatchModal({
  isOpen,
  onClose,
  projects,
  members,
  onSubmit,
}: QuickDispatchModalProps) {
  const intl = useIntl()
  const {
    phase,
    input,
    setInput,
    result,
    error,
    parse,
    enterEditMode,
    exitEditMode,
    updateField,
    reset,
    backToInput,
  } = useQuickDispatch()

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
        if (phase === 'editing') {
          exitEditMode()
        } else if (phase === 'preview') {
          backToInput()
        } else {
          handleClose()
        }
      }
    },
    [phase, input, parse, handleSubmit, exitEditMode, backToInput, handleClose]
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
          phase === 'preview' || phase === 'editing' ? (
            <div className='flex items-center gap-3 ml-auto'>
              {phase === 'editing' ? (
                <Button variant='ghost' onClick={exitEditMode}>
                  {intl.formatMessage({ id: 'quickDispatch.back' })}
                </Button>
              ) : (
                <>
                  <Button variant='ghost' onClick={backToInput}>
                    {intl.formatMessage({ id: 'quickDispatch.back' })}
                  </Button>
                  <Button variant='outline' onClick={enterEditMode}>
                    {intl.formatMessage({ id: 'quickDispatch.edit' })}
                  </Button>
                </>
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

            {/* ── Editing Phase ─────────────────────────── */}
            {phase === 'editing' && result && (
              <div className='space-y-4'>
                <input
                  className='w-full bg-transparent border-none p-0 text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
                  type='text'
                  value={result.title}
                  onChange={e => updateField('title', e.target.value)}
                />
                <DescriptionEditor
                  value={result.description || null}
                  onCommit={html => updateField('description', html ?? '')}
                  onChange={html => updateField('description', html ?? '')}
                />
                <div className='flex flex-wrap items-center gap-2 pt-1'>
                  <StatusSelect
                    value={result.status as ApiStatus}
                    onChange={v => updateField('status', v)}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <ProjectSelect
                    value={result.projectId ?? ''}
                    onChange={v => {
                      updateField('projectId', v)
                      const p = projects.find(proj => proj.id === v)
                      updateField('projectName', p?.name ?? null)
                    }}
                    projects={projects}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <AssigneeSelect
                    value={result.assigneeActorId ?? null}
                    onChange={v => {
                      updateField('assigneeActorId', v ?? null)
                      const m = members.find(mem => mem.actorId === v)
                      updateField('assigneeName', m?.name ?? null)
                    }}
                    members={members.filter(
                      (m): m is WorkspaceMemberInfo & { actorId: string } =>
                        m.actorId !== null
                    )}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <PrioritySelect
                    value={result.priority as ApiPriority}
                    onChange={v => updateField('priority', v)}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <DueDatePicker
                    value={result.dueDate}
                    onChange={v => updateField('dueDate', v)}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                </div>
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
