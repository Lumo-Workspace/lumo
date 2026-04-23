import 'dotenv/config'
import { prisma } from '@/lib/db/prisma'

async function main() {
  const count = await prisma.hookEvent.count()
  console.log(`hook_events row count: ${count}\n`)

  if (count > 0) {
    const rows = await prisma.hookEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        toolName: true,
        createdAt: true,
        workspaceId: true,
        workspaceMemberId: true,
      },
    })
    console.log('Most recent events (up to 20):')
    console.table(rows)
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
