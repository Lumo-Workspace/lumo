'use client'

import type { AgentRunSession } from '../../types'
import { AgentRunCard } from './AgentRunCard'

export function AgentRunList({ runs }: { runs: AgentRunSession[] }) {
  return (
    <div className='space-y-3'>
      {runs.map(run => (
        <AgentRunCard
          key={run.sessionId ?? `unlinked-${run.runNumber}`}
          run={run}
          defaultExpanded={false}
        />
      ))}
    </div>
  )
}
