'use client'

import { useCallback, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { FormDialog } from '../FormDialog'
import { MentionInput } from '../MentionInput'
import type { MentionCandidate } from '../MentionInput'
import type { Mention } from '@/lib/quick-dispatch/types'
import type { ApiProject, MyTask, WorkspaceMemberInfo } from '../../types'

interface QuickDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  myTasks: MyTask[]
}

export function QuickDispatchModal({
  isOpen,
  onClose,
  members,
  projects,
  myTasks,
}: QuickDispatchModalProps) {
  const intl = useIntl()
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])

  // Build autocomplete candidates — these surface as the in-modal "search
  // results" that the user can pick from while typing.
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
    setInput('')
    setMentions([])
    onClose()
  }, [onClose])

  return (
    <FormDialog
      isOpen={isOpen}
      onClose={handleClose}
      title={intl.formatMessage({ id: 'quickDispatch.title' })}
      expandable={false}
    >
      {() => (
        <MentionInput
          value={input}
          onChange={setInput}
          mentions={mentions}
          onMentionsChange={setMentions}
          candidates={candidates}
          placeholder={intl.formatMessage({
            id: 'quickDispatch.placeholder',
          })}
          autoFocus
        />
      )}
    </FormDialog>
  )
}
