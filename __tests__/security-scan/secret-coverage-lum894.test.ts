/** @jest-environment node */
// LUM-1064: plugin cases live in __tests__/ee/security/security-scan/secret-coverage-lum894.test.ts.
// The cases that also run the hunt sandbox's sanitizeHuntOutput live there
// verbatim; the "(core entry points)" copies below keep the same assertions
// over the core redaction entry points.

import {
  redactForInjection,
  redactForStorage,
  redactKnownSecrets,
  redactPrivateKeysAcrossParts,
  scanSecrets,
} from '@/lib/security-scan/scan-secrets'
import { secretFingerprint } from '@/lib/security-scan/redact'
import { redactHookPayload } from '@/lib/validation/hook-payload'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'

// Every credential-shaped value below is assembled at runtime from a seeded
// generator and split prefixes, so no literal in this file looks like a real
// credential (team convention: never hardcode credential-shaped fixtures).

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const B64 = ALNUM + '+/'
const HEX = '0123456789abcdef'

function gen(alphabet: string, len: number, seed: number): string {
  let x = seed >>> 0 || 1
  let out = ''
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out += alphabet[(x >>> 8) % alphabet.length]
  }
  return out
}

const DASHES = '-'.repeat(5)
const begin = (label: string) => `${DASHES}BEGIN ${label}${DASHES}`
const end = (label: string) => `${DASHES}END ${label}${DASHES}`
const bodyLines = (seed: number, n = 6) =>
  Array.from({ length: n }, (_, i) => gen(B64, 64, seed + i))
const RSA = 'RSA PRIVATE KEY'

type EntryPoint = [string, (text: string) => string]

const ENTRY_POINTS: EntryPoint[] = [
  ['redactForStorage', t => redactForStorage(t).text],
  [
    'redactHookPayload',
    t => {
      const { payload } = redactHookPayload({ tool_response: { stdout: t } })
      return (payload.tool_response as { stdout: string }).stdout
    },
  ],
  ['redactForInjection', t => redactForInjection(t).text],
  ['redactKnownSecrets', t => redactKnownSecrets(t)],
]

/** Stored copy of a hook event, as the hook handler builds it. */
function stored(payload: Record<string, unknown>): string {
  return JSON.stringify(
    stripCodeFromHookPayload(
      'POST_TOOL_USE',
      redactHookPayload(payload).payload
    )
  )
}

describe('LUM-894 private keys split across array elements', () => {
  test('LUM-894 array-split private key body is not persisted', () => {
    const body = bodyLines(500, 25)
    const key = [begin(RSA), ...body, end(RSA)]
    const filePath = '__tests__/fixtures/keys.test.ts'
    const content = `export const KEY = \`${key.join('\n')}\`\n`

    // Write to a test file: LUM-855 keeps tool_input and the structuredPatch.
    const write = stored({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
      tool_response: {
        type: 'create',
        filePath,
        content,
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: key.length,
            lines: content.split('\n').map(l => `+${l}`),
          },
        ],
      },
    })
    // Edit of a test file: context, removed and added lines in one hunk.
    const edit = stored({
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
      tool_response: {
        filePath,
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: key.length,
            newStart: 1,
            newLines: key.length,
            lines: [
              ' export const KEY = `',
              ...key.map(l => `-${l}`),
              ...key.map(l => `+${l}`),
              ' `',
            ],
          },
        ],
      },
    })
    // Any payload that carries a key one line per array element.
    const bare = stored({ tool_response: { lines: key } })
    const nested = stored({ tool_calls: [{ tool_response: { out: key } }] })

    for (const [name, text] of Object.entries({ write, edit, bare, nested })) {
      const survived = body.filter(line => text.includes(line)).length
      expect([name, survived]).toEqual([name, 0])
      expect([name, text.includes(end(RSA))]).toEqual([name, false])
    }
    // The test-file diff is still kept — only the key is cut out of it.
    expect(write).toContain('+export const KEY = `')
    expect(edit).toContain(' export const KEY = `')

    // An array without a key comes back untouched (same reference).
    const plain = { tool_response: { lines: ['+one', '+two', '-three'] } }
    const { payload } = redactHookPayload(plain)
    expect(payload).toBe(plain)

    // The part-level helper keeps the array shape and marks one redaction.
    const parts = ['before', ...key, 'after']
    const out = redactPrivateKeysAcrossParts(parts)
    expect(out.count).toBe(1)
    expect(out.parts).toHaveLength(parts.length)
    expect(out.parts[0]).toBe('before')
    expect(out.parts[parts.length - 1]).toBe('after')
    expect(out.parts.join('\n')).toContain('…(len ')
    for (const line of body) expect(out.parts.join('\n')).not.toContain(line)
  })
})

