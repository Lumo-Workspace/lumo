'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight, ChevronDown, Plus, Sparkle } from 'lucide-react'
import type { TaskArtifact } from '@prisma/client'
import { artifactsClient } from '@/lib/api-client/task-artifacts'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'
import { RichTextViewer } from './RichTextViewer'

interface Props {
  taskId: string
  artifacts: Pick<
    TaskArtifact,
    'id' | 'kind' | 'title' | 'content' | 'source' | 'order' | 'createdAt'
  >[]
  onChanged: () => void | Promise<void>
}

export function SpecArtifactGroup({ taskId, artifacts, onChanged }: Props) {
  const intl = useIntl()
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const sourceLabel = useMemo(() => {
    const sources = Array.from(new Set(artifacts.map(a => a.source)))
    return sources.length === 1 ? sources[0]! : sources.join(', ')
  }, [artifacts])

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
          <span className='text-xs font-semibold tracking-wide text-muted-foreground'>
            {intl.formatMessage({ id: 'taskArtifact.groupLabel' })}
          </span>
          <span className='text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded inline-flex items-center gap-1'>
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
          className='text-xs text-foreground border border-border rounded px-2.5 py-1 inline-flex items-center gap-1 hover:bg-accent'
        >
          <Plus className='size-3' />
          {intl.formatMessage({ id: 'taskArtifact.add' })}
        </button>
      </div>

      <div className='space-y-2'>
        {artifacts.map(a => {
          const open = openIds.has(a.id)
          return (
            <div key={a.id} className='bg-card border border-border rounded-lg'>
              <button
                type='button'
                onClick={() => toggle(a.id)}
                className='w-full flex items-center gap-3 px-3 py-2.5 text-left'
              >
                {open ? (
                  <ChevronDown className='size-3.5 text-muted-foreground shrink-0' />
                ) : (
                  <ChevronRight className='size-3.5 text-muted-foreground shrink-0' />
                )}
                <span className='text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0'>
                  {a.kind}
                </span>
                <span className='text-sm text-foreground'>{a.title}</span>
              </button>
              {open && (
                <div className='px-4 pb-3.5 pl-10'>
                  <RichTextViewer value={markdownToHtml(a.content)} />
                  <div className='mt-3 pt-2.5 border-t border-border text-xs text-muted-foreground inline-flex items-center gap-1'>
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
          taskId={taskId}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

function ManualAddForm({
  taskId,
  onCancel,
  onSaved,
}: {
  taskId: string
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  const intl = useIntl()
  const [kind, setKind] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = !!kind.trim() && !!title.trim() && !!content.trim() && !saving

  return (
    <div className='mt-2 border border-border rounded-lg p-3 space-y-2'>
      <input
        value={kind}
        onChange={e => setKind(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addKind' })}
        className='w-full text-sm bg-transparent border border-input rounded px-2 py-1 outline-none'
      />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addTitle' })}
        className='w-full text-sm bg-transparent border border-input rounded px-2 py-1 outline-none'
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addContent' })}
        rows={5}
        className='w-full text-sm bg-transparent border border-input rounded px-2 py-1 outline-none font-mono'
      />
      <div className='flex justify-end gap-2'>
        <button
          type='button'
          onClick={onCancel}
          className='text-xs text-muted-foreground px-2.5 py-1'
        >
          {intl.formatMessage({ id: 'taskArtifact.cancel' })}
        </button>
        <button
          type='button'
          disabled={!canSave}
          onClick={async () => {
            setSaving(true)
            try {
              await artifactsClient.add(taskId, {
                kind: kind.trim(),
                title: title.trim(),
                content,
                source: 'manual',
              })
              await onSaved()
            } finally {
              setSaving(false)
            }
          }}
          className='text-xs bg-primary text-primary-foreground rounded px-2.5 py-1 disabled:opacity-40'
        >
          {intl.formatMessage({ id: 'taskArtifact.save' })}
        </button>
      </div>
    </div>
  )
}
