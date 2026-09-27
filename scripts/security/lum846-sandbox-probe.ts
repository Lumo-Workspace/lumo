/**
 * LUM-846 — run the managed scan's real tool scripts in a real Vercel Sandbox
 * (`vercel/sandbox/universal`, same vCPUs as production) over a probe tree
 * built inside the VM: a `pull_request_target` workflow that interpolates the
 * PR title into `run:`, a Dockerfile with no USER, and a Pod with two
 * privileged containers.
 *
 * The scripts are `managedToolScript` — the exact strings production runs,
 * sha guard included — and the reports go through the production
 * `parseSarif` + `normalizeSarif` (no diff filter, as the baseline does).
 *
 * Passes when zizmor and trivy each report at least one finding, every tool
 * exits as production expects, and the five tools together stay under half
 * the 12-minute sandbox cap. Prints a per-tool timing table as evidence.
 *
 * Manual (boots one VM, needs a local `vercel` login / VERCEL_OIDC_TOKEN):
 *   npx tsx scripts/security/lum846-sandbox-probe.ts
 */
/* eslint-disable no-console -- CLI checkpointer: its output IS the verdict */
import { createScratchSandbox } from '@/lib/integrations/vercel-sandbox'
import { normalizeSarif, parseSarif } from '@/lib/security-scan/sarif'
import {
  MANAGED_SCAN_TOOLS,
  SANDBOX_IMAGE,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_VCPUS,
  type ManagedScanTool,
} from '@/lib/services/security-managed-scan.config'
import {
  MANAGED_REPORT_PATH,
  managedInstallScript,
  managedToolScript,
} from '@/lib/services/security-managed-scan.scripts'

const PROBE_DIR = '/vercel/lum846-probe'
const BUDGET_MS = SANDBOX_TIMEOUT_MS / 2

/** Exit codes production treats as "ran" for each tool on this tree. */
const OK_EXITS: Record<ManagedScanTool, readonly number[]> = {
  gitleaks: [0],
  semgrep: [0, 1],
  // No lockfile in the probe tree: 128 = no package sources (a skip).
  'osv-scanner': [0, 1, 128],
  zizmor: [0, 11, 12, 13, 14],
  trivy: [0],
}

const WORKFLOW = `name: ci
on:
  pull_request_target:
    types: [opened]
jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: echo "Title \${{ github.event.pull_request.title }}"
`
const DOCKERFILE = `FROM node:latest
ADD . /app
RUN npm install
CMD ["node", "/app/index.js"]
`
const POD = `apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  containers:
    - name: web
      image: nginx
      securityContext:
        privileged: true
    - name: sidecar
      image: busybox
      securityContext:
        privileged: true
`

function heredoc(path: string, body: string): string {
  return `cat > ${path} <<'LUM846_EOF'\n${body}LUM846_EOF`
}

const BUILD_TREE = [
  'set -e',
  `rm -rf ${PROBE_DIR}`,
  `mkdir -p ${PROBE_DIR}/.github/workflows ${PROBE_DIR}/deploy`,
  `cd ${PROBE_DIR}`,
  heredoc('.github/workflows/ci.yml', WORKFLOW),
  heredoc('Dockerfile', DOCKERFILE),
  heredoc('deploy/pod.yaml', POD),
  'git init -q .',
  'git add -A',
  'git -c user.email=probe@lum846 -c user.name=probe commit -qm probe',
  'git rev-parse HEAD',
].join('\n')

interface Row {
  tool: ManagedScanTool
  exit: number
  ms: number
  findings: number | null
  rules: string[]
  note: string
}

async function main(): Promise<number> {
  const sandbox = await createScratchSandbox({
    image: SANDBOX_IMAGE,
    vcpus: SANDBOX_VCPUS,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  })
  const rows: Row[] = []
  const problems: string[] = []
  try {
    const built = await sandbox.run('sh', ['-c', BUILD_TREE])
    const headSha = built.stdout.trim().split('\n').pop() ?? ''
    if (built.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(headSha)) {
      throw new Error(`probe tree build failed: ${built.stderr}`)
    }
    console.log(`probe tree at ${PROBE_DIR} @ ${headSha}`)

    // LUM-852: production installs every tool first (phase 1, cwd /tmp).
    for (const tool of MANAGED_SCAN_TOOLS) {
      const inst = await sandbox.run('sh', ['-c', managedInstallScript(tool)], {
        cwd: '/tmp',
      })
      if (inst.exitCode !== 0) {
        throw new Error(`${tool} install exit ${inst.exitCode}: ${inst.stderr}`)
      }
    }

    for (const tool of MANAGED_SCAN_TOOLS) {
      const t0 = Date.now()
      const r = await sandbox.run(
        'sh',
        ['-c', managedToolScript(tool, headSha)],
        { cwd: PROBE_DIR }
      )
      const ms = Date.now() - t0
      const row: Row = {
        tool,
        exit: r.exitCode,
        ms,
        findings: null,
        rules: [],
        note: '',
      }
      rows.push(row)
      if (!OK_EXITS[tool].includes(r.exitCode)) {
        row.note = r.stderr.replace(/\s+/g, ' ').slice(-300)
        problems.push(`${tool} exited ${r.exitCode}: ${row.note}`)
        continue
      }
      if (tool === 'osv-scanner' && r.exitCode === 128) {
        row.note = 'skipped: no package sources (expected, no lockfile)'
        continue
      }
      const buf = await sandbox.readFile(MANAGED_REPORT_PATH[tool])
      if (!buf) {
        problems.push(`${tool} produced no report`)
        continue
      }
      const out = normalizeSarif(parseSarif(JSON.parse(buf.toString('utf8'))), {
        toolHint: tool,
        changedLines: null,
      })
      row.findings = out.findings.length
      row.rules = Array.from(new Set(out.findings.map(f => f.ruleId))).sort()
    }
  } finally {
    await sandbox.stop()
  }

  const total = rows.reduce((n, r) => n + r.ms, 0)
  const added = rows
    .filter(r => r.tool === 'zizmor' || r.tool === 'trivy')
    .reduce((n, r) => n + r.ms, 0)
  console.log('\ntool          exit   seconds  findings')
  for (const r of rows) {
    console.log(
      `${r.tool.padEnd(13)} ${String(r.exit).padEnd(6)} ${(r.ms / 1000)
        .toFixed(1)
        .padStart(7)}  ${r.findings ?? '-'}${r.note ? `  (${r.note})` : ''}`
    )
  }
  console.log(
    `\ntotal ${(total / 1000).toFixed(1)}s of the ${SANDBOX_TIMEOUT_MS / 60000}-minute cap (budget ${BUDGET_MS / 60000} min); zizmor + trivy add ${(added / 1000).toFixed(1)}s`
  )
  for (const r of rows.filter(x => x.tool === 'zizmor' || x.tool === 'trivy')) {
    console.log(`${r.tool} rules: ${r.rules.join(', ') || '(none)'}`)
  }

  for (const tool of ['zizmor', 'trivy'] as const) {
    const r = rows.find(x => x.tool === tool)
    if (!r || !r.findings) problems.push(`${tool} reported no findings`)
  }
  if (total >= BUDGET_MS) {
    problems.push(`five tools took ${(total / 1000).toFixed(0)}s, over budget`)
  }
  if (problems.length > 0) {
    console.error(`\nFAIL\n- ${problems.join('\n- ')}`)
    return 1
  }
  console.log('\nPASS')
  return 0
}

void (async () => {
  try {
    process.exit(await main())
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
