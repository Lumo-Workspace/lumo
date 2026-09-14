'use client'

import { useIntl } from 'react-intl'
import type {
  PerPrGateAudit,
  DeliveryGateAudit,
  GateRecord,
  GateStatus,
} from '@/lib/services/gate-audit'
import type { GateKey } from '../../../../shared/src/gate-map'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  gateDescLabel,
  gateStatusLabel,
  gateProvenanceLabel,
} from './DeliveryGatesPanel'

type Intl = ReturnType<typeof useIntl>

/** Tailwind text color per status — failed is the only loud one (decision-relevant). */
const STATUS_TONE: Record<GateStatus, string> = {
  passed: 'text-success',
  failed: 'text-destructive',
  not_run: 'text-muted-foreground',
  not_configured: 'text-muted-foreground',
}

/** The gate keys to render as columns — taken from any available audit (every
 *  audit carries the same keys in the same order). */
function columnKeys(perPr: PerPrGateAudit): GateKey[] {
  const sample = perPr.prs[0]?.audit ?? perPr.unlinked
  return sample ? sample.gates.map(g => g.key) : []
}

function gateByKey(
  audit: DeliveryGateAudit,
  key: GateKey
): GateRecord | undefined {
  return audit.gates.find(g => g.key === key)
}

/** One gate cell — status (toned) with the provenance marker underneath. */
function GateCell({
  gate,
  intl,
}: {
  gate: GateRecord | undefined
  intl: Intl
}) {
  if (!gate) return <td className='px-2 py-2 align-top' />
  return (
    <td
      data-testid={`cell-${gate.key}`}
      data-status={gate.status}
      data-provenance={gate.provenance}
      className='px-2 py-2 align-top'
    >
      <span className={`block text-caption ${STATUS_TONE[gate.status]}`}>
        {gateStatusLabel(gate.status, intl)}
      </span>
      {(gate.status === 'passed' || gate.status === 'failed') && (
        <span className='block text-caption text-muted-foreground'>
          {gateProvenanceLabel(gate.provenance, intl)}
        </span>
      )}
    </td>
  )
}

function StatePill({ state }: { state: string }) {
  return (
    <span className='rounded-sm bg-muted px-1.5 text-caption text-muted-foreground'>
      {state}
    </span>
  )
}

/**
 * Audit-only mechanical-gates panel, grouped by PR (LUM-617). Each pull request
 * is one row; the execution gates (typecheck/build/test) are columns. A signal
 * that resolves to no PR shows in the explicit "unlinked" bucket below the table
 * — never dropped, never folded into a PR. Same audit-only framing and four-state
 * vocabulary as the flat panel: a gate with no signal reads "not run", never green.
 */
export function DeliveryGatesByPrPanel({ perPr }: { perPr: PerPrGateAudit }) {
  const intl = useIntl()
  const keys = columnKeys(perPr)

  return (
    <div data-testid='gate-audit-by-pr-panel' className='mt-4'>
      <table className='w-full table-fixed'>
        <thead>
          <tr className='border-b border-border text-left'>
            <th className='w-2/5 px-2 py-1 text-caption font-normal text-muted-foreground'>
              {intl.formatMessage({
                id: 'gates.prColumn',
                defaultMessage: 'Pull request',
              })}
            </th>
            {keys.map(key => (
              <th
                key={key}
                data-testid={`gate-col-${key}`}
                className='px-2 py-1 text-caption font-normal text-muted-foreground'
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className='cursor-help font-mono underline decoration-dotted underline-offset-2'>
                      {key}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{gateDescLabel(key, intl)}</TooltipContent>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {perPr.prs.map(({ pr, audit }) => (
            <tr
              key={pr.number}
              data-testid={`pr-gate-row-${pr.number}`}
              data-pr={pr.number}
              className='border-b border-border'
            >
              <td className='px-2 py-2 align-top'>
                <span className='flex items-center gap-2'>
                  <span className='text-caption font-medium'>#{pr.number}</span>
                  <StatePill state={pr.state} />
                </span>
                <span className='block truncate text-caption text-muted-foreground'>
                  {pr.title}
                </span>
              </td>
              {keys.map(key => (
                <GateCell key={key} gate={gateByKey(audit, key)} intl={intl} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {perPr.unlinked && (
        <div
          data-testid='gate-unlinked-bucket'
          className='mt-2 border-t border-border pt-2'
        >
          <p className='mb-1 text-caption text-muted-foreground'>
            {intl.formatMessage({
              id: 'gates.unlinked',
              defaultMessage: 'Signals not linked to a PR',
            })}
          </p>
          <table className='w-full table-fixed'>
            <tbody>
              <tr>
                <td className='w-2/5 px-2 py-2' />
                {keys.map(key => (
                  <GateCell
                    key={key}
                    gate={gateByKey(perPr.unlinked!, key)}
                    intl={intl}
                  />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
