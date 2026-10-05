'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'

interface Props {
  /** The invited address, masked (`a***@acme.com`). */
  maskedEmail: string
  workspaceName: string
  onSwitchAccount: () => void
}

/**
 * LUM-906: shown on the invite page when the signed-in account has no
 * verified email matching the invite — names the (masked) address to sign
 * in with and offers to switch accounts.
 */
export function InviteEmailMismatch({
  maskedEmail,
  workspaceName,
  onSwitchAccount,
}: Props) {
  const intl = useIntl()
  return (
    <>
      <h2 className='text-lg font-semibold'>
        {intl.formatMessage({ id: 'invite.mismatch.title' })}
      </h2>
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage(
          { id: 'invite.mismatch.body' },
          { email: maskedEmail, workspaceName }
        )}
      </p>
      <Button className='w-full' onClick={onSwitchAccount}>
        {intl.formatMessage({ id: 'invite.mismatch.switchAccount' })}
      </Button>
    </>
  )
}
