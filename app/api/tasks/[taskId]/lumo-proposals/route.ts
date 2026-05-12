import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { githubTreeService } from '@/lib/services/lumo-sync/github-tree.service'
import { lumoProposalService } from '@/lib/services/lumo-proposal/lumo-proposal.service'
import { decrypt } from '@/lib/crypto'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { taskId } = await params

    // Load task and verify workspace membership
    const task = await taskRepository.findForMemoryContext(taskId)
    const taskResult = await requireTaskMember(
      task
        ? { ...task, project: { workspaceId: task.project.workspaceId } }
        : null,
      userId
    )
    if (taskResult instanceof NextResponse) return taskResult
    const { member } = taskResult

    const workspaceId = task!.project.workspaceId

    // Get GitHub token
    const integration = await githubRepository.findIntegration(
      workspaceId,
      member.id
    )
    if (!integration) {
      return NextResponse.json(
        {
          error:
            'GitHub not connected. Please connect GitHub in Settings first.',
        },
        { status: 400 }
      )
    }
    const token = decrypt(integration.accessToken)

    // Get repo info
    const repos = await projectRepository.findRepositories(task!.projectId)
    const defaultRepo = repos.find(r => r.isDefault) ?? repos[0]
    if (!defaultRepo) {
      return NextResponse.json(
        { error: 'No repository linked to this project' },
        { status: 400 }
      )
    }
    const [owner, repo] = defaultRepo.fullName.split('/')

    // Read current LUMO.md from GitHub
    const currentLumoMd = await githubTreeService.readFile(
      owner!,
      repo!,
      'LUMO.md',
      token
    )

    // Generate proposal
    const proposal = await lumoProposalService.generateProposal(
      taskId,
      currentLumoMd ?? ''
    )

    return NextResponse.json(proposal)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message =
      error instanceof Error ? error.message : 'Failed to generate proposal'
    return NextResponse.json({ error: message }, { status })
  }
}
