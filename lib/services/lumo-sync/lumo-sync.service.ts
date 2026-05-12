import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubTreeService } from './github-tree.service'
import { applyOperations } from '@/lib/services/lumo-proposal/lumo-md-writer'
import { decrypt } from '@/lib/crypto'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

const LUMO_MD_TEMPLATE = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
`

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

function buildPrDescription(
  taskIdentifier: string,
  taskTitle: string,
  operations: ProposalOperation[],
  summary: string,
  isOnboarding: boolean
): string {
  const changeLines = operations.map(op => {
    const badge = op.type.charAt(0).toUpperCase() + op.type.slice(1)
    const content = op.type === 'modify' ? op.newContent : op.content
    return `- **[${badge}] ${op.section}**: ${content} — ${op.rationale}`
  })

  let body = `## Source\nTask: ${taskIdentifier} — ${taskTitle}\n\n`
  body += `## Changes\n${changeLines.join('\n')}\n\n`
  body += `## Summary\n${summary}\n`

  if (isOnboarding) {
    body += `\n> **First-time setup:** This PR initializes \`LUMO.md\` and adds \`@import LUMO.md\` to \`CLAUDE.md\`.\n`
  }

  body += `\n---\n_Synced by Lumo_`
  return body
}

export const lumoSyncService = {
  async sync(
    proposalId: string,
    workspaceId: string,
    memberId: string
  ): Promise<{ prUrl: string; prNumber: number; branchName: string }> {
    // 1. Validate proposal
    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) httpError(404, 'Proposal not found')
    if (proposal.status !== 'PENDING')
      httpError(400, 'Proposal is not in PENDING status')

    // 2. Get GitHub token
    const integration = await githubRepository.findIntegration(
      workspaceId,
      memberId
    )
    if (!integration)
      httpError(
        400,
        'GitHub not connected. Please connect GitHub in Settings first.'
      )
    const token = decrypt(integration.accessToken)

    // 3. Get repo info
    const repos = await projectRepository.findRepositories(proposal.projectId)
    const defaultRepo = repos.find(r => r.isDefault) ?? repos[0]
    if (!defaultRepo) httpError(400, 'No repository linked to this project')
    const [owner, repo] = defaultRepo.fullName.split('/')
    if (!owner || !repo) httpError(400, 'Invalid repository name')
    const baseBranch = 'main'

    // 4. Get task info for branch naming and PR description
    const task = await taskRepository.findForMemoryContext(proposal.taskId)
    const taskIdentifier = task
      ? `${task.team.identifier}-${task.number}`
      : proposal.taskId

    // 5. Read current LUMO.md from GitHub
    const currentLumoMd = await githubTreeService.readFile(
      owner,
      repo,
      'LUMO.md',
      token
    )
    const isOnboarding = currentLumoMd === null

    // 6. Apply operations
    const baseContent = currentLumoMd ?? LUMO_MD_TEMPLATE
    const operations = proposal.operations as ProposalOperation[]
    const { content: newContent } = applyOperations(baseContent, operations)

    // 7. Prepare files
    const files: { path: string; content: string }[] = [
      { path: 'LUMO.md', content: newContent },
    ]

    if (isOnboarding) {
      const claudeMd = await githubTreeService.readFile(
        owner,
        repo,
        'CLAUDE.md',
        token
      )
      if (claudeMd === null) {
        files.push({ path: 'CLAUDE.md', content: '@import LUMO.md\n' })
      } else if (!claudeMd.includes('@import LUMO.md')) {
        const sep = claudeMd.endsWith('\n') ? '' : '\n'
        files.push({
          path: 'CLAUDE.md',
          content: claudeMd + sep + '@import LUMO.md\n',
        })
      }
    }

    // 8. Create branch + commit
    const branchName = `lumo/sync-${taskIdentifier}-${Math.floor(Date.now() / 1000)}`
    const commitMessage = isOnboarding
      ? `chore: initialize LUMO.md from ${taskIdentifier}`
      : `chore: sync LUMO.md from ${taskIdentifier}`

    const { commitSha: _commitSha } =
      await githubTreeService.createBranchWithFiles(
        owner,
        repo,
        baseBranch,
        branchName,
        files,
        commitMessage,
        token
      )

    // 9. Create PR
    const prTitle = isOnboarding
      ? `[Lumo] Initialize LUMO.md from ${taskIdentifier}`
      : `[Lumo] Sync project memory from ${taskIdentifier}`

    const prBody = buildPrDescription(
      taskIdentifier,
      task?.title ?? 'Unknown task',
      operations,
      proposal.summary ?? '',
      isOnboarding
    )

    const { prUrl, prNumber } = await githubTreeService.createPullRequest(
      owner,
      repo,
      prTitle,
      prBody,
      branchName,
      baseBranch,
      token
    )

    // 10. Update proposal in DB
    await lumoProposalRepository.updateSyncResult(
      proposalId,
      'APPLIED',
      new Date(),
      prUrl
    )

    return { prUrl, prNumber, branchName }
  },
}
