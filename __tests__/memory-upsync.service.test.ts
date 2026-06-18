/**
 * @jest-environment node
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectUpsyncCandidates,
  projectMemoriesEndpoint,
} from '@/cli/src/lib/upsync'

describe('collectUpsyncCandidates', () => {
  it('reads structured {category, content} from outbox/*.json, skipping junk', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-upsync-'))
    mkdirSync(join(root, 'outbox'))
    writeFileSync(
      join(root, 'outbox', 'a.json'),
      JSON.stringify({
        category: 'convention',
        content: { rule: 'r', applies: 'a' },
      })
    )
    writeFileSync(join(root, 'outbox', 'bad.json'), '{ not valid json')
    writeFileSync(join(root, 'outbox', 'note.txt'), 'ignored')
    writeFileSync(
      join(root, 'outbox', 'missing-content.json'),
      JSON.stringify({ category: 'trap' })
    )

    const candidates = collectUpsyncCandidates(root)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.category).toBe('convention')
    expect(candidates[0]!.content).toEqual({ rule: 'r', applies: 'a' })
  })

  it('returns [] when there is no outbox dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-upsync-empty-'))
    expect(collectUpsyncCandidates(root)).toEqual([])
  })
})

describe('projectMemoriesEndpoint', () => {
  it('targets the EXISTING create-project-memory route (no parallel pipeline)', () => {
    // identical to lib/api-client/memories.ts createForProject — proving upsync
    // reuses createForProject (canonicalize → dedup → reconcile-on-write).
    expect(projectMemoriesEndpoint('https://x', 'proj_1')).toBe(
      'https://x/api/projects/proj_1/memories'
    )
  })
})
