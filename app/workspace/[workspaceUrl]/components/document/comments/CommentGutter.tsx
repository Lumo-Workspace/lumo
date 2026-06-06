'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { DocumentCommentThread } from './DocumentCommentThread'
import { CommentResolvedSection } from './CommentResolvedSection'
import { useCommentGutterLayout } from './useCommentGutterLayout'

export interface CommentGutterProps {
  editor: Editor | null
  /** The flex-row element both the editor and gutter sit in (positioning origin). */
  rowEl: HTMLElement | null
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  currentActorId: string | null
  activeCommentId: string | null
  onReply: (parentId: string, body: string) => void
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onSetStatus: (id: string, status: 'OPEN' | 'RESOLVED') => void
  onSelectThread: (id: string) => void
}

export function CommentGutter(props: CommentGutterProps) {
  const open = props.comments.filter(c => c.status === 'OPEN')
  const [heights, setHeights] = useState<Record<string, number>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const { tops, height } = useCommentGutterLayout(
    props.editor,
    props.rowEl,
    props.comments,
    heights
  )

  // Measure each rendered card's real height and feed it into the layout, so a
  // tall card (replies, edit mode) reserves enough space and the next card
  // doesn't overlap it. Re-observes whenever the OPEN card set changes.
  const openKey = open.map(c => c.id).join(',')
  useLayoutEffect(() => {
    const root = containerRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      setHeights(prev => {
        let next = prev
        let changed = false
        for (const e of entries) {
          const el = e.target as HTMLElement
          const id = el.dataset.gutterCard
          if (!id) continue
          const h = el.offsetHeight
          if (prev[id] !== h) {
            if (!changed) {
              next = { ...prev }
              changed = true
            }
            next[id] = h
          }
        }
        return changed ? next : prev
      })
    })
    root
      .querySelectorAll<HTMLElement>('[data-gutter-card]')
      .forEach(el => ro.observe(el))
    return () => ro.disconnect()
  }, [openKey])

  return (
    <div className='w-full'>
      <div ref={containerRef} className='relative w-full' style={{ height }}>
        {open.map(c => (
          <div
            key={c.id}
            data-testid={`gutter-pos-${c.id}`}
            data-gutter-card={c.id}
            className='absolute left-0 right-0'
            style={{ top: tops[c.id] ?? 0 }}
          >
            <DocumentCommentThread
              thread={c}
              members={props.members}
              agentActors={[]}
              currentActorId={props.currentActorId}
              onReply={props.onReply}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
              onSetStatus={props.onSetStatus}
              onSelect={props.onSelectThread}
              active={props.activeCommentId === c.id}
            />
          </div>
        ))}
      </div>
      <CommentResolvedSection
        comments={props.comments}
        members={props.members}
        currentActorId={props.currentActorId}
        activeCommentId={props.activeCommentId}
        onReply={props.onReply}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onSetStatus={props.onSetStatus}
        onSelectThread={props.onSelectThread}
      />
    </div>
  )
}
