/**
 * @jest-environment node
 *
 * LUM-505 — `resolveDocContent` must not turn a missing content channel into
 * an empty body. In a non-TTY shell (the common agent/CI case) with no
 * `--content`/`--file` and nothing piped, the stdin read comes back empty;
 * that must resolve to `kind: 'none'` (body untouched) rather than
 * `kind: 'ok'` with an empty string (which ships an empty body and trips the
 * LUM-410 structure guard). Piped real content and an explicit empty
 * `--content ""` must keep working.
 */
import { resolveDocContent } from '../../src/lib/doc-input'

const baseArgs = {
  content: undefined as string | undefined,
  file: undefined as string | undefined,
  stdinIsTTY: false,
  readStdin: async () => '',
  readFile: async () => '',
}

describe('resolveDocContent — LUM-505 missing content channel', () => {
  it('LUM-505 empty or whitespace-only non-TTY stdin resolves to none', async () => {
    const empty = await resolveDocContent({
      ...baseArgs,
      readStdin: async () => '',
    })
    expect(empty).toEqual({ kind: 'none' })

    const whitespace = await resolveDocContent({
      ...baseArgs,
      readStdin: async () => '\n  \t\n',
    })
    expect(whitespace).toEqual({ kind: 'none' })
  })

  it('LUM-505 piped real content still resolves to ok with the markdown', async () => {
    const md = '# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
    const res = await resolveDocContent({
      ...baseArgs,
      readStdin: async () => md,
    })
    expect(res).toEqual({ kind: 'ok', markdown: md })
  })

  it('LUM-505 explicit empty --content still resolves to ok empty markdown', async () => {
    const res = await resolveDocContent({
      ...baseArgs,
      content: '',
      // stdin must not be consulted when --content is set, even if empty
      readStdin: async () => 'SHOULD NOT BE READ',
    })
    expect(res).toEqual({ kind: 'ok', markdown: '' })
  })

  it('returns kind none on a TTY shell with no flags (unchanged)', async () => {
    const res = await resolveDocContent({
      ...baseArgs,
      stdinIsTTY: true,
      readStdin: async () => 'SHOULD NOT BE READ',
    })
    expect(res).toEqual({ kind: 'none' })
  })
})
