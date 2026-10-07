import { notFound, redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { parseDocumentSlugNumber } from '@/lib/utils/document-slug'
import WorkspaceApp from '../../WorkspaceApp'

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; docId: string }>
}) {
  const { workspaceUrl, docId } = await params

  // Reject bare-cuid URLs at the page layer so external links to the old
  // cuid form (Slack, IM, bookmarks) produce a hard 404 instead of silently
  // resolving via the SPA shell. Done before the auth check so a stale
  // cuid link doesn't first bounce the visitor through sign-in only to 404.
  // Optimistic `temp-<uuid>` ids would also lack a `-<number>` tail, but
  // those exist purely client-side and never reach this server route.
  if (parseDocumentSlugNumber(docId) === null) {
    notFound()
  }

  const userId = await getCurrentUserId()

  if (!userId) redirect('/signin')

  const workspace = await prisma.workspace.findFirst({
    where: {
      slug: workspaceUrl,
      members: { some: { clerkId: userId, deactivatedAt: null } },
    },
  })

  if (!workspace) redirect('/onboarding')

  return <WorkspaceApp key={userId} />
}
