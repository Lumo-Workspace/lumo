/**
 * Manual test for LUMO.md proposal generation.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/test-lumo-proposal.ts --task=<taskId>
 *
 * Reads the task's memories from DB, generates a proposal using the LLM,
 * and prints the result. Does NOT write any files.
 */
import { prisma } from '../lib/db/prisma'
import { taskRepository } from '../lib/repositories/task.repository'
import { memoryRepository } from '../lib/repositories/memory.repository'
import { callLumoProposalLLM } from '../lib/llm/lumo-proposal-client'

function parseArgs(): { taskId: string } {
  const taskFlag = process.argv.find(a => a.startsWith('--task='))
  if (!taskFlag) {
    console.error(
      'Usage: npx tsx scripts/test-lumo-proposal.ts --task=<taskId>'
    )
    process.exit(1)
  }
  return { taskId: taskFlag.slice('--task='.length) }
}

async function main() {
  const { taskId } = parseArgs()

  const task = await taskRepository.findForMemoryContext(taskId)
  if (!task) {
    console.error(`Task ${taskId} not found`)
    process.exit(1)
  }

  const memories = await memoryRepository.findActiveTaskMemories(taskId)
  console.log(`Task: ${task.title} (${task.team.identifier}-${task.number})`)
  console.log(`Memories: ${memories.length}`)

  if (memories.length === 0) {
    console.log('No memories found — nothing to propose.')
    process.exit(0)
  }

  const mockLumoMd = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
`

  console.log('\nCalling LLM...\n')
  const result = await callLumoProposalLLM(
    {
      id: task.id,
      title: task.title,
      description: task.description,
      taskIdentifier: `${task.team.identifier}-${task.number}`,
    },
    memories,
    mockLumoMd
  )

  console.log('Summary:', result.summary)
  console.log(`Operations (${result.operations.length}):`)
  for (const op of result.operations) {
    console.log(`  [${op.type}] ## ${op.section}`)
    if (op.type === 'modify') {
      console.log(`    old: ${op.oldContent}`)
      console.log(`    new: ${op.newContent}`)
    } else {
      console.log(`    content: ${op.content}`)
    }
    console.log(`    rationale: ${op.rationale}`)
    console.log(`    source: ${op.sourceTaskId}`)
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
