/**
 * LUM-1332 — scripts/self-host/check-config.mjs turns the app's check
 * results into the lines setup.sh prints. Plain ESM run by `node` inside the
 * app container, so it is exercised through a real `node` process.
 */
import { execFileSync, spawn } from 'child_process'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const SCRIPT = pathToFileURL(
  join(__dirname, '..', '..', 'scripts', 'self-host', 'check-config.mjs')
).href

function formatReport(checks: unknown[]): {
  lines: string[]
  exitCode: number
} {
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
      {
        id: 'email',
        status: 'skipped',
        detail: 'not configured',
        hint: 'set SMTP_URL',
      },
    ])
    expect(exitCode).toBe(0)
    expect(lines[0]).toMatch(/^ {2}✓ Database +connected$/)
    expect(lines[1]).toMatch(/^ {2}– Email +not configured$/)
    expect(lines[2]?.trim()).toBe('set SMTP_URL')
    expect(lines).not.toContain('unused')
    expect(lines[lines.length - 1]).toBe('Configuration check passed.')
  })

  it('a failed check exits 1 and says how many failed', () => {
    const { lines, exitCode } = formatReport([
      {
        id: 'redis',
        status: 'failed',
        detail: 'closed',
        hint: 'check REDIS_URL',
      },
      { id: 'public_url', status: 'failed', detail: 'ENOTFOUND' },
    ])
    expect(exitCode).toBe(1)
    expect(lines[0]).toContain('✗ Redis')
    expect(lines[lines.length - 1]).toContain('2 failed')
  })

  it('importing it runs nothing (only --report does)', () => {
    expect(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `await import(${JSON.stringify(SCRIPT)})`,
        ],
        { encoding: 'utf8' }
      )
    ).toBe('')
  })
})

/** Runs the script with --report against a local server answering `status` / `body`. */
async function report(
  status: number,
  body: string
): Promise<{ code: number | null; out: string; auth: string | undefined }> {
  let auth: string | undefined
  const server: Server = createServer((req, res) => {
    auth = req.headers.authorization
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const child = spawn(process.execPath, [fileURLToPath(SCRIPT), '--report'], {
      env: {
        ...process.env,
        PORT: String(port),
        CRON_SECRET: 'fixture-secret',
      },
    })
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    const code = await new Promise<number | null>(resolve =>
      child.on('close', resolve)
    )
    return { code, out, auth }
  } finally {
    server.close()
  }
}

describe('check-config.mjs --report', () => {
  it('prints the report and exits with its code, sending the cron secret', async () => {
    const res = await report(
      200,
      JSON.stringify({
        checks: [{ id: 'database', status: 'failed', detail: 'down' }],
      })
    )
    expect(res.code).toBe(1)
    expect(res.out).toContain('✗ Database')
    expect(res.auth).toBe('Bearer fixture-secret')
  })

  it('a 404 means the image predates the check: exit 3', async () => {
    const res = await report(404, '{}')
    expect(res.code).toBe(3)
    expect(res.out).toContain('LUMO_IMAGE')
  })

  it('a 401 says the secret differs and how to fix it', async () => {
    const res = await report(401, '{}')
    expect(res.code).toBe(1)
    expect(res.out).toContain('CRON_SECRET')
  })

  it('an unexpected 200 body is a readable error, not a stack trace', async () => {
    for (const body of ['<html>', '{"other":1}']) {
      const res = await report(200, body)
      expect(res.code).toBe(1)
      expect(res.out).toContain('unexpected response')
      expect(res.out).not.toContain('    at ')
    }
  })
})
