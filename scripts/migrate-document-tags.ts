/**
 * Migration script: Convert Document.tags (String[]) to Tag + DocumentTag relations.
 *
 * Run: npx tsx --env-file=.env.local scripts/migrate-document-tags.ts
 *
 * This script:
 * 1. Reads all documents with non-empty tags[]
 * 2. For each workspace, creates unique Tag records from tag strings
 * 3. Creates DocumentTag associations
 * 4. Does NOT remove the old tags field (do that via Prisma migration after verifying)
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function sanitizeDbUrl(url: string): string {
  if (!url) return url
  return url.replace(
    /sslmode=(prefer|require|verify-ca)/gi,
    'sslmode=verify-full'
  )
}

const adapter = new PrismaPg({
  connectionString: sanitizeDbUrl(process.env.DATABASE_URL ?? ''),
  ssl: { rejectUnauthorized: true },
})

const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Starting Document.tags → Tag migration...')

  // Find all documents with non-empty tags
  const docs = await prisma.document.findMany({
    where: {
      tags: { isEmpty: false },
    },
    select: {
      id: true,
      workspaceId: true,
      tags: true,
    },
  })

  console.log(`Found ${docs.length} documents with tags`)

  if (docs.length === 0) {
    console.log('Nothing to migrate.')
    return
  }

  // Group tag names by workspace
  const workspaceTagNames = new Map<string, Set<string>>()
  for (const doc of docs) {
    const existing = workspaceTagNames.get(doc.workspaceId) ?? new Set()
    for (const tag of doc.tags) {
      existing.add(tag)
    }
    workspaceTagNames.set(doc.workspaceId, existing)
  }

  // Create tags per workspace (idempotent with skipDuplicates)
  let tagCount = 0
  for (const [workspaceId, names] of workspaceTagNames) {
    const nameArr = [...names]
    await prisma.tag.createMany({
      data: nameArr.map(name => ({ name, workspaceId })),
      skipDuplicates: true,
    })
    tagCount += nameArr.length
    console.log(
      `Workspace ${workspaceId}: ensured ${nameArr.length} tag(s) exist`
    )
  }

  // Build a lookup: (workspaceId, name) → tagId
  const allTags = await prisma.tag.findMany({
    where: {
      workspaceId: { in: [...workspaceTagNames.keys()] },
    },
  })
  const tagLookup = new Map<string, string>()
  for (const tag of allTags) {
    tagLookup.set(`${tag.workspaceId}::${tag.name}`, tag.id)
  }

  // Create DocumentTag associations
  let linkCount = 0
  for (const doc of docs) {
    const links = doc.tags
      .map(name => {
        const tagId = tagLookup.get(`${doc.workspaceId}::${name}`)
        return tagId ? { documentId: doc.id, tagId } : null
      })
      .filter((l): l is { documentId: string; tagId: string } => l !== null)

    if (links.length > 0) {
      await prisma.documentTag.createMany({
        data: links,
        skipDuplicates: true,
      })
      linkCount += links.length
    }
  }

  console.log(
    `Migration complete: ${tagCount} tag(s), ${linkCount} document-tag link(s) created.`
  )
}

main()
  .catch(e => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
