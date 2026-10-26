/** LUM-1318 — the capability helpers of the GitProvider port. */
import {
  GIT_PROVIDER_CAPABILITIES,
  allCapabilities,
  supportsAll,
} from '@/lib/integrations/git-provider'

describe('git provider capabilities', () => {
  it('allCapabilities turns every capability on', () => {
    const caps = allCapabilities()
    expect(Object.keys(caps).sort()).toEqual(
      [...GIT_PROVIDER_CAPABILITIES].sort()
    )
    expect(Object.values(caps).every(Boolean)).toBe(true)
  })
  it('supportsAll needs every required capability', () => {
    const caps = { ...allCapabilities(), repoClone: false }
    expect(supportsAll(caps, [])).toBe(true)
    expect(supportsAll(caps, ['prFileList'])).toBe(true)
    expect(supportsAll(caps, ['prFileList', 'repoClone'])).toBe(false)
  })
})
