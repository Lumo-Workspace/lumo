import type { useIntl } from 'react-intl'

/**
 * Human-readable label for a BoundaryCrossingCategory (LUM-426). Shared by the
 * Record tab panel and the timeline marker so the two never drift. The
 * category is bare structured data crossing the wire; only the prose around it
 * is translated.
 */
export function boundaryCategoryLabel(
  category: string,
  intl: ReturnType<typeof useIntl>
): string {
  switch (category) {
    case 'PUSH_TO_PROTECTED_BRANCH':
      return intl.formatMessage({
        id: 'boundary.category.push',
        defaultMessage: 'push to a protected branch',
      })
    case 'MIGRATION_FILE_DELETED':
      return intl.formatMessage({
        id: 'boundary.category.migrationDelete',
        defaultMessage: 'deleted a migration file',
      })
    case 'HARDCODED_SECRET':
      return intl.formatMessage({
        id: 'boundary.category.secret',
        defaultMessage: 'hardcoded secret',
      })
    case 'NEW_NPM_DEPENDENCY':
      return intl.formatMessage({
        id: 'boundary.category.npm',
        defaultMessage: 'new dependency install',
      })
    case 'DESTRUCTIVE_DB_COMMAND':
      return intl.formatMessage({
        id: 'boundary.category.db',
        defaultMessage: 'destructive database command',
      })
    case 'TEST_TAMPERING':
      return intl.formatMessage({
        id: 'boundary.category.testTampering',
        defaultMessage: 'edited a test a check depends on',
      })
    case 'EXFILTRATION_PUBLIC':
      return intl.formatMessage({
        id: 'boundary.category.exfiltration',
        defaultMessage: 'data exfiltration to the public internet',
      })
    case 'CLOUD_DATA_DELETION':
      return intl.formatMessage({
        id: 'boundary.category.cloudDelete',
        defaultMessage: 'deleted cloud-storage data',
      })
    case 'INFRA_TERMINATION':
      return intl.formatMessage({
        id: 'boundary.category.infra',
        defaultMessage: 'terminated or restarted infrastructure',
      })
    case 'SESSION_BINDING_MISSING':
      return intl.formatMessage({
        id: 'boundary.category.sessionBindingMissing',
        defaultMessage: 'task work from an unattached session',
      })
    case 'CONTRACT_WEAKENING':
      return intl.formatMessage({
        id: 'boundary.category.contractWeakening',
        defaultMessage: 'weakened a failing acceptance criterion',
      })
    case 'SPINOFF_LAUNDERED':
      return intl.formatMessage({
        id: 'boundary.category.spinoffLaundered',
        defaultMessage: 'laundered rework into a new task',
      })
    case 'SILENT_FIX':
      return intl.formatMessage({
        id: 'boundary.category.silentFix',
        defaultMessage: 'silently fixed submitted work (no send-back)',
      })
    case 'PROJECT_RULE_VIOLATION':
      return intl.formatMessage({
        id: 'boundary.category.PROJECT_RULE_VIOLATION',
        defaultMessage: 'violated a project rule from CLAUDE.md',
      })
    case 'POLICY_WEAKENING':
      return intl.formatMessage({
        id: 'boundary.category.POLICY_WEAKENING',
        defaultMessage: 'weakened a blocking policy rule',
      })
    case 'STEWARD_IMPLEMENTATION_ARTIFACT':
      return intl.formatMessage({
        id: 'boundary.category.STEWARD_IMPLEMENTATION_ARTIFACT',
        defaultMessage: 'implementation artifact from a steward session',
      })
    // LUM-736 L4 Session Guard
    case 'SENSITIVE_PATH_EDIT':
      return intl.formatMessage({
        id: 'boundary.category.SENSITIVE_PATH_EDIT',
        defaultMessage: 'edited a sensitive path',
      })
    case 'HOOK_BYPASS':
      return intl.formatMessage({
        id: 'boundary.category.HOOK_BYPASS',
        defaultMessage: 'bypassed git hooks',
      })
    case 'TEST_FILE_DELETED':
      return intl.formatMessage({
        id: 'boundary.category.TEST_FILE_DELETED',
        defaultMessage: 'deleted a test file',
      })
    // LUM-962
    case 'UNTRUSTED_CODE_EXECUTION':
      return intl.formatMessage({
        id: 'boundary.category.UNTRUSTED_CODE_EXECUTION',
        defaultMessage: 'ran code from an unvetted source',
      })
    // LUM-793 memory-poison write gate
    case 'USED_TRAP_MEMORY_DELETED':
      return intl.formatMessage({
        id: 'boundary.category.USED_TRAP_MEMORY_DELETED',
        defaultMessage: 'deleted a proven-useful trap memory',
      })
    // LUM-963 (advisory — never blocks DONE)
    case 'SENSITIVE_PATH_READ':
      return intl.formatMessage({
        id: 'boundary.category.SENSITIVE_PATH_READ',
        defaultMessage: 'read a sensitive path',
      })
    default:
      return category.toLowerCase().replace(/_/g, ' ')
  }
}

