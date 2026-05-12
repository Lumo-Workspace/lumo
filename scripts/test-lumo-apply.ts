/**
 * End-to-end test for LUMO.md proposal → apply flow.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/test-lumo-apply.ts --task=<taskId> --repo=<repoPath>
 *
 * Generates a proposal from the task's memories, then applies it to LUMO.md
 * in the specified repo path. Runs onboarding if needed.
 */
import * as fs from 'fs'
import * as path from 'path'
import { prisma } from '../lib/db/prisma'
import { lumoProposalService } from '../lib/services/lumo-proposal/lumo-proposal.service'
import { lumoOnboardingService } from '../lib/services/lumo-proposal/lumo-onboarding.service'

function parseArgs(): { taskId: string; repoPath: string } {
  const taskFlag = process.argv.find(a => a.startsWith('--task='))
  const repoFlag = process.argv.find(a => a.startsWith('--repo='))
  if (!taskFlag || !repoFlag) {
    console.error(
      'Usage: npx tsx scripts/test-lumo-apply.ts --task=<taskId> --repo=<repoPath>'
    )
    process.exit(1)
  }
  return {
    taskId: taskFlag.slice('--task='.length),
    repoPath: repoFlag.slice('--repo='.length),
  }
}

async function main() {
  const { taskId, repoPath } = parseArgs()
  const lumoMdPath = path.join(repoPath, 'LUMO.md')

  // Step 1: Onboarding check
  const status = lumoOnboardingService.checkStatus(repoPath)
  console.log('Onboarding status:', status)

  if (!status.lumoMdExists || !status.claudeMdImported) {
    console.log('Running onboarding...')
    const result = lumoOnboardingService.perform(repoPath, ['CLAUDE.md'])
    console.log('Onboarding result:', result)
  }

  // Step 2: Read current LUMO.md
  const currentLumoMd = fs.readFileSync(lumoMdPath, 'utf-8')
  console.log('\n--- Current LUMO.md ---')
  console.log(currentLumoMd)

  // Step 3: Generate proposal
  console.log('Generating proposal...')
  const proposal = await lumoProposalService.generateProposal(
    taskId,
    currentLumoMd
  )
  console.log('Proposal created:', proposal.id)

  // Step 4: Apply proposal
  console.log('Applying proposal...')
  const { newContent, warnings } = await lumoProposalService.applyProposal(
    proposal.id,
    lumoMdPath
  )

  if (warnings.length > 0) {
    console.log('\nWarnings:')
    for (const w of warnings) console.log(`  ⚠ ${w}`)
  }

  console.log('\n--- Updated LUMO.md ---')
  console.log(newContent)

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
