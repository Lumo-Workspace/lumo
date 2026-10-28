/**
 * @jest-environment node
 *
 * LUM-1330 — against a REAL Postgres: the migration gives every installation
 * row an empty rename record, a rename writes old → new with the confirmed
 * list, and the old name then resolves to the current one — for that
 * workspace only.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import {
  loadRenamedRepository,
  nextRepositoryAliases,
  parseRepositoryAliases,
} from '@/lib/integrations/github/confirmed-repositories'

jest.setTimeout(180_000)

beforeAll(async () => {
  await harness.start()
  for (const ws of ['ws_a', 'ws_b']) {
    await harness.prisma!.workspace.create({
      data: { id: ws, name: ws, slug: ws },
    })
    await harness.prisma!.gitHubAppInstallation.create({
      data: { workspaceId: ws, installationId: 7, repositories: ['acme/old'] },
    })
  }
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-1330 repository aliases', () => {
  it('a new row starts with an empty record', async () => {
    const row = await githubAppInstallationRepository.findRenameState('ws_a')
    expect(row).toEqual({ repositories: ['acme/old'], repositoryAliases: {} })
  })

  it('a rename stores old → new, and only that workspace resolves it', async () => {
    const state = await githubAppInstallationRepository.findRecheckState('ws_a')
    const written = await githubAppInstallationRepository.renameRepository(
      'ws_a',
      {
        expectedUpdatedAt: state!.updatedAt,
        repositories: ['acme/new'],
        repositoryAliases: nextRepositoryAliases(
          parseRepositoryAliases(state!.repositoryAliases),
          'acme/old',
          'acme/new'
        ),
        from: 'acme/old',
        to: 'acme/new',
      }
    )
    expect(written).not.toBeNull()
    await expect(loadRenamedRepository('ws_a', 'Acme/Old')).resolves.toBe(
      'acme/new'
    )
    // ws_b still has the old name confirmed and no record.
    await expect(loadRenamedRepository('ws_b', 'acme/old')).resolves.toBeNull()
  })
})
