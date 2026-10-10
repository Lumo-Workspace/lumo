/** @jest-environment node */
/**
 * LUM-1064: plugin half of __tests__/shared/security-scan.test.ts (split)
 */
import { EXTERNAL_ERROR_PREFIX } from '@/shared/src/security-scan'
import { EXTERNAL_ERROR_PREFIX as LIB_PREFIX } from '@/lib/security-scan/stages'

describe('externalFailureReason', () => {
  it('is the same constant lib/security-scan/stages re-exports', () => {
    expect(LIB_PREFIX).toBe(EXTERNAL_ERROR_PREFIX)
    expect(EXTERNAL_ERROR_PREFIX).toBe('external: ')
  })
})
