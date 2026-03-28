import { prisma } from '../lib/db/prisma'
async function main() {
  const t = await prisma.task.findUnique({
    where: { id: 'cmn3rtrac000a92jp9bhfafn6' },
    select: {
      title: true,
      spec: true,
      description: true,
      agentStatus: true,
      number: true,
    },
  })
  console.log(JSON.stringify(t, null, 2))
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
