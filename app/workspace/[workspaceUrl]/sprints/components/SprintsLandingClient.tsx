'use client'

import { useState, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import { useWorkspaceTeams } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTeams'
import { TeamSelector } from './TeamSelector'
import { SprintCards } from './SprintCards'

export function SprintsLandingClient() {
  const intl = useIntl()
  const { teams, isLoading } = useWorkspaceTeams()
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  // Auto-select the first team (default team first) once loaded
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      const first = teams[0]
      if (first) setSelectedTeamId(first.id)
    }
  }, [teams, selectedTeamId])

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb title={intl.formatMessage({ id: 'sidebar.sprints' })} />
      <div className='flex flex-col gap-4 p-6 overflow-y-auto flex-1'>
        {!isLoading && teams.length > 0 && (
          <TeamSelector
            teams={teams}
            value={selectedTeamId}
            onChange={setSelectedTeamId}
          />
        )}
        {selectedTeamId ? <SprintCards teamId={selectedTeamId} /> : null}
      </div>
    </div>
  )
}
