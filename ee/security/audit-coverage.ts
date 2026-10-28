/**
 * LUM-1065 — the security plugin's part of the LUM-907 audit-log coverage
 * registry (lib/audit/coverage.ts holds the core's). Same buckets, same
 * rules: every sensitive mutation is audited, every OWNER-gated unit of the
 * plugin is instrumented or exempt with a reason.
 * __tests__/ee/security/audit/coverage-guard.test.ts holds the plugin to it.
 */
import type { AuditAction } from '@/lib/audit/actions'
import type { AuditUnit } from '@/lib/audit/coverage'

/** Units that write audit events, with the actions each must write. */
export const SECURITY_AUDIT_INSTRUMENTED: Readonly<
  Record<AuditUnit, readonly AuditAction[]>
> = {
  // Human rulings on security findings (LUM-732 / LUM-740).
  'ee/security/services/pr-security-scan.service.ts#disposition': [
    'security_finding.dispositioned',
  ],
  'ee/security/services/pr-security-scan.service.ts#dispositionSuggested': [
    'security_finding.suggestions_confirmed',
  ],
  // LUM-1133: per-repository automatic PR review (OWNER).
  'ee/security/services/repo-review-settings.service.ts#update': [
    'repository.review_settings_updated',
  ],
  // LUM-1329: the agent-review level, a compare-and-set on securityPolicy
  // after update's OWNER check.
  'ee/security/services/security-scan-settings.service.ts#writeAgentReviewBlocking':
    ['workspace.agent_review_blocking_updated'],
}

/** OWNER-gated plugin units that are not sensitive mutations, with the reason. */
export const SECURITY_AUDIT_EXEMPT: Readonly<Record<AuditUnit, string>> = {
  // LUM-1002: `get` only reports whether the caller is an OWNER (`canEdit`);
  // the write goes through workspaceService.updateWorkspace, which is audited.
  'ee/security/services/security-scan-settings.service.ts#get': 'read-only',
  // LUM-1329: `update` checks OWNER itself before the agent-review write;
  // it writes only through audited units — writeAgentReviewBlocking above
  // and workspaceService.updateWorkspace.
  'ee/security/services/security-scan-settings.service.ts#update':
    'writes only through audited units (writeAgentReviewBlocking, updateWorkspace)',
  // LUM-1133: `list` only reports whether the caller is an OWNER (`canEdit`).
  'ee/security/services/repo-review-settings.service.ts#list': 'read-only',
}
