/**
 * @jest-environment node
 *
 * LUM-1330 — the per-workspace record of renamed repositories, so a CLI whose
 * git remote still has the old name finds the repository under its current
 * one. An exact, confirmed name always wins; only a confirmed target counts.
 */
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findRenameState: jest.fn() },
}))

import {
  loadRenamedRepository,
  nextRepositoryAliases,
  parseRepositoryAliases,
  resolveRenamedRepository,
} from '@/lib/integrations/github/confirmed-repositories'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'

const findRenameState =
  githubAppInstallationRepository.findRenameState as jest.Mock

describe('parseRepositoryAliases', () => {
  it('keeps string → string entries under a lower-cased key', () => {
    expect(
      parseRepositoryAliases({ 'Acme/Old': 'acme/new', bad: 3, x: null })
    ).toEqual({ 'acme/old': 'acme/new' })
  })
  it('anything that is not an object reads as no record', () => {
    for (const v of [null, undefined, 'x', 1, ['a']])
      expect(parseRepositoryAliases(v)).toEqual({})
  })
  it('drops non-ASCII names (no Kelvin-sign folding)', () => {
    const kelvin = String.fromCodePoint(0x212a)
    expect(
      parseRepositoryAliases({ [`acme/${kelvin}ey`]: 'acme/key' })
    ).toEqual({})
  })
})

describe('nextRepositoryAliases', () => {
  it('records from → to', () => {
    expect(nextRepositoryAliases({}, 'Acme/Old', 'acme/new')).toEqual({
      'acme/old': 'acme/new',
    })
  })
  it('a chain A → B → C resolves A straight to C', () => {
    const ab = nextRepositoryAliases({}, 'acme/a', 'acme/b')
    expect(nextRepositoryAliases(ab, 'acme/b', 'acme/c')).toEqual({
      'acme/a': 'acme/c',
      'acme/b': 'acme/c',
    })
  })
  it('renaming back drops the name that is current again', () => {
    const ab = nextRepositoryAliases({}, 'acme/a', 'acme/b')
    expect(nextRepositoryAliases(ab, 'acme/b', 'acme/a')).toEqual({
      'acme/b': 'acme/a',
    })
  })
  it('a case-only rename records nothing', () => {
    const before = { 'acme/x': 'acme/y' }
    expect(nextRepositoryAliases(before, 'acme/App', 'acme/app')).toBe(before)
  })
})

describe('resolveRenamedRepository', () => {
  const aliases = { 'acme/old': 'acme/new' }
  it('the current name of a renamed, confirmed repository (any case)', () => {
    expect(resolveRenamedRepository(['acme/New'], aliases, 'ACME/old')).toBe(
      'acme/New'
    )
  })
  it('a name that is confirmed itself is never redirected', () => {
    expect(
      resolveRenamedRepository(['acme/old', 'acme/new'], aliases, 'acme/old')
    ).toBeNull()
  })
  it('a target no longer confirmed resolves to nothing', () => {
    expect(resolveRenamedRepository(['acme/other'], aliases, 'acme/old')).toBe(
      null
    )
  })
  it('a name never renamed resolves to nothing', () => {
    expect(resolveRenamedRepository(['acme/new'], aliases, 'acme/zzz')).toBe(
      null
    )
  })
})

describe('loadRenamedRepository', () => {
  beforeEach(() => jest.clearAllMocks())
  it("reads the workspace's own row", async () => {
    findRenameState.mockResolvedValue({
      repositories: ['acme/new'],
      repositoryAliases: { 'acme/old': 'acme/new' },
    })
    await expect(loadRenamedRepository('ws1', 'acme/old')).resolves.toBe(
      'acme/new'
    )
    expect(findRenameState).toHaveBeenCalledWith('ws1')
  })
  it('a failed read is no rename, never an error', async () => {
    findRenameState.mockRejectedValue(new Error('db down'))
    await expect(loadRenamedRepository('ws1', 'acme/old')).resolves.toBeNull()
  })
  it('no installation, or no workspace: nothing', async () => {
    findRenameState.mockResolvedValue(null)
    await expect(loadRenamedRepository('ws1', 'acme/old')).resolves.toBeNull()
    await expect(loadRenamedRepository('', 'acme/old')).resolves.toBeNull()
  })
})
