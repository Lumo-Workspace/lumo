import * as fs from 'fs'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { callLumoProposalLLM } from '@/lib/llm/lumo-proposal-client'
import { applyOperations } from './lumo-md-writer'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const lumoProposalService = {
  async generateProposal(taskId: string, currentLumoMd: string) {
    const task = await taskRepository.findForMemoryContext(taskId)
    if (!task) httpError(404, 'task not found')

    const memories = await memoryRepository.findActiveTaskMemories(taskId)
    if (memories.length === 0) httpError(400, 'task has no memories')

    const taskIdentifier = `${task.team.identifier}-${task.number}`

    const { operations, summary } = await callLumoProposalLLM(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        taskIdentifier,
      },
      memories,
      currentLumoMd
    )

    const proposal = await lumoProposalRepository.create({
      projectId: task.projectId,
      taskId: task.id,
      operations,
      lumoMdSnapshot: currentLumoMd || null,
      summary,
    })

    return proposal
  },

  async applyProposal(proposalId: string, lumoMdPath: string) {
    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) httpError(404, 'proposal not found')
    if (proposal.status !== 'PENDING')
      httpError(400, 'proposal is not in PENDING status')

    const currentContent = fs.readFileSync(lumoMdPath, 'utf-8')
    const operations = proposal.operations as ProposalOperation[]
    const { content: newContent, warnings } = applyOperations(
      currentContent,
      operations
    )

    fs.writeFileSync(lumoMdPath, newContent, 'utf-8')
    await lumoProposalRepository.updateStatus(proposalId, 'APPLIED', new Date())

    return { newContent, warnings }
  },
}
