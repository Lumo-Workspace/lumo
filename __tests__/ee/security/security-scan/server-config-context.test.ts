import {
  SERVER_CONFIG_MAX_CHARS,
  SERVER_CONFIG_MAX_FILE_CHARS,
  SERVER_CONFIG_MAX_FILES,
  isSecretLikePath,
  isServerConfigName,
  loadServerConfigContext,
  packServerConfig,
  planServerConfigContext,
  selectServerConfigFiles,
} from '@/ee/security/security-scan/server-config-context'

/** One file section of a unified diff with the given added lines. */
function section(path: string, added: string[], context: string[] = []) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${context.length} +1,${context.length + added.length} @@`,
    ...context.map(l => ` ${l}`),
    ...added.map(l => `+${l}`),
  ].join('\n')
}

// The LUM-1158 benchmark's miss (oss-38): a Makefile target that starts the
// frontend dev server from a subdirectory whose Trunk.toml binds 0.0.0.0.
const MAKEFILE_DIFF = section('Makefile', [
  '.PHONY: serve-fe',
  'serve-fe: ## Run frontend dev server with Trunk: make serve-fe',
  '\t@echo "==> Starting frontend dev server (trunk serve)"',
  '\t@cd $(PROJECT_DIR)/frontend && $(TRUNK) serve',
])

describe('LUM-1208 server config context — trigger detection', () => {
  it('a Makefile line that starts a server from a subdirectory plans that directory and its own', () => {
    const plan = planServerConfigContext(MAKEFILE_DIFF)
    expect(plan.triggers).toEqual(['Makefile'])
    // The directory the command runs in comes before the Makefile's own.
    expect(plan.dirs).toEqual(['frontend', ''])
  })

  it('package.json: a dev/start/serve script triggers, a dependency bump does not', () => {
    const script = section('web/package.json', ['    "dev": "vite --host",'])
    expect(planServerConfigContext(script).dirs).toEqual(['web'])
    const bump = section('web/package.json', ['    "vite": "^5.4.0",'])
    expect(planServerConfigContext(bump).triggers).toEqual([])
  })

  it('package.json: only an added scripts entry triggers, never a dependency whose name says dev/start/serve/preview', () => {
    const pkg = (added: string[], context: string[]) =>
      [
        'diff --git a/web/package.json b/web/package.json',
        '--- a/web/package.json',
        '+++ b/web/package.json',
        '@@ -10,4 +10,5 @@',
        ...context.map(l => ` ${l}`),
        ...added.map(l => `+${l}`),
      ].join('\n')
    // Inside "devDependencies" (its key in the hunk's context).
    expect(
      planServerConfigContext(
        pkg(['    "webpack-dev-server": "^5.0.4",'], ['  "devDependencies": {'])
      ).triggers
    ).toEqual([])
    expect(
      planServerConfigContext(
        pkg(['    "serve-static": "^1.16.2",'], ['  "dependencies": {'])
      ).triggers
    ).toEqual([])
    // Hunk starts mid-object (no key in sight): a version-like value is a
    // dependency, a command is a script.
    expect(
      planServerConfigContext(
        pkg(['    "start-server-and-test": "2.0.3",'], [])
      ).triggers
    ).toEqual([])
    expect(
      planServerConfigContext(pkg(['    "dev:web": "next dev -p 3000",'], []))
        .triggers
    ).toEqual(['web/package.json'])
    // Inside "scripts": a dev script triggers even with a version-like look.
    expect(
      planServerConfigContext(
        pkg(['    "start": "node server.js",'], ['  "scripts": {'])
      ).triggers
    ).toEqual(['web/package.json'])
    // After "scripts" closes, the next object's entries are not scripts.
    expect(
      planServerConfigContext(
        pkg(
          ['    "preview-email": "^3.0.0",'],
          [
            '  "scripts": {',
            '    "build": "tsc"',
            '  },',
            '  "dependencies": {',
          ]
        )
      ).triggers
    ).toEqual([])
  })

  it('Dockerfile CMD/EXPOSE and compose ports trigger; a plain RUN does not', () => {
    expect(
      planServerConfigContext(
        section('api/Dockerfile', ['CMD ["uvicorn", "app:app"]'])
      ).dirs
    ).toEqual(['api'])
    expect(
      planServerConfigContext(section('docker-compose.yml', ['    ports:']))
        .dirs
    ).toEqual([''])
    expect(
      planServerConfigContext(section('api/Dockerfile', ['RUN apt-get update']))
        .triggers
    ).toEqual([])
  })

  it('a framework entrypoint that starts listening triggers', () => {
    const plan = planServerConfigContext(
      section('server/src/main.ts', ['  await app.listen(port)'])
    )
    expect(plan.dirs).toEqual(['server/src'])
  })

  it('docs and ordinary source changes never trigger', () => {
    const docs = section('README.md', [
      'Run `npm run dev` to start the server.',
    ])
    const code = section('lib/sum.ts', ['export const sum = (a, b) => a + b'])
    expect(planServerConfigContext(`${docs}\n${code}`).triggers).toEqual([])
    expect(planServerConfigContext('').dirs).toEqual([])
  })

  it('removed and context lines never trigger, only added ones', () => {
    const diff = [
      'diff --git a/Makefile b/Makefile',
      '--- a/Makefile',
      '+++ b/Makefile',
      '@@ -1,2 +1,2 @@',
      ' \tcd frontend && trunk serve',
      '-\tcd web && npm run dev',
      '+# comment only',
    ].join('\n')
    expect(planServerConfigContext(diff).triggers).toEqual([])
  })

  it('explicit config references in added lines become file refs', () => {
    const plan = planServerConfigContext(
      section('Makefile', [
        'run:',
        '\tnginx -c deploy/nginx.conf',
        '\tdocker compose -f ops/docker-compose.dev.yml up',
      ])
    )
    expect(plan.refs).toEqual([
      'deploy/nginx.conf',
      'ops/docker-compose.dev.yml',
    ])
  })

  it('path scope: never escapes the repository (.., absolute paths)', () => {
    const plan = planServerConfigContext(
      section('tools/Makefile', [
        'dev:',
        '\tcd ../../etc && python -m http.server',
        '\tcd /srv/app && npm start',
        '\tnginx -c /etc/nginx/nginx.conf',
      ])
    )
    expect(plan.dirs).toEqual(['tools'])
    expect(plan.refs).toEqual([])
    // `..` that stays inside the repository resolves.
    const inside = planServerConfigContext(
      section('tools/Makefile', ['dev:', '\tcd ../web && npm run dev'])
    )
    expect(inside.dirs).toEqual(['web', 'tools'])
  })
})

describe('LUM-1208 server config context — exclusions', () => {
  it('names server config files', () => {
    for (const n of [
      'Trunk.toml',
      'vite.config.ts',
      'next.config.mjs',
      'docker-compose.yml',
      'docker-compose.dev.yaml',
      'compose.yaml',
      'nginx.conf',
      'nginx-site.conf',
      '.env.example',
      '.env.sample',
      'settings.py',
      'application.yml',
      'appsettings.Development.json',
      'gunicorn.conf.py',
      'Caddyfile',
    ])
      expect([n, isServerConfigName(n)]).toEqual([n, true])
    for (const n of ['Cargo.toml', 'pyproject.toml', 'package.json', 'main.ts'])
      expect([n, isServerConfigName(n)]).toEqual([n, false])
  })

  it('never a real .env or a key / secret / credential file', () => {
    for (const p of [
      '.env',
      'web/.env',
      '.env.local',
      '.env.production',
      'certs/server.pem',
      'tls.key',
      'api_key.yml',
      'secrets.yaml',
      'config/credentials.yml',
      'deploy/id_rsa',
      'cert.p12',
    ]) {
      expect([p, isSecretLikePath(p)]).toEqual([p, true])
    }
    expect(isSecretLikePath('.env.example')).toBe(false)
    expect(isSecretLikePath('frontend/Trunk.toml')).toBe(false)
  })

  it('selects config files from the listings: refs first, then planned dir order; skips changed and secret files; caps the count', () => {
    const plan = {
      triggers: ['Makefile'],
      dirs: ['frontend', ''],
      refs: ['deploy/nginx.conf'],
    }
    const listing: Record<string, string[]> = {
      deploy: ['deploy/nginx.conf'],
      frontend: [
        'frontend/Trunk.toml',
        'frontend/Cargo.toml',
        'frontend/.env',
        'frontend/index.html',
      ],
      '': [
        'Makefile',
        '.env.example',
        '.env.local',
        'secrets.yaml',
        'docker-compose.yml',
        'vite.config.ts',
        'next.config.js',
      ],
    }
    const picked = selectServerConfigFiles(
      plan,
      listing,
      new Set(['docker-compose.yml'])
    )
    expect(picked).toEqual([
      'deploy/nginx.conf',
      'frontend/Trunk.toml',
      '.env.example',
      'next.config.js',
    ])
    expect(picked.length).toBe(SERVER_CONFIG_MAX_FILES)
  })

  it('a ref that does not exist never takes a slot from a directory file', () => {
    const picked = selectServerConfigFiles(
      {
        triggers: ['Makefile'],
        dirs: [''],
        refs: ['a/nginx.conf', 'b/nginx.conf', 'c/nginx.conf', 'd/nginx.conf'],
      },
      { '': ['vite.config.ts'], a: [], b: [] },
      new Set()
    )
    expect(picked).toEqual(['vite.config.ts'])
  })

  it('the loader lists the directories of explicit refs to check they exist', async () => {
    const listed: string[] = []
    const ctx = await loadServerConfigContext({
      plan: planServerConfigContext(
        section('Makefile', ['run:', '\tnginx -c deploy/nginx.conf'])
      ),
      changedPaths: ['Makefile'],
      listDir: async dir => {
        listed.push(dir)
        return dir === 'deploy' ? ['deploy/nginx.conf'] : []
      },
      readFile: async () => 'listen 0.0.0.0:80;\n',
    })
    expect(listed.sort()).toEqual(['', 'deploy'])
    expect(ctx.included).toEqual(['deploy/nginx.conf'])
  })

  it('a ref that is a secret file or not a config file is never selected', () => {
    const picked = selectServerConfigFiles(
      { triggers: ['Makefile'], dirs: [], refs: ['deploy/.env', 'src/app.ts'] },
      {},
      new Set()
    )
    expect(picked).toEqual([])
  })
})

describe('LUM-1208 server config context — caps and masking', () => {
  it('packs files with headers under the total cap and truncates a long file at a line', () => {
    const long = Array.from(
      { length: 400 },
      (_, i) => `key_${i} = "value"`
    ).join('\n')
    const packed = packServerConfig(
      [
        {
          path: 'frontend/Trunk.toml',
          body: '[serve]\naddresses = ["0.0.0.0"]\n',
        },
        { path: 'nginx.conf', body: long },
      ],
      SERVER_CONFIG_MAX_CHARS
    )
    expect(packed.included).toEqual(['frontend/Trunk.toml', 'nginx.conf'])
    expect(packed.text).toContain('=== frontend/Trunk.toml ===\n[serve]')
    expect(packed.text).toContain('(truncated)')
    expect(packed.text.length).toBeLessThanOrEqual(SERVER_CONFIG_MAX_CHARS)
    const nginxBlock = packed.text.split('=== nginx.conf ===\n')[1]!
    expect(nginxBlock.length).toBeLessThanOrEqual(
      SERVER_CONFIG_MAX_FILE_CHARS + 40
    )
  })

  it('a smaller budget wins over the 8k cap; nothing fits → empty', () => {
    const files = [{ path: 'a/vite.config.ts', body: 'x'.repeat(500) }]
    expect(packServerConfig(files, 100).text).toBe('')
    expect(packServerConfig(files, 0).included).toEqual([])
  })

  it('loads through the injected readers, masks secrets, keeps the bind address readable', async () => {
    // Built at run time so no credential-shaped literal sits in the source.
    const pw = ['Sup3r', 'S3cret', 'Pw9x'].join('')
    const files: Record<string, string> = {
      'frontend/Trunk.toml': '[serve]\naddresses = ["0.0.0.0"]\nport = 9899\n',
      '.env.example': `DATABASE_URL=postgres://admin:${pw}@db:5432/app\nDEBUG=true\n`,
    }
    const ctx = await loadServerConfigContext({
      plan: planServerConfigContext(MAKEFILE_DIFF),
      changedPaths: ['Makefile'],
      listDir: async dir =>
        dir === 'frontend'
          ? ['frontend/Trunk.toml', 'frontend/src']
          : ['Makefile', '.env.example', '.env'],
      readFile: async p => files[p] ?? null,
    })
    expect(ctx.error).toBeNull()
    expect(ctx.included).toEqual(['frontend/Trunk.toml', '.env.example'])
    expect(ctx.text).toContain('addresses = ["0.0.0.0"]')
    expect(ctx.text).toContain('DEBUG=true')
    expect(ctx.text).not.toContain(pw)
  })

  it('no trigger → no listing, no read', async () => {
    const listDir = jest.fn(async () => [] as string[])
    const readFile = jest.fn(async () => null)
    const ctx = await loadServerConfigContext({
      plan: planServerConfigContext(section('lib/a.ts', ['const a = 1'])),
      changedPaths: ['lib/a.ts'],
      listDir,
      readFile,
    })
    expect(ctx).toEqual({ text: '', included: [], error: null })
    expect(listDir).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('degrades to no config context on a throw or timeout', async () => {
    const plan = planServerConfigContext(MAKEFILE_DIFF)
    const thrown = await loadServerConfigContext({
      plan,
      changedPaths: [],
      listDir: async () => {
        throw new Error('403')
      },
      readFile: async () => null,
    })
    expect(thrown).toEqual({ text: '', included: [], error: '403' })
    const slow = await loadServerConfigContext({
      plan,
      changedPaths: [],
      listDir: () => new Promise<string[]>(() => undefined),
      readFile: async () => null,
      timeoutMs: 20,
    })
    expect(slow.text).toBe('')
    expect(slow.error).toMatch(/timed out/)
  })
})
