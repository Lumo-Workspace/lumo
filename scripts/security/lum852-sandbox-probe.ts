/**
 * LUM-852 — prove the managed scan's isolation on a real Vercel Sandbox, with
 * the production building blocks (not copies): `getRepoCloneToken`'s scope,
 * `createRepoSandbox`, `revokeInstallationToken`, `scrubSandboxCredentials`,
 * `managedInstallScript` / `managedToolScript`, `restrictSandboxEgress` with
 * `SCAN_EGRESS_ALLOWLIST`, then `denySandboxEgress`.
 *
 * Prints, as evidence:
 *   - what the scoped token can see (repositories + permissions) and that it
 *     is dead (401) after the revoke;
 *   - whether the token was in the checkout's `.git/config` BEFORE the scrub,
 *     and that the scrub passed (so it is not there, nor in env / $HOME);
 *   - every scanner's exit code and report size under the allowlist;
 *   - egress: an allowlisted host reachable and a non-listed one not, under
 *     the allowlist; nothing reachable after deny-all.
 *
 * The token is minted by `createRepoScopedToken` — the same call
 * `getRepoCloneToken` makes — from the installation id in the local env
 * (there is no workspace row to resolve here).
 *
 * Manual (boots one VM; needs GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY /
 * GITHUB_APP_INSTALLATION_ID and a local `vercel` login / VERCEL_OIDC_TOKEN):
 *   npx tsx --env-file=<.env.local> scripts/security/lum852-sandbox-probe.ts <owner/repo> <sha>
 */
/* eslint-disable no-console -- CLI probe: its output IS the evidence */
import {
  createRepoSandbox,
  denySandboxEgress,
  repoCheckoutDir,
  restrictSandboxEgress,
  type RepoSandbox,
} from '@/ee/security/integrations/vercel-sandbox'
// LUM-889: the unchecked mint is internal — not in the github barrel.
import {
  createRepoScopedToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { scrubSandboxCredentials } from '@/ee/security/services/sandbox-credential-scrub'
import {
  MANAGED_SCAN_TOOLS,
  SANDBOX_IMAGE,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_VCPUS,
  SCAN_EGRESS_ALLOWLIST,
} from '@/ee/security/services/security-managed-scan.config'
import {
  MANAGED_REPORT_PATH,
  managedInstallScript,
  managedToolScript,
} from '@/ee/security/services/security-managed-scan.scripts'

const [repository, sha] = process.argv.slice(2)
if (!repository || !sha || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error('usage: lum852-sandbox-probe.ts <owner/repo> <40-char sha>')
  process.exit(2)
}

async function mintScopedToken(): Promise<string> {
  return createRepoScopedToken(
    Number(process.env.GITHUB_APP_INSTALLATION_ID),
    repository!
  )
}

async function tokenScope(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/installation/repositories', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (res.status !== 200) return `HTTP ${res.status}`
  const body = (await res.json()) as {
    total_count: number
    repositories: { full_name: string }[]
  }
  return `HTTP 200, ${body.total_count} repo(s): ${body.repositories.map(r => r.full_name).join(', ')}`
}

/** exit code of a 10 s curl to `url` from inside the VM (0 = reached). */
async function reach(sandbox: RepoSandbox, url: string): Promise<number> {
  const r = await sandbox.run('curl', [
    '-sS',
    '-o',
    '/dev/null',
    '-m',
    '10',
    url,
  ])
  return r.exitCode
}

async function main(): Promise<void> {
  const problems: string[] = []
  const token = await mintScopedToken()
  const scope = await tokenScope(token)
  console.log(`scoped token sees: ${scope}`)
  if (!scope.startsWith('HTTP 200, 1 repo(s)')) {
    problems.push('scoped token does not see exactly one repository')
  }

  const t0 = Date.now()
  let sandbox: RepoSandbox
  try {
    sandbox = await createRepoSandbox({
      repository: repository!,
      revision: sha!,
      token,
      timeoutMs: SANDBOX_TIMEOUT_MS,
      vcpus: SANDBOX_VCPUS,
      image: SANDBOX_IMAGE,
    })
  } finally {
    const revoked = await revokeInstallationToken(token)
    console.log(`revoke → ${revoked}`)
    // LUM-869: the services now refuse to scan on this; the probe says so too.
    if (!revoked) problems.push('clone token revoke failed')
  }
  const afterRevoke = await tokenScope(token)
  console.log(`token after revoke: ${afterRevoke}`)
  if (afterRevoke !== 'HTTP 401') problems.push('token still live after revoke')

  try {
    const cwd = repoCheckoutDir(sandbox.cwd, repository!)
    const config =
      (await sandbox.readFile(`${cwd}/.git/config`)) ?? Buffer.from('')
    console.log(
      `token in .git/config before scrub: ${config.toString('utf8').includes(token)}`
    )
    await scrubSandboxCredentials({ sandbox, cwd, token }, repository!)
    const after =
      (await sandbox.readFile(`${cwd}/.git/config`)) ?? Buffer.from('')
    const env = await sandbox.run('env', [], { cwd })
    console.log(
      `scrub passed · token-in-git-config=${after.toString('utf8').includes(token)} · token-in-env=${env.stdout.includes(token)}`
    )

    for (const tool of MANAGED_SCAN_TOOLS) {
      const r = await sandbox.run('sh', ['-c', managedInstallScript(tool)], {
        cwd: '/tmp',
      })
      console.log(`install ${tool}: exit ${r.exitCode}`)
      if (r.exitCode !== 0) {
        problems.push(
          `${tool} install exit ${r.exitCode}: ${r.stderr.slice(-300)}`
        )
      }
    }

    await restrictSandboxEgress(sandbox.name, SCAN_EGRESS_ALLOWLIST)
    const osv = await reach(
      sandbox,
      'https://api.osv.dev/v1/vulns/OSV-2020-111'
    )
    const other = await reach(sandbox, 'https://example.com/')
    console.log(
      `allowlist: api.osv.dev curl exit ${osv} · example.com curl exit ${other}`
    )
    if (osv !== 0) problems.push('allowlisted host unreachable')
    if (other === 0) problems.push('non-allowlisted host reachable')

    console.log('tool         exit  report bytes  seconds')
    for (const tool of MANAGED_SCAN_TOOLS) {
      const s0 = Date.now()
      const r = await sandbox.run('sh', ['-c', managedToolScript(tool, sha!)], {
        cwd,
      })
      const report = await sandbox.readFile(MANAGED_REPORT_PATH[tool])
      console.log(
        `${tool.padEnd(12)} ${String(r.exitCode).padEnd(5)} ${String(report?.byteLength ?? 0).padEnd(13)} ${((Date.now() - s0) / 1000).toFixed(1)}`
      )
      const skip = tool === 'osv-scanner' && r.exitCode === 128
      // LUM-869: a 0-byte file is not a report (zizmor wrote one and passed).
      if ((!report || report.byteLength === 0) && !skip) {
        problems.push(
          `${tool} produced no report (exit ${r.exitCode}): ${r.stderr.slice(-300)}`
        )
      }
    }

    await denySandboxEgress(sandbox.name)
    const osvAfter = await reach(
      sandbox,
      'https://api.osv.dev/v1/vulns/OSV-2020-111'
    )
    console.log(`deny-all: api.osv.dev curl exit ${osvAfter}`)
    if (osvAfter === 0) problems.push('egress still open after deny-all')
  } finally {
    await sandbox.stop()
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s`)

  if (problems.length > 0) {
    console.log(`FAIL\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.log('PASS')
}

main().catch(error => {
  console.error(
    `probe error: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exit(1)
})
