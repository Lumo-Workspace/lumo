import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { callLumoProposalLLM } from '@/lib/llm/lumo-proposal-client'

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
}
