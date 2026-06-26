'use client'

import { useState, useEffect, useRef } from 'react'
import { useIntl } from 'react-intl'
import { AnimatePresence } from 'motion/react'
import { useParams } from 'next/navigation'
import { Modal } from '../Modal'
import {
  ApiProject,
  ApiTask,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  SprintSelect,
  AiPrioritySelect,
  DueDatePicker,
  FIELD_TRIGGER_CLS,
} from '../fields'
import { DescriptionEditor } from '../DescriptionEditorLazy'
import { AiDescriptionPrompt } from '../AiDescriptionPrompt'
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck'
import { usePrioritySuggestion } from '../../hooks/usePrioritySuggestion'
import { useFormRecovery } from '../../hooks/useFormRecovery'
import { useMentionSources } from '../../hooks/useMentionSources'
import { FormRecoveryBanner } from '../FormRecoveryBanner'
import { CACHE_KEY } from '../../constants'
import { toast } from 'sonner'
import { DuplicateWarning } from '../DuplicateWarning'
import { DuplicateConfirm, DuplicateMatch } from '../DuplicateConfirm'
import { Loader2 } from 'lucide-react'

// Stable reference for the `tasks` default. Using `tasks = []` as a destructuring
// default creates a new [] every render, which would feed an unstable ref into
// useDuplicateCheck's effect deps and trigger an infinite render loop.
const EMPTY_TASKS: ApiTask[] = []

export interface NewTaskFormData {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
  sprintId: string | null
  dueDate: string | null
  aiSuggestedPriority?: ApiPriority | null
}

/** Pre-filled fields from Quick Dispatch. */
export interface NewTaskPreFill {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
  dueDate: string | null
  sprintId?: string | null
}

interface NewTaskModalProps {
  isOpen: boolean
  onClose: () => void
  projects: ApiProject[]
  members: WorkspaceMemberInfo[]
  defaultProjectId?: string | undefined
  defaultAssigneeId?: string | undefined
  defaultStatus?: ApiStatus | undefined
  /** Pre-selected sprint (e.g. when opening from the Sprint board). */
  defaultSprintId?: string | null | undefined
  /** Team whose sprints are offered in the Sprint picker. Without this the
   *  picker is hidden. */
  sprintTeamId?: string | null | undefined
  /** Pre-filled fields from Quick Dispatch AI parsing. */
  preFill?: NewTaskPreFill | undefined
  /** Parent handles optimistic create + API call. Throw to show error in modal. */
  onSubmit: (data: NewTaskFormData) => Promise<void>
  tasks?: ApiTask[]
  /** When restoring from a DB draft, pass the draft ID so it can be deleted on submit. */
  draftId?: string | undefined
  /** Called when user clicks "Save Draft". */
  onSaveDraft?:
    | ((type: 'TASK', data: Record<string, unknown>) => Promise<void>)
    | undefined
  /** Called to delete a draft after successful submit from a draft. */
  onDeleteDraft?: ((id: string) => Promise<void>) | undefined
}

