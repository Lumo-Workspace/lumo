'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FeishuIcon } from './FeishuIcon'
import { FeishuDisconnectDialog } from './FeishuDisconnectDialog'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { useFeishuIntegration } from '../hooks/useFeishuIntegration'

/** LUM-1341 — the workspace's Feishu / Lark install (TEAM). */
export function FeishuIntegrationCard({
  isOwner,
  onConnectedChange,
}: {
  isOwner: boolean
  onConnectedChange?: (connected: boolean) => void
}) {
  const intl = useIntl()
  const {
    status,
    loading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleConnect,
    handleDisconnect,
  } = useFeishuIntegration()

  const connected = status?.connected === true
  const reinstallRequired =
    status?.connected === true && status.reinstallRequired

  useEffect(() => {
    // Report once known, so the page can tell "none" from "loading".
    if (status) onConnectedChange?.(connected)
  }, [status, connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'feishu.connected' })} />
  ) : isOwner ? (
    <Button size='sm' onClick={handleConnect}>
      {intl.formatMessage({ id: 'common.connect' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<FeishuIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'feishu.title' })}
        description={intl.formatMessage({ id: 'feishu.description' })}
        headerAction={headerAction}
        // A stale install stays open so the prompt is seen.
        collapsible={connected && !reinstallRequired}
        onReconnect={connected && isOwner ? handleConnect : undefined}
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={
          connected && isOwner ? () => setDisconnectOpen(true) : undefined
        }
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {reinstallRequired ? (
          <p
            className='text-caption text-danger-text'
            data-testid='feishu-reinstall-required'
          >
            {intl.formatMessage({ id: 'feishu.error.reinstallRequired' })}
          </p>
        ) : null}
        {status?.connected ? (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage(
              { id: 'feishu.connectedTo' },
              {
                tenantName: (
                  <span className='text-foreground'>{status.tenantName}</span>
                ),
              }
            )}
          </p>
        ) : null}
      </IntegrationCard>

      <FeishuDisconnectDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        disconnecting={disconnecting}
        onConfirm={handleDisconnect}
        titleId='feishu.disconnectTitle'
        descriptionId='feishu.disconnectDesc'
      />
    </>
  )
}
