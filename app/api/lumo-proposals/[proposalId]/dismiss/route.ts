import { NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { prisma } from '@/lib/db/prisma'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { proposalId } = await params

    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const project = await prisma.project.findUnique({
      where: { id: proposal.projectId },
      select: { workspaceId: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const member = await requireWorkspaceMember(project.workspaceId, userId)
    if (member instanceof NextResponse) return member

    await lumoProposalRepository.updateStatus(proposalId, 'APPLIED', new Date())

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message =
      error instanceof Error ? error.message : 'Failed to dismiss proposal'
    return NextResponse.json({ error: message }, { status })
  }
}
