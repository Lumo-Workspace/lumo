/** LUM-395 one-off probe: detail of the ARCHIVED PROJECT memory rows. Read-only. */
import { config } from 'dotenv'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const archived = await prisma.memory.findMany({
    where: { scope: 'PROJECT', status: 'ARCHIVED' },
    select: {
      id: true,
      category: true,
      createdAt: true,
      updatedAt: true,
      content: true,
    },
  })
  for (const m of archived) {
    console.log(
      JSON.stringify({ ...m, content: JSON.stringify(m.content).slice(0, 400) })
    )
    const best = await prisma.$queryRaw<
      { id: string; sim: number; createdAt: Date }[]
    >`
      SELECT b.id, 1 - (a.embedding <=> b.embedding) AS sim, b."createdAt"
      FROM memories a
      JOIN memories b
        ON b."projectId" = a."projectId" AND b.scope = 'PROJECT'
       AND b.status = 'ACTIVE' AND b."createdAt" > a."updatedAt"
       AND b.embedding IS NOT NULL
      WHERE a.id = ${m.id} AND a.embedding IS NOT NULL
      ORDER BY sim DESC LIMIT 3`
    console.log('best later neighbors:', JSON.stringify(best))
  }
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