describe('LUM-894 prefixed and headless private key bodies', () => {
  test('LUM-894 prefixed and headless private key bodies are redacted (core entry points)', () => {
    const body = bodyLines(700, 25)
    const tailShort = gen(B64, 40, 777) + '=='
    const truncated = [begin(RSA), ...body]
    const catN = (lines: string[], from = 1) =>
      lines.map((l, i) => `${String(i + from).padStart(6)}\t${l}`)
    const arrow = (lines: string[], from = 1) =>
      lines.map((l, i) => `${String(i + from).padStart(6)}→${l}`)

    const cases: Record<string, { text: string; secret: string[] }> = {
      catN: {
        text: [...catN(truncated), '$ echo done'].join('\n'),
        secret: body,
      },
      readArrow: {
        text: [...arrow(truncated), '… (file truncated)'].join('\n'),
        secret: body,
      },
      rgContext: {
        text: [
          `keys/id_rsa:1:${begin(RSA)}`,
          ...body.slice(0, 5).map((l, i) => `keys/id_rsa-${i + 2}-${l}`),
          '--',
          'src/app.ts:12:const x = 1',
        ].join('\n'),
        secret: body.slice(0, 5),
      },
      grepNoPath: {
        text: [
          `1:${begin(RSA)}`,
          ...body.slice(0, 5).map((l, i) => `${i + 2}-${l}`),
        ].join('\n'),
        secret: body.slice(0, 5),
      },
      trailingSpaces: {
        text: [begin(RSA), ...body.map(l => `${l}   `), 'next output'].join(
          '\n'
        ),
        secret: body,
      },
      diffRemoved: {
        text: [`-${begin(RSA)}`, ...body.map(l => `-${l}`), ' context'].join(
          '\n'
        ),
        secret: body,
      },
      headlessSed: {
        text: ['$ sed -n 2,10p key.pem', ...body.slice(0, 9), '$ ls'].join(
          '\n'
        ),
        secret: body.slice(0, 9),
      },
      headlessCatN: {
        text: [...catN(body.slice(3, 12), 4), '$ ls'].join('\n'),
        secret: body.slice(3, 12),
      },
      headlessJsonEscaped: {
        text: `{"stdout":"${body.slice(0, 8).join('\\n')}\\n${tailShort}"}`,
        secret: [...body.slice(0, 8), tailShort],
      },
      tail: {
        text: ['$ tail -n 3 key.pem', body[24]!, tailShort, end(RSA)].join(
          '\n'
        ),
        secret: [body[24]!, tailShort],
      },
      lowercase: {
        text: [
          begin(RSA.toLowerCase()),
          ...body.slice(0, 4),
          end(RSA.toLowerCase()),
        ].join('\n'),
        secret: body.slice(0, 4),
      },
    }

    // Over the 16k complete-block bound, in JSON-array and line-number form.
    const big = bodyLines(900, 300)
    cases.over16kJsonArray = {
      text: `lines = ${JSON.stringify([begin(RSA), ...big, end(RSA)])}`,
      secret: big,
    }
    cases.over16kLineNumbers = {
      text: catN([begin(RSA), ...big, end(RSA)]).join('\n'),
      secret: big,
    }

    // PuTTY .ppk: the private section goes, the public part stays.
    const pub = Array.from({ length: 4 }, (_, i) => gen(B64, 64, 950 + i))
    const priv = [
      ...Array.from({ length: 5 }, (_, i) => gen(B64, 64, 960 + i)),
      gen(B64, 24, 970),
    ]
    const mac = gen(HEX, 64, 971)
    cases.putty = {
      text: [
        'PuTTY-User-Key-File-3: ssh-rsa',
        'Encryption: none',
        'Comment: rsa-key-20260928',
        `Public-Lines: ${pub.length}`,
        ...pub,
        `Private-Lines: ${priv.length}`,
        ...priv,
        `Private-MAC: ${mac}`,
      ].join('\n'),
      secret: [...priv, mac],
    }

    for (const [form, c] of Object.entries(cases)) {
      const text = `before the key\n${c.text}\nafter the key`
      for (const [name, redact] of ENTRY_POINTS) {
        const out = redact(text)
        const where = `${name} / ${form}`
        const survived = c.secret.filter(line => out.includes(line)).length
        expect([where, survived]).toEqual([where, 0])
        expect([where, out.includes('after the key')]).toEqual([where, true])
      }
    }

    // A public certificate / public key body is not a private key.
    const cert = ['CERTIFICATE', 'PUBLIC KEY'].map(label =>
      [
        begin(label),
        ...bodyLines(1000, 8),
        gen(B64, 30, 1100),
        end(label),
      ].join('\n')
    )
    // Plain hex digests one per line are not a key body.
    const digests = Array.from({ length: 6 }, (_, i) => gen(HEX, 64, 1200 + i))
    for (const text of [...cert, digests.join('\n')]) {
      expect(redactForStorage(text).text).toBe(text)
      expect(redactForInjection(text).text).toBe(text)
    }
  })
})

