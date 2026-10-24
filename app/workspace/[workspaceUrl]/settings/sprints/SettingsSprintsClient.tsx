'use client'

import { useWorkspaceTeams } from '../../hooks/useWorkspaceTeams'
import { CadencePanel } from '../../sprints/components/CadencePanel'
import { useIntl } from 'react-intl'
import { LoadingState } from '../../components/AsyncContent'
import { RowListSkeleton } from '../../components/skeletons/RowListSkeleton'

export function SettingsSprintsClient() {
  const intl = useIntl()
  const { teams, isLoading, error } = useWorkspaceTeams()

  if (isLoading && teams.length === 0)
    return (
      <LoadingState
        label={intl.formatMessage({ id: 'sprints.settings.loading' })}
      >
        <RowListSkeleton
          rows={2}
          subtitle
          rowClassName='rounded-lg border border-border px-4 py-4'
          className='space-y-4'
        />
      </LoadingState>
    )
  if (error) return <p className='text-danger-text'>{error.message}</p>

  return (
    <div className='flex flex-col gap-4'>
      <h2 className='text-heading'>
        {intl.formatMessage({ id: 'sprints.settings.title' })}
      </h2>
      <p className='text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'sprints.settings.intro' })}
      </p>
      {teams?.map(team => (
        <CadencePanel key={team.id} team={team} />
      ))}
    </div>
  )
}
