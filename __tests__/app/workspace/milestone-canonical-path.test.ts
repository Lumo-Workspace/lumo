import { getCanonicalMilestonePath } from '@/app/workspace/[workspaceUrl]/utils/milestonePath'

const PROJECT_CUID = 'cmn32e31r000004lazy8geebi'
const MILESTONE_CUID = 'cmpi3534a000704l3uefwwbgo'
const SLUG = 'doc-cli-follow-ups'
const PROJECT_NAME = 'Lumo' // slugify('Lumo') === 'lumo'
const baseParams = {
  workspaceUrl: 'lumo',
  projectSlug: PROJECT_CUID,
  milestoneId: MILESTONE_CUID,
}

describe('getCanonicalMilestonePath', () => {
  it('canonicalizes BOTH cuid segments to their slug form', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    expect(getCanonicalMilestonePath(baseParams, milestone, PROJECT_NAME)).toBe(
      `/workspace/lumo/projects/lumo/milestones/${SLUG}`
    )
  })

  it('canonicalizes the project segment even when the milestone segment is already a slug', () => {
    // The exact bug this LUM-126 follow-up fixes: project segment is a cuid
    // while the milestone segment is already the slug.
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    const params = { ...baseParams, milestoneId: SLUG }
    expect(getCanonicalMilestonePath(params, milestone, PROJECT_NAME)).toBe(
      `/workspace/lumo/projects/lumo/milestones/${SLUG}`
    )
  })

  it('returns null when both segments are already the canonical slug', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    const params = {
      workspaceUrl: 'lumo',
      projectSlug: 'lumo',
      milestoneId: SLUG,
    }
    expect(
      getCanonicalMilestonePath(params, milestone, PROJECT_NAME)
    ).toBeNull()
  })

  it('returns null when the milestone is not yet loaded', () => {
    expect(getCanonicalMilestonePath(baseParams, null, PROJECT_NAME)).toBeNull()
  })

  it('returns null when the milestone slug is missing', () => {
    // Defensive: a milestone with falsy slug (shouldn't happen post-migration)
    // must not produce `/milestones/` or `/milestones/undefined`.
    const milestone = { id: MILESTONE_CUID, slug: '' }
    expect(
      getCanonicalMilestonePath(baseParams, milestone, PROJECT_NAME)
    ).toBeNull()
  })

  it('returns null when projectSlug or workspaceUrl is missing', () => {
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    expect(
      getCanonicalMilestonePath(
        { ...baseParams, workspaceUrl: undefined },
        milestone,
        PROJECT_NAME
      )
    ).toBeNull()
    expect(
      getCanonicalMilestonePath(
        { ...baseParams, projectSlug: undefined },
        milestone,
        PROJECT_NAME
      )
    ).toBeNull()
  })

  it('still canonicalizes the milestone segment when the project name is not loaded yet', () => {
    // Projects list not loaded → project segment is left as-is (cuid), but the
    // milestone segment still settles to its slug. Once projects load, a second
    // pass canonicalizes the project segment too.
    const milestone = { id: MILESTONE_CUID, slug: SLUG }
    expect(getCanonicalMilestonePath(baseParams, milestone, undefined)).toBe(
      `/workspace/lumo/projects/${PROJECT_CUID}/milestones/${SLUG}`
    )
  })
})
