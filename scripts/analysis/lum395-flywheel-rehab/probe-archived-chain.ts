/** LUM-395 one-off probe: supersede/provenance involvement of ARCHIVED rows. Read-only. */
import { config } from 'dotenv'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const archived = await prisma.memory.findMany({
    where: { scope: 'PROJECT', status: 'ARCHIVED' },
    select: { id: true, supersededById: true },
  })
  const ids = archived.map(a => a.id)
  const won = await prisma.memory.count({
    where: { supersededById: { in: ids } },
  })
  const prov = await prisma.memoryProvenance.count({
    where: {
      OR: [{ childMemoryId: { in: ids } }, { parentMemoryId: { in: ids } }],
    },
  })
  console.log(
    JSON.stringify({
      archived,
      supersededOthersCount: won,
      provenanceLinks: prov,
    })
  )
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
