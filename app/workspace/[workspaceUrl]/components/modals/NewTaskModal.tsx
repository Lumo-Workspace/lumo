'use client'

import { useState, useEffect, useRef } from 'react'
import { useIntl } from 'react-intl'
import { AnimatePresence } from 'motion/react'
import { useParams } from 'next/navigation'
import { Modal } from '../Modal'
import {
  ApiProject,
  ApiRepository,
  ApiTask,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { apiFetch, isSubmitShortcut, submitModLabel } from '../../utils'
import { Button } from '@/components/ui/button'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  PrioritySelect,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
import { DescriptionEditor } from '../DescriptionEditor'
import { AiDescriptionPrompt } from '../AiDescriptionPrompt'
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck'
import { DuplicateWarning } from '../DuplicateWarning'
import { DuplicateConfirm, DuplicateMatch } from '../DuplicateConfirm'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GitBranch, Loader2 } from 'lucide-react'

export interface NewTaskFormData {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
  repositoryId: string | null
}

interface NewTaskModalProps {
  isOpen: boolean
  onClose: () => void
  projects: ApiProject[]
  members: WorkspaceMemberInfo[]
  defaultProjectId?: string | undefined
  defaultAssigneeId?: string | undefined
  defaultStatus?: ApiStatus | undefined
  /** Parent handles optimistic create + API call. Throw to show error in modal. */
  onSubmit: (data: NewTaskFormData) => Promise<void>
  tasks?: ApiTask[]
}

export function NewTaskModal({
  isOpen,
  onClose,
  projects,
  members,
  defaultProjectId,
  defaultAssigneeId,
  defaultStatus,
  onSubmit,
  tasks = [],
}: NewTaskModalProps) {
  const intl = useIntl()
  const [title, setTitle] = useState('')
  const descriptionRef = useRef<string | null>(null)
  const [descriptionValue, setDescriptionValue] = useState<string | null>(null)
  const [status, setStatus] = useState<ApiStatus>(defaultStatus ?? 'TODO')
  const [priority, setPriority] = useState<ApiPriority>('MEDIUM')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? '')
  const [repositoryId, setRepositoryId] = useState<string | null>(null)
  const [projectRepos, setProjectRepos] = useState<ApiRepository[]>([])

  // ─── Duplicate detection ────────────────────────────────────────────────
  type ModalPhase = 'editing' | 'checking' | 'confirming'
  const [phase, setPhase] = useState<ModalPhase>('editing')
  const [aiMatches, setAiMatches] = useState<DuplicateMatch[]>([])
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const effectiveProjectId = projectId || defaultProjectId || ''
  const { clientMatches } = useDuplicateCheck(title, tasks, effectiveProjectId)

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

  // Load repositories for the selected project
  useEffect(() => {
    const pid = projectId || defaultProjectId
    if (!pid) {
      setProjectRepos([])
      setRepositoryId(null)
      return
    }
    fetch(`/api/projects/${pid}/repositories`)
      .then(r => r.json())
      .then(data => {
        const repos: ApiRepository[] = data.repositories ?? []
        setProjectRepos(repos)
        // Auto-select the default repo
        const def = repos.find(r => r.isDefault)
        setRepositoryId(def?.id ?? null)
      })
      .catch(() => {
        setProjectRepos([])
        setRepositoryId(null)
      })
  }, [projectId, defaultProjectId])

  const reset = () => {
    setTitle('')
    descriptionRef.current = null
    setDescriptionValue(null)
    setStatus(defaultStatus ?? 'TODO')
    setPriority('MEDIUM')
    setProjectId(defaultProjectId ?? '')
    setAssigneeId(defaultAssigneeId ?? '')
    setRepositoryId(null)
    setProjectRepos([])
    setPhase('editing')
    setAiMatches([])
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const doCreate = () => {
    const data = {
      title: title.trim(),
      description: descriptionRef.current ?? '',
      status,
      priority,
      projectId: effectiveProjectId,
      assigneeId,
      repositoryId,
    }
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
      const res = await apiFetch('/api/tasks/check-duplicates', {
        method: 'POST',
        body: { title: trimmedTitle, projectId: effectiveProjectId },
      })

      if (res.ok) {
        const data = await res.json()
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
      }
      // No matches or API error → proceed with creation
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
              <input
                autoFocus
                className='w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
                placeholder={intl.formatMessage({
                  id: 'newTask.titlePlaceholder',
                })}
                type='text'
                value={title}
                onChange={e => setTitle(e.target.value)}
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
                existingDescription={descriptionValue}
                onAccept={html => {
                  descriptionRef.current = html
                  setDescriptionValue(html)
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
                  }}
                  placeholder={intl.formatMessage({
                    id: 'newTask.descriptionPlaceholder',
                  })}
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
                <PrioritySelect
                  value={priority}
                  onChange={setPriority}
                  triggerClassName={triggerClass}
                />
                {projectRepos.length > 0 && (
                  <Select
                    value={repositoryId ?? '__none__'}
                    onValueChange={v =>
                      setRepositoryId(v === '__none__' ? null : v)
                    }
                  >
                    <SelectTrigger className={triggerClass}>
                      <GitBranch size={12} className='mr-1 shrink-0' />
                      <SelectValue placeholder='Repository' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>No repository</SelectItem>
                      {projectRepos.map(repo => (
                        <SelectItem key={repo.id} value={repo.id}>
                          {repo.name}
                          {repo.isDefault ? ' (default)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )
        }
      </Modal>
    </AnimatePresence>
  )
}
