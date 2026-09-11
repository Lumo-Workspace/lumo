/** @jest-environment node */
import {
  LUMO_CI_CHECKS,
  LUMO_CI_SANDBOX_TAG,
  LUMO_CI_SANDBOX_TIMEOUT_MS,
  LUMO_CI_SANDBOX_VCPUS,
  LUMO_CI_SOURCE,
  MANAGED_CI_HOURLY_CAP_DEFAULT,
  isManagedCiEnabled,
  jestIgnorePatterns,
  jestShardCount,
  managedCiHourlyCap,
} from '@/lib/services/lumo-ci.config'

describe('lumo-ci config (LUM-746)', () => {
  it('constants: two execution checks, a lumoCi sandbox tag, 4 vCPU, a 30-min VM, source lumo_sandbox', () => {
    expect([...LUMO_CI_CHECKS]).toEqual(['typecheck', 'test'])
    expect(LUMO_CI_SANDBOX_TAG).toBe('lumoCi')
    expect(LUMO_CI_SANDBOX_VCPUS).toBe(4)
    expect(LUMO_CI_SANDBOX_TIMEOUT_MS).toBe(30 * 60 * 1000)
    expect(LUMO_CI_SOURCE).toBe('lumo_sandbox')
  })

  it('isManagedCiEnabled is on unless LUMO_MANAGED_CI is exactly "off"', () => {
    expect(isManagedCiEnabled({})).toBe(true)
    expect(isManagedCiEnabled({ LUMO_MANAGED_CI: 'on' })).toBe(true)
    expect(isManagedCiEnabled({ LUMO_MANAGED_CI: 'off' })).toBe(false)
  })

  it('managedCiHourlyCap defaults to 10 and accepts only positive integers', () => {
    expect(MANAGED_CI_HOURLY_CAP_DEFAULT).toBe(10)
    expect(managedCiHourlyCap({})).toBe(10)
    expect(managedCiHourlyCap({ LUMO_MANAGED_CI_HOURLY_CAP: '3' })).toBe(3)
    expect(managedCiHourlyCap({ LUMO_MANAGED_CI_HOURLY_CAP: '0' })).toBe(10)
    expect(managedCiHourlyCap({ LUMO_MANAGED_CI_HOURLY_CAP: 'x' })).toBe(10)
  })

  it('jestShardCount defaults to 2, accepts 1..8, rejects junk', () => {
    expect(jestShardCount({})).toBe(2)
    expect(jestShardCount({ LUMO_CI_JEST_SHARDS: '4' })).toBe(4)
    expect(jestShardCount({ LUMO_CI_JEST_SHARDS: '1' })).toBe(1)
    expect(jestShardCount({ LUMO_CI_JEST_SHARDS: '0' })).toBe(2)
    expect(jestShardCount({ LUMO_CI_JEST_SHARDS: '99' })).toBe(2)
    expect(jestShardCount({ LUMO_CI_JEST_SHARDS: 'abc' })).toBe(2)
  })

  it('jestIgnorePatterns splits LUMO_CI_JEST_IGNORE on commas, trims, drops empties and shell metacharacters', () => {
    expect(jestIgnorePatterns({})).toEqual([])
    expect(
      jestIgnorePatterns({
        LUMO_CI_JEST_IGNORE:
          ' __tests__/a.test.ts, cli/__tests__/b.test.ts ,, ',
      })
    ).toEqual(['__tests__/a.test.ts', 'cli/__tests__/b.test.ts'])
    // A pattern is interpolated into a shell script: anything that could
    // break out of its quoting is dropped, never escaped.
    expect(
      jestIgnorePatterns({ LUMO_CI_JEST_IGNORE: "a.test.ts,x'; rm -rf /,b" })
    ).toEqual(['a.test.ts', 'b'])
  })
})
