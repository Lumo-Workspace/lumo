'use client'

import { useCallback, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { AnimatePresence } from 'motion/react'
import { Loader2, ArrowRightLeft, Plus, X } from 'lucide-react'
import { Modal } from '../Modal'
import { Button } from '@/components/ui/button'
import { MentionInput } from '../MentionInput'
import { useQuickDispatch } from '../../hooks/useQuickDispatch'
import type { QuickAction } from '@/lib/quick-dispatch/types'
import type { MentionCandidate } from '../MentionInput'
import type { ApiProject, MyTask, WorkspaceMemberInfo } from '../../types'
import { isSubmitShortcut } from '../../utils'

interface QuickDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  myTasks: MyTask[]
  currentActorId: string | null
  onTasksChanged: () => void
}

export function QuickDispatchModal({
  isOpen,
  onClose,
  members,
  projects,
  myTasks,
  currentActorId: _currentActorId,
  onTasksChanged,
}: QuickDispatchModalProps) {
  const intl = useIntl()
  const {
    phase,
    input,
    setInput,
    mentions,
    setMentions,
    actions,
    error,
    parse,
    execute,
    removeAction,
    reset,
    backToInput,
  } = useQuickDispatch()

  // Build autocomplete candidates
  const candidates: MentionCandidate[] = useMemo(() => {
    const taskCandidates: MentionCandidate[] = myTasks.map(t => ({
      type: 'task',
      id: t.id,
      label: `${t.teamIdentifier}-${t.number} ${t.title}`,
      sublabel: t.project?.name,
      identifier: `${t.teamIdentifier}-${t.number}`,
      title: t.title,
    }))
    const projectCandidates: MentionCandidate[] = projects.map(p => ({
      type: 'project',
      id: p.id,
      label: p.name,
      name: p.name,
    }))
    const memberCandidates: MentionCandidate[] = members.map(m => ({
      type: 'member',
      id: m.actorId ?? m.id,
      label: m.name,
      name: m.name,
      actorId: m.actorId ?? m.id,
    }))
    return [...taskCandidates, ...projectCandidates, ...memberCandidates]
  }, [myTasks, projects, members])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const handleExecute = useCallback(async () => {
    const results = await execute()
    if (results) {
      const successCount = results.filter(r => r.success).length
      if (successCount > 0) {
        toast.success(
          intl.formatMessage(
            { id: 'quickDispatch.executed' },
            { count: successCount }
          )
        )
        onTasksChanged()
      }
      const errors = results.filter(r => !r.success)
      for (const err of errors) {
        toast.error(err.message ?? 'Action failed')
      }
      reset()
      onClose()
    }
  }, [execute, intl, onTasksChanged, reset, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase === 'preview' && isSubmitShortcut(e)) {
        e.preventDefault()
        handleExecute()
      }
      if (e.key === 'Escape') {
        if (phase === 'preview') {
          backToInput()
        } else if (phase === 'input') {
          handleClose()
        }
      }
    },
    [phase, handleExecute, backToInput, handleClose]
  )

  const hasCreateWithoutProject = actions.some(
    a => a.type === 'create' && !a.projectId
  )

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
              <Button
                onClick={handleExecute}
                disabled={actions.length === 0 || hasCreateWithoutProject}
              >
                {intl.formatMessage(
                  { id: 'quickDispatch.confirmExecute' },
                  { count: actions.length }
                )}
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
                <MentionInput
                  value={input}
                  onChange={setInput}
                  mentions={mentions}
                  onMentionsChange={setMentions}
                  candidates={candidates}
                  placeholder={intl.formatMessage({
                    id: 'quickDispatch.placeholder',
                  })}
                  disabled={phase === 'loading'}
                  onSubmit={() => parse(input)}
                  autoFocus
                />
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
              </div>
            )}

            {/* ── Preview Phase ──────────────────────────── */}
            {phase === 'preview' && (
              <div className='space-y-2'>
                {actions.map((action, i) => (
                  <ActionRow
                    key={i}
                    action={action}
                    onRemove={() => removeAction(i)}
                  />
                ))}
              </div>
            )}

            {/* ── Executing Phase ──────────────────────────── */}
            {phase === 'executing' && (
              <div className='flex items-center justify-center gap-2 py-8 text-sm text-indigo-600 dark:text-indigo-400'>
                <Loader2 className='size-4 animate-spin' />
                {intl.formatMessage({ id: 'quickDispatch.executing' })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}

function ActionRow({
  action,
  onRemove,
}: {
  action: QuickAction
  onRemove: () => void
}) {
  if (action.type === 'update') {
    return (
      <div className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
        <ArrowRightLeft className='size-4 text-blue-500 shrink-0' />
        <span className='font-mono text-xs text-zinc-500'>
          {action.taskIdentifier}
        </span>
        <span className='truncate font-medium'>{action.taskTitle}</span>
        {action.fields.status && (
          <span className='ml-auto text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800'>
            → {action.fields.status}
          </span>
        )}
        {action.fields.priority && (
          <span className='text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800'>
            {action.fields.priority}
          </span>
        )}
        <button
          onClick={onRemove}
          className='ml-1 p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded'
        >
          <X className='size-3.5 text-zinc-400' />
        </button>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
      <Plus className='size-4 text-green-500 shrink-0' />
      <span className='truncate font-medium'>{action.title}</span>
      {action.projectName && (
        <span className='text-xs text-zinc-500'>{action.projectName}</span>
      )}
      {action.assigneeName && (
        <span className='text-xs text-zinc-500'>@{action.assigneeName}</span>
      )}
      <span className='ml-auto text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800'>
        {action.status}
      </span>
      <button
        onClick={onRemove}
        className='ml-1 p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded'
      >
        <X className='size-3.5 text-zinc-400' />
      </button>
    </div>
  )
}
