/**
 * LUM-851 — trivy checks with no line of their own (DS-0002 "no USER"), in a
 * real Vercel Sandbox with the production trivy script.
 *
 * Tree A is the LUM-846 probe tree (Dockerfile whose line 1 is a real
 * `FROM node:latest`, no USER; a Pod with two privileged containers):
 *   - the production script's findings must carry DS-0002 line=null and
 *     DS-0001 line=1;
 *   - its fingerprints must equal those of the pre-LUM-851 script (a direct
 *     `--format sarif`), and so must its SARIF bytes.
 * Tree B is a PR: base has a Dockerfile whose line 1 is a comment and which
 * sets `USER node`; head deletes only the USER line. The real `git diff
 * base head` goes through the production diff parser, and DS-0002 must be
 * reported (line=null). Without the JSON signal it would be dropped — the
 * probe prints that too, as the before/after.
 *
 * `--write-fixtures` also saves the raw reports to `__tests__/fixtures/lum851/`.
 *
 * Manual (boots one VM, needs a local `vercel` login / VERCEL_OIDC_TOKEN):
 *   npx tsx scripts/security/lum851-sandbox-probe.ts [--write-fixtures]
 */
/* eslint-disable no-console -- CLI checkpointer: its output IS the verdict */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createScratchSandbox } from '@/lib/integrations/vercel-sandbox'
import {
  changedLinesOfDiff,
  normalizeSarif,
  parseSarif,
  trivyFileLevelKeys,
} from '@/lib/security-scan/sarif'
import type { RawSarifFinding } from '@/lib/security-scan/types'
import {
  SANDBOX_IMAGE,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_VCPUS,
  TRIVY_SEVERITIES,
} from '@/lib/services/security-managed-scan.config'
import {
  MANAGED_REPORT_PATH,
  MANAGED_SIDECAR_PATH,
  managedToolScript,
} from '@/lib/services/security-managed-scan.scripts'

const TREE_A = '/vercel/lum851-a'
const TREE_B = '/vercel/lum851-b'
const OLD_SARIF = '/tmp/trivy-pre-lum851.sarif'
const FIXTURE_DIR = join(__dirname, '../../__tests__/fixtures/lum851')

