/** @jest-environment node */
import { matchSensitiveName } from '@/cli/src/lib/path-guard'

describe('matchSensitiveName', () => {
  it('passes an ordinary spec file', () => {
    expect(matchSensitiveName('docs/spec.md')).toBeNull()
    expect(matchSensitiveName('plan.md')).toBeNull()
  })

  it('flags dotenv files', () => {
    expect(matchSensitiveName('.env')).not.toBeNull()
    expect(matchSensitiveName('config/.env.local')).not.toBeNull()
    expect(matchSensitiveName('.env.production')).not.toBeNull()
  })

  it('flags private keys by name and extension', () => {
    expect(matchSensitiveName('id_rsa')).not.toBeNull()
    expect(matchSensitiveName('keys/id_ed25519')).not.toBeNull()
    expect(matchSensitiveName('server.pem')).not.toBeNull()
    expect(matchSensitiveName('cert.key')).not.toBeNull()
  })

  it('flags credential-bearing files and segments', () => {
    expect(matchSensitiveName('.aws/credentials')).not.toBeNull()
    expect(matchSensitiveName('/Users/x/.ssh/known_hosts')).not.toBeNull()
    expect(matchSensitiveName('.npmrc')).not.toBeNull()
  })

  it('is case-insensitive on the basename', () => {
    expect(matchSensitiveName('Server.PEM')).not.toBeNull()
  })

  it('is case-insensitive on sensitive path segments', () => {
    expect(matchSensitiveName('.SSH/id_rsa')).not.toBeNull()
    expect(matchSensitiveName('config/.AWS/credentials')).not.toBeNull()
  })
})
