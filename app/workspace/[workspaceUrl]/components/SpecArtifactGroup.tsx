'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Sparkle,
  Pencil,
  Trash2,
} from 'lucide-react'
import { TaskArtifactAgent } from '@prisma/client'
import type {
  CreateArtifactPayload,
  UpdateArtifactPayload,
} from '@/lib/api-client/task-artifacts'
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
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'
import { useArtifacts, type OptimisticArtifact } from '../hooks/useArtifacts'
import { RichTextViewer } from './RichTextViewer'
import { AgentBadge, AgentAvatar } from './AgentBadge'
import { ContentSignalsBadge } from './ContentSignalsBadge'

interface Props {
  taskId: string
}

export function SpecArtifactGroup({ taskId }: Props) {
  const intl = useIntl()
  const { artifacts, add, update, remove } = useArtifacts(taskId)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const confirmDelete = () => {
    if (pendingDeleteId) {
      void remove(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  const sourceLabel = useMemo(() => {
    const sources = Array.from(new Set(artifacts.map(a => a.source)))
    return sources.length === 1 ? sources[0]! : sources.join(', ')
  }, [artifacts])

  const distinctAgents = useMemo(
    () => Array.from(new Set(artifacts.map(a => a.agent))),
    [artifacts]
  )

  if (artifacts.length === 0) return null

  const toggle = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className='mb-6'>
      <div className='flex items-center justify-between mb-2.5'>
        <div className='flex items-center gap-2.5'>
          <span className='text-caption font-semibold text-muted-foreground'>
            {intl.formatMessage({ id: 'taskArtifact.groupLabel' })}
          </span>
          <span className='flex -space-x-1.5'>
            {distinctAgents.map(agent => (
              <AgentAvatar key={agent} agent={agent} />
            ))}
          </span>
          {distinctAgents.length > 1 && (
            <span className='text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'taskArtifact.crossAgent' })}
            </span>
          )}
          <span className='text-caption text-muted-foreground bg-muted px-2 py-0.5 rounded-sm inline-flex items-center gap-1'>
            <Sparkle className='size-3 fill-current' />
            {intl.formatMessage(
              { id: 'taskArtifact.sourceCount' },
              { source: sourceLabel, count: artifacts.length }
            )}
          </span>
        </div>
        <button
          type='button'
          onClick={() => setAdding(true)}
          className='text-caption text-foreground border border-border rounded-sm px-2.5 py-1 inline-flex items-center gap-1 hover:bg-accent'
        >
          <Plus className='size-3' />
          {intl.formatMessage({ id: 'taskArtifact.add' })}
        </button>
      </div>

      <div className='space-y-2'>
        {artifacts.map(a => {
          const open = openIds.has(a.id)
          const editing = editingId === a.id
          return (
            <div
              key={a.id}
              className={`bg-card border border-border rounded-lg ${
                a.loading ? 'opacity-60' : ''
              }`}
            >
              <div className='flex items-center gap-3 px-3 py-2.5'>
                <button
                  type='button'
                  onClick={() => toggle(a.id)}
                  className='flex items-center gap-3 text-left grow min-w-0'
                >
                  {open ? (
                    <ChevronDown className='size-3.5 text-muted-foreground shrink-0' />
                  ) : (
                    <ChevronRight className='size-3.5 text-muted-foreground shrink-0' />
                  )}
                  <span className='text-caption font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-sm shrink-0'>
                    {a.kind}
                  </span>
                  <span className='text-body text-foreground truncate'>
                    {a.title}
                  </span>
                </button>
                <ContentSignalsBadge
                  signals={a.contentSignals}
                  className='shrink-0'
                />
                <AgentBadge agent={a.agent} />
                {!a.loading && (
                  <>
                    <button
                      type='button'
                      onClick={() => setEditingId(editing ? null : a.id)}
                      aria-label={intl.formatMessage({
                        id: 'taskArtifact.edit',
                      })}
                      className='text-muted-foreground hover:text-foreground shrink-0'
                    >
                      <Pencil className='size-3.5' />
                    </button>
                    <button
                      type='button'
                      onClick={() => setPendingDeleteId(a.id)}
                      aria-label={intl.formatMessage({
                        id: 'taskArtifact.delete',
                      })}
                      className='text-muted-foreground hover:text-destructive shrink-0'
                    >
                      <Trash2 className='size-3.5' />
                    </button>
                  </>
                )}
              </div>

              {editing && (
                <EditForm
                  artifact={a}
                  onCancel={() => setEditingId(null)}
                  onSave={async payload => {
                    await update(a.id, payload)
                    setEditingId(null)
                  }}
                />
              )}

              {open && !editing && (
                <div className='px-4 pb-3.5 pl-10'>
                  <RichTextViewer value={markdownToHtml(a.content)} />
                  <div className='mt-3 pt-2.5 border-t border-border text-caption text-muted-foreground inline-flex items-center gap-1'>
                    <Sparkle className='size-3 fill-current' />
                    {intl.formatMessage(
                      { id: 'taskArtifact.generatedMeta' },
                      {
                        source: a.source,
                        time: intl.formatDate(a.createdAt, {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                      }
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {adding && (
        <ManualAddForm
          onCancel={() => setAdding(false)}
          onSave={async payload => {
            await add(payload)
            setAdding(false)
          }}
        />
      )}

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={open => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'taskArtifact.deleteConfirmTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'taskArtifact.deleteConfirmDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'taskArtifact.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={confirmDelete}>
              {intl.formatMessage({ id: 'taskArtifact.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ManualAddForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (payload: CreateArtifactPayload) => void | Promise<void>
}) {
  const intl = useIntl()
  const [kind, setKind] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [agent, setAgent] = useState<TaskArtifactAgent>(
    TaskArtifactAgent.CLAUDE_CODE
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !!kind.trim() && !!title.trim() && !!content.trim() && !saving

  return (
    <div className='mt-2 border border-border rounded-lg p-3 space-y-2'>
      <input
        value={kind}
        onChange={e => setKind(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addKind' })}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
      />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addTitle' })}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addContent' })}
        rows={5}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none font-mono'
      />
      <select
        value={agent}
        onChange={e => setAgent(e.target.value as TaskArtifactAgent)}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
        aria-label={intl.formatMessage({ id: 'taskArtifact.selectAgent' })}
      >
        {Object.values(TaskArtifactAgent).map(value => (
          <option key={value} value={value}>
            {intl.formatMessage({ id: `taskArtifact.agent.${value}` })}
          </option>
        ))}
      </select>
      {error && <p className='text-caption text-danger-text'>{error}</p>}
      <div className='flex justify-end gap-2'>
        <button
          type='button'
          onClick={onCancel}
          className='text-caption text-muted-foreground px-2.5 py-1'
        >
          {intl.formatMessage({ id: 'taskArtifact.cancel' })}
        </button>
        <button
          type='button'
          disabled={!canSave}
          onClick={async () => {
            setSaving(true)
            setError(null)
            try {
              await onSave({
                kind: kind.trim(),
                title: title.trim(),
                content,
                source: 'manual',
                agent,
              })
            } catch {
              setError(intl.formatMessage({ id: 'taskArtifact.saveError' }))
            } finally {
              setSaving(false)
            }
          }}
          className='text-caption bg-primary text-primary-foreground rounded-sm px-2.5 py-1 disabled:opacity-40'
        >
          {intl.formatMessage({ id: 'taskArtifact.save' })}
        </button>
      </div>
    </div>
  )
}

function EditForm({
  artifact,
  onCancel,
  onSave,
}: {
  artifact: OptimisticArtifact
  onCancel: () => void
  onSave: (payload: UpdateArtifactPayload) => void | Promise<void>
}) {
  const intl = useIntl()
  const [kind, setKind] = useState(artifact.kind)
  const [title, setTitle] = useState(artifact.title)
  const [source, setSource] = useState(artifact.source)
  const [agent, setAgent] = useState<TaskArtifactAgent>(artifact.agent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !!kind.trim() && !!title.trim() && !!source.trim() && !saving

  return (
    <div className='px-3 pb-3 pl-10 space-y-2'>
      <input
        value={kind}
        onChange={e => setKind(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addKind' })}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
      />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addTitle' })}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
      />
      <input
        value={source}
        onChange={e => setSource(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.editSource' })}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
      />
      <select
        value={agent}
        onChange={e => setAgent(e.target.value as TaskArtifactAgent)}
        className='w-full text-body bg-transparent border border-border rounded-sm px-2 py-1 outline-none'
        aria-label={intl.formatMessage({ id: 'taskArtifact.selectAgent' })}
      >
        {Object.values(TaskArtifactAgent).map(value => (
          <option key={value} value={value}>
            {intl.formatMessage({ id: `taskArtifact.agent.${value}` })}
          </option>
        ))}
      </select>
      {error && <p className='text-caption text-danger-text'>{error}</p>}
      <div className='flex justify-end gap-2'>
        <button
          type='button'
          onClick={onCancel}
          className='text-caption text-muted-foreground px-2.5 py-1'
        >
          {intl.formatMessage({ id: 'taskArtifact.cancel' })}
        </button>
        <button
          type='button'
          disabled={!canSave}
          onClick={async () => {
            setSaving(true)
            setError(null)
            try {
              await onSave({
                kind: kind.trim(),
                title: title.trim(),
                source: source.trim(),
                agent,
              })
            } catch {
              setError(intl.formatMessage({ id: 'taskArtifact.saveError' }))
            } finally {
              setSaving(false)
            }
          }}
          className='text-caption bg-primary text-primary-foreground rounded-sm px-2.5 py-1 disabled:opacity-40'
        >
          {intl.formatMessage({ id: 'taskArtifact.save' })}
        </button>
      </div>
    </div>
  )
}
