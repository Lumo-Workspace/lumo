/**
 * LUM-846 — the shell each managed-scan tool runs inside the sandbox, and
 * where it leaves its SARIF. Pure (strings only, no SDK, no I/O) so the
 * real-VM probe (`scripts/security/lum846-sandbox-probe.ts`) executes the
 * exact scripts production does instead of a copy of them.
 */
import {
  LLM_SEMGREP_RULES_YAML,
  SEMGREP_CUSTOM_RULES_EOF,
  SEMGREP_CUSTOM_RULES_PATH,
} from '@/lib/security-scan/semgrep-rules'
import {
  GITLEAKS_URL,
  OSV_SCANNER_URL,
  SEMGREP_CONFIGS,
  SEMGREP_VERSION,
  TRIVY_SEVERITIES,
  TRIVY_SHA256,
  TRIVY_URL,
  ZIZMOR_SHA256,
  ZIZMOR_URL,
  type ManagedScanTool,
} from './security-managed-scan.config'

/**
 * The P9 checkout guard's exit. It sits INSIDE osv-scanner's result band, so
 * the band has to exclude it by name: a guard whose whole job is "this is the
 * wrong tree, do not report anything" must not become conditional on whether a
 * report happens to exist. Unreachable in a fresh one-shot VM today — but the
 * guard exists against the unforeseen, and LUM-758's `keepAlive` already lets a
 * second workflow attach to the same VM's /tmp.
 */
export const SHA_GUARD_EXIT = 90

export const MANAGED_REPORT_PATH: Record<ManagedScanTool, string> = {
  gitleaks: '/tmp/gitleaks.sarif',
  semgrep: '/tmp/semgrep.sarif',
  'osv-scanner': '/tmp/osv.sarif',
  zizmor: '/tmp/zizmor.sarif',
  trivy: '/tmp/trivy.sarif',
}

/**
 * LUM-851 — a second report a tool leaves next to its SARIF. trivy's JSON is
 * the only place a check with no line of its own (DS-0002) says so; its
 * SARIF writes 1:1 for those, same as a real line-1 hit.
 */
export const MANAGED_SIDECAR_PATH: Partial<Record<ManagedScanTool, string>> = {
  trivy: '/tmp/trivy.json',
}

/** LUM-846: download a pinned tarball and refuse to unpack it unless its sha256 matches. */
function verifiedDownload(url: string, sha256: string, file: string): string {
  return `curl -sSL -o ${file} "${url}"; echo "${sha256}  ${file}" | sha256sum -c --quiet -`
}

/**
 * LUM-852 — phase 1, run from /tmp with the network open: fetch each tool.
 * Nothing here reads the checkout, so nothing here can be steered by the
 * repository; the scripts below (phase 2) run after the credential scrub and
 * with egress narrowed to `SCAN_EGRESS_ALLOWLIST`.
 */
const INSTALL_BODY: Record<ManagedScanTool, string> = {
  gitleaks: `set -e; curl -sSL "${GITLEAKS_URL}" | tar -xz -C /tmp gitleaks`,
  semgrep: `set -e; python3 -m pip install --quiet semgrep==${SEMGREP_VERSION}`,
  'osv-scanner': `set -e; curl -sSL -o /tmp/osv-scanner "${OSV_SCANNER_URL}"; chmod +x /tmp/osv-scanner`,
  zizmor: [
    'set -e',
    verifiedDownload(ZIZMOR_URL, ZIZMOR_SHA256, '/tmp/zizmor.tgz'),
    'tar -xzf /tmp/zizmor.tgz -C /tmp zizmor',
  ].join('\n'),
  // The check bundle lives in trivy's cache; a config scan of an empty
  // directory pulls it now, so the real scan can skip the update and needs no
  // registry host on the allowlist. A failed pull leaves trivy on its
  // embedded checks, which is also what the scan then uses.
  trivy: [
    'set -e',
    verifiedDownload(TRIVY_URL, TRIVY_SHA256, '/tmp/trivy.tgz'),
    'tar -xzf /tmp/trivy.tgz -C /tmp trivy',
    'mkdir -p /tmp/trivy-warm',
    'cd /tmp/trivy-warm && /tmp/trivy config --quiet --exit-code 0 . >/dev/null || true',
  ].join('\n'),
}

