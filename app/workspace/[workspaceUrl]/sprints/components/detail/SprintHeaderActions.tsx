'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LiveSprintActionsProps {
  canClose: boolean
  onCloseSprint: () => void
  onNewTask: () => void
}

/** A live sprint: "Close sprint" (outline) and the single primary "New task". */
export function LiveSprintActions({
  canClose,
  onCloseSprint,
  onNewTask,
}: LiveSprintActionsProps) {
  const intl = useIntl()
  return (
    <>
      {canClose && (
        <Button
          variant='outline'
          className='flex-1 sm:flex-none'
          onClick={onCloseSprint}
        >
          {intl.formatMessage({ id: 'sprints.detail.closeSprint' })}
        </Button>
      )}
      <Button className='flex-1 sm:flex-none' onClick={onNewTask}>
        <Plus className='size-4' />
        {intl.formatMessage({ id: 'sprints.detail.newTask' })}
      </Button>
    </>
  )
}

interface ClosedSprintActionsProps {
  /** The team's next sprint; null renders no action. */
  nextSprint: { name: string; href: string } | null
}

/** A closed sprint: no close / new task — just a way on to the next sprint. */
export function ClosedSprintActions({ nextSprint }: ClosedSprintActionsProps) {
  const intl = useIntl()
  if (!nextSprint) return null
  return (
    <Button variant='outline' className='flex-1 sm:flex-none' asChild>
      <Link href={nextSprint.href}>
        {intl.formatMessage(
          { id: 'sprints.detail.retro.goToSprint' },
          { name: nextSprint.name }
        )}
        <ArrowRight className='size-4' />
      </Link>
    </Button>
  )
}
