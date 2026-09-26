'use client'

import { useIntl } from 'react-intl'
import type {
  CheckAudit,
  CiCheck,
  CiCheckStatus,
  PerPrGateAudit,
  PrRef,
  SelfReportedCheck,
} from '@/lib/services/gate-audit'

type Intl = ReturnType<typeof useIntl>

/** Max command chars shown inline — the full command is in the hover title. */
const COMMAND_MAX = 72

/** Tailwind text color per status — failed is the only loud one (decision-relevant). */
const STATUS_TONE: Record<CiCheckStatus, string> = {
  passed: 'text-success',
  failed: 'text-destructive',
  did_not_run: 'text-muted-foreground',
}

/**
 * Status label — explicit switch with literal message ids (greppable). "did not
 * run" stays lexically apart from "failed": a check that never started is not a
 * failure (LUM-838).
 */
function statusLabel(status: CiCheckStatus, intl: Intl): string {
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
    case 'did_not_run':
      return intl.formatMessage({
        id: 'gates.status.did_not_run',
        defaultMessage: 'did not run',
      })
  }
}

function truncate(command: string): string {
  return command.length > COMMAND_MAX
    ? `${command.slice(0, COMMAND_MAX - 1)}…`
    : command
}

function SectionTitle({ children }: { children: string }) {
  return (
    <p className='mb-0.5 text-caption font-medium text-muted-foreground'>
      {children}
    </p>
  )
}

function EmptyLine({ testId, children }: { testId: string; children: string }) {
  return (
    <p data-testid={testId} className='py-1 text-caption text-muted-foreground'>
      {children}
    </p>
  )
}

function CiCheckRow({ check, intl }: { check: CiCheck; intl: Intl }) {
  return (
    <li
      data-testid='ci-check'
      data-name={check.name}
      data-status={check.status}
      className='flex flex-wrap items-baseline gap-x-3 py-0.5'
    >
      <span className='min-w-0 truncate text-caption'>{check.name}</span>
      <span className={`text-caption ${STATUS_TONE[check.status]}`}>
        {statusLabel(check.status, intl)}
      </span>
      {check.detailsUrl && (
        <a
          href={check.detailsUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground'
        >
          {intl.formatMessage({
            id: 'gates.ci.details',
            defaultMessage: 'details',
          })}
        </a>
      )}
    </li>
  )
}

/**
 * The independent CI list, by each check's own name. An empty list is stated
 * in words ("no CI checks on this commit") — never left blank, never green.
 */
function CiChecks({ audit, intl }: { audit: CheckAudit; intl: Intl }) {
  return (
    <div data-testid='ci-checks'>
      <SectionTitle>
        {intl.formatMessage({
          id: 'gates.ci.title',
          defaultMessage: 'CI checks (independent)',
        })}
      </SectionTitle>
      {audit.ci.length === 0 ? (
        <EmptyLine testId='ci-checks-none'>
          {audit.headSha
            ? intl.formatMessage(
                {
                  id: 'gates.ci.none',
                  defaultMessage: 'No CI checks reported for commit {sha}',
                },
                { sha: audit.headSha.slice(0, 7) }
              )
            : intl.formatMessage({
                id: 'gates.ci.noneNoCommit',
                defaultMessage: 'No CI checks reported',
              })}
        </EmptyLine>
      ) : (
        <ul>
          {audit.ci.map(check => (
            <CiCheckRow key={check.name} check={check} intl={intl} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SelfReportedRow({
  check,
  intl,
}: {
  check: SelfReportedCheck
  intl: Intl
}) {
  return (
    <li
      data-testid='self-reported-check'
      data-status={check.status}
      className='flex flex-wrap items-baseline gap-x-3 py-0.5'
    >
      <span
        title={check.command}
        className='min-w-0 truncate font-mono text-caption'
      >
        {truncate(check.command)}
      </span>
      <span className={`text-caption ${STATUS_TONE[check.status]}`}>
        {statusLabel(check.status, intl)}
      </span>
      <span className='text-caption text-muted-foreground'>
        {intl.formatMessage(
          { id: 'gates.self.exit', defaultMessage: 'exit {code}' },
          { code: check.exitCode }
        )}
      </span>
    </li>
  )
}

/** The agent's own check commands — labelled as self-report, never as CI. */
function SelfReported({ audit, intl }: { audit: CheckAudit; intl: Intl }) {
  return (
    <div data-testid='self-reported-checks' className='mt-2'>
      <SectionTitle>
        {intl.formatMessage({
          id: 'gates.self.title',
          defaultMessage: 'Agent self-reported',
        })}
      </SectionTitle>
      {audit.selfReported.length === 0 ? (
        <EmptyLine testId='self-reported-none'>
          {intl.formatMessage({
            id: 'gates.self.none',
            defaultMessage: 'No check commands recorded from the agent',
          })}
        </EmptyLine>
      ) : (
        <ul>
          {audit.selfReported.map(check => (
            <SelfReportedRow key={check.command} check={check} intl={intl} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PrHeader({ pr }: { pr: PrRef }) {
  return (
    <div className='mb-1 flex min-w-0 items-center gap-2'>
      <span className='text-caption font-medium'>#{pr.number}</span>
      <span className='rounded-sm bg-muted px-1.5 text-caption text-muted-foreground'>
        {pr.state}
      </span>
      <span className='min-w-0 truncate text-caption text-muted-foreground'>
        {pr.title}
      </span>
    </div>
  )
}

/**
 * Audit-only delivery checks panel, grouped by PR (LUM-617 / LUM-839). Each PR
 * shows the CI checks on its head commit by their own names (independent), and
 * separately the check commands the agent ran (self-reported). The two are
 * never merged. Anything that resolves to no PR shows in an explicit "unlinked"
 * block — never dropped, never folded into a PR.
 */
export function DeliveryGatesByPrPanel({ perPr }: { perPr: PerPrGateAudit }) {
  const intl = useIntl()

  return (
    <div data-testid='gate-audit-by-pr-panel' className='mt-4'>
      {perPr.prs.map(({ pr, audit }) => (
        <section
          key={pr.number}
          data-testid={`pr-gate-row-${pr.number}`}
          data-pr={pr.number}
          className='border-b border-border py-2'
        >
          <PrHeader pr={pr} />
          <CiChecks audit={audit} intl={intl} />
          <SelfReported audit={audit} intl={intl} />
        </section>
      ))}

      {perPr.unlinked && (
        <section data-testid='gate-unlinked-bucket' className='py-2'>
          <p className='mb-1 text-caption text-muted-foreground'>
            {intl.formatMessage({
              id: 'gates.unlinked',
              defaultMessage: 'Signals not linked to a PR',
            })}
          </p>
          <CiChecks audit={perPr.unlinked} intl={intl} />
          <SelfReported audit={perPr.unlinked} intl={intl} />
        </section>
      )}
    </div>
  )
}
