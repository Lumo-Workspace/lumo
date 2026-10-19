'use client'

import { useIntl } from 'react-intl'
import { GitPullRequest, GitMerge, Link2, Unlink } from 'lucide-react'
import type { TimelineActivityEntry } from '../../../types'

interface PrItemProps {
  entry: TimelineActivityEntry
}

export function PrItem({ entry }: PrItemProps) {
  const intl = useIntl()
  const payload = entry.payload ?? {}
  const prNumber = payload.prNumber as number | undefined
  const prUrl = payload.prUrl as string | undefined
  const prTitle = payload.prTitle as string | undefined

  const config: Record<
    string,
    { icon: typeof GitPullRequest; color: string; label: string }
  > = {
    PR_CREATED: {
      icon: GitPullRequest,
      color: 'text-info-text',
      label: intl.formatMessage(
        { id: 'activity.prCreated', defaultMessage: 'PR #{n} created' },
        { n: prNumber }
      ),
    },
    PR_MERGED: {
      icon: GitMerge,
      color: 'text-success-text',
      label: intl.formatMessage(
        { id: 'activity.prMerged', defaultMessage: 'PR #{n} merged' },
        { n: prNumber }
      ),
    },
    PR_LINKED: {
      icon: Link2,
      color: 'text-info-text',
      label: intl.formatMessage(
        { id: 'activity.prLinked', defaultMessage: 'PR #{n} linked' },
        { n: prNumber }
      ),
    },
    PR_UNLINKED: {
      icon: Unlink,
      color: 'text-muted-foreground',
      label: intl.formatMessage(
        { id: 'activity.prUnlinked', defaultMessage: 'PR #{n} unlinked' },
        { n: prNumber }
      ),
    },
  }

  const c = config[entry.type] ?? {
    icon: GitPullRequest,
    color: 'text-muted-foreground',
    label: entry.type,
  }
  const Icon = c.icon

  return (
    <div className='flex items-start gap-2.5 py-2 px-3 rounded-md bg-muted border border-border'>
      <Icon size={16} className={`mt-0.5 shrink-0 ${c.color}`} />
      <div className='flex-1 min-w-0'>
        <p className='text-caption text-foreground'>{c.label}</p>
        {prTitle && (
          <p className='text-[11px] text-muted-foreground mt-0.5 truncate'>
            {prTitle}
          </p>
        )}
      </div>
      {prUrl && (
        <a
          href={prUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-[11px] text-info-text hover:underline shrink-0'
        >
          View
        </a>
      )}
    </div>
  )
}
