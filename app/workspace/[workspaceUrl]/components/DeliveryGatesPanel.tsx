'use client'

import { useIntl } from 'react-intl'
import type {
  DeliveryGateAudit,
  GateRecord,
  GateStatus,
} from '@/lib/services/gate-audit'
import type { GateKey, GateProvenance } from '../../../../shared/src/gate-map'
import { parseEvidencePointer } from '../../../../shared/src/acceptance-evidence'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** Max command chars shown inline — the full command lives in the pointer. */
const GROUNDING_CMD_MAX = 56

/**
 * Compact, display-safe rendering of a `cmd:<command>#exit=<code>` grounding
 * pointer: `<command> · exit <code>`, with the command truncated so a long
 * agent command (e.g. a multi-line `lumo task create`) can never blow out the
 * row. Falls back to the raw pointer for any non-cmd shape.
 */
function groundingDisplay(pointer: string): string {
  const parsed = parseEvidencePointer(pointer)
  if (!parsed || parsed.kind !== 'cmd') return pointer
  const cmd =
    parsed.command.length > GROUNDING_CMD_MAX
      ? `${parsed.command.slice(0, GROUNDING_CMD_MAX - 1)}…`
      : parsed.command
  return `${cmd} · exit ${parsed.exitCode}`
}

type Intl = ReturnType<typeof useIntl>

/**
 * One-line "what this gate checks" hint per gate, surfaced as a hover tooltip on
 * the gate name so the terse keys (`typecheck`, `build`, `test`) are legible
 * without prior knowledge. Maps to the engineer-gate taxonomy.
 */
const GATE_DESC: Record<GateKey, { id: string; default: string }> = {
  typecheck: {
    id: 'gates.desc.typecheck',
    default: 'Types are self-consistent (tsc)',
  },
  build: {
    id: 'gates.desc.build',
    default: 'The project builds — an artifact is produced',
  },
  test: {
    id: 'gates.desc.test',
    default:
      'The test suite runs without errors (not whether assertions are right)',
  },
}

/** The hover-hint description for a gate. */
export function gateDescLabel(key: GateKey, intl: Intl): string {
  const d = GATE_DESC[key]
  return intl.formatMessage({ id: d.id, defaultMessage: d.default })
}

/**
 * Status label — explicit switch with literal message ids (greppable, matches
 * boundary-format.ts). The four states stay lexically distinct so a not_run /
 * not_configured gate never reads as a pass.
 */
export function gateStatusLabel(status: GateStatus, intl: Intl): string {
  switch (status) {
    case 'passed':
      return intl.formatMessage({
        id: 'gates.status.passed',
        defaultMessage: 'passed',
      })
    case 'failed':
      return intl.formatMessage({
        id: 'gates.status.failed',
        defaultMessage: 'failed',
      })
    case 'not_run':
      return intl.formatMessage({
        id: 'gates.status.not_run',
        defaultMessage: 'not run',
      })
    case 'not_configured':
      return intl.formatMessage({
        id: 'gates.status.not_configured',
        defaultMessage: 'not configured',
      })
  }
}

export function gateProvenanceLabel(
  provenance: GateProvenance,
  intl: Intl
): string {
  return provenance === 'independent_harness'
    ? intl.formatMessage({
        id: 'gates.provenance.independent_harness',
        defaultMessage: 'independent harness',
      })
    : intl.formatMessage({
        id: 'gates.provenance.agent_self_reported',
        defaultMessage: 'agent self-reported',
      })
}

/** Tailwind text color per status — failed is the only loud one (decision-relevant). */
const STATUS_TONE: Record<GateStatus, string> = {
  passed: 'text-success',
  failed: 'text-destructive',
  not_run: 'text-muted-foreground',
  not_configured: 'text-muted-foreground',
}

function summarize(gates: GateRecord[]) {
  const count = (s: GateStatus) => gates.filter(g => g.status === s).length
  return {
    total: gates.length,
    passed: count('passed'),
    failed: count('failed'),
    notRun: count('not_run'),
    notConfigured: count('not_configured'),
  }
}

function GateRow({ gate, intl }: { gate: GateRecord; intl: Intl }) {
  return (
    <li
      data-gate-key={gate.key}
      data-status={gate.status}
      data-provenance={gate.provenance}
      className='flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5'
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='w-28 shrink-0 cursor-help font-mono text-caption underline decoration-dotted underline-offset-2'>
            {gate.key}
          </span>
        </TooltipTrigger>
        <TooltipContent>{gateDescLabel(gate.key, intl)}</TooltipContent>
      </Tooltip>
      <span className={`text-caption ${STATUS_TONE[gate.status]}`}>
        {gateStatusLabel(gate.status, intl)}
      </span>
      <span className='rounded-sm bg-muted px-1.5 text-caption text-muted-foreground'>
        {gateProvenanceLabel(gate.provenance, intl)}
      </span>
      {gate.grounding && (
        <span
          title={gate.grounding.pointer}
          className='truncate font-mono text-caption text-muted-foreground'
        >
          {groundingDisplay(gate.grounding.pointer)}
        </span>
      )}
    </li>
  )
}

/**
 * Audit-only mechanical-gates panel for the delivery card (LUM-614). Renders
 * the per-delivery gate read-model as a read-out for human judgment — it never
 * renders a verdict. Provenance is shown per row so a self-reported gate is
 * never mistaken for an
 * independent pass; not_run / not_configured read as "no signal", never green.
 */
export function DeliveryGatesPanel({ audit }: { audit: DeliveryGateAudit }) {
  const intl = useIntl()
  const s = summarize(audit.gates)

  return (
    <div
      data-testid='gate-audit-panel'
      className='mt-4 border-t border-border pt-3'
    >
      <p className='mb-1 text-caption text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'gates.summary',
            defaultMessage:
              '{total} gates · {passed} passed · {failed} failed · {notRun} not run · {notConfigured} not configured',
          },
          s
        )}
      </p>

      <ul>
        {audit.gates.map(gate => (
          <GateRow key={gate.key} gate={gate} intl={intl} />
        ))}
      </ul>
    </div>
  )
}