/** Label for a severity tier (LUM-442). */
export function boundarySeverityLabel(
  severity: string,
  intl: ReturnType<typeof useIntl>
): string {
  switch (severity) {
    case 'HIGH':
      return intl.formatMessage({
        id: 'boundary.severity.high',
        defaultMessage: 'high',
      })
    case 'LOW':
      return intl.formatMessage({
        id: 'boundary.severity.low',
        defaultMessage: 'low',
      })
    default:
      return intl.formatMessage({
        id: 'boundary.severity.medium',
        defaultMessage: 'medium',
      })
  }
}

/** Every disposition the read model can surface (LUM-435; AUTO_LEGIT LUM-478;
 *  AUTO_SUPPRESSED LUM-751). */
export type BoundaryDispositionValue =
  | 'FALSE_POSITIVE'
  | 'CONFIRMED'
  | 'AUTO_LEGIT'
  | 'AUTO_SUPPRESSED'

/** Label for a disposition (LUM-435; AUTO_LEGIT added LUM-478; AUTO_SUPPRESSED LUM-751). */
export function boundaryDispositionLabel(
  disposition: BoundaryDispositionValue,
  intl: ReturnType<typeof useIntl>
): string {
  if (disposition === 'FALSE_POSITIVE')
    return intl.formatMessage({
      id: 'boundary.disposition.falsePositive',
      defaultMessage: 'false positive',
    })
  if (disposition === 'AUTO_LEGIT')
    return intl.formatMessage({
      id: 'boundary.disposition.autoLegit',
      defaultMessage: 'auto-resolved (legit)',
    })
  if (disposition === 'AUTO_SUPPRESSED')
    return intl.formatMessage({
      id: 'boundary.disposition.autoSuppressed',
      defaultMessage: 'auto-dispositioned by rule',
    })
  return intl.formatMessage({
    id: 'boundary.disposition.confirmed',
    defaultMessage: 'confirmed',
  })
}

/**
 * Label for a disposition-or-OPEN (LUM-450) — like boundaryDispositionLabel but
 * a null (reverted to undispositioned) reads as "open". Used by the re-
 * disposition "corrected from -> to" line and the timeline change marker.
 */
export function boundaryDispositionOrOpenLabel(
  disposition: BoundaryDispositionValue | null,
  intl: ReturnType<typeof useIntl>
): string {
  return disposition === null
    ? intl.formatMessage({
        id: 'boundary.disposition.open',
        defaultMessage: 'open',
      })
    : boundaryDispositionLabel(disposition, intl)
}

/** Label for taxonomy-driven reversibility (LUM-435). */
export function boundaryReversibilityLabel(
  reversible: boolean,
  intl: ReturnType<typeof useIntl>
): string {
  return reversible
    ? intl.formatMessage({
        id: 'boundary.reversible',
        defaultMessage: 'reversible',
      })
    : intl.formatMessage({
        id: 'boundary.irreversible',
        defaultMessage: 'irreversible',
      })
}
