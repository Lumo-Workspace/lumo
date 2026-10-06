/** @jest-environment node */
import { NextRequest } from 'next/server'
import {
  isWorkflowRoutePath,
  requireWorkflowDeliveryAuth,
  usesVercelWorkflowWorld,
  workflowGuardApplies,
} from '@/lib/api/workflow-delivery-auth'

const SECRET = ['unit', 'fixture', 'value'].join('-')
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
const req = (path: string, authorization?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  })
const selfHosted = (extra: Record<string, string> = {}) =>
  ({
    NODE_ENV: 'production',
    WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
    ...extra,
  }) as unknown as NodeJS.ProcessEnv

describe('usesVercelWorkflowWorld', () => {
  it('follows the SDK resolution order', () => {
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv
    expect(
      usesVercelWorkflowWorld(env({ VERCEL_DEPLOYMENT_ID: 'dpl_1' }))
    ).toBe(true)
    expect(
      usesVercelWorkflowWorld(
        env({ WORKFLOW_TARGET_WORLD: '@workflow/world-vercel' })
      )
    ).toBe(true)
    expect(usesVercelWorkflowWorld(env({}))).toBe(false)
    // An explicit non-Vercel world wins even on a Vercel deployment.
    expect(
      usesVercelWorkflowWorld(
        env({
          VERCEL_DEPLOYMENT_ID: 'dpl_1',
          WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
        })
      )
    ).toBe(false)
  })
})

describe('workflowGuardApplies', () => {
  it('applies to every non-Vercel world outside next dev', () => {
    expect(workflowGuardApplies(selfHosted())).toBe(true)
    expect(workflowGuardApplies(selfHosted({ NODE_ENV: 'test' }))).toBe(true)
    expect(
      workflowGuardApplies({
        NODE_ENV: 'production',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(true)
  })
  it('exempts the Vercel World and next dev', () => {
    expect(
      workflowGuardApplies({
        NODE_ENV: 'production',
        VERCEL_DEPLOYMENT_ID: 'd',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(false)
    expect(workflowGuardApplies(selfHosted({ NODE_ENV: 'development' }))).toBe(
      false
    )
  })
})

describe('isWorkflowRoutePath', () => {
  it('matches workflow routes, including encoded and doubled-slash spellings', () => {
    expect(isWorkflowRoutePath('/.well-known/workflow/v1/step')).toBe(true)
    expect(isWorkflowRoutePath('/.well-known/%77orkflow/v1/flow')).toBe(true)
    expect(isWorkflowRoutePath('//.well-known//workflow/v1/flow')).toBe(true)
    expect(isWorkflowRoutePath('/.well-known/workflow/%E0%A4%A')).toBe(true)
  })
  it('does not match the MCP OAuth discovery endpoints or app routes', () => {
    expect(isWorkflowRoutePath('/.well-known/oauth-authorization-server')).toBe(
      false
    )
    expect(isWorkflowRoutePath('/.well-known/oauth-protected-resource')).toBe(
      false
    )
    expect(isWorkflowRoutePath('/api/workflow/x')).toBe(false)
  })
})

describe('requireWorkflowDeliveryAuth', () => {
  const step = '/.well-known/workflow/v1/step'

  it('rejects missing, malformed and wrong credentials', () => {
    const env = selfHosted({ WORKFLOW_SECRET: SECRET })
    for (const h of [
      undefined,
      '',
      `Bearer ${SECRET}`,
      SECRET,
      basic('workflow', 'x'),
      'Basic !!!',
      `Basic ${Buffer.from(SECRET).toString('base64')}`,
    ]) {
      expect(requireWorkflowDeliveryAuth(req(step, h), env)?.status).toBe(401)
    }
  })

  it('fails closed when WORKFLOW_SECRET is unset or empty', () => {
    for (const env of [selfHosted(), selfHosted({ WORKFLOW_SECRET: '' })]) {
      expect(requireWorkflowDeliveryAuth(req(step), env)?.status).toBe(401)
      expect(
        requireWorkflowDeliveryAuth(req(step, basic('workflow', '')), env)
          ?.status
      ).toBe(401)
    }
  })

  it('accepts the Basic password that matches, whatever the username', () => {
    const env = selfHosted({ WORKFLOW_SECRET: SECRET })
    expect(
      requireWorkflowDeliveryAuth(req(step, basic('workflow', SECRET)), env)
    ).toBeNull()
    expect(
      requireWorkflowDeliveryAuth(req(step, basic('any', SECRET)), env)
    ).toBeNull()
  })

  it('ignores non-workflow paths and the Vercel World', () => {
    expect(
      requireWorkflowDeliveryAuth(
        req('/.well-known/oauth-protected-resource'),
        selfHosted()
      )
    ).toBeNull()
    expect(
      requireWorkflowDeliveryAuth(req(step), {
        NODE_ENV: 'production',
        VERCEL_DEPLOYMENT_ID: 'd',
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})

describe('the worker side: credentials in WORKFLOW_LOCAL_BASE_URL', () => {
  // world-postgres delivers with `http.request(new URL(url), …)`
  // (@workflow/world/dist/node-http.js:284). Node turns the URL's userinfo into
  // `Authorization: Basic …`, percent-decoded — this pins that contract.
  it('arrives as a Basic header the guard accepts', async () => {
    const http = await import('node:http')
    const seen: string[] = []
    const server = http.createServer((r, res) => {
      seen.push(r.headers.authorization ?? '')
      res.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    const secret = ['a/b', 'c:d', 'e f'].join('')
    const base = `http://workflow:${encodeURIComponent(secret)}@127.0.0.1:${port}`
    await new Promise<void>((resolve, reject) => {
      const r = http.request(new URL(`${base}/.well-known/workflow/v1/step`), {
        method: 'POST',
      })
      r.on('response', res => {
        res.resume()
        res.on('end', () => resolve())
      })
      r.on('error', reject)
      r.end('{}')
    })
    await new Promise<void>(resolve => server.close(() => resolve()))

    const env = selfHosted({ WORKFLOW_SECRET: secret })
    expect(
      requireWorkflowDeliveryAuth(
        req('/.well-known/workflow/v1/step', seen[0]),
        env
      )
    ).toBeNull()
  })
})
