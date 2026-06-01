/**
 * @jest-environment node
 */
import * as os from 'os'
import * as path from 'path'

import { credentialsPath } from '@/cli/src/lib/config'

const originalEnv = process.env.LUMO_CONFIG_DIR

afterEach(() => {
  if (originalEnv === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = originalEnv
})

describe('credentialsPath / configDir resolution', () => {
  it('falls back to ~/.lumo when LUMO_CONFIG_DIR is unset', () => {
    delete process.env.LUMO_CONFIG_DIR
    expect(credentialsPath()).toBe(
      path.join(os.homedir(), '.lumo', 'credentials.json')
    )
  })

  it('honors LUMO_CONFIG_DIR when set', () => {
    process.env.LUMO_CONFIG_DIR = '/tmp/custom-lumo-home'
    expect(credentialsPath()).toBe(
      path.join('/tmp/custom-lumo-home', 'credentials.json')
    )
  })

  it('falls back to ~/.lumo when LUMO_CONFIG_DIR is an empty string', () => {
    process.env.LUMO_CONFIG_DIR = ''
    expect(credentialsPath()).toBe(
      path.join(os.homedir(), '.lumo', 'credentials.json')
    )
  })
})
