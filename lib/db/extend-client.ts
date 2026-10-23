import type { PrismaClient } from '@prisma/client'
import { withSoftDelete } from './soft-delete'
import { withHookPayloadEncryption } from './hook-payload-encryption'
import { createDataKeyRing } from '@/lib/hook-payload/data-key-ring'
import { createWorkspaceDataKeyStore } from '@/lib/repositories/workspace-data-key.repository'
import { isEncryptionKeyConfigured } from '@/lib/crypto'

/**
 * The query extensions every app client carries, in one place so real-Postgres
 * suites run the same stack as production.
 */
export function extendPrismaClient(base: PrismaClient): PrismaClient {
  // LUM-1302: HookEvent payloads are encrypted at rest with per-workspace
  // keys, which are read through the plain client.
  const encrypted = withHookPayloadEncryption(base, {
    ring: createDataKeyRing(createWorkspaceDataKeyStore(base)),
    enabled: isEncryptionKeyConfigured,
  })
  // LUM-918: tasks / documents in the trash are invisible to default reads.
  return withSoftDelete(encrypted)
}
