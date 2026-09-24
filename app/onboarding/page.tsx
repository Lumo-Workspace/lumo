import { redirect } from 'next/navigation'
import { auth, getUserWorkspace, getVerifiedEmails } from '@/lib/auth'
import { inviteService } from '@/lib/services/invite.service'
import { OnboardingClient } from './OnboardingClient'

export default async function OnboardingPage() {
  const { userId } = await auth()
  if (!userId) redirect('/signin')

  // An invitee who signs in directly (not through the invite link) joins the
  // inviting workspace instead of being asked to create one. Users who already
  // belong somewhere may be here on purpose to create another workspace.
  if (!(await getUserWorkspace(userId))) {
    const slug = await inviteService.joinPendingInvitesForEmails(
      userId,
      await getVerifiedEmails()
    )
    if (slug) redirect(`/workspace/${slug}`)
  }

  return <OnboardingClient />
}
