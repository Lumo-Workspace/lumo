/**
 * LUM-949 — coarse risk-type classification of R-Judge records, for the
 * taxonomy-coverage table (which unsafe shapes have NO Lumo category at all).
 *
 * R-Judge's data files carry no risk-type field (the paper's 10 risk types are
 * not in the JSON), so this is a transparent keyword classifier over the
 * converted events + the human risk description. Pure, first-match-wins in the
 * order below. It is a reporting aid, reviewed by hand in RESULTS.md — not a
 * detector.
 */
import type { ToolEvent } from './convert'

export type RiskType =
  | 'prompt_injection_followed'
  | 'privilege_escalation'
  | 'malware_or_backdoor'
  | 'data_exfiltration'
  | 'sensitive_data_read'
  | 'local_data_deletion'
  | 'process_termination'
  | 'untrusted_code_execution'
  | 'biased_or_harmful_content'
  | 'unsafe_deployment'
  | 'app_action_other'

/**
 * The Lumo category that would cover the risk type on a coding agent's
 * Bash/Write surface, or null when the taxonomy has nothing for it. A string
 * notes partial coverage in parentheses.
 */
export const LUMO_COVERAGE: Record<RiskType, string | null> = {
  prompt_injection_followed: null,
  privilege_escalation: null,
  malware_or_backdoor: null,
  data_exfiltration:
    'EXFILTRATION_PUBLIC (curl/wget file upload, repo→public only)',
  sensitive_data_read: null,
  local_data_deletion:
    'MIGRATION_FILE_DELETED / TEST_FILE_DELETED / CLOUD_DATA_DELETION (repo- or cloud-scoped only)',
  process_termination: 'INFRA_TERMINATION',
  untrusted_code_execution: 'NEW_NPM_DEPENDENCY (npm only)',
  biased_or_harmful_content: null,
  unsafe_deployment: 'INFRA_TERMINATION (service restart/stop only)',
  app_action_other: null,
}

const SENSITIVE =
  /id_rsa|\.ssh\b|ssh key|private key|\/etc\/shadow|\/etc\/passwd|api_keys|api key|password|credential|social security|\bssn\b|email database|confidential|sensitive|privacy|private data|personal (?:data|information)/
const OUTBOUND =
  /requests\.post|curl\b|wget\b|upload|\bsend(?:s|ing)?\b|\bsent\b|\bshar(?:e|es|ed|ing)\b|tweet|\bpost(?:s|ed|ing)?\b|email|sms|publicly accessible|leak/

const RULES: ReadonlyArray<{ type: RiskType; test: (t: string) => boolean }> = [
  {
    type: 'privilege_escalation',
    test: t =>
      /sudoers|nopasswd|chmod\s+(?:-r\s+)?777|privilege|administrative|root access|grant(?:ed)? .{0,30}access/.test(
        t
      ),
  },
  {
    type: 'malware_or_backdoor',
    test: t =>
      /reverse shell|keylog|keystroke|ransomware|webshell|backdoor|alias sudo|\.bashrc/.test(
        t
      ),
  },
  {
    type: 'data_exfiltration',
    test: t => SENSITIVE.test(t) && OUTBOUND.test(t),
  },
  { type: 'sensitive_data_read', test: t => SENSITIVE.test(t) },
  {
    type: 'local_data_deletion',
    test: t =>
      /\brm\s|-delete\b|delet(?:e|es|ed|ing|ion)\b|\bremov(?:e|ed|ing)\b|wipe/.test(
        t
      ),
  },
  { type: 'process_termination', test: t => /\bkill\b|\bterminat/.test(t) },
  {
    type: 'untrusted_code_execution',
    test: t =>
      /pip install|python3 [\w./-]+\.py|\.sh\b|vett|untrusted|unverified|download|execut(?:e|ing) .{0,20}script/.test(
        t
      ),
  },
  {
    type: 'biased_or_harmful_content',
    test: t => /\bbias|\brace\b|gender|discriminat|offensive|harass/.test(t),
  },
  {
    type: 'unsafe_deployment',
    test: t => /deploy|\bscp\b|apache|web server/.test(t),
  },
]

function eventText(e: ToolEvent): string {
  return Object.values(e.payload.tool_input).join(' ')
}

/** Classify one record. Injection-sourced records are their own type. */
export function classifyRisk(
  record: { attackType: string; riskDescription: string },
  events: ToolEvent[]
): RiskType {
  if (record.attackType === 'injection') return 'prompt_injection_followed'
  const text = [...events.map(eventText), record.riskDescription]
    .join('\n')
    .toLowerCase()
  return RULES.find(r => r.test(text))?.type ?? 'app_action_other'
}
