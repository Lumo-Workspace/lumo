import { NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { lumoSyncService } from '@/lib/services/lumo-sync/lumo-sync.service'
import { projectRepository } from '@/lib/repositories/project.repository'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { proposalId } = await params

    // Load proposal to get projectId
    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get workspace from project and verify membership
    const project = await projectRepository.findWorkspaceId(proposal.projectId)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const member = await requireWorkspaceMember(project.workspaceId, userId)
    if (member instanceof NextResponse) return member

    const result = await lumoSyncService.sync(
      proposalId,
      project.workspaceId,
      member.id
    )

    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message =
      error instanceof Error ? error.message : 'Failed to sync proposal'
    return NextResponse.json({ error: message }, { status })
  }
}
