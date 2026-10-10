/**
 * @jest-environment node
 *
 * LUM-1062 — on a server without the security plugin the scan routes do not
 * exist, and the framework answers with its own HTML 404 page. `lumo pr scan`
 * and `lumo workspace security-scan` say the feature is not on this server;
 * a JSON 404 from our own handler keeps its old meaning ("PR not found").
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import { prScan } from '@/cli/src/commands/pr-scan'
import { workspaceSecurityScan } from '@/cli/src/commands/workspace-security-scan'
import {
  isMissingPluginRoute,
  missingPluginMessage,
} from '@/cli/src/lib/plugin-route'

const htmlNotFound = () =>
  new Response('<!DOCTYPE html><html><body>404</body></html>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
const jsonNotFound = (error: string) =>
  new Response(JSON.stringify({ error }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })

let err: string
const original = global.fetch
beforeEach(() => {
  err = ''
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  jest.restoreAllMocks()
  global.fetch = original
})

describe('isMissingPluginRoute', () => {
  it('is true only for the framework HTML 404', () => {
    expect(isMissingPluginRoute(htmlNotFound())).toBe(true)
    expect(isMissingPluginRoute(new Response('', { status: 404 }))).toBe(false)
    expect(isMissingPluginRoute(jsonNotFound('PR not found'))).toBe(false)
    expect(isMissingPluginRoute(new Response('x', { status: 500 }))).toBe(false)
  })
})

describe('lumo pr scan', () => {
  it('says the security plugin is not installed when the route is missing', async () => {
    global.fetch = jest.fn(async () =>
      htmlNotFound()
    ) as unknown as typeof fetch
    expect(await prScan('12')).toBe(1)
    expect(err).toBe(missingPluginMessage('pr scan', 'security'))
    expect(err).toMatch(/not available on this Lumo server/)
  })

  it('keeps "PR not found" for the handler\'s own JSON 404', async () => {
    global.fetch = jest.fn(async () =>
      jsonNotFound('PR not found')
    ) as unknown as typeof fetch
    expect(await prScan('12')).toBe(1)
    expect(err).toMatch(/PR #12 not found in workspace lumo/)
  })
})

describe('lumo workspace security-scan', () => {
  it('says the security plugin is not installed when the route is missing', async () => {
    global.fetch = jest.fn(async () =>
      htmlNotFound()
    ) as unknown as typeof fetch
    expect(await workspaceSecurityScan({})).toBe(1)
    expect(err).toBe(
      missingPluginMessage('workspace security-scan', 'security')
    )
  })

  it('keeps the server error of a JSON 404', async () => {
    global.fetch = jest.fn(async () =>
      jsonNotFound('Workspace not found')
    ) as unknown as typeof fetch
    expect(await workspaceSecurityScan({})).toBe(1)
    expect(err).toBe('Error: Workspace not found')
  })
})
