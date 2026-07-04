import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { ClusterGateBoard } from './ClusterGateBoard'

export const dynamic = 'force-dynamic'

/**
 * Gate A (闸门A) of the design-thinking 转换器: the reviewer sees Stage-1's
 * clustering, renames clusters and moves ideas between clusters / the orphan
 * zone, then confirms — advancing the run to alignment. The deep-link into this
 * page is minted by `lumo plan` (Spec2-6, LUM-668). The board itself loads its
 * data client-side through the gate API.
 */
export default async function GateAPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/signin')

  const { runId } = await params

  return (
    <main className='mx-auto max-w-5xl p-6'>
      <ClusterGateBoard runId={runId} />
    </main>
  )
}
