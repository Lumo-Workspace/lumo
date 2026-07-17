'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiIdea } from '../types'
import { IdeaEvidenceTab } from './IdeaEvidenceTab'
import { IdeaCommentsSection } from './IdeaCommentsSection'
import { IdeaActivityTimeline } from './IdeaActivityTimeline'

interface IdeaDetailPanelProps {
  idea: ApiIdea
  workspaceUrl: string
  /** Persist an edited statement (wired to the PATCH mutation by the host). */
  onSave: (statement: string) => Promise<void>
  saving?: boolean
}

/**
 * Presentational host for a single idea's detail (LUM-683). Renders the
 * statement (inline-editable), the `LUM-I` identifier, the status badge, and
 * the full lineage (source context/task/session, the run that consumed it, the
 * Initiative it fed). Below sit the Comments / Activity tabs (LUM-680) and the
 * Evidence tab (LUM-681, the source-card system mirrored from the Task detail).
 *
 * Pure presentation (SRP): all data comes in via `idea`, persistence via
 * `onSave`. The status is read-only here — the interactive 4-state lifecycle
 * control is the sibling task 679's; the current 2-state value is shown as a
 * badge so the shell is honest about what exists today.
 */
export function IdeaDetailPanel({
  idea,
  workspaceUrl,
  onSave,
  saving = false,
}: IdeaDetailPanelProps) {
  const intl = useIntl()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(idea.statement)

  // Keep the draft in sync when the idea changes underneath us (e.g. the cache
  // updated after a save) — but never clobber an in-progress edit.
  useEffect(() => {
    if (!editing) setDraft(idea.statement)
  }, [idea.statement, editing])

  const isPlanned = idea.status === 'PLANNED'
  const trimmed = draft.trim()
  const canSave = !saving && trimmed.length > 0 && trimmed !== idea.statement

  const handleSave = async () => {
    if (!canSave) return
    await onSave(trimmed)
    setEditing(false)
  }

  const handleCancel = () => {
    setDraft(idea.statement)
    setEditing(false)
  }

  return (
    <div className='flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6'>
      {/* Identity — LUM-I id + read-only status badge */}
      <div className='flex items-center gap-2'>
        <span className='font-mono text-xs text-muted-foreground'>
          {idea.identifier}
        </span>
        <Badge
          variant={isPlanned ? 'secondary' : 'outline'}
          className='text-[10px]'
        >
          {intl.formatMessage({
            id: isPlanned ? 'ideas.statusPlanned' : 'ideas.statusCaptured',
          })}
        </Badge>
      </div>

      {/* Statement — inline-editable */}
      <section className='flex flex-col gap-2'>
        {editing ? (
          <>
            <Textarea
              aria-label={intl.formatMessage({ id: 'ideas.detail.title' })}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
            />
            <div className='flex gap-2'>
              <Button size='sm' onClick={handleSave} disabled={!canSave}>
                {intl.formatMessage({ id: 'common.save' })}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                onClick={handleCancel}
                disabled={saving}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </Button>
            </div>
          </>
        ) : (
          <div className='group flex items-start gap-2'>
            <p className='flex-1 whitespace-pre-wrap text-sm'>
              {idea.statement}
            </p>
            <Button
              size='sm'
              variant='ghost'
              className='shrink-0 text-muted-foreground'
              onClick={() => setEditing(true)}
            >
              {intl.formatMessage({ id: 'common.edit' })}
            </Button>
          </div>
        )}
      </section>

      {/* Lineage — where the idea came from and what consumed it */}
      <IdeaLineage idea={idea} workspaceUrl={workspaceUrl} />

      {/* Comments + Activity are filled by LUM-680; Evidence by LUM-681
          (source-card system mirrored from the Task detail's ContextTab). */}
      <Tabs defaultValue='comments' className='flex flex-col gap-3'>
        <TabsList className='self-start'>
          <TabsTrigger value='comments'>
            {intl.formatMessage({ id: 'ideas.detail.tabComments' })}
          </TabsTrigger>
          <TabsTrigger value='activity'>
            {intl.formatMessage({ id: 'ideas.detail.tabActivity' })}
          </TabsTrigger>
          <TabsTrigger value='evidence'>
            {intl.formatMessage({ id: 'ideas.detail.tabEvidence' })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='comments'>
          <IdeaCommentsSection ideaId={idea.id} />
        </TabsContent>
        <TabsContent value='activity'>
          <IdeaActivityTimeline ideaId={idea.id} />
        </TabsContent>
        <TabsContent value='evidence'>
          <IdeaEvidenceTab ideaId={idea.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** The lineage read-out — every populated provenance/materialisation link. */
function IdeaLineage({
  idea,
  workspaceUrl,
}: {
  idea: ApiIdea
  workspaceUrl: string
}) {
  const intl = useIntl()

  const rows: React.ReactNode[] = []

  if (idea.sourceContext) {
    rows.push(
      <LineageRow key='context'>
        {intl.formatMessage(
          { id: 'ideas.detail.sourceContext' },
          { context: idea.sourceContext }
        )}
      </LineageRow>
    )
  }
  if (idea.sourceTaskId) {
    rows.push(
      <LineageRow key='task'>
        {intl.formatMessage(
          { id: 'ideas.fromTask' },
          { task: idea.sourceTaskId }
        )}
      </LineageRow>
    )
  }
  if (idea.sourceSessionId) {
    rows.push(
      <LineageRow key='session'>
        {intl.formatMessage(
          { id: 'ideas.detail.sourceSession' },
          { session: idea.sourceSessionId }
        )}
      </LineageRow>
    )
  }
  if (idea.planRunId) {
    rows.push(
      <LineageRow key='run'>
        <Link
          href={`/workspace/${workspaceUrl}/plan/${idea.planRunId}`}
          className='text-primary underline underline-offset-2 hover:no-underline'
        >
          {intl.formatMessage({ id: 'ideas.detail.consumedByRun' })}
        </Link>
      </LineageRow>
    )
  }
  if (idea.initiative) {
    rows.push(
      <LineageRow key='initiative'>
        <Link
          href={`/workspace/${workspaceUrl}/initiatives/${idea.initiative.id}`}
          className='text-primary underline underline-offset-2 hover:no-underline'
        >
          {intl.formatMessage(
            { id: 'ideas.plannedInto' },
            { goal: idea.initiative.name }
          )}
        </Link>
      </LineageRow>
    )
  }

  return (
    <section className='flex flex-col gap-2'>
      <h2 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {intl.formatMessage({ id: 'ideas.detail.lineage' })}
      </h2>
      {rows.length > 0 ? (
        <ul className='flex flex-col gap-1'>{rows}</ul>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'ideas.detail.noLineage' })}
        </p>
      )}
    </section>
  )
}

function LineageRow({ children }: { children: React.ReactNode }) {
  return <li className='truncate text-sm text-foreground/90'>{children}</li>
}
