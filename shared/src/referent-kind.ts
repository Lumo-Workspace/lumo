/**
 * referentKind (LUM-602): what a milestone exit criterion anchors.
 * Dependency-light (no @prisma/client); the Prisma `ReferentKind` enum mirrors
 * REFERENT_KIND_DECLARABLE exactly.
 */
export const REFERENT_KIND_DECLARABLE = [
  'EXTERNAL_FACT',
  'AGENT_CONSTRUCTED_STATE',
  'PENDING_OUTCOME',
] as const
export type DeclarableReferentKind = (typeof REFERENT_KIND_DECLARABLE)[number]
