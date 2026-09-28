/**
 * @jest-environment node
 *
 * LUM-893 — the post-tool-use hook folds `_lumo_written_path_ignored` into a
 * Write/Edit/MultiEdit body so the server can record a secret written to a
 * gitignored file as advisory. Only a real answer reaches the wire.
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { augmentBodyWithWrittenPathIgnored } from '@/cli/src/lib/hook-runner'
import { probeWrittenPathIgnored } from '@/cli/src/lib/git-ignored-path'

const body = (toolName: string, input: Record<string, unknown>) =>
  JSON.stringify({
    session_id: 's1',
    cwd: '/repo/here',
    tool_name: toolName,
    tool_input: input,
  })

describe('LUM-893 gitignore probe', () => {
  it('LUM-893 hook folds gitignore probe into write payloads', () => {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      for (const answer of [true, false]) {
        const probe = jest.fn().mockReturnValue(answer)
        const out = JSON.parse(
          augmentBodyWithWrittenPathIgnored(
            'post-tool-use',
            body(tool, { file_path: '/repo/here/.env.local', content: 'x' }),
            probe
          )
        )
        expect(probe).toHaveBeenCalledWith(
          '/repo/here',
          '/repo/here/.env.local'
        )
        expect(out['_lumo_written_path_ignored']).toBe(answer)
      }
    }

    // Probe could not answer, or threw: body untouched (server fails closed).
    const writeBody = body('Write', { file_path: 'a.ts', content: 'x' })
    expect(
      augmentBodyWithWrittenPathIgnored('post-tool-use', writeBody, () => null)
    ).toBe(writeBody)
    expect(
      augmentBodyWithWrittenPathIgnored('post-tool-use', writeBody, () => {
        throw new Error('boom')
      })
    ).toBe(writeBody)

    // Non-write events and other hook paths: never probed.
    const probe = jest.fn().mockReturnValue(true)
    const bash = body('Bash', { command: 'ls' })
    expect(
      augmentBodyWithWrittenPathIgnored('post-tool-use', bash, probe)
    ).toBe(bash)
    expect(
      augmentBodyWithWrittenPathIgnored('pre-tool-use', writeBody, probe)
    ).toBe(writeBody)
    expect(probe).not.toHaveBeenCalled()

    // Real git: ignored, not ignored, tracked-but-matching, outside a repo.
    const dir = mkdtempSync(join(tmpdir(), 'lum893-'))
    const outside = mkdtempSync(join(tmpdir(), 'lum893-out-'))
    try {
      const git = (...args: string[]) =>
        spawnSync('git', args, { cwd: dir, stdio: 'ignore' }).status
      expect(git('init', '-q')).toBe(0)
      writeFileSync(join(dir, '.gitignore'), '.env*.local\nsecret.txt\n')
      writeFileSync(join(dir, 'secret.txt'), 'x')
      expect(git('add', '-f', 'secret.txt')).toBe(0)
      expect(probeWrittenPathIgnored(dir, join(dir, '.env.local'))).toBe(true)
      expect(probeWrittenPathIgnored(dir, '.env.development.local')).toBe(true)
      expect(probeWrittenPathIgnored(dir, join(dir, 'lib/config.ts'))).toBe(
        false
      )
      // Tracked files are never reported ignored — they get committed.
      expect(probeWrittenPathIgnored(dir, 'secret.txt')).toBe(false)
      expect(
        probeWrittenPathIgnored(outside, join(outside, '.env.local'))
      ).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
