import { prisma } from '@/lib/db/prisma'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import { AcceptInviteClient } from './AcceptInviteClient'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params

  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    select: {
      status: true,
      expiresAt: true,
      inviterName: true,
      workspace: { select: { name: true, slug: true } },
    },
  })

  if (!invite) notFound()

  const isExpired = invite.expiresAt < new Date()
  const status =
    isExpired && invite.status === 'PENDING' ? 'EXPIRED' : invite.status

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
          workspaceName={invite.workspace.name}
          workspaceSlug={invite.workspace.slug}
          inviterName={invite.inviterName}
          status={status}
        />
      </div>
    </div>
  )
}
