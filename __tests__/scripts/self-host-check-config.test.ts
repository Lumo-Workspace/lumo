/**
 * LUM-1332 — scripts/self-host/check-config.mjs turns the app's check
 * results into the lines setup.sh prints. Plain ESM run by `node` inside the
 * app container, so it is exercised through a real `node` process.
 */
import { execFileSync } from 'child_process'
import { join } from 'path'
import { pathToFileURL } from 'url'

const SCRIPT = pathToFileURL(
  join(__dirname, '..', '..', 'scripts', 'self-host', 'check-config.mjs')
).href

function formatReport(checks: unknown[]): { lines: string[]; exitCode: number } {
  const code = `const m = await import(${JSON.stringify(SCRIPT)});
process.stdout.write(JSON.stringify(m.formatReport(${JSON.stringify(checks)})))`
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
    })
  )
}

describe('check-config.mjs formatReport', () => {
  it('all usable: marks each line, prints hints only for what is not ok, exits 0', () => {
    const { lines, exitCode } = formatReport([
      { id: 'database', status: 'ok', detail: 'connected', hint: 'unused' },
      { id: 'email', status: 'skipped', detail: 'not configured', hint: 'set SMTP_URL' },
    ])
    expect(exitCode).toBe(0)
    expect(lines[0]).toMatch(/^ {2}✓ Database +connected$/)
    expect(lines[1]).toMatch(/^ {2}– Email +not configured$/)
    expect(lines[2]?.trim()).toBe('set SMTP_URL')
    expect(lines).not.toContain('unused')
    expect(lines.at(-1)).toBe('Configuration check passed.')
  })

  it('a failed check exits 1 and says how many failed', () => {
    const { lines, exitCode } = formatReport([
      { id: 'redis', status: 'failed', detail: 'closed', hint: 'check REDIS_URL' },
      { id: 'public_url', status: 'failed', detail: 'ENOTFOUND' },
    ])
    expect(exitCode).toBe(1)
    expect(lines[0]).toContain('✗ Redis')
    expect(lines.at(-1)).toContain('2 failed')
  })

  it('importing it runs nothing (only --report does)', () => {
    expect(
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(SCRIPT)})`],
        { encoding: 'utf8' }
      )
    ).toBe('')
  })
})