describe('LUM-894 single-line PEM fingerprints', () => {
  // The pre-LUM-887 rule, verbatim: it matched (and fingerprinted) the header.
  const PRE_LUM887 =
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/

  test('LUM-894 single-line PEM keeps the pre-LUM-887 fingerprint', () => {
    const body = bodyLines(1300, 4)
    const lines = {
      gcpJson: `  "private_key": "${[begin('PRIVATE KEY'), ...body, end('PRIVATE KEY')].join('\\n')}\\n",`,
      envQuoted: `KEY="${[begin(RSA), ...body, end(RSA)].join('\\n')}"`,
      spaceFlattened: `SSH_KEY=${[begin('OPENSSH PRIVATE KEY'), ...body, end('OPENSSH PRIVATE KEY')].join(' ')}`,
    }
    for (const [form, text] of Object.entries(lines)) {
      const findings = scanSecrets([
        { path: 'config/service-account.json', lines: [{ lineNo: 3, text }] },
      ])
      const pem = findings.filter(f => f.ruleId === 'secret:private-key-block')
      expect([form, pem.length]).toEqual([form, 1])
      const header = PRE_LUM887.exec(text)![0]
      expect([form, pem[0]!.fingerprint]).toEqual([
        form,
        secretFingerprint('secret:private-key-block', header),
      ])
      for (const line of body) expect(pem[0]!.evidence).not.toContain(line)
    }
    // Two different keys under the same header share the finding identity,
    // exactly as they did before LUM-887.
    const other = `KEY="${[begin(RSA), ...bodyLines(1400, 4), end(RSA)].join('\\n')}"`
    const [a] = scanSecrets([
      { path: 'a.env', lines: [{ lineNo: 1, text: lines.envQuoted }] },
    ])
    const [b] = scanSecrets([
      { path: 'a.env', lines: [{ lineNo: 1, text: other }] },
    ])
    expect(a!.fingerprint).toBe(b!.fingerprint)
  })
})

