import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth/config'
import Sidebar from '@/components/workspace/Sidebar'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceUrl: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const { workspaceUrl } = await params
  if (!workspaceUrl) redirect('/workspace')

  return (
    <div className='min-h-screen grid grid-cols-[16rem_1fr]'>
      <Sidebar workspaceUrl={workspaceUrl} />
      <main className='min-h-screen bg-white'>{children}</main>
    </div>
  )
}
