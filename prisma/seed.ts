import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { SYSTEM_TEMPLATES } from '../lib/editor/templates'

/**
 * Build idempotent upsert args for every built-in template. System templates
 * have `workspaceId: null`; re-running converges because create and update
 * carry identical field values, matched on the unique `key`.
 */
export function buildTemplateUpserts(): Prisma.DocumentTemplateUpsertArgs[] {
  return SYSTEM_TEMPLATES.map(t => {
    const fields = {
      emoji: t.emoji,
      content: t.content,
      sortOrder: t.sortOrder,
      isSystem: true,
      workspaceId: null,
    }
    return {
      where: { key: t.key },
      create: { key: t.key, ...fields },
      update: fields,
    }
  })
}

async function main() {
  // Mirror lib/db/prisma.ts: Prisma 7 driver adapters require an adapter.
  const connectionString = (process.env.DATABASE_URL ?? '').replace(
    /sslmode=(prefer|require|verify-ca)/gi,
    'sslmode=verify-full'
  )
  const adapter = new PrismaPg({
    connectionString,
    ssl: { rejectUnauthorized: true },
  })
  const prisma = new PrismaClient({ adapter })
  try {
    for (const args of buildTemplateUpserts()) {
      await prisma.documentTemplate.upsert(args)
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${SYSTEM_TEMPLATES.length} system document templates`)
  } finally {
    await prisma.$disconnect()
  }
}

// Only run when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
