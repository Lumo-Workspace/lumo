'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { GithubIcon } from '@/components/icons/GithubIcon'
import { useIdeaPullRequests } from '../../hooks/useIdeaPullRequests'
import { useIntegrationConnected } from '../../hooks/useIntegrationConnected'
import { useWorkspace } from '../../hooks/useWorkspace'
import { ContextSection } from '../TaskDetailTimeline/ContextSection'
import { PrStateBadge, CiIcon } from '../pr-helpers'
import { LinkIdeaPrPopover } from '../LinkIdeaPrPopover'

interface Props {
  ideaId: string
}

/**
 * GitHub PRs cited as evidence on an idea (LUM-684) — the fourth idea evidence
 * section, alongside Slack / Web links / Figma.
 *
 * Like its siblings it consumes the workspace's existing GitHub integration
 * rather than offering its own connect flow. Note GitHub's connection is
 * per-member (`GitHubIntegration @@unique([workspaceId, memberId])`), not
 * workspace-wide like Slack's — so "connected" here means the same thing the
 * integrations settings page shows you, which is what the gate should agree
 * with.
 */
export function IdeaPullRequestSection({ ideaId }: Props): React.ReactElement {
  const intl = useIntl()
  const { citations, loading, link, unlink } = useIdeaPullRequests(ideaId)
  const { connected, integrationsHref } = useIntegrationConnected('github')
  const { workspace } = useWorkspace()

  const handleAttach = useCallback(
    async (payload: { prId?: string; url?: string }) => {
      await link(payload)
    },
    [link]
  )

  const notConnected = connected === false

  const addSlot = (
    <LinkIdeaPrPopover
      workspaceId={workspace?.id}
      onAttach={handleAttach}
      {...(connected !== undefined ? { connected } : {})}
      integrationsHref={integrationsHref}
    />
  )

  return (
    <ContextSection
      value='pullRequests'
      label={intl.formatMessage({
        id: 'task.pullRequests',
        defaultMessage: 'Pull Requests',
      })}
      icon={<GithubIcon size={14} />}
      count={citations.length}
      addSlot={addSlot}
    >
      {loading ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </div>
      ) : notConnected && citations.length === 0 ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'idea.pullRequests.notConnected',
            defaultMessage: 'GitHub is not connected.',
          })}
        </div>
      ) : citations.length === 0 ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'idea.pullRequests.empty',
            defaultMessage: 'No pull requests cited',
          })}
        </div>
      ) : (
        <div className='space-y-2'>
          {citations.map(c => (
            <div key={c.id} className='group flex items-center gap-2'>
              <CiIcon status={c.pullRequest.ciStatus} />
              <a
                href={c.pullRequest.url}
                target='_blank'
                rel='noopener noreferrer'
                className='min-w-0 flex-1 truncate text-xs text-foreground hover:underline'
              >
                #{c.pullRequest.number} {c.pullRequest.title}
              </a>
              <PrStateBadge state={c.pullRequest.state} />
              <button
                onClick={() => unlink(c.id)}
                title={intl.formatMessage({
                  id: 'idea.pullRequests.remove',
                  defaultMessage: 'Remove citation',
                })}
                className='opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity'
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ContextSection>
  )
}
