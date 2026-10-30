/**
 * @jest-environment node
 *
 * LUM-1344 — scripts/admin-oauth: the spec and registration core for the
 * lumo-admin console OAuth client. No database is touched.
 */
import {
  buildConsoleClientSpec,
  parseConsoleClientArgs,
  registerConsoleClient,
  runRegisterConsoleClient,
  toProviderClientBody,
} from '../../../scripts/admin-oauth/console-client'

const CB = 'https://admin.example.com/api/auth/callback'

describe('buildConsoleClientSpec', () => {
  it('is a confidential, consent-free, admin-only authorization-code client', () => {
    const spec = buildConsoleClientSpec({
      name: 'Lumo Admin',
      redirectUris: [CB],
    })
    expect(spec).toMatchObject({
      name: 'Lumo Admin',
      redirectUris: [CB],
      scopes: ['platform-admin'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      skipConsent: true,
      resource: 'admin',
    })
    const text = JSON.stringify(spec)
    expect(text).not.toContain('offline_access')
    expect(text).not.toContain('refresh_token')
    expect(spec.scopes).not.toContain('mcp')
  })

  it('rejects an empty redirect list and a blank name', () => {
    expect(() =>
      buildConsoleClientSpec({ name: 'x', redirectUris: [] })
    ).toThrow(/redirect/i)
    expect(() =>
      buildConsoleClientSpec({ name: '  ', redirectUris: [CB] })
    ).toThrow(/name/i)
  })

  it('rejects non-https redirect URIs and fragments', () => {
    for (const bad of [
      'http://admin.example.com/cb',
      'http://localhost.evil.com/cb',
      'ftp://admin.example.com/cb',
      'myapp://cb',
      'not a url',
      `${CB}#frag`,
      'https://admin.example.com/cb#',
    ]) {
      expect(() =>
        buildConsoleClientSpec({ name: 'x', redirectUris: [bad] })
      ).toThrow()
    }
  })

  it('rejects loopback hosts (even https) with a hint about tunnels', () => {
    for (const bad of [
      'http://localhost:3001/cb',
      'http://127.0.0.1:3001/cb',
      'https://localhost:3001/cb',
      'https://127.0.0.1/cb',
      'https://[::1]:3001/cb',
      'https://admin.localhost/cb',
    ]) {
      expect(() =>
        buildConsoleClientSpec({ name: 'x', redirectUris: [bad] })
      ).toThrow(/tunnel/)
    }
  })
})

describe('toProviderClientBody', () => {
  it('maps the spec to the provider body without refresh capability', () => {
    const body = toProviderClientBody(
      buildConsoleClientSpec({ name: 'Lumo Admin', redirectUris: [CB] })
    )
    expect(body).toEqual({
      client_name: 'Lumo Admin',
      redirect_uris: [CB],
      scope: 'platform-admin',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      skip_consent: true,
      require_pkce: true,
    })
  })
})

describe('registerConsoleClient', () => {
  it('creates via the injected provider call, links the admin resource, returns id and secret', async () => {
    const spec = buildConsoleClientSpec({
      name: 'Lumo Admin',
      redirectUris: [CB],
    })
    const createClient = jest.fn(async () => ({
      client_id: 'cid',
      client_secret: 'sec',
    }))
    const linkAdminResourceOnly = jest.fn(async () => undefined)
    const out = await registerConsoleClient(spec, {
      createClient,
      linkAdminResourceOnly,
      deleteClient: jest.fn(),
    })
    expect(out).toEqual({ clientId: 'cid', clientSecret: 'sec' })
    expect(createClient).toHaveBeenCalledWith(spec)
    expect(linkAdminResourceOnly).toHaveBeenCalledWith('cid')
  })

  it('fails without echoing the secret when the provider returns none or linking fails', async () => {
    const spec = buildConsoleClientSpec({ name: 'x', redirectUris: [CB] })
    await expect(
      registerConsoleClient(spec, {
        createClient: async () => ({ client_id: 'cid' }),
        linkAdminResourceOnly: async () => undefined,
        deleteClient: async () => undefined,
      })
    ).rejects.toThrow(/secret/i)
    const deleteClient = jest.fn(async () => undefined)
    const err = await registerConsoleClient(spec, {
      createClient: async () => ({
        client_id: 'cid',
        client_secret: 'TOPSECRET',
      }),
      linkAdminResourceOnly: async () => {
        throw new Error('linked to the admin resource AND still linked to MCP')
      },
      deleteClient,
    }).catch((e: Error) => e)
    expect((err as Error).message).toContain('cid')
    expect((err as Error).message).toContain('AND still linked to MCP')
    expect((err as Error).message).toContain('was deleted')
    expect((err as Error).message).not.toContain('TOPSECRET')
    expect(deleteClient).toHaveBeenCalledWith('cid')
  })

  it('reports a failed cleanup with the client id', async () => {
    const spec = buildConsoleClientSpec({ name: 'x', redirectUris: [CB] })
    const err = await registerConsoleClient(spec, {
      createClient: async () => ({ client_id: 'cid', client_secret: 'S' }),
      linkAdminResourceOnly: async () => {
        throw new Error('link boom')
      },
      deleteClient: async () => {
        throw new Error('delete boom')
      },
    }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/cleanup FAILED.*delete boom/)
    expect((err as Error).message).toContain('delete client cid manually')
  })
})

describe('parseConsoleClientArgs', () => {
  it('is a dry run unless --confirm; collects repeated --redirect-uri', () => {
    expect(
      parseConsoleClientArgs([
        '--name',
        'Lumo Admin',
        '--redirect-uri',
        CB,
        '--redirect-uri',
        'https://tunnel.example.dev/cb',
        '--operator-email',
        'Ops@Example.com',
      ])
    ).toEqual({
      name: 'Lumo Admin',
      redirectUris: [CB, 'https://tunnel.example.dev/cb'],
      operatorEmail: 'ops@example.com',
      confirm: false,
    })
    expect(
      parseConsoleClientArgs([
        '--name',
        'x',
        '--redirect-uri',
        CB,
        '--operator-email',
        'a@b.co',
        '--confirm',
      ]).confirm
    ).toBe(true)
  })

  it('rejects missing required flags and unknown flags', () => {
    expect(() => parseConsoleClientArgs(['--redirect-uri', CB])).toThrow(/name/)
    expect(() => parseConsoleClientArgs(['--name', 'x'])).toThrow(/redirect/i)
    expect(() => parseConsoleClientArgs(['--bogus'])).toThrow()
  })
})

describe('runRegisterConsoleClient', () => {
  const argv = [
    '--name',
    'Lumo Admin',
    '--redirect-uri',
    CB,
    '--operator-email',
    'ops@example.com',
  ]
  const makeIo = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      io: {
        stdout: (s: string) => out.push(s),
        stderr: (s: string) => err.push(s),
      },
    }
  }

  it('default (no --confirm) prints the spec and never calls the provider', async () => {
    const { out, io } = makeIo()
    const openProvider = jest.fn()
    const code = await runRegisterConsoleClient(argv, { openProvider, io })
    expect(code).toBe(0)
    expect(openProvider).not.toHaveBeenCalled()
    const text = out.join('\n')
    expect(text).toContain('platform-admin')
    expect(text).toMatch(/nothing was (written|created)/i)
  })

  it('--confirm registers and prints the secret exactly once', async () => {
    const { out, err, io } = makeIo()
    const close = jest.fn(async () => undefined)
    const code = await runRegisterConsoleClient([...argv, '--confirm'], {
      openProvider: async () => ({
        deps: {
          createClient: async () => ({
            client_id: 'cid',
            client_secret: 'S3CRET',
          }),
          linkAdminResourceOnly: async () => undefined,
          deleteClient: async () => undefined,
        },
        close,
        leftBehind: 'LEFT',
      }),
      io,
    })
    expect(code).toBe(0)
    expect(close).toHaveBeenCalled()
    const lines = out.join('\n').split('\n')
    expect(lines.filter(l => l.includes('S3CRET'))).toHaveLength(1)
    expect(out.join('\n')).toMatch(/cannot be shown again/i)
    expect(err.join('')).not.toContain('S3CRET')
  })

  const failingHandle = (close: () => Promise<void>) => ({
    deps: {
      createClient: async () => ({ client_id: 'cid', client_secret: 'S3CRET' }),
      linkAdminResourceOnly: async () => {
        throw new Error('link boom')
      },
      deleteClient: async () => undefined,
    },
    close,
    leftBehind: 'LEFT',
  })

  it('closes the operator session even when registration rejects, exit 1', async () => {
    const { out, err, io } = makeIo()
    const close = jest.fn(async () => undefined)
    const code = await runRegisterConsoleClient([...argv, '--confirm'], {
      openProvider: async () => failingHandle(close),
      io,
    })
    expect(code).toBe(1)
    expect(close).toHaveBeenCalled()
    expect(err.join('')).toContain('link boom')
    expect(out.join('')).not.toContain('S3CRET')
    expect(err.join('')).not.toContain('S3CRET')
  })

  it('a close() failure after success is reported separately and still exits 0', async () => {
    const { out, err, io } = makeIo()
    const code = await runRegisterConsoleClient([...argv, '--confirm'], {
      openProvider: async () => ({
        deps: {
          createClient: async () => ({
            client_id: 'cid',
            client_secret: 'S3CRET',
          }),
          linkAdminResourceOnly: async () => undefined,
          deleteClient: async () => undefined,
        },
        close: async () => {
          throw new Error('close boom')
        },
        leftBehind: 'LEFT',
      }),
      io,
    })
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('S3CRET')
    expect(err.join('')).toMatch(/close boom.*LEFT/)
    expect(err.join('')).not.toContain('S3CRET')
  })

  it('exits 1 with the message on bad input and never opens the provider', async () => {
    const { err, io } = makeIo()
    const openProvider = jest.fn()
    const code = await runRegisterConsoleClient(
      [
        '--name',
        'x',
        '--redirect-uri',
        'http://evil.example.com/cb',
        '--operator-email',
        'a@b.co',
        '--confirm',
      ],
      { openProvider, io }
    )
    expect(code).toBe(1)
    expect(openProvider).not.toHaveBeenCalled()
    expect(err.join('')).toMatch(/https/)
  })
})
