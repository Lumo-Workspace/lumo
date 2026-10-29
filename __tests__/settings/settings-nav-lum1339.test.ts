/**
 * LUM-1339 — the settings nav model and the redirects that keep old links
 * working: every old path and every anchor of the old single Workspace page
 * lands on the page that now holds it, query string included.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  LEGACY_SETTINGS_REDIRECTS,
  legacyWorkspaceTarget,
  settingsNav,
  settingsUrl,
} from '@/app/workspace/[workspaceUrl]/settings/settings-nav'

const SETTINGS_DIR = path.join(
  process.cwd(),
  'app/workspace/[workspaceUrl]/settings'
)

describe('settingsNav', () => {
  it('every page in the nav has a route', () => {
    for (const group of settingsNav({
      isOwner: true,
      codeReviewAvailable: true,
    })) {
      for (const item of group.items) {
        expect(
          fs.existsSync(path.join(SETTINGS_DIR, item.path, 'page.tsx'))
        ).toBe(true)
      }
    }
  })

  it('drops groups a member has nothing in', () => {
    expect(
      settingsNav({ isOwner: false, codeReviewAvailable: true }).map(g => g.id)
    ).toEqual(['personal', 'workspace', 'workflow', 'dataSecurity'])
  })
})

describe('legacy redirects', () => {
  it.each([
    ['profile', '/workspace/acme/settings/account'],
    ['preferences', '/workspace/acme/settings/account#preferences'],
    ['cli', '/workspace/acme/settings/developer'],
    ['api-keys', '/workspace/acme/settings/developer#api-keys'],
  ] as const)('/settings/%s → %s', (from, to) => {
    expect(settingsUrl('acme', LEGACY_SETTINGS_REDIRECTS[from])).toBe(to)
    // The old route still exists and redirects.
    expect(fs.existsSync(path.join(SETTINGS_DIR, from, 'page.tsx'))).toBe(true)
  })

  it.each([
    ['', 'general'],
    ['#general', 'general'],
    ['#done-requirements', 'done-requirements'],
    ['#ai-features', 'ai'],
    ['#code-review', 'code-review'],
    ['#data-privacy', 'data-retention'],
    // Sent session-record notices link here (lib/services/session-record-notice.service.ts before LUM-1339).
    ['#data-retention', 'data-retention'],
    ['#danger-zone', 'general#danger-zone'],
    ['#unknown', 'general'],
  ])('old Workspace page %p → %s', (hash, target) => {
    expect(legacyWorkspaceTarget(hash)).toBe(target)
  })
})

describe('settingsUrl', () => {
  it('carries the query string over, before the anchor', () => {
    expect(
      settingsUrl('acme', 'developer#api-keys', {
        github_error: 'expired',
        tag: ['a', 'b'],
        gone: undefined,
      })
    ).toBe(
      '/workspace/acme/settings/developer?github_error=expired&tag=a&tag=b#api-keys'
    )
  })

  it('adds no "?" without a query', () => {
    expect(settingsUrl('acme', 'general')).toBe(
      '/workspace/acme/settings/general'
    )
  })
})
