import { prisma } from '../lib/db/prisma'
async function main() {
  const t = await prisma.task.findUnique({
    where: { id: 'cmn3rtrac000a92jp9bhfafn6' },
    select: {
      agentStatus: true,
      sandboxId: true,
      pullRequests: {
        where: { state: 'open' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
  console.log(JSON.stringify(t, null, 2))
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
