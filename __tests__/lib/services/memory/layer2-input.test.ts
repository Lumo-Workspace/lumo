/**
 * @jest-environment node
 *
 * Unit tests for loadConstitution (LUM-137). It reads CLAUDE.md / AGENTS.md
 * from the repo root and must degrade gracefully — a missing or unreadable
 * file becomes null so Layer 2 consolidation never fails over a missing
 * constitution file.
 */
import { readFile } from 'node:fs/promises'
import { loadConstitution } from '@/lib/services/memory/layer2-input'

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}))

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>

describe('loadConstitution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns both files trimmed when present', async () => {
    mockReadFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('CLAUDE.md')) return '\n# Claude\nrule\n\n'
      if (String(filePath).endsWith('AGENTS.md')) return '  # Agents  '
      throw new Error('unexpected path')
    })
    const result = await loadConstitution()
    expect(result).toEqual({
      claudeMd: '# Claude\nrule',
      agentsMd: '# Agents',
    })
  })

  it('degrades a missing file to null without throwing', async () => {
    mockReadFile.mockImplementation(async filePath => {
      if (String(filePath).endsWith('CLAUDE.md')) return 'present'
      const err = Object.assign(new Error('not found'), { code: 'ENOENT' })
      throw err
    })
    const result = await loadConstitution()
    expect(result).toEqual({ claudeMd: 'present', agentsMd: null })
  })

  it('treats an empty / whitespace-only file as null', async () => {
    mockReadFile.mockResolvedValue('   \n  \n')
    const result = await loadConstitution()
    expect(result).toEqual({ claudeMd: null, agentsMd: null })
  })
})
