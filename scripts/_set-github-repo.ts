import { prisma } from '../lib/db/prisma'

async function main() {
  const task = await prisma.task.findUnique({
    where: { id: 'cmn3rtrac000a92jp9bhfafn6' },
    select: {
      projectId: true,
      project: { select: { id: true, name: true, githubRepo: true } },
    },
  })
  console.log('Task project:', JSON.stringify(task?.project))

  if (task?.project && !task.project.githubRepo) {
    const updated = await prisma.project.update({
      where: { id: task.projectId },
      data: { githubRepo: 'Lumo-Workspace/lumo' },
    })
    console.log('Updated githubRepo:', updated.githubRepo)
  } else {
    console.log('githubRepo already set:', task?.project.githubRepo)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
