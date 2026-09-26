/**
 * @jest-environment node
 */
import {
  AUTH_LOGIN_HINT,
  createAuthFailureTracker,
} from '@/cli/src/lib/auth-failure'

function fakeFetch(status: number): typeof fetch {
  return (async () => new Response('{}', { status })) as typeof fetch
}

const BEARER = { headers: { Authorization: 'Bearer lum_test' } }

describe('auth failure hint', () => {
  it('is due after a bearer 401 and a non-zero exit that never named lumo auth login', async () => {
    const t = createAuthFailureTracker()
    await t.wrapFetch(fakeFetch(401))('https://x/api/docs', BEARER)
    t.noteOutput('Error: 401 Unauthorized: {"error":"Unauthorized"}\n')
    expect(t.hintFor(1)).toBe(AUTH_LOGIN_HINT)
    expect(AUTH_LOGIN_HINT).toContain('lumo auth login')
  })

  it('is not repeated when the command already printed the remediation', async () => {
    const t = createAuthFailureTracker()
    await t.wrapFetch(fakeFetch(401))('https://x/api/tasks', BEARER)
    t.noteOutput(
      Buffer.from('Error: API key invalid or revoked. Run `lumo auth login`.\n')
    )
    expect(t.hintFor(1)).toBeNull()
  })

  it('stays silent on exit 0, on non-401 failures and on unauthenticated 401s', async () => {
    const ok = createAuthFailureTracker()
    await ok.wrapFetch(fakeFetch(401))('https://x', BEARER)
    expect(ok.hintFor(0)).toBeNull()

    const other = createAuthFailureTracker()
    await other.wrapFetch(fakeFetch(500))('https://x', BEARER)
    expect(other.hintFor(1)).toBeNull()

    const anon = createAuthFailureTracker()
    await anon.wrapFetch(fakeFetch(401))('https://registry.npmjs.org/x')
    expect(anon.hintFor(1)).toBeNull()
  })

  it('recognises the bearer header in Headers and tuple forms', async () => {
    const viaHeaders = createAuthFailureTracker()
    await viaHeaders.wrapFetch(fakeFetch(401))('https://x', {
      headers: new Headers({ authorization: 'Bearer lum_a' }),
    })
    expect(viaHeaders.hintFor(2)).toBe(AUTH_LOGIN_HINT)

    const viaTuples = createAuthFailureTracker()
    await viaTuples.wrapFetch(fakeFetch(401))('https://x', {
      headers: [['Authorization', 'Bearer lum_b']],
    })
    expect(viaTuples.hintFor(1)).toBe(AUTH_LOGIN_HINT)
  })

  it('passes the response through unchanged', async () => {
    const t = createAuthFailureTracker()
    const res = await t.wrapFetch(fakeFetch(401))('https://x', BEARER)
    expect(res.status).toBe(401)
  })
})
