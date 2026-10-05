import { notFound } from 'next/navigation'
import Image from 'next/image'
import { inviteService } from '@/lib/services/invite.service'
import { AcceptInviteClient } from './AcceptInviteClient'

interface PageProps {
  params: Promise<{ token: string }>
}

async function loadInvite(token: string) {
  try {
    return await inviteService.getInviteByToken(token)
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null
    throw error
  }
}

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params

  // Public page: the service returns the invited address masked only.
  const invite = await loadInvite(token)
  if (!invite) notFound()

  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted py-12 px-4'>
      <div className='w-full max-w-md bg-card rounded-xl shadow-elevation-3 p-8 text-center space-y-6'>
        <Image
          src='/logo-dark.svg'
          alt='Lumo'
          width={48}
          height={48}
          className='mx-auto'
          priority
        />
        <AcceptInviteClient
          token={token}
          workspaceName={invite.workspaceName}
          workspaceSlug={invite.workspaceSlug}
          inviterName={invite.inviterName}
          maskedEmail={invite.maskedEmail}
          status={invite.status}
        />
      </div>
    </div>
  )
}