const DOCKERFILE_A = `FROM node:latest
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
const DOCKERFILE_B_BASE = `# app image
FROM node:22.9.0
WORKDIR /app
COPY . .
RUN npm ci
USER node
CMD ["node", "index.js"]
`
const DOCKERFILE_B_HEAD = DOCKERFILE_B_BASE.replace('USER node\n', '')

function heredoc(path: string, body: string): string {
  return `cat > ${path} <<'LUM851_EOF'\n${body}LUM851_EOF`
}
const GIT = 'git -c user.email=probe@lum851 -c user.name=probe'

const BUILD = [
  'set -e',
  `rm -rf ${TREE_A} ${TREE_B}`,
  `mkdir -p ${TREE_A}/deploy ${TREE_B}`,
  `cd ${TREE_A}`,
  heredoc('Dockerfile', DOCKERFILE_A),
  heredoc('deploy/pod.yaml', POD),
  `git init -q . && git add -A && ${GIT} commit -qm a`,
  `cd ${TREE_B}`,
  heredoc('Dockerfile', DOCKERFILE_B_BASE),
  `git init -q . && git add -A && ${GIT} commit -qm base`,
  heredoc('Dockerfile', DOCKERFILE_B_HEAD),
  `${GIT} commit -qam head`,
  `echo "A $(git -C ${TREE_A} rev-parse HEAD)"`,
  `echo "B $(git rev-parse HEAD)"`,
].join('\n')

function withoutRootPath(sarif: Buffer): string {
  const doc = JSON.parse(sarif.toString('utf8')) as {
    runs: Array<Record<string, unknown>>
  }
  for (const run of doc.runs) delete run['originalUriBaseIds']
  return JSON.stringify(doc)
}

function byRule(findings: RawSarifFinding[], rule: string): RawSarifFinding[] {
  return findings.filter(f => f.ruleId === `ext:trivy:${rule}`)
}

async function main(): Promise<number> {
  const writeFixtures = process.argv.includes('--write-fixtures')
  const problems: string[] = []
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
    if (!ok) problems.push(what)
  }
  const sandbox = await createScratchSandbox({
    image: SANDBOX_IMAGE,
    vcpus: SANDBOX_VCPUS,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  })
  try {
    const built = await sandbox.run('sh', ['-c', BUILD])
    const sha = Object.fromEntries(
      built.stdout
        .trim()
        .split('\n')
        .map(l => l.split(' ') as [string, string])
    )
    if (built.exitCode !== 0 || !sha['A'] || !sha['B']) {
      throw new Error(`probe trees failed: ${built.stderr}`)
    }

    const read = async (path: string): Promise<Buffer> => {
      const buf = await sandbox.readFile(path)
      if (!buf) throw new Error(`no ${path}`)
      return buf
    }
    const runTrivy = async (cwd: string, headSha: string) => {
      const r = await sandbox.run(
        'sh',
        ['-c', managedToolScript('trivy', headSha)],
        { cwd }
      )
      if (r.exitCode !== 0) {
        throw new Error(`trivy exit ${r.exitCode}: ${r.stderr.slice(-400)}`)
      }
      return {
        sarif: await read(MANAGED_REPORT_PATH.trivy),
        json: await read(MANAGED_SIDECAR_PATH.trivy!),
      }
    }

    // ── Tree A: the production script vs the pre-LUM-851 one ────────────────
    const a = await runTrivy(TREE_A, sha['A'])
    const old = await sandbox.run(
      'sh',
      [
        '-c',
        `/tmp/trivy config --severity ${TRIVY_SEVERITIES} --exit-code 0 --format sarif --output ${OLD_SARIF} .`,
      ],
      { cwd: TREE_A }
    )
    if (old.exitCode !== 0) throw new Error(`old trivy: ${old.stderr}`)
    const oldSarif = await read(OLD_SARIF)

    const fileLevel = trivyFileLevelKeys(JSON.parse(a.json.toString('utf8')))
    const newOut = normalizeSarif(parseSarif(JSON.parse(a.sarif.toString())), {
      toolHint: 'trivy',
      changedLines: null,
      fileLevelResults: fileLevel,
    })
    const oldOut = normalizeSarif(parseSarif(JSON.parse(oldSarif.toString())), {
      toolHint: 'trivy',
      changedLines: null,
    })
    console.log(`\ntree A: ${newOut.findings.length} trivy findings`)
    for (const f of newOut.findings) {
      console.log(`  ${f.ruleId.padEnd(22)} ${f.filePath}:${f.line ?? '-'}`)
    }
    check(
      byRule(newOut.findings, 'DS-0002').length === 1 &&
        byRule(newOut.findings, 'DS-0002')[0]!.line === null,
      'A: DS-0002 (no USER) has line=null'
    )
    check(
      byRule(newOut.findings, 'DS-0001')[0]?.line === 1,
      'A: DS-0001 (FROM :latest on line 1) keeps line=1'
    )
    check(
      newOut.findings.every(
        f => f.ruleId === 'ext:trivy:DS-0002' || f.line !== null
      ),
      'A: every other finding keeps its line'
    )
    const fps = (o: typeof newOut) =>
      o.findings
        .map(f => f.fingerprint)
        .sort()
        .join(',')
    check(
      fps(newOut) === fps(oldOut) && newOut.findings.length > 0,
      `A: fingerprints equal the pre-LUM-851 script's (${oldOut.findings.length} vs ${newOut.findings.length})`
    )
    // `trivy convert` names the JSON file as ROOTPATH where the scan named
    // the checkout; parseSarif never reads originalUriBaseIds.
    check(
      withoutRootPath(a.sarif) === withoutRootPath(oldSarif),
      'A: the converted SARIF equals a direct --format sarif (ROOTPATH aside)'
    )

    // ── Tree B: a PR that deletes only the USER line ────────────────────────
    const b = await runTrivy(TREE_B, sha['B'])
    const diff = await sandbox.run('sh', ['-c', 'git diff HEAD~1 HEAD'], {
      cwd: TREE_B,
    })
    const changedLines = changedLinesOfDiff(diff.stdout)
    console.log(`\ntree B diff:\n${diff.stdout}`)
    const runsB = parseSarif(JSON.parse(b.sarif.toString()))
    const after = normalizeSarif(runsB, {
      toolHint: 'trivy',
      changedLines,
      fileLevelResults: trivyFileLevelKeys(JSON.parse(b.json.toString())),
    })
    // What production did before LUM-851: SARIF lines, added-lines-only files.
    const before = normalizeSarif(runsB, {
      toolHint: 'trivy',
      changedLines: new Map(
        [...changedLines].filter(([, lines]) => lines.size > 0)
      ),
    })
    console.log(
      `tree B: before LUM-851 ${before.findings.length} kept / ${before.dropped.notInDiff} notInDiff; after ${after.findings.length} kept / ${after.dropped.notInDiff} notInDiff`
    )
    check(
      byRule(after.findings, 'DS-0002')[0]?.line === null,
      'B: deleting the USER line reports DS-0002 (line=null)'
    )
    console.log(
      `     (pre-LUM-851 pipeline on the same diff: DS-0002 ${byRule(before.findings, 'DS-0002').length ? 'kept' : 'dropped'})`
    )

    if (writeFixtures) {
      mkdirSync(FIXTURE_DIR, { recursive: true })
      writeFileSync(join(FIXTURE_DIR, 'trivy.json'), a.json)
      writeFileSync(join(FIXTURE_DIR, 'trivy.sarif'), a.sarif)
      writeFileSync(join(FIXTURE_DIR, 'pr-no-user.trivy.json'), b.json)
      writeFileSync(join(FIXTURE_DIR, 'pr-no-user.trivy.sarif'), b.sarif)
      writeFileSync(join(FIXTURE_DIR, 'pr-no-user.diff'), diff.stdout)
      console.log(`\nfixtures written to ${FIXTURE_DIR}`)
    }
  } finally {
    await sandbox.stop()
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
