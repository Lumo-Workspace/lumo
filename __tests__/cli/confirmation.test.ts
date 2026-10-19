/**
 * @jest-environment node
 *
 * LUM-755: the confirmation protocol helpers. A mutation command that needs
 * human approval does not prompt and does not just refuse with a text error —
 * it exits 4 with a structured envelope the agent relays to the user, and the
 * user-approved re-run carries --confirm.
 */
import {
  EXIT_CONFIRMATION_REQUIRED,
  buildConfirmCommand,
  buildEnvelope,
  emitConfirmation,
  isConfirmed,
  renderConfirmation,
  shellQuote,
} from '@/cli/src/lib/confirmation'

describe('confirmation helpers', () => {
  describe('shellQuote', () => {
    it('leaves plain tokens alone', () => {
      expect(shellQuote('LUM-42')).toBe('LUM-42')
      expect(shellQuote('--team')).toBe('--team')
      expect(shellQuote('a1b2c3d4')).toBe('a1b2c3d4')
    })

    it('single-quotes values with spaces or shell metacharacters', () => {
      expect(shellQuote('Q3 Launch')).toBe("'Q3 Launch'")
      expect(shellQuote('a"b')).toBe("'a\"b'")
      expect(shellQuote('$HOME')).toBe("'$HOME'")
      expect(shellQuote('')).toBe("''")
    })

    it('escapes embedded single quotes', () => {
      expect(shellQuote("it's")).toBe("'it'\\''s'")
    })
  })

  describe('buildConfirmCommand', () => {
    it('reproduces argv and appends --confirm', () => {
      expect(buildConfirmCommand(['sprint', 'delete', '3'])).toBe(
        'lumo sprint delete 3 --confirm'
      )
    })

    it('keeps every flag that was passed, quoting values with spaces', () => {
      expect(
        buildConfirmCommand([
          'milestone',
          'delete',
          'Q3 Launch',
          '--project',
          'backend',
        ])
      ).toBe("lumo milestone delete 'Q3 Launch' --project backend --confirm")
      expect(
        buildConfirmCommand(['task', 'update', 'LUM-48', '--status', 'done'])
      ).toBe('lumo task update LUM-48 --status done --confirm')
    })

    it('appends extra flags before --confirm and never duplicates one already present', () => {
      expect(
        buildConfirmCommand(['worktree', 'rm', 'LUM-267'], ['--force'])
      ).toBe('lumo worktree rm LUM-267 --force --confirm')
      expect(
        buildConfirmCommand(
          ['worktree', 'rm', 'LUM-267', '--force'],
          ['--force']
        )
      ).toBe('lumo worktree rm LUM-267 --force --confirm')
      expect(
        buildConfirmCommand(
          ['worktree', 'rm', 'LUM-267', '--confirm'],
          ['--force']
        )
      ).toBe('lumo worktree rm LUM-267 --force --confirm')
    })

    it('defaults to the live process argv (minus node + script)', () => {
      const saved = process.argv
      process.argv = ['/usr/bin/node', '/x/lumo', 'memory', 'rm', 'cm1']
      try {
        expect(buildConfirmCommand()).toBe('lumo memory rm cm1 --confirm')
      } finally {
        process.argv = saved
      }
    })
  })

  describe('isConfirmed', () => {
    it('accepts --confirm only (LUM-1233 3i: the --yes alias is gone)', () => {
      expect(isConfirmed({ confirm: true })).toBe(true)
      expect(isConfirmed({ yes: true } as never)).toBe(false)
      expect(isConfirmed({})).toBe(false)
      expect(isConfirmed({ confirm: false })).toBe(false)
    })
  })

  describe('buildEnvelope / renderConfirmation', () => {
    const envelope = buildEnvelope({
      command: 'sprint delete',
      changes: [
        'Will delete sprint #3 "Sprint 3"',
        '12 tasks under it keep their data; only sprintId is cleared',
      ],
      argv: ['sprint', 'delete', '3'],
    })

    it('has the fixed field set', () => {
      expect(envelope).toEqual({
        status: 'confirmation_required',
        command: 'sprint delete',
        changes: [
          'Will delete sprint #3 "Sprint 3"',
          '12 tasks under it keep their data; only sprintId is cleared',
        ],
        confirmCommand: 'lumo sprint delete 3 --confirm',
      })
    })

    it('non-TTY: renders the envelope as JSON', () => {
      const out = renderConfirmation(envelope, false)
      expect(JSON.parse(out)).toEqual(envelope)
    })

    it('TTY: renders readable text listing every change and ending in a copyable re-run line', () => {
      const out = renderConfirmation(envelope, true)
      expect(out).not.toMatch(/^\s*\{/)
      expect(out).toContain('sprint delete')
      expect(out).toContain('Will delete sprint #3 "Sprint 3"')
      expect(out).toContain('12 tasks under it keep their data')
      const lines = out.trimEnd().split('\n')
      expect(lines[lines.length - 2]).toMatch(/Re-run with --confirm/)
      expect(lines[lines.length - 1]?.trim()).toBe(
        'lumo sprint delete 3 --confirm'
      )
    })
  })

  describe('emitConfirmation', () => {
    let stdout: string[]
    let stderr: string[]
    const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

    function setStdoutTTY(value: boolean) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value,
        configurable: true,
        writable: true,
      })
    }

    beforeEach(() => {
      stdout = []
      stderr = []
      jest.spyOn(process.stdout, 'write').mockImplementation(s => {
        stdout.push(String(s))
        return true
      })
      jest.spyOn(console, 'error').mockImplementation((...a) => {
        stderr.push(a.join(' '))
      })
    })

    afterEach(() => {
      jest.restoreAllMocks()
      if (original) Object.defineProperty(process.stdout, 'isTTY', original)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    })

    it('writes the JSON envelope to stdout (not stderr) and returns exit code 4 when piped', () => {
      setStdoutTTY(false)
      const code = emitConfirmation({
        command: 'memory rm',
        changes: ['Will hard-delete memory cm1 [DECISION]'],
        argv: ['memory', 'rm', 'cm1'],
      })
      expect(code).toBe(4)
      expect(EXIT_CONFIRMATION_REQUIRED).toBe(4)
      expect(stderr).toEqual([])
      const parsed = JSON.parse(stdout.join(''))
      expect(parsed.status).toBe('confirmation_required')
      expect(parsed.command).toBe('memory rm')
      expect(parsed.changes).toEqual(['Will hard-delete memory cm1 [DECISION]'])
      expect(parsed.confirmCommand).toBe('lumo memory rm cm1 --confirm')
    })

    it('writes readable text to stdout on a TTY, still exit 4', () => {
      setStdoutTTY(true)
      const code = emitConfirmation({
        command: 'memory rm',
        changes: ['Will hard-delete memory cm1 [DECISION]'],
        argv: ['memory', 'rm', 'cm1'],
      })
      expect(code).toBe(4)
      const out = stdout.join('')
      expect(() => JSON.parse(out)).toThrow()
      expect(out).toContain('Will hard-delete memory cm1 [DECISION]')
      expect(out.trimEnd().endsWith('lumo memory rm cm1 --confirm')).toBe(true)
    })
  })
})

