/**
 * @jest-environment node
 *
 * LUM-326 — deterministic selective-forgetting integration test.
 *
 * Proves the FactConsolidation later-fact-wins invariant end-to-end over the
 * REAL apply + supersede + active-read pipeline (backed by an in-memory Prisma
 * fake): given a SUPERSEDE op, the active/injection set converges to {A'} and
 * forgets {A} — unless the target carries a strong usage-trust verdict, in
 * which case the guard keeps it alive. The reconcile LLM that *decides* the op
 * and the embedding gateway are out of scope and mocked here; this asserts the
 * pipeline AFTER the decision, not the decision quality (LUM-329).
 *
 * Duplicated into `tests/` per the two-test-root convention; the assertions
 * live once in `runSelectiveForgettingSuite`.
 */
const embedTextsMock = jest.fn()
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: (...a: unknown[]) => embedTextsMock(...a),
  EMBEDDING_DIM: 1024,
}))

const resolveGuardedMock = jest.fn()
jest.mock('@/lib/services/memory/supersede-guard', () => ({
  resolveGuardedSupersedeIds: (...a: unknown[]) => resolveGuardedMock(...a),
}))

jest.mock('@/lib/db/prisma', () => {
  const { makeInMemoryPrisma } = require('@/test-utils/in-memory-memory-store')
  return { prisma: makeInMemoryPrisma() }
})

import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import {
  runSelectiveForgettingSuite,
  type InMemoryMemoryStore,
} from '@/test-utils/in-memory-memory-store'

const store = (prisma as unknown as { $store: InMemoryMemoryStore }).$store

runSelectiveForgettingSuite({
  applyLayer1Operations,
  memoryRepository,
  memoryProvenanceRepository,
  store,
  setGuarded: ids => resolveGuardedMock.mockResolvedValue(new Set(ids)),
  resetMocks: () => {
    embedTextsMock.mockImplementation(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2])
    )
    resolveGuardedMock.mockResolvedValue(new Set<string>())
  },
})
