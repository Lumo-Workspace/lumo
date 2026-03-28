import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const t = await p.task.findUnique({
  where: { id: 'cmn3rtrac000a92jp9bhfafn6' },
  select: {
    id: true,
    title: true,
    number: true,
    agentStatus: true,
    project: { select: { workspaceId: true, githubRepo: true } },
  },
})
console.log(JSON.stringify(t, null, 2))
await p.$disconnect()
