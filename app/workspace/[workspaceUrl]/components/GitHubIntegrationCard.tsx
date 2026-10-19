'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { Loader2, AlertTriangle, ExternalLink } from 'lucide-react'
import { GitHubIcon } from './GitHubIcon'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { GitHubPendingRepos } from './GitHubPendingRepos'
import { GitHubAccessNotices } from './GitHubAccessNotices'
import { useGitHubAppInstallation } from '../hooks/useGitHubAppInstallation'

interface GitHubIntegrationCardProps {
  workspaceUrl: string
  isOwner: boolean
  onConnectedChange?: (connected: boolean) => void
}

/**
 * The team's GitHub card: the App installation, and only that — same shell
 * and same behaviour as the Slack card (status dot in the header, collapsible
 * body, the destructive action in the overflow menu). Every repository read
 * and write — PR links, webhooks, comment mirroring, the security scan — runs
 * as the installation, so "connected" here means "installed". A member's own
 * GitHub login is the PERSONAL GitHubAccountCard, not this.
 */
export function GitHubIntegrationCard({
  workspaceUrl,
  isOwner,
  onConnectedChange,
}: GitHubIntegrationCardProps) {
  const intl = useIntl()
  const {
    status,
    loading,
    uninstallOpen,
    setUninstallOpen,
    uninstalling,
    handleInstall,
    handleReverify,
    handleUninstall,
  } = useGitHubAppInstallation(workspaceUrl)

  // `undefined` is "not known yet" and must never render as "not set up"
  // (LUM-684) — only an explicit false unlocks the install affordance.
  const installed = status?.installed === true
  const missing = status?.installed === false

  useEffect(() => {
    onConnectedChange?.(installed)
  }, [installed, onConnectedChange])

  const installedLabel = status?.accountLogin
    ? intl.formatMessage(
        { id: 'github.appAccount' },
        { account: status.accountLogin }
      )
    : intl.formatMessage({ id: 'github.appInstalled' })

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-muted-foreground' />
  ) : installed ? (
    <ConnectedDot label={installedLabel} />
  ) : missing && isOwner ? (
    <Button size='sm' onClick={handleInstall}>
      {intl.formatMessage({ id: 'github.installApp' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<GitHubIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'github.title' })}
        description={intl.formatMessage({ id: 'github.description' })}
        headerAction={headerAction}
        collapsible={installed}
        onDisconnect={
          installed && isOwner ? () => setUninstallOpen(true) : undefined
        }
        disconnectLabel={intl.formatMessage({ id: 'github.uninstallApp' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {missing ? (
          <div className='flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2'>
            <AlertTriangle
              size={14}
              className='mt-0.5 shrink-0 text-warning-text'
            />
            <div className='min-w-0'>
              <p className='text-caption text-foreground'>
                {intl.formatMessage({ id: 'github.scanDisabled' })}
              </p>
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'github.scanDisabledDesc' })}
              </p>
            </div>
          </div>
        ) : installed ? (
          <>
            <p className='text-body text-muted-foreground'>{installedLabel}</p>
            <GitHubAccessNotices
              accessRecheckEnabled={status?.accessRecheckEnabled}
              accessRemovedCount={status?.accessRemovedCount}
              accessRemovedReason={status?.accessRemovedReason}
              tokenFailingSince={status?.tokenFailingSince}
            />
            <div>
              <div className='flex items-center justify-between mb-2'>
                <p className='text-caption text-muted-foreground uppercase'>
                  {intl.formatMessage({ id: 'github.appRepos' })}
                </p>
                <div className='flex items-center gap-3'>
                  {isOwner && (
                    <button
                      type='button'
                      onClick={handleReverify}
                      title={intl.formatMessage({ id: 'github.reverifyHint' })}
                      className='text-caption text-muted-foreground hover:text-foreground transition-colors'
                    >
                      {intl.formatMessage({ id: 'github.reverify' })}
                    </button>
                  )}
                  <a
                    href='https://github.com/settings/installations'
                    target='_blank'
                    rel='noreferrer'
                    className='inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground transition-colors'
                  >
                    {intl.formatMessage({ id: 'github.manageOnGithub' })}
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
              {status?.repositories && status.repositories.length > 0 ? (
                <ul className='space-y-1.5'>
                  {status.repositories.map(repo => (
                    <li
                      key={repo}
                      className='px-3 py-2 rounded-lg bg-card border border-border text-body'
                    >
                      <span className='text-foreground font-mono text-caption'>
                        {repo}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-caption text-muted-foreground italic'>
                  {intl.formatMessage({ id: 'github.appNoRepos' })}
                </p>
              )}
            </div>
            <GitHubPendingRepos
              pendingRepositories={status?.pendingRepositories}
            />
          </>
        ) : null}
      </IntegrationCard>

      <AlertDialog open={uninstallOpen} onOpenChange={setUninstallOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'github.uninstallTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'github.uninstallDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleUninstall}
              disabled={uninstalling}
            >
              {uninstalling ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                intl.formatMessage({ id: 'github.uninstallApp' })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
