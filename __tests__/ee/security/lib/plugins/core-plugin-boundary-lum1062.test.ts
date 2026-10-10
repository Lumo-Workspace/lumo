/**
 * LUM-1062 — the UI and settings core files of RFC LUM-1058 §3.5 (the 15
 * PR3 edges of PR2's inventory, plus the legal retention figures) reach the
 * security plugin only through the client slots, the `workspaceSettings`
 * point and the `retention` figures. PR5 replaces this list with a guard
 * over every core file.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../../../../..')
const W = 'app/workspace/[workspaceUrl]/components'

const CORE_FILES = [
  `${W}/TaskDetailTimeline/TaskDossier.tsx`,
  `${W}/TaskDetailTimeline/sections/PullRequestsSection.tsx`,
  `${W}/TaskDetailTimeline/BoundaryCrossingsPanel.tsx`,
  `${W}/pages/WorkspaceSettingsPage.tsx`,
  `${W}/pr-helpers.tsx`,
  `${W}/settings/DataRetentionSection.tsx`,
  'app/api/workspaces/me/route.ts',
  'lib/api-client/workspaces.ts',
  'lib/validation/schemas.ts',
  'lib/services/workspace.service.ts',
  'lib/services/claim-faithfulness.service.ts',
  'lib/legal/retention-figures.ts',
  'components/security/SecurityPage.tsx',
]

/** Import specifiers of the security plugin these files used to reach. */
const PLUGIN_IMPORT =
  /from\s+['"][^'"]*(SecurityScanSection|security-summary|useSecurityScans|SecurityScanSwitchesCard|ScanEvidenceRetentionRow|CrossingTriageLine|security-scan\/|pr-security-scan|security-scan-settings|security-workspace-switches|retention\/scan-evidence|@\/ee\/)[^'"]*['"]/

describe('LUM-1062 UI and settings core files go through slots and settings points', () => {
  it.each(CORE_FILES)('%s imports no security-plugin module', file => {
    expect(readFileSync(join(ROOT, file), 'utf8')).not.toMatch(PLUGIN_IMPORT)
  })
})
