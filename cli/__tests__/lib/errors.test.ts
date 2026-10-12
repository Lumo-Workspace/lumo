import {
  AUTH_INVALID_MESSAGE,
  AUTH_INVALID_REASON,
  NOT_LOGGED_IN_MESSAGE,
  WARN_PREFIX,
  errAuth,
  errHttp,
  errNotLoggedIn,
  httpFailed,
  warn,
} from '../../src/lib/errors'

describe('cli errors helpers (LUM-1087)', () => {
  it('errAuth keeps the exact auth-failure line agents grep for', () => {
    expect(errAuth()).toBe(
      'Error: API key invalid or revoked. Run `lumo auth login`.'
    )
    expect(AUTH_INVALID_MESSAGE).toBe(
      `${AUTH_INVALID_REASON}. Run \`lumo auth login\`.`
    )
    expect(errAuth()).toContain('lumo auth login')
  })

  it('errNotLoggedIn keeps the exact not-logged-in line', () => {
    expect(errNotLoggedIn()).toBe(
      'Error: not logged in. Run `lumo auth login` first.'
    )
    expect(NOT_LOGGED_IN_MESSAGE).toBe(
      'not logged in. Run `lumo auth login` first.'
    )
  })

  it('httpFailed renders the single HTTP-failure wording', () => {
    expect(httpFailed('task list', 500)).toBe('task list failed (HTTP 500)')
    expect(httpFailed('doc bind', 404, 'Not found')).toBe(
      'doc bind failed (HTTP 404): Not found'
    )
  })

  it('httpFailed drops an empty or whitespace-only detail', () => {
    expect(httpFailed('doc sync', 502, '')).toBe('doc sync failed (HTTP 502)')
    expect(httpFailed('doc sync', 502, '  \n')).toBe(
      'doc sync failed (HTTP 502)'
    )
    expect(httpFailed('doc sync', 502, null)).toBe('doc sync failed (HTTP 502)')
  })

  it('httpFailed strips terminal control characters from the server detail', () => {
    expect(httpFailed('doc show', 500, 'bad\x1b[31m red')).toBe(
      'doc show failed (HTTP 500): bad[31m red'
    )
  })

  it('errHttp prefixes Error: and never uses the status-text wording', () => {
    const line = errHttp('doc create', 403, 'Forbidden')
    expect(line).toBe('Error: doc create failed (HTTP 403): Forbidden')
    expect(line).not.toMatch(/Error: \d{3} /)
  })

  it('warn uses the one warning prefix', () => {
    expect(WARN_PREFIX).toBe('⚠')
    expect(warn('git fetch failed')).toBe('⚠ git fetch failed')
    expect(warn('x')).not.toMatch(/^Warning:/)
  })
})