describe('LUM-894 missed credential shapes', () => {
  const pw = gen(ALNUM, 8, 31) + '!' + gen(ALNUM, 5, 32) + '9'
  const tok = gen(ALNUM, 30, 33) + '7'
  const cases: { rule: string; line: string; value: string }[] = [
    { rule: 'lowercase env', line: `api_key=${tok}`, value: tok },
    { rule: 'lowercase env', line: `export db_password=${pw}`, value: pw },
    {
      rule: 'SECRET_KEY_BASE',
      line: `SECRET_KEY_BASE=${gen(HEX, 128, 34)}`,
      value: gen(HEX, 128, 34),
    },
    {
      rule: 'quoted with spaces',
      line: `export TOKEN="${gen(ALNUM, 6, 35)} ${gen(ALNUM, 6, 36)} ${gen(ALNUM, 6, 37)}"`,
      value: `${gen(ALNUM, 6, 35)} ${gen(ALNUM, 6, 36)} ${gen(ALNUM, 6, 37)}`,
    },
    { rule: 'yaml', line: `  password: ${pw}`, value: pw },
    { rule: 'yaml', line: `  DB_PASSWORD: ${pw} # prod`, value: pw },
    { rule: 'json', line: `{"password": "${pw}"}`, value: pw },
    { rule: 'json', line: `{"client_secret":"${tok}"}`, value: tok },
    { rule: 'X-API-Key', line: `X-API-Key: ${tok}`, value: tok },
    {
      rule: 'X-API-Key',
      line: `curl -H "x-api-key: ${tok}" https://api.example.com`,
      value: tok,
    },
    {
      rule: 'Cookie',
      line: `Cookie: session=${tok}; theme=dark`,
      value: tok,
    },
    {
      rule: 'curl -u',
      line: `curl -u admin:${pw} https://api.example.com`,
      value: pw,
    },
    {
      rule: 'curl --user',
      line: `curl --user=admin:${pw} https://api.example.com`,
      value: pw,
    },
    {
      rule: 'docker login -p',
      line: `docker login -u bot -p ${pw} ghcr.io`,
      value: pw,
    },
    { rule: 'mysql -p', line: `mysql -h db -u root -p${pw} app`, value: pw },
    { rule: '--secret', line: `tool deploy --secret ${tok}`, value: tok },
    { rule: '--key', line: `tool sign --key=${tok}`, value: tok },
    {
      rule: 'kubectl',
      line: `kubectl create secret generic db --from-literal=password=${pw}`,
      value: pw,
    },
    {
      rule: 'url https',
      line: `git clone https://deploy:${pw}@git.example.com/x/y.git`,
      value: pw,
    },
    {
      rule: 'url amqp',
      line: `AMQP=amqp://guest:${pw}@mq:5672/`,
      value: pw,
    },
    {
      rule: 'json-escaped newline',
      line: `{"env":"FOO=1\\nAPI_KEY=${tok}\\nBAR=2"}`,
      value: tok,
    },
    {
      rule: 'npm 37',
      line: `//registry.npmjs.org/:_authToken=${'npm_' + gen(ALNUM, 37, 38)}`,
      value: 'npm_' + gen(ALNUM, 37, 38),
    },
    {
      rule: 'lum uppercase',
      line: `lumo auth login ${'lum_' + gen(HEX, 64, 39).toUpperCase()}`,
      value: 'lum_' + gen(HEX, 64, 39).toUpperCase(),
    },
  ]

  const benign = [
    'password: string',
    'token: string | null',
    '  apiKey: process.env.API_KEY,',
    'apiKey: config.apiKey',
    '"password": "Password",',
    '"token": "Token expired",',
    '"secret": "Secret",',
    'def login(username, password=None):',
    'connect(password=db_password)',
    "const token = searchParams.get('token')",
    'secret: true',
    'password: ${DB_PASSWORD}',
    'git push -u origin main',
    'docker run -u 1000:1000 node:20',
    'curl --key client.key --cert client.crt https://api.example.com',
    'mysql -h localhost -P 3306 -u root -p',
    'kubectl create secret generic x --from-literal=password=$DB_PASSWORD',
    'git clone https://github.com/org/repo.git',
    'headers: { cookie: `session=${sid}` },',
    'X-API-Key: ${API_KEY}',
    'export PASSWORD_HINT="use your pet name"',
    'docker build --secret id=npmrc,src=.npmrc .',
    'echo "$PASSWORD" | docker login --password-stdin ghcr.io',
    'export TOKEN="${GH_TOKEN} ${OTHER}"',
    'sort --key 2 data.txt',
    "  'x-api-key': process.env.PARTNER_KEY,",
    '  apiKey: apiKeyFromEnv(),',
    // Shapes the production stock count surfaced as false positives.
    'echo "READY $(date -u +%FT%H:%M:%SZ)"',
    "now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
    "KEY=$(grep '^AI_GATEWAY_API_KEY=' /Users/me/app/.env.local | cut -d= -f2)",
    'grep -q "^CLERK_SECRET=" .env.local && echo "set"',
  ]

  test('LUM-894 missed credential shapes are redacted without touching benign code (core entry points)', () => {
    for (const c of cases) {
      const outputs: Record<string, string> = {}
      for (const [name, redact] of ENTRY_POINTS) outputs[name] = redact(c.line)
      for (const [name, out] of Object.entries(outputs))
        expect([c.rule, c.line, name, out.includes(c.value)]).toEqual([
          c.rule,
          c.line,
          name,
          false,
        ])
      const found = scanSecrets([
        { path: 'src/app.ts', lines: [{ lineNo: 1, text: c.line }] },
      ])
      expect([c.line, found.length]).toEqual([c.line, 1])
      expect([c.line, found[0]!.evidence.includes(c.value)]).toEqual([
        c.line,
        false,
      ])
    }
    for (const line of benign) {
      expect([line, redactForStorage(line).text]).toEqual([line, line])
      expect([line, redactForInjection(line).text]).toEqual([line, line])
      expect([
        line,
        scanSecrets([
          { path: 'src/app.ts', lines: [{ lineNo: 1, text: line }] },
        ]).length,
      ]).toEqual([line, 0])
    }
  })
})
