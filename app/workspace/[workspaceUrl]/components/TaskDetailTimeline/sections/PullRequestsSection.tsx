'use client'

import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { GithubIcon } from '@/components/icons/GithubIcon'
import { PrStateBadge, CiIcon, SecurityScanBadge } from '../../pr-helpers'
import { useSecurityScans } from '../../../hooks/useSecurityScans'
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
  const {
    data: security,
    isLoading: securityLoading,
    isError: securityError,
  } = useSecurityScans(taskId)
  const scanByPrId = new Map(
    (security?.prs ?? []).map(p => [p.pr.id, p.latest] as const)
  )

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
      icon={<GithubIcon size={14} className='text-foreground' />}
      count={pullRequests.length}
      addSlot={addSlot}
    >
      {pullRequests.length === 0 ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
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
                  className='text-caption text-foreground hover:underline leading-snug block'
                >
                  #{pr.number} {pr.title}
                </a>
                <div className='flex items-center gap-1.5 mt-1'>
                  <PrStateBadge state={pr.state} />
                  {/* Review I4: nothing at all while the read is in flight —
                      an unanswered fetch is not "Not scanned" — and an
                      explicit unavailable state once it has failed. */}
                  {securityLoading ? null : (
                    <SecurityScanBadge
                      scan={scanByPrId.get(pr.id)}
                      unavailable={securityError}
                      scanningOff={security?.scanningOff ?? false}
                    />
                  )}
                </div>
              </div>
              <button
                onClick={() => onUnlinkPr(pr.id)}
                className='shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all'
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