export function NewTaskModal({
  isOpen,
  onClose,
  projects,
  members,
  defaultProjectId,
  defaultAssigneeId,
  defaultStatus,
  defaultSprintId,
  sprintTeamId,
  preFill,
  onSubmit,
  tasks = EMPTY_TASKS,
  draftId,
  onSaveDraft,
  onDeleteDraft,
}: NewTaskModalProps) {
  const intl = useIntl()
  const mentionSources = useMentionSources(members)
  const [title, setTitle] = useState(preFill?.title ?? '')
  const descriptionRef = useRef<string | null>(preFill?.description ?? null)
  const [descriptionValue, setDescriptionValue] = useState<string | null>(
    preFill?.description ?? null
  )
  const [status, setStatus] = useState<ApiStatus>(
    preFill?.status ?? defaultStatus ?? 'TODO'
  )
  const [priority, setPriority] = useState<ApiPriority>(
    preFill?.priority ?? 'MEDIUM'
  )
  const [projectId, setProjectId] = useState(
    preFill?.projectId ?? defaultProjectId ?? ''
  )
  const [assigneeId, setAssigneeId] = useState(
    preFill?.assigneeId ?? defaultAssigneeId ?? ''
  )
  const [dueDate, setDueDate] = useState<string | null>(
    preFill?.dueDate ?? null
  )
  const [sprintId, setSprintId] = useState<string | null>(
    preFill?.sprintId ?? defaultSprintId ?? null
  )

  // ─── Form recovery (localStorage) ────────────────────────────────────────
  const isFromDraft = !!draftId
  const recovery = useFormRecovery<Record<string, unknown>>({
    cacheKey: CACHE_KEY.formRecoveryNewTask,
    disabled: isFromDraft || !!preFill,
    isEmpty: data => {
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
      return !str(data.title) && !str(data.description)
    },
  })

  // ─── AI priority suggestion ────────────────────────────────────────────
  const [userHasOverriddenPriority, setUserHasOverriddenPriority] =
    useState(false)
  const [overrideRecorded, setOverrideRecorded] = useState(false)
  const aiSuggestedRef = useRef<ApiPriority | null>(null)

  // ─── Duplicate detection ────────────────────────────────────────────────
  type ModalPhase = 'editing' | 'checking' | 'confirming'
  const [phase, setPhase] = useState<ModalPhase>('editing')
  const [aiMatches, setAiMatches] = useState<DuplicateMatch[]>([])
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const effectiveProjectId = projectId || defaultProjectId || ''
  const { clientMatches } = useDuplicateCheck(title, tasks, effectiveProjectId)

  const {
    suggestion: prioritySuggestion,
    isLoading: isPriorityLoading,
    onTitleChange: onTitleChangePriority,
    onDescriptionChange: onDescriptionChangePriority,
    reset: resetPrioritySuggestion,
  } = usePrioritySuggestion({
    projectId: effectiveProjectId,
  })

  // Auto-apply AI suggestion when it arrives
  useEffect(() => {
    if (prioritySuggestion && !userHasOverriddenPriority) {
      setPriority(prioritySuggestion.priority)
      aiSuggestedRef.current = prioritySuggestion.priority
    }
  }, [prioritySuggestion, userHasOverriddenPriority])

  const projectName =
    projects.find(p => p.id === effectiveProjectId)?.name ?? ''

  // Sync defaults when they change (modal may stay mounted between opens)
  useEffect(() => {
    setProjectId(defaultProjectId ?? '')
  }, [defaultProjectId])

  useEffect(() => {
    setAssigneeId(defaultAssigneeId ?? '')
  }, [defaultAssigneeId])

  useEffect(() => {
    if (isOpen) setStatus(defaultStatus ?? 'TODO')
  }, [isOpen, defaultStatus])

  useEffect(() => {
    if (isOpen) setSprintId(defaultSprintId ?? null)
  }, [isOpen, defaultSprintId])

  const reset = () => {
    setTitle('')
    descriptionRef.current = null
    setDescriptionValue(null)
    setStatus(defaultStatus ?? 'TODO')
    setPriority('MEDIUM')
    setProjectId(defaultProjectId ?? '')
    setAssigneeId(defaultAssigneeId ?? '')
    setDueDate(null)
    setSprintId(defaultSprintId ?? null)
    setPhase('editing')
    setAiMatches([])
    setUserHasOverriddenPriority(false)
    setOverrideRecorded(false)
    aiSuggestedRef.current = null
    resetPrioritySuggestion()
  }

  // Auto-save to localStorage on form changes
  const { save: recoverySave } = recovery
  useEffect(() => {
    if (!isOpen) return
    const formData: Record<string, unknown> = {}
    if (title) formData.title = title
    if (descriptionValue) formData.description = descriptionValue
    if (status !== 'TODO') formData.status = status
    if (priority !== 'MEDIUM') formData.priority = priority
    if (projectId) formData.projectId = projectId
    if (assigneeId) formData.assigneeId = assigneeId
    if (dueDate) formData.dueDate = dueDate
    recoverySave(formData)
  }, [
    isOpen,
    title,
    descriptionValue,
    status,
    priority,
    projectId,
    assigneeId,
    dueDate,
    recoverySave,
  ])

  const handleRestore = () => {
    const data = recovery.acceptRecovery()
    if (!data) return
    if (data.title && typeof data.title === 'string') setTitle(data.title)
    if (data.description && typeof data.description === 'string') {
      descriptionRef.current = data.description
      setDescriptionValue(data.description)
    }
    if (data.status) setStatus(data.status as ApiStatus)
    if (data.priority) setPriority(data.priority as ApiPriority)
    if (data.projectId && typeof data.projectId === 'string')
      setProjectId(data.projectId)
    if (data.assigneeId && typeof data.assigneeId === 'string')
      setAssigneeId(data.assigneeId)
    if (data.dueDate && typeof data.dueDate === 'string')
      setDueDate(data.dueDate)
  }

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return
    const formData: Record<string, unknown> = {}
    if (title.trim()) formData.title = title.trim()
    const descText = descriptionRef.current?.replace(/<[^>]*>/g, '').trim()
    if (descText) formData.description = descriptionRef.current
    if (status !== 'TODO') formData.status = status
    if (priority !== 'MEDIUM') formData.priority = priority
    if (effectiveProjectId) formData.projectId = effectiveProjectId
    if (assigneeId) formData.assigneeId = assigneeId
    if (dueDate) formData.dueDate = dueDate
    if (Object.keys(formData).length === 0) return
    try {
      await onSaveDraft('TASK', formData)
      recovery.clear()
      reset()
      onClose()
      toast.success(intl.formatMessage({ id: 'drafts.saved' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'drafts.saveFailed' }))
    }
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handlePriorityChange = (v: ApiPriority) => {
    setPriority(v)
    setUserHasOverriddenPriority(true)
    if (aiSuggestedRef.current && v !== aiSuggestedRef.current) {
      setOverrideRecorded(true)
    }
  }

  const doCreate = () => {
    const data: NewTaskFormData = {
      title: title.trim(),
      description: descriptionRef.current ?? '',
      status,
      priority,
      projectId: effectiveProjectId,
      assigneeId,
      sprintId,
      dueDate,
      aiSuggestedPriority: aiSuggestedRef.current,
    }
    recovery.clear()
    if (draftId && onDeleteDraft) onDeleteDraft(draftId).catch(() => {})
    reset()
    onClose()
    onSubmit(data).catch(console.error)
  }

  const handleSubmit = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle || !effectiveProjectId) return

    // If already confirmed, skip detection
    if (phase === 'confirming') {
      doCreate()
      return
    }

    // Phase 2: AI semantic matching on submit
    setPhase('checking')
    try {
      const data = await apiFetch<{ matches?: DuplicateMatch[] }>(
        '/api/tasks/check-duplicates',
        {
          method: 'POST',
          body: { title: trimmedTitle, projectId: effectiveProjectId },
        }
      )
      const matches: DuplicateMatch[] = data.matches ?? []

      if (matches.length > 0) {
        // Merge with client matches (dedup by taskId, AI score wins)
        const aiIds = new Set(matches.map(m => m.taskId))
        const clientOnly = clientMatches
          .filter(cm => !aiIds.has(cm.task.id))
          .map(cm => ({
            taskId: cm.task.id,
            title: cm.task.title,
            number: cm.task.number,
            teamIdentifier: cm.task.teamIdentifier,
            status: cm.task.status,
            score: cm.score,
            assigneeName: null,
            priority: cm.task.priority,
          }))

        const merged = [...matches, ...clientOnly]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

        setAiMatches(merged)
        setPhase('confirming')
        return
      }
      // No matches → proceed with creation
      doCreate()
    } catch {
      // API error → skip detection, proceed with creation
      doCreate()
    }
  }

  const canSubmit = title.trim().length > 0 && !!(projectId || defaultProjectId)

  const triggerClass = FIELD_TRIGGER_CLS

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={intl.formatMessage({ id: 'newTask.title' })}
        footer={
          phase === 'confirming' ? undefined : (
            <div className='flex items-center gap-3 ml-auto'>
              {onSaveDraft && (
                <Button variant='ghost' onClick={handleSaveDraft}>
                  {intl.formatMessage({ id: 'drafts.saveDraft' })}
                </Button>
              )}
              <Button variant='ghost' onClick={handleClose}>
                {intl.formatMessage({ id: 'newTask.cancel' })}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || phase === 'checking'}
              >
                {phase === 'checking' ? (
                  <>
                    <Loader2 className='size-4 animate-spin mr-1' />
                    {intl.formatMessage({ id: 'newTask.checking' })}
                  </>
                ) : (
                  <>
                    {intl.formatMessage({ id: 'newTask.create' })}{' '}
                    {submitModLabel}↵
                  </>
                )}
              </Button>
            </div>
          )
        }
      >
        {expanded =>
          phase === 'confirming' ? (
            <DuplicateConfirm
              matches={aiMatches}
              projectName={projectName}
              workspaceUrl={workspaceUrl}
              onConfirm={doCreate}
              onCancel={() => setPhase('editing')}
            />
          ) : (
            <div className='space-y-4 h-full flex flex-col'>
              {recovery.recovered && (
                <FormRecoveryBanner
                  onRestore={handleRestore}
                  onDiscard={recovery.discardRecovery}
                />
              )}
              <input
                autoFocus
                className='w-full bg-transparent border-none p-0 text-xl font-medium text-foreground placeholder:text-muted-foreground focus:ring-0 outline-none'
                placeholder={intl.formatMessage({
                  id: 'newTask.titlePlaceholder',
                })}
                type='text'
                value={title}
                onChange={e => {
                  setTitle(e.target.value)
                  onTitleChangePriority(e.target.value)
                }}
                onKeyDown={e => {
                  if (isSubmitShortcut(e)) handleSubmit()
                }}
              />
              <DuplicateWarning
                matches={clientMatches}
                workspaceUrl={workspaceUrl}
                projects={projects}
              />
              <AiDescriptionPrompt
                title={title}
                projectId={projectId || defaultProjectId || ''}
                workspaceUrl={workspaceUrl}
                existingDescription={descriptionValue}
                onAccept={html => {
                  descriptionRef.current = html
                  setDescriptionValue(html)
                }}
                onProjectSuggested={suggested => {
                  if (!projectId && !defaultProjectId) {
                    setProjectId(suggested.id)
                  }
                }}
              />
              <div className={expanded ? 'flex-1 min-h-0 overflow-y-auto' : ''}>
                <DescriptionEditor
                  value={descriptionValue}
                  onCommit={html => {
                    descriptionRef.current = html
                  }}
                  onChange={html => {
                    descriptionRef.current = html
                    setDescriptionValue(html)
                    onDescriptionChangePriority(title, html ?? '')
                  }}
                  placeholder={intl.formatMessage({
                    id: 'newTask.descriptionPlaceholder',
                  })}
                  mentionSources={mentionSources}
                />
              </div>
              <div className='flex flex-wrap items-center gap-2 pt-1'>
                <StatusSelect
                  value={status}
                  onChange={setStatus}
                  triggerClassName={triggerClass}
                />
                <ProjectSelect
                  value={projectId || defaultProjectId || ''}
                  onChange={setProjectId}
                  projects={projects}
                  triggerClassName={triggerClass}
                />
                <AssigneeSelect
                  value={assigneeId || null}
                  onChange={v => setAssigneeId(v ?? '')}
                  members={members.filter(
                    (m): m is WorkspaceMemberInfo & { actorId: string } =>
                      m.actorId !== null
                  )}
                  triggerClassName={triggerClass}
                />
                <AiPrioritySelect
                  value={priority}
                  onChange={handlePriorityChange}
                  triggerClassName={triggerClass}
                  suggestion={prioritySuggestion}
                  isLoadingSuggestion={isPriorityLoading}
                  overrideRecorded={overrideRecorded}
                />
                <DueDatePicker
                  value={dueDate}
                  onChange={setDueDate}
                  triggerClassName={triggerClass}
                />
                {sprintTeamId && (
                  <SprintSelect
                    teamId={sprintTeamId}
                    value={sprintId}
                    onChange={setSprintId}
                    triggerClassName={triggerClass}
                  />
                )}
              </div>
            </div>
          )
        }
      </Modal>
    </AnimatePresence>
  )
}
