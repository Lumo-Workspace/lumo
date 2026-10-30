'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FeishuIcon } from './FeishuIcon'
import { FeishuDisconnectDialog } from './FeishuDisconnectDialog'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { API } from '../constants'
import { useFeishuAccount } from '../hooks/useFeishuAccount'

/** LUM-1341 — the member's own Feishu / Lark account link (PERSONAL). */
export function FeishuAccountCard({
  onConnectedChange,
}: {
  onConnectedChange?: (connected: boolean) => void
} = {}) {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const {
    status,
    loading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleDisconnect,
  } = useFeishuAccount()

  const connected = status?.connected === true
  const connectHref = API.feishu.accountConnect(workspaceUrl)

  useEffect(() => {
    if (status) onConnectedChange?.(connected)
  }, [status, connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'feishu.connected' })} />
  ) : status?.installed ? (
    <Button size='sm' asChild>
      <a href={connectHref}>{intl.formatMessage({ id: 'common.connect' })}</a>
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<FeishuIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'feishuAccount.title' })}
        description={intl.formatMessage({ id: 'feishuAccount.description' })}
        headerAction={headerAction}
        // A link that needs reauth stays open so the prompt is seen.
        collapsible={connected && !status?.needsReauth}
        onReconnect={
          connected
            ? () => {
                window.location.href = connectHref
              }
            : undefined
        }
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={connected ? () => setDisconnectOpen(true) : undefined}
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {status && !status.installed && !connected ? (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'feishuAccount.notInstalled' })}
          </p>
        ) : null}
        {connected && status?.name ? (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'feishuAccount.connectedAs' })}{' '}
            <span className='text-foreground'>{status.name}</span>
          </p>
        ) : null}
        {connected && status?.needsReauth ? (
          <>
            <p
              className='text-caption text-danger-text'
              data-testid='feishu-account-reauth'
            >
              {intl.formatMessage({ id: 'feishuAccount.reauthRequired' })}
            </p>
            <div className='flex items-center pt-1'>
              <Button variant='outline' size='sm' asChild>
                <a href={connectHref}>
                  {intl.formatMessage({ id: 'feishuAccount.reconnect' })}
                </a>
              </Button>
            </div>
          </>
        ) : null}
      </IntegrationCard>

      <FeishuDisconnectDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        disconnecting={disconnecting}
        onConfirm={handleDisconnect}
        titleId='feishuAccount.disconnectTitle'
        descriptionId='feishuAccount.disconnectDesc'
      />
    </>
  )
}
