import { restoreEnv } from './helpers/restore-env'

describe('restoreEnv', () => {
  it('deletes a var that was unset and restores one that was set', () => {
    process.env.LUM1302_PROBE = 'x'
    restoreEnv('LUM1302_PROBE', undefined)
    expect('LUM1302_PROBE' in process.env).toBe(false)
    restoreEnv('LUM1302_PROBE', 'y')
    expect(process.env.LUM1302_PROBE).toBe('y')
    delete process.env.LUM1302_PROBE
  })
})
