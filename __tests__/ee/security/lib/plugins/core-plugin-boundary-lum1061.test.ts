/**
 * LUM-1061 — the scan-side core files of RFC LUM-1058 §3.5 (plus the two
 * #1367 edges, see below) reach the security plugin only through the
 * registry, and nothing outside lib/plugins/installed.ts imports the plugin
 * tree. PR5 replaces this list with a guard over every core file.
 */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../../../../..')

/** Core files PR2 moved onto the doneGate / agentContext / event / retention points. */
const CORE_FILES = [
  'app/api/hooks/pre-tool-use/route.ts',
  'app/api/webhooks/github/handlers.ts',
  'lib/repositories/index.ts',
  'lib/services/done-verdict.service.ts',
  'lib/services/github-app-install.service.ts',
  'lib/services/retention-stock.service.ts',
  'lib/services/session.service.ts',
  'lib/services/task-context.service.ts',
  'lib/services/task-pr-link.service.ts',
  'lib/services/task-status.service.ts',
]

/** Import specifiers of the security plugin these files used to reach. */
const PLUGIN_IMPORT =
  /from\s+['"][^'"]*(pr-security-|security-baseline|scan-evidence-retention|security-scan\/agent-reminder|security-scan\/review-control)[^'"]*['"]|import\(\s*['"][^'"]*(pr-security-|security-baseline)[^'"]*['"]/

function source(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

describe('LUM-1061 scan-side core files go through the plugin registry', () => {
  it.each(CORE_FILES)('%s imports no security-plugin module', file => {
    expect(source(file)).not.toMatch(PLUGIN_IMPORT)
    // …not even through the repositories barrel (github-app-install did).
    expect(source(file)).not.toMatch(/prSecurityScanRepository/)
  })

  it('only the installed lists (and plugin files not yet moved) import the plugin tree', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', 'app', 'components', 'hooks', 'lib', 'shared/src'],
      { cwd: ROOT, encoding: 'utf8' }
    )
      .split('\0')
      .filter(f => /\.(ts|tsx)$/.test(f))
    const importers = files.filter(f =>
      /['"]@\/ee\/|['"](\.\.\/)+ee\//.test(source(f))
    )
    // LUM-1062: the client list joins the server one. Two security-plugin
    // files that still live under app/ until PR6 import their moved helpers
    // (scan badges, the plugin API client) from ee/ — plugin to plugin.
    expect(importers).toEqual([
      'app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SecurityScanSection.tsx',
      'app/workspace/[workspaceUrl]/components/settings/SecurityScanSwitchesCard.tsx',
      'lib/plugins/installed.client.ts',
      'lib/plugins/installed.ts',
    ])
  })
})
