'use client'

import { useState, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import { useWorkspaceTeams } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTeams'
import { TeamSelector } from './TeamSelector'
import { SprintsBoard } from './SprintsBoard'

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
    <div className='flex h-full flex-col overflow-hidden'>
      <PageBreadcrumb
        title={intl.formatMessage({ id: 'sidebar.sprints' })}
        actions={
          !isLoading && teams.length > 1 ? (
            <TeamSelector
              teams={teams}
              value={selectedTeamId}
              onChange={setSelectedTeamId}
            />
          ) : null
        }
      />
      <div className='flex-1 overflow-y-auto px-4 py-6 md:px-8'>
        {selectedTeamId ? <SprintsBoard teamId={selectedTeamId} /> : null}
      </div>
    </div>
  )
}
