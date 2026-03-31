import { redirect } from 'next/navigation'

export default async function WorkspaceAppPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  redirect(`/workspace/${workspaceUrl}/my-tasks`)
}
