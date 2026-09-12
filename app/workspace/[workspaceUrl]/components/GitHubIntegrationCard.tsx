'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { Loader2, AlertTriangle, ExternalLink } from 'lucide-react'
import { GitHubIcon } from './GitHubIcon'
import { IntegrationCard } from './IntegrationCard'
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
import { useGitHubIntegration } from '../hooks/useGitHubIntegration'
import { useGitHubAppInstallation } from '../hooks/useGitHubAppInstallation'
import { IntegrationChainRow } from './IntegrationChainRow'

interface GitHubIntegrationCardProps {
  workspaceUrl: string
  isOwner: boolean
  onConnectedChange?: (connected: boolean) => void
}

export function GitHubIntegrationCard({
  workspaceUrl,
  isOwner,
  onConnectedChange,
}: GitHubIntegrationCardProps) {
  const intl = useIntl()
  const {
    status,
    loading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleConnect,
    handleDisconnect,
  } = useGitHubIntegration(workspaceUrl)
  const {
    status: appStatus,
    loading: appLoading,
    uninstallOpen,
    setUninstallOpen,
    uninstalling,
    handleInstall,
    handleUninstall,
  } = useGitHubAppInstallation(workspaceUrl)

  const connected = status?.connected === true
  // `undefined` is "not known yet" and must never render as "not set up"
  // (LUM-684) — only an explicit false unlocks the connect/install affordances.
  const oauthMissing = status?.connected === false
  const appInstalled = appStatus?.installed === true
  const appMissing = appStatus?.installed === false

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction =
    loading || appLoading ? (
      <Loader2 size={16} className='animate-spin text-muted-foreground' />
    ) : null

  return (
    <>
      <IntegrationCard
        icon={<GitHubIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'github.title' })}
        description={intl.formatMessage({ id: 'github.description' })}
        headerAction={headerAction}
        onReconnect={connected && isOwner ? handleConnect : undefined}
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={
          connected && isOwner ? () => setDisconnectOpen(true) : undefined
        }
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {/* Two grants with different jobs. The App installation is the team's:
            every repository read and write — PR links, webhooks, comment
            mirroring, the security scan — runs as it. The OAuth link is
            personal and optional: it only maps a GitHub login to this member so
            comments arriving from GitHub are attributed to them. */}
        <IntegrationChainRow
          testId='github-app-row'
          label={intl.formatMessage({ id: 'github.appRow' })}
          description={intl.formatMessage({ id: 'github.appRowDesc' })}
          connected={appInstalled}
          connectedLabel={
            appStatus?.accountLogin
              ? intl.formatMessage(
                  { id: 'github.appAccount' },
                  { account: appStatus.accountLogin }
                )
              : intl.formatMessage({ id: 'github.appInstalled' })
          }
          action={
            isOwner && appMissing ? (
              <Button size='sm' onClick={handleInstall}>
                {intl.formatMessage({ id: 'github.installApp' })}
              </Button>
            ) : isOwner && appInstalled ? (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setUninstallOpen(true)}
              >
                {intl.formatMessage({ id: 'github.uninstallApp' })}
              </Button>
            ) : null
          }
        />

        {appMissing ? (
          <div className='flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2'>
            <AlertTriangle size={14} className='mt-0.5 shrink-0 text-warning' />
            <div className='min-w-0'>
              <p className='text-xs font-medium text-foreground'>
                {intl.formatMessage({ id: 'github.scanDisabled' })}
              </p>
              <p className='text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'github.scanDisabledDesc' })}
              </p>
            </div>
          </div>
        ) : null}

        {appInstalled ? (
          <div>
            <div className='flex items-center justify-between mb-2'>
              <p className='text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                {intl.formatMessage({ id: 'github.appRepos' })}
              </p>
              <a
                href='https://github.com/settings/installations'
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
              >
                {intl.formatMessage({ id: 'github.manageOnGithub' })}
                <ExternalLink size={11} />
              </a>
            </div>
            {appStatus?.repositories && appStatus.repositories.length > 0 ? (
              <ul className='space-y-1.5'>
                {appStatus.repositories.map(repo => (
                  <li
                    key={repo}
                    className='px-3 py-2 rounded-lg bg-card border border-border text-sm'
                  >
                    <span className='text-foreground font-mono text-xs'>
                      {repo}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-xs text-muted-foreground italic'>
                {intl.formatMessage({ id: 'github.appNoRepos' })}
              </p>
            )}
          </div>
        ) : null}

        <IntegrationChainRow
          testId='github-oauth-row'
          label={intl.formatMessage({ id: 'github.oauthRow' })}
          description={intl.formatMessage({ id: 'github.oauthRowDesc' })}
          connected={connected}
          connectedLabel={intl.formatMessage({ id: 'github.oauthConnected' })}
          action={
            oauthMissing && isOwner ? (
              <Button size='sm' onClick={handleConnect}>
                {intl.formatMessage({ id: 'common.connect' })}
              </Button>
            ) : null
          }
        />
      </IntegrationCard>

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'github.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'github.disconnectDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                intl.formatMessage({ id: 'common.disconnect' })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Uninstall App confirmation — independent of the OAuth disconnect */}
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
