import { getCanonicalMilestonePath } from '@/app/workspace/[workspaceUrl]/utils/milestonePath'

const PROJECT_CUID = 'cmn32e31r000004lazy8geebi'
const MILESTONE_CUID = 'cmpi3534a000704l3uefwwbgo'
const SLUG = 'doc-cli-follow-ups'
const baseParams = {
  workspaceUrl: 'lumo',
  projectSlug: PROJECT_CUID,
  milestoneId: MILESTONE_CUID,
}

describe('getCanonicalMilestonePath', () => {
  it('returns the slug URL when the URL segment is a cuid and the milestone has a slug', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    expect(getCanonicalMilestonePath(baseParams, milestone)).toBe(
      `/workspace/lumo/projects/${PROJECT_CUID}/milestones/${SLUG}`
    )
  })

  it('returns null when the URL segment is already the slug', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    const params = { ...baseParams, milestoneId: SLUG }
    expect(getCanonicalMilestonePath(params, milestone)).toBeNull()
  })

  it('returns null when the milestone is not yet loaded', () => {
    expect(getCanonicalMilestonePath(baseParams, null)).toBeNull()
  })

  it('returns null when the segment is a cuid that matches the milestone id but slug is missing', () => {
    // Defensive: a milestone with falsy slug (shouldn't happen post-migration)
    // must not produce `/milestones/` or `/milestones/undefined`.
    const milestone = { id: MILESTONE_CUID, slug: '' }
    expect(getCanonicalMilestonePath(baseParams, milestone)).toBeNull()
  })

  it('returns null when projectSlug or workspaceUrl is missing', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    expect(
      getCanonicalMilestonePath(
        { ...baseParams, workspaceUrl: undefined },
        milestone
      )
    ).toBeNull()
    expect(
      getCanonicalMilestonePath(
        { ...baseParams, projectSlug: undefined },
        milestone
      )
    ).toBeNull()
  })

  it('preserves the projectSlug segment as-is (cuid or slug) — project slug routing is out of scope', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    const slugProject = { ...baseParams, projectSlug: 'lumo' }
    expect(getCanonicalMilestonePath(slugProject, milestone)).toBe(
      `/workspace/lumo/projects/lumo/milestones/${SLUG}`
    )
  })
})
