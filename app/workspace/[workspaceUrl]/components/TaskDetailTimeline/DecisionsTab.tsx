'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useTaskDecisions } from '../../hooks/useTaskDecisions'
import { DecisionCard } from './DecisionCard'
import { DecisionForm } from './DecisionForm'

export interface DecisionAuthor {
  name: string
  imageUrl: string | null
}

interface DecisionsTabProps {
  taskId: string
  /** WorkspaceMember.id → name and avatar, for "recorded by". */
  authors: ReadonlyMap<string, DecisionAuthor>
  enabled: boolean
}

/**
 * LUM-1303: the task's Decisions tab — numbered rulings ("Decision 3") made
 * on the task, each with an optional "Why", newest first. Agents add them
 * with `lumo task decide`; people add, edit and delete them here.
 */
export function DecisionsTab({ taskId, authors, enabled }: DecisionsTabProps) {
  const intl = useIntl()
  const { decisions, loading, error, add, edit, remove } = useTaskDecisions(
    taskId,
    enabled
  )
  const [composing, setComposing] = useState(false)
  const newestFirst = [...decisions].reverse()

  const recordLabel = intl.formatMessage({
    id: 'task.decisions.add',
    defaultMessage: 'Record decision',
  })

  if (loading) {
    return (
      <p className='py-4 text-center text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'common.loading',
          defaultMessage: 'Loading…',
        })}
      </p>
    )
  }
  if (error) {
    return (
      <p
        role='alert'
        className='py-4 text-center text-caption text-danger-text'
      >
        {error}
      </p>
    )
  }

  const composer = composing ? (
    <Card>
      <DecisionForm
        submitLabel={recordLabel}
        onSubmit={async input => {
          await add(input)
          setComposing(false)
        }}
        onCancel={() => setComposing(false)}
      />
    </Card>
  ) : null

  if (newestFirst.length === 0) {
    return (
      composer ?? (
        <Empty className='border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Scale />
            </EmptyMedia>
            <EmptyTitle>
              {intl.formatMessage({
                id: 'task.decisions.emptyTitle',
                defaultMessage: 'No decisions yet',
              })}
            </EmptyTitle>
            <EmptyDescription>
              {intl.formatMessage({
                id: 'task.decisions.empty',
                defaultMessage:
                  'Record rulings on scope or approach here so they are not lost in comments.',
              })}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size='sm' onClick={() => setComposing(true)}>
              <Plus size={16} />
              {recordLabel}
            </Button>
          </EmptyContent>
        </Empty>
      )
    )
  }

  return (
    <div className='space-y-3'>
      {composer ?? (
        <Button
          variant='outline'
          className='w-full justify-start text-muted-foreground'
          onClick={() => setComposing(true)}
        >
          <Plus size={16} />
          {intl.formatMessage({
            id: 'task.decisions.compose',
            defaultMessage: 'Record a decision',
          })}
        </Button>
      )}
      <ul className='space-y-3'>
        {newestFirst.map(d => (
          <DecisionCard
            key={d.id}
            number={d.number}
            text={d.text}
            rationale={d.rationale}
            createdAt={d.createdAt}
            author={d.createdById ? (authors.get(d.createdById) ?? null) : null}
            onEdit={input => edit({ id: d.id, ...input })}
            onDelete={() => remove(d.id)}
          />
        ))}
      </ul>
    </div>
  )
}
