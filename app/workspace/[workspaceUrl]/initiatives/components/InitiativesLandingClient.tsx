'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Lightbulb, ListChecks, Plus, Target } from 'lucide-react'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiInitiativeStatus } from '@/lib/api-client/initiatives'
import { useCreateInitiative, useInitiatives } from '../../hooks/useInitiatives'

// LUM-678: Linear-aligned 5-state lifecycle.
const STATUS_KEY: Record<ApiInitiativeStatus, string> = {
  PROPOSED: 'initiative.status.proposed',
  PLANNED: 'initiative.status.planned',
  ACTIVE: 'initiative.status.active',
  COMPLETED: 'initiative.status.completed',
  CANCELLED: 'initiative.status.cancelled',
}

// Semantic Badge variants (token-backed) instead of brand colors — active
// stands out (primary), planned/completed recede (secondary), proposed/
// cancelled de-emphasized (outline).
const STATUS_VARIANT: Record<
  ApiInitiativeStatus,
  'default' | 'secondary' | 'outline'
> = {
  PROPOSED: 'outline',
  PLANNED: 'secondary',
  ACTIVE: 'default',
  COMPLETED: 'secondary',
  CANCELLED: 'outline',
}

/**
 * Initiatives landing (LUM-673) — the caller team's initiatives, with a
 * **New Initiative** action to create one directly (no plan run required).
 * Each card links to the detail page where the lineage (which ideas became it,
 * which tasks hang off it) is shown. First-class browse; does not touch the
 * core Milestone concept.
 */
export function InitiativesLandingClient() {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const { initiatives, isLoading, error } = useInitiatives()
  const {
    createInitiative,
    isCreating,
    error: createError,
  } = useCreateInitiative()

  const [formOpen, setFormOpen] = useState(false)
  const [goal, setGoal] = useState('')
  const [assumption, setAssumption] = useState('')

  const resetForm = () => {
    setGoal('')
    setAssumption('')
    setFormOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!goal.trim() || isCreating) return
    try {
      await createInitiative({
        name: goal.trim(),
        assumptionNote: assumption.trim() || null,
      })
      resetForm()
    } catch {
      // Error surfaced via the hook's `createError`; keep the form open.
    }
  }

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <PageBreadcrumb
        title={intl.formatMessage({ id: 'sidebar.initiatives' })}
        actions={
          <Button size='sm' onClick={() => setFormOpen(o => !o)}>
            <Plus className='size-4' />
            {intl.formatMessage({ id: 'initiative.new' })}
          </Button>
        }
      />
      <div className='flex-1 overflow-y-auto px-4 py-6 md:px-8'>
        <div className='mx-auto max-w-3xl'>
          {formOpen && (
            <form
              onSubmit={handleSubmit}
              className='mb-6 flex flex-col gap-3 rounded-lg border p-4'
            >
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='initiative-goal'>
                  {intl.formatMessage({ id: 'initiative.create.goalLabel' })}
                </Label>
                <Textarea
                  id='initiative-goal'
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'initiative.create.goalPlaceholder',
                  })}
                  rows={2}
                  autoFocus
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='initiative-assumption'>
                  {intl.formatMessage({
                    id: 'initiative.create.assumptionLabel',
                  })}
                </Label>
                <Input
                  id='initiative-assumption'
                  value={assumption}
                  onChange={e => setAssumption(e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'initiative.create.assumptionPlaceholder',
                  })}
                />
              </div>
              {createError && (
                <p className='text-sm text-danger-text'>
                  {intl.formatMessage({ id: 'initiative.create.error' })}
                </p>
              )}
              <div className='flex items-center gap-2'>
                <Button
                  type='submit'
                  size='sm'
                  disabled={!goal.trim() || isCreating}
                >
                  {intl.formatMessage({
                    id: isCreating
                      ? 'initiative.create.submitting'
                      : 'initiative.create.submit',
                  })}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={resetForm}
                >
                  {intl.formatMessage({ id: 'initiative.create.cancel' })}
                </Button>
              </div>
            </form>
          )}

          {isLoading ? (
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'initiative.list.loading' })}
            </p>
          ) : error ? (
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'initiative.list.error' })}
            </p>
          ) : initiatives.length === 0 ? (
            <div className='rounded-lg border border-dashed p-8 text-center'>
              <Target className='mx-auto mb-3 size-6 text-muted-foreground' />
              <p className='text-sm font-medium'>
                {intl.formatMessage({ id: 'initiative.list.empty' })}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {intl.formatMessage({ id: 'initiative.list.emptyHint' })}
              </p>
            </div>
          ) : (
            <ul className='flex flex-col gap-2'>
              {initiatives.map(initiative => (
                <li key={initiative.id}>
                  <Link
                    href={`/workspace/${workspaceUrl}/initiatives/${initiative.id}`}
                    className='flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-accent/50'
                  >
                    <div className='flex items-center gap-3'>
                      <span className='font-mono text-xs text-muted-foreground'>
                        {initiative.identifier}
                      </span>
                      <Badge variant={STATUS_VARIANT[initiative.status]}>
                        {intl.formatMessage({
                          id: STATUS_KEY[initiative.status],
                        })}
                      </Badge>
                    </div>
                    <p className='font-medium leading-snug'>
                      {initiative.name}
                    </p>
                    <div className='flex items-center gap-4 text-xs text-muted-foreground'>
                      <span className='flex items-center gap-1'>
                        <ListChecks className='size-3.5' />
                        {intl.formatMessage(
                          { id: 'initiative.list.taskCount' },
                          { count: initiative.taskCount }
                        )}
                      </span>
                      <span className='flex items-center gap-1'>
                        <Lightbulb className='size-3.5' />
                        {intl.formatMessage(
                          { id: 'initiative.list.ideaCount' },
                          { count: initiative.ideaCount }
                        )}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
