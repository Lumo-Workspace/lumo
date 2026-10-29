/**
 * LUM-1339 — the settings navigation: five groups, one page per area. The
 * nav, the legacy redirects and their tests all read this one model.
 */

export type SettingsNavIcon =
  | 'user'
  | 'bell'
  | 'link'
  | 'terminal'
  | 'building'
  | 'users'
  | 'puzzle'
  | 'tag'
  | 'calendar'
  | 'check'
  | 'gitPullRequest'
  | 'folderGit'
  | 'listChecks'
  | 'database'
  | 'sparkles'
  | 'download'
  | 'scrollText'
  | 'trash'

export interface SettingsNavItem {
  /** Path under `/workspace/<slug>/settings/`. */
  path: string
  labelId: string
  icon: SettingsNavIcon
}

export interface SettingsNavGroup {
  id: 'personal' | 'workspace' | 'workflow' | 'codeReview' | 'dataSecurity'
  labelId: string
  items: SettingsNavItem[]
}

export interface SettingsNavOptions {
  isOwner: boolean
  /** The security plugin fills the Code review pages (absent in OSS builds). */
  codeReviewAvailable: boolean
}

/**
 * The groups a viewer sees. Members keep exactly what they could open before
 * (members, integrations, tags, trash, and every personal page); the rest is
 * OWNER-only, as the pages and the API enforce. Empty groups are dropped.
 */
export function settingsNav({
  isOwner,
  codeReviewAvailable,
}: SettingsNavOptions): SettingsNavGroup[] {
  const owner = <T>(items: T[]): T[] => (isOwner ? items : [])
  const groups: SettingsNavGroup[] = [
    {
      id: 'personal',
      labelId: 'settings.personal',
      items: [
        { path: 'account', labelId: 'settings.account', icon: 'user' },
        {
          path: 'notifications',
          labelId: 'settings.notifications',
          icon: 'bell',
        },
        {
          path: 'connected-accounts',
          labelId: 'settings.connectedAccounts',
          icon: 'link',
        },
        { path: 'developer', labelId: 'settings.developer', icon: 'terminal' },
      ],
    },
    {
      id: 'workspace',
      labelId: 'settings.workspace',
      items: [
        ...owner([
          {
            path: 'general',
            labelId: 'settings.general',
            icon: 'building' as const,
          },
        ]),
        { path: 'members', labelId: 'settings.members', icon: 'users' },
        {
          path: 'integrations',
          labelId: 'settings.integrations',
          icon: 'puzzle',
        },
      ],
    },
    {
      id: 'workflow',
      labelId: 'settings.group.workflow',
      items: [
        { path: 'tags', labelId: 'settings.tags', icon: 'tag' },
        ...owner([
          {
            path: 'sprints',
            labelId: 'settings.nav.sprints',
            icon: 'calendar' as const,
          },
          {
            path: 'done-requirements',
            labelId: 'workspaceSettings.section.doneRequirements',
            icon: 'check' as const,
          },
        ]),
      ],
    },
    {
      id: 'codeReview',
      labelId: 'settings.group.codeReview',
      items:
        isOwner && codeReviewAvailable
          ? [
              {
                path: 'code-review',
                labelId: 'settings.codeReview.behavior',
                icon: 'gitPullRequest',
              },
              {
                path: 'code-review/repositories',
                labelId: 'settings.codeReview.repositories',
                icon: 'folderGit',
              },
              {
                path: 'code-review/rules',
                labelId: 'settings.codeReview.rules',
                icon: 'listChecks',
              },
            ]
          : [],
    },
    {
      id: 'dataSecurity',
      labelId: 'settings.group.dataSecurity',
      items: [
        ...owner([
          {
            path: 'data-retention',
            labelId: 'dataRetention.title',
            icon: 'database' as const,
          },
          { path: 'ai', labelId: 'settings.ai', icon: 'sparkles' as const },
          {
            path: 'export',
            labelId: 'settings.export',
            icon: 'download' as const,
          },
          {
            path: 'audit-log',
            labelId: 'settings.auditLog',
            icon: 'scrollText' as const,
          },
        ]),
        // LUM-918: every member has a trash (tasks + their own documents).
        { path: 'trash', labelId: 'settings.trash', icon: 'trash' },
      ],
    },
  ]
  return groups.filter(g => g.items.length > 0)
}

/** Old settings paths and the page (with an optional anchor) each moved to. */
export const LEGACY_SETTINGS_REDIRECTS = {
  profile: 'account',
  preferences: 'account#preferences',
  cli: 'developer',
  'api-keys': 'developer#api-keys',
} as const

/**
 * Where an anchor on the old single Workspace page (LUM-1327) lives now;
 * links in sent mails and notices still carry them. No anchor → General.
 */
export function legacyWorkspaceTarget(hash: string): string {
  switch (hash.replace(/^#/, '')) {
    case 'done-requirements':
      return 'done-requirements'
    case 'ai-features':
      return 'ai'
    case 'code-review':
      return 'code-review'
    case 'data-privacy':
    case 'data-retention':
      return 'data-retention'
    case 'danger-zone':
      return 'general#danger-zone'
    default:
      return 'general'
  }
}

/**
 * The full URL of a settings page, carrying over a redirected request's
 * query string (OAuth callbacks pass `?…_error=` / `?connected=1`).
 */
export function settingsUrl(
  workspaceUrl: string,
  target: string,
  search: Record<string, string | string[] | undefined> = {}
): string {
  const [path, hash] = target.split('#')
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) {
      params.append(key, v)
    }
  }
  const query = params.toString()
  return `/workspace/${workspaceUrl}/settings/${path}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`
}
