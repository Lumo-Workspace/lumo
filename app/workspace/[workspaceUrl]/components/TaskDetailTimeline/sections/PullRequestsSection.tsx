'use client'

import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { GithubIcon } from '@/components/icons/GithubIcon'
import { PrStateBadge, CiIcon } from '../../pr-helpers'
import { LinkPrPopover } from '../../LinkPrPopover'
import { ContextSection } from '../ContextSection'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

interface Props {
  taskId: string
  workspaceId: string
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
}

export function PullRequestsSection({
  taskId,
  workspaceId,
  pullRequests,
  onLinkPr,
  onUnlinkPr,
}: Props): React.ReactElement {
  const intl = useIntl()

  const addSlot = (
    <LinkPrPopover
      taskId={taskId}
      workspaceId={workspaceId}
      onLinked={onLinkPr}
    />
  )

  return (
    <ContextSection
      value='pullRequests'
      label={intl.formatMessage({ id: 'task.pullRequests' })}
      icon={
        <GithubIcon size={14} className='text-zinc-700 dark:text-zinc-300' />
      }
      count={pullRequests.length}
      addSlot={addSlot}
    >
      {pullRequests.length === 0 ? (
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({ id: 'task.noPullRequests' })}
        </div>
      ) : (
        <ul className='space-y-2.5'>
          {pullRequests.map(pr => (
            <li key={pr.id} className='flex items-start gap-2 group'>
              <CiIcon status={pr.ciStatus} />
              <div className='min-w-0 flex-1'>
                <a
                  href={pr.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium leading-snug block'
                >
                  #{pr.number} {pr.title}
                </a>
                <div className='flex items-center gap-1.5 mt-1'>
                  <PrStateBadge state={pr.state} />
                </div>
              </div>
              <button
                onClick={() => onUnlinkPr(pr.id)}
                className='shrink-0 opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-all'
                title={intl.formatMessage({ id: 'task.unlinkPr' })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}
