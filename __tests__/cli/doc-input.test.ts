import { resolveDocContent } from '@/cli/src/lib/doc-input'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('resolveDocContent', () => {
  it('returns content from --content', async () => {
    const result = await resolveDocContent({
      content: 'hi',
      file: undefined,
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('hi')
  })

  it('returns content from --file', async () => {
    const tmp = path.join(os.tmpdir(), 'lumo-doc-test.md')
    fs.writeFileSync(tmp, '# Hello')
    const result = await resolveDocContent({
      content: undefined,
      file: tmp,
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async p => fs.promises.readFile(p, 'utf8'),
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('# Hello')
    fs.unlinkSync(tmp)
  })

  it('returns content from stdin when not a TTY', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: undefined,
      stdinIsTTY: false,
      readStdin: async () => '## piped',
      readFile: async () => '',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('## piped')
  })

  it('returns none when nothing is provided and stdin is a TTY', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: undefined,
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('none')
  })

  it('errors when --content and --file are both set', async () => {
    const result = await resolveDocContent({
      content: 'a',
      file: '/tmp/b.md',
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('error')
  })

  it('prefers --content over non-TTY stdin (silently ignores stdin)', async () => {
    let stdinRead = false
    const result = await resolveDocContent({
      content: 'from-flag',
      file: undefined,
      stdinIsTTY: false,
      readStdin: async () => {
        stdinRead = true
        return 'from-stdin'
      },
      readFile: async () => '',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('from-flag')
    expect(stdinRead).toBe(false)
  })

  it('prefers --file over non-TTY stdin (silently ignores stdin)', async () => {
    let stdinRead = false
    const result = await resolveDocContent({
      content: undefined,
      file: '/tmp/x.md',
      stdinIsTTY: false,
      readStdin: async () => {
        stdinRead = true
        return 'from-stdin'
      },
      readFile: async () => 'from-file',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('from-file')
    expect(stdinRead).toBe(false)
  })

  it('handles non-TTY shell with no actual pipe (e.g. < /dev/null) when --content is set', async () => {
    // Regression for LUM-84: in Claude Code's Bash tool and other non-TTY
    // shells, stdin is non-TTY even when nothing is piped. --content must
    // still work without erroring.
    const result = await resolveDocContent({
      content: 'hello',
      file: undefined,
      stdinIsTTY: false,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('hello')
  })
})
