'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { milestonesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { TestCasesSection } from '../TaskDetailTimeline/TestCasesSection'
import { MilestoneTestDefects } from '../TaskDetailTimeline/BlockingTestDefects'
import { MilestoneCloseGateBanner } from './MilestoneCloseGateBanner'
import { useTestCases } from '../../hooks/useTestCases'
import type { WorkspaceMemberInfo } from '../../types'

const SECTION_LABEL =
  'text-caption font-semibold uppercase text-muted-foreground'

interface MilestoneTestCasesSectionProps {
  milestoneId: string
  milestoneName: string
  allTasksDone: boolean
  completed: boolean
  members: WorkspaceMemberInfo[]
}

/** LUM-1135: the milestone's close contract — its test cases plus the gate they hold. */
export function MilestoneTestCasesSection({
  milestoneId,
  milestoneName,
  allTasksDone,
  completed,
  members,
}: MilestoneTestCasesSectionProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const owner = useMemo(
    () => ({ kind: 'milestone' as const, id: milestoneId }),
    [milestoneId]
  )
  // Same query key as the list inside TestCasesSection — one request.
  const { gate } = useTestCases(owner)

  return (
    <section
      aria-labelledby='milestone-test-cases-label'
      className='mt-8 px-4 pb-8 md:px-8'
    >
      <h2 id='milestone-test-cases-label' className={SECTION_LABEL}>
        {intl.formatMessage({ id: 'milestoneTestCases.title' })}
      </h2>
      <div className='mt-2 flex max-w-3xl flex-col gap-3'>
        {gate && (
          <MilestoneCloseGateBanner
            gate={gate}
            allTasksDone={allTasksDone}
            completed={completed}
            onOverride={async note => {
              await milestonesClient.overrideClose(milestoneId, note)
              // Detail page reads detail(id) or byProjectAndSlug — the
              // milestones prefix covers both (and the list rollups).
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: queryKeys.milestoneTestCases(milestoneId),
                }),
                queryClient.invalidateQueries({
                  queryKey: queryKeys.milestones.all(),
                }),
              ])
            }}
          />
        )}
        {/* Undispositioned proven defects hold the gate — rule on them in place. */}
        <MilestoneTestDefects
          milestoneId={milestoneId}
          milestoneName={milestoneName}
        />
        <TestCasesSection
          owner={owner}
          handlePrefix={milestoneName}
          enabled
          members={members}
        />
      </div>
    </section>
  )
}
