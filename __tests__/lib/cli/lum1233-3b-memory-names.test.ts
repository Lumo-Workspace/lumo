/**
 * @jest-environment node
 *
 * LUM-1233 batch 3b — server-written memory pointers (the session-start index
 * "+N more" line and the Layer-2 review section's delete line) name the
 * commands the caller's CLI has.
 */
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
  cliCommandNamesForVersion,
} from '@/lib/cli/command-names'
import { buildMemoryIndex } from '@/lib/services/memory/index-disclosure'
import { renderLayer2ReviewSection } from '@/lib/memory/render'

const mem = (n: number) => ({
  id: `cmem00000000000000000${String(n).padStart(4, '0')}`,
  category: 'TRAP' as const,
  scope: 'PROJECT' as const,
  content: { trigger: `t${n}`, outcome: `o${n}` },
})

describe('memory index pointer', () => {
  const memories = [mem(1), mem(2), mem(3)]
  it('legacy by default', () => {
    expect(buildMemoryIndex(memories as never, 1)).toContain(
      '`lumo project memory list` / `lumo task memory list` to browse'
    )
  })
  it('a current CLI gets memory list', () => {
    const out = buildMemoryIndex(memories as never, 1, CURRENT_CLI_COMMANDS)
    expect(out).toContain(
      '`lumo memory list --scope project` / `lumo memory list` to browse'
    )
    expect(out).not.toMatch(/task memory|project memory/)
  })
})

describe('Layer-2 review delete line', () => {
  it('legacy keeps memory rm', () => {
    expect(renderLayer2ReviewSection([mem(1)] as never)).toContain(
      '`lumo memory rm <ref> --yes`'
    )
  })
  it('a current CLI gets memory delete with the confirmation step', () => {
    const out = renderLayer2ReviewSection(
      [mem(1)] as never,
      CURRENT_CLI_COMMANDS
    )
    expect(out).toContain('`lumo memory delete <ref>`')
    expect(out).toContain('`--confirm` command once they approve')
    expect(out).not.toContain('memory rm')
    expect(out).not.toContain('--yes')
  })
})

describe('the memory floor is its own', () => {
  it('a CLI past the other floors but not the memory one keeps the old names', () => {
    const names = cliCommandNamesForVersion('1.126.0', {
      LUMO_MEMORY_SCOPE_MIN_CLI_VERSION: '1.127.0',
    })
    expect(names.memoryScope).toBe(false)
    expect(names.current).toBe(true)
    expect(names.memoryBrowse).toBe(LEGACY_CLI_COMMANDS.memoryBrowse)
  })
})