describe('buildConfirmCommand — multi-step handshake (LUM-769)', () => {
  it('drops a previous step flag and its --receipt pair, then appends the new receipt and the requested step flag', async () => {
    const { buildConfirmCommand, buildEnvelope } =
      await import('@/cli/src/lib/confirmation')
    // Step 1 → asks for --confirm-read.
    expect(
      buildConfirmCommand(
        ['crossing', 'disposition', 'cx-1', '--false-positive'],
        ['--receipt', 'r1.tok'],
        '--confirm-read'
      )
    ).toBe(
      'lumo crossing disposition cx-1 --false-positive --receipt r1.tok --confirm-read'
    )
    // Step 2 re-ran from that command → the stale r1 pair and --confirm-read go, r2 + --confirm come.
    expect(
      buildConfirmCommand(
        [
          'crossing',
          'disposition',
          'cx-1',
          '--false-positive',
          '--receipt',
          'r1.tok',
          '--confirm-read',
        ],
        ['--receipt', 'r2.tok'],
        '--confirm'
      )
    ).toBe(
      'lumo crossing disposition cx-1 --false-positive --receipt r2.tok --confirm'
    )
    // `--receipt=value` spelling is stripped too; default flag stays --confirm.
    expect(
      buildConfirmCommand(['x', '--receipt=old', '--confirm'], [], undefined)
    ).toBe('lumo x --confirm')
    // The envelope threads confirmFlag + receipt through; no receipt → no key.
    const env = buildEnvelope({
      command: 'crossing disposition',
      changes: ['c'],
      argv: ['crossing', 'disposition', 'cx-1', '--confirmed'],
      receipt: { token: 'r1.tok', expiresAt: '2026-09-14T10:10:00.000Z' },
      confirmFlag: '--confirm-read',
    })
    expect(env.confirmCommand).toBe(
      'lumo crossing disposition cx-1 --confirmed --receipt r1.tok --confirm-read'
    )
    expect(env.receipt).toEqual({
      token: 'r1.tok',
      expiresAt: '2026-09-14T10:10:00.000Z',
    })
    expect(
      'receipt' in buildEnvelope({ command: 'x', changes: ['c'], argv: ['x'] })
    ).toBe(false)
  })
})
