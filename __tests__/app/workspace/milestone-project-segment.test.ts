import { findProjectForMilestoneSegment } from '@/app/workspace/[workspaceUrl]/utils/milestonePath'

const PROJECT_CUID = 'cmn32e31r000004lazy8geebi'
const projects = [
  { id: PROJECT_CUID, name: 'Lumo' },
  { id: 'cmother00000000000000000y', name: 'Backend Service' },
]

describe('findProjectForMilestoneSegment', () => {
  it('resolves the project when the segment is the project cuid (the link MilestoneCard builds)', () => {
    // Regression: MilestoneCard builds `/projects/<cuid>/milestones/<slug>`, so
    // the detail page must match the project by id — a slugified-name-only match
    // never equals the cuid, which left the page stuck blank.
    expect(findProjectForMilestoneSegment(projects, PROJECT_CUID)).toBe(
      projects[0]
    )
  })

  it('falls back to a slugified-name match for hand-built slug URLs', () => {
    expect(findProjectForMilestoneSegment(projects, 'backend-service')).toBe(
      projects[1]
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
