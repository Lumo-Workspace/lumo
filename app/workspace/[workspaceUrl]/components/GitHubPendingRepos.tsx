'use client'

import { useIntl } from 'react-intl'

interface GitHubPendingReposProps {
  /** `null` = GitHub could not be asked; `[]` = nothing pending. */
  pendingRepositories: string[] | null | undefined
}

/**
 * Repositories the App installation reaches that this workspace has not
 * confirmed (LUM-881): added on GitHub after the installation was bound. Lumo
 * ignores them until an owner re-verifies, so the card lists them rather than
 * letting them look connected. Renders nothing when nothing is pending.
 */
export function GitHubPendingRepos({
  pendingRepositories,
}: GitHubPendingReposProps) {
  const intl = useIntl()

  if (pendingRepositories === null) {
    return (
      <p className='text-caption text-muted-foreground italic'>
        {intl.formatMessage({ id: 'github.appPendingUnknown' })}
      </p>
    )
  }
  if (!pendingRepositories || pendingRepositories.length === 0) return null

  return (
    <div>
      <p className='text-caption text-muted-foreground uppercase mb-1'>
        {intl.formatMessage({ id: 'github.appPendingRepos' })}
      </p>
      <p className='text-caption text-muted-foreground mb-2'>
        {intl.formatMessage({ id: 'github.appPendingReposDesc' })}
      </p>
      <ul className='space-y-1.5'>
        {pendingRepositories.map(repo => (
          <li
            key={repo}
            className='px-3 py-2 rounded-lg border border-dashed border-border text-body'
          >
            <span className='text-muted-foreground font-mono text-caption'>
              {repo}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