/** The install script for one tool; runs with cwd /tmp. */
export function managedInstallScript(tool: ManagedScanTool): string {
  return INSTALL_BODY[tool]
}

const SCRIPT_BODY: Record<ManagedScanTool, string> = {
  gitleaks: `/tmp/gitleaks dir . --report-format sarif --report-path ${MANAGED_REPORT_PATH.gitleaks} --exit-code 0 --no-banner`,
  // LUM-785: Lumo's own rules ride along as a dotfile written into the
  // checkout root (see `SEMGREP_CUSTOM_RULES_PATH` for why not /tmp), loaded
  // FIRST so a registry pack cannot override them, and removed again once
  // semgrep has run. The quoted heredoc keeps the YAML byte-for-byte (no
  // expansion of `$V` / `${…}` metavariables). semgrep's exit code is kept
  // across the cleanup: exit 1 = findings, which `isSuccessExit` accepts.
  semgrep: [
    'set -e',
    `cat > ${SEMGREP_CUSTOM_RULES_PATH} <<'${SEMGREP_CUSTOM_RULES_EOF}'`,
    LLM_SEMGREP_RULES_YAML.replace(/\n$/, ''),
    SEMGREP_CUSTOM_RULES_EOF,
    'code=0',
    `semgrep scan --config ${SEMGREP_CUSTOM_RULES_PATH} ${SEMGREP_CONFIGS.map(c => `--config ${c}`).join(' ')} --sarif --output ${MANAGED_REPORT_PATH.semgrep} --metrics=off --disable-version-check || code=$?`,
    `rm -f ${SEMGREP_CUSTOM_RULES_PATH}`,
    'exit $code',
  ].join('\n'),
  // `scan source -r .` walks every lockfile / manifest osv-scanner knows;
  // SARIF goes to a file so stdout (which may echo advisory text) is never
  // parsed.
  'osv-scanner': `/tmp/osv-scanner scan source -r . --format sarif --output-file ${MANAGED_REPORT_PATH['osv-scanner']}`,
  // LUM-846: `--offline` keeps zizmor from calling the GitHub API — its
  // online audits would need a token handed to a third-party binary, and
  // would send the customer's action refs out of the VM. zizmor prints SARIF
  // on stdout; its exit code is kept across the redirect (3 = no inputs).
  zizmor: [
    'code=0',
    `/tmp/zizmor --offline --format sarif . > ${MANAGED_REPORT_PATH.zizmor} || code=$?`,
    'exit $code',
  ].join('\n'),
  // LUM-846: `config` only (Dockerfile / Kubernetes / Terraform / Helm /
  // CloudFormation misconfigurations). `--exit-code 0` is explicit because a
  // trivy.yaml in the customer's checkout is loaded by default and could set
  // it; any non-zero exit is therefore a real failure.
  // LUM-851: the scan writes JSON (the only format that keeps "this check has
  // no line"), and `trivy convert` renders the SARIF from that same JSON with
  // the same writer the scan used — so the SARIF, and every fingerprint keyed
  // on its message, is what a direct `--format sarif` produced. convert runs
  // from /tmp so it cannot load a trivy.yaml from the customer's checkout.
  // LUM-852: `--skip-check-update` — the bundle was cached at install time.
  trivy: [
    'set -e',
    `/tmp/trivy config --skip-check-update --severity ${TRIVY_SEVERITIES} --exit-code 0 --format json --output ${MANAGED_SIDECAR_PATH.trivy} .`,
    `cd /tmp && /tmp/trivy convert --format sarif --output ${MANAGED_REPORT_PATH.trivy} ${MANAGED_SIDECAR_PATH.trivy}`,
  ].join('\n'),
}

/**
 * Guards against a mis-rooted or wrong-revision sandbox scanning the wrong
 * tree and silently passing (P9): the guard exits 90 — that tool's normal
 * non-success exit — when the checkout at cwd is not exactly `headSha`.
 * `headSha` is interpolated into a shell script, so it must be validated
 * (see `HEAD_SHA_RE`) before this is ever called.
 */
export function managedToolScript(
  tool: ManagedScanTool,
  headSha: string
): string {
  const guard = `test "$(git rev-parse HEAD 2>/dev/null | cut -c1-${headSha.length})" = "${headSha}" || exit ${SHA_GUARD_EXIT}; `
  return guard + SCRIPT_BODY[tool]
}
