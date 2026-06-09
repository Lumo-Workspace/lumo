import { describe, it, expect } from '@jest/globals'
import { buildProjectUrl } from '@/lib/utils/buildProjectUrl'
import { buildMilestoneUrl } from '@/lib/utils/buildMilestoneUrl'

describe('entity url builders', () => {
  it('builds a project url from workspace slug + project name', () => {
    expect(buildProjectUrl('acme', 'Backend Revamp')).toMatch(
      /\/workspace\/acme\/projects\/backend-revamp$/
    )
  })
  it('builds a milestone url scoped under its project + slug', () => {
    expect(buildMilestoneUrl('acme', 'Backend Revamp', 'v1-0')).toMatch(
      /\/workspace\/acme\/projects\/backend-revamp\/milestones\/v1-0$/
    )
  })
})
