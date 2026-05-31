import { findProjectForMilestoneSegment } from '@/app/workspace/[workspaceUrl]/utils/milestonePath'

const PROJECT_CUID = 'cmn32e31r000004lazy8geebi'
const projects = [
  { id: PROJECT_CUID, name: 'Lumo' },
  { id: 'cmother00000000000000000y', name: 'Backend Service' },
]

describe('findProjectForMilestoneSegment', () => {
  it('resolves the project when the segment is the slugified name (the link MilestoneCard now builds)', () => {
    // MilestoneCard builds `/projects/<slug>/milestones/<slug>`, so the detail
    // page resolves the project by its slugified name.
    expect(findProjectForMilestoneSegment(projects, 'lumo')).toBe(projects[0])
    expect(findProjectForMilestoneSegment(projects, 'backend-service')).toBe(
      projects[1]
    )
  })

  it('still resolves legacy cuid segments by id (bookmarks, CLI-built ids, stale bundles)', () => {
    // Pre-LUM-126 links and hand-built CLI urls use the project cuid; matching
    // by id keeps those URLs working (they then canonicalize to the slug form).
    expect(findProjectForMilestoneSegment(projects, PROJECT_CUID)).toBe(
      projects[0]
    )
  })

  it('returns null when no project matches the segment', () => {
    expect(findProjectForMilestoneSegment(projects, 'nope')).toBeNull()
  })

  it('returns null when the segment is undefined (params not yet resolved)', () => {
    expect(findProjectForMilestoneSegment(projects, undefined)).toBeNull()
  })

  it('returns null when the project list is empty', () => {
    expect(findProjectForMilestoneSegment([], PROJECT_CUID)).toBeNull()
  })
})
