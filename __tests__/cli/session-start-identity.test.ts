/**
 * @jest-environment node
 */
import * as path from 'path'
import { withCliIdentity } from '@/cli/src/lib/hook-runner'
import { readCliVersion } from '@/cli/src/lib/cli-version'

describe('session-start status line carries the cli version and identity', () => {
  const id = {
    version: '1.70.0',
    email: 'cli@uselumo.ai',
    workspaceSlug: 'lumo',
  }

  it('inserts version and identity right after the session id', () => {
    const [line] = withCliIdentity(
      [
        '[Lumo] session_id=s1 | Detected LUM-9 (from branch name). Run `lumo session attach LUM-9` to bind.',
      ],
      id
    )
    expect(line).toBe(
      '[Lumo] session_id=s1 | lumo 1.70.0 · cli@uselumo.ai (lumo) | Detected LUM-9 (from branch name). Run `lumo session attach LUM-9` to bind.'
    )
  })

  it('leaves the context JSON line and non-status lines untouched', () => {
    const json = '{"hookSpecificOutput":{}}'
    const out = withCliIdentity(
      ['[Lumo] session_id=s1 | Current task: LUM-1 - x', json],
      id
    )
    expect(out[1]).toBe(json)
    expect(withCliIdentity([json], id)).toEqual([json])
    expect(withCliIdentity([], id)).toEqual([])
  })

  it('degrades to a bare lumo tag when version or email is unknown', () => {
    const [line] = withCliIdentity(
      ['[Lumo] session_id=s1 | Current task: LUM-1 - x'],
      {
        version: null,
      }
    )
    expect(line).toBe('[Lumo] session_id=s1 | lumo | Current task: LUM-1 - x')
  })

  it('reads the version from the @lumoai/cli package.json', () => {
    const cliPkg = require(
      path.resolve(__dirname, '../../cli/package.json')
    ) as { version: string }
    expect(readCliVersion(path.resolve(__dirname, '../../cli/src/lib'))).toBe(
      cliPkg.version
    )
    expect(readCliVersion('/')).toBeNull()
  })
})
