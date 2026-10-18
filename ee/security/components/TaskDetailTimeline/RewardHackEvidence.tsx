'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useRewardHackEvidence } from '@/ee/security/hooks/useRewardHackEvidence'

/** `/sessions/<id>#<eventId>` — the step on its session page. */
function sessionHref(sessionId: string, eventId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}#${encodeURIComponent(eventId)}`
}

function Block({
  label,
  testId,
  children,
}: {
  label: string
  testId: string
  children: ReactNode
}) {
  return (
    <div data-testid={testId} className='mt-2 min-w-0'>
      <span className='block text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * LUM-1234 — the evidence of a REWARD_HACK finding, shown when the row is
 * opened: the task requirement, the user prompts that opened the cited
 * turns, and the agent's cited steps, each linked to its session page. A
 * session the viewer may not open is left out and named in one line. Long
 * text wraps (never a horizontal scroll); order comes from type, not color.
 * Rendering only — the data and every access rule come from the server.
 */
export function RewardHackEvidence({
  taskId,
  findingId,
}: {
  taskId: string
  findingId: string
}) {
  const intl = useIntl()
  const { data, isLoading, isError } = useRewardHackEvidence(taskId, findingId)
  const t = (id: string) => intl.formatMessage({ id })

  if (isLoading) {
    return (
      <p className='mt-1.5 text-caption text-muted-foreground'>
        {t('securityScan.rewardHack.loading')}
      </p>
    )
  }
  if (isError || !data) {
    return (
      <p
        data-testid='reward-hack-evidence-error'
        className='mt-1.5 text-caption text-muted-foreground'
      >
        {t('securityScan.rewardHack.error')}
      </p>
    )
  }

  const openLink = (sessionId: string, eventId: string) => (
    <a
      href={sessionHref(sessionId, eventId)}
      className='text-muted-foreground underline underline-offset-2 hover:text-foreground'
    >
      {t('securityScan.rewardHack.openInSession')}
    </a>
  )
  const empty =
    data.steps.length === 0 && data.prompts.length === 0 && !data.restricted

  return (
    <div
      data-testid='reward-hack-evidence'
      className='mt-1.5 min-w-0 break-words text-caption'
    >
      {data.restricted && (
        <p
          data-testid='reward-hack-evidence-restricted'
          className='text-muted-foreground'
        >
          {t('securityScan.rewardHack.restricted')}
        </p>
      )}
      {data.requirementExcerpt !== '' && (
        <Block
          label={t('securityScan.rewardHack.requirement')}
          testId='reward-hack-evidence-requirement'
        >
          <p className='whitespace-pre-wrap text-foreground/80'>
            {data.requirementExcerpt}
          </p>
        </Block>
      )}
      {data.prompts.length > 0 && (
        <Block
          label={t('securityScan.rewardHack.prompts')}
          testId='reward-hack-evidence-prompts'
        >
          <ul className='space-y-1'>
            {data.prompts.map(prompt => (
              <li key={prompt.eventId} className='min-w-0'>
                <p className='whitespace-pre-wrap text-foreground/80'>
                  {prompt.text}
                </p>
                {openLink(prompt.sessionId, prompt.eventId)}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {data.steps.length > 0 && (
        <Block
          label={t('securityScan.rewardHack.steps')}
          testId='reward-hack-evidence-steps'
        >
          <ol className='space-y-1.5'>
            {data.steps.map(step => (
              <li key={step.eventId} className='min-w-0'>
                <span className='block font-mono text-foreground'>
                  {step.kind === 'stop'
                    ? t('securityScan.rewardHack.finalMessage')
                    : step.label}
                </span>
                {step.detail !== '' && (
                  <p
                    className={`whitespace-pre-wrap text-foreground/80${
                      step.kind === 'tool' ? ' font-mono' : ''
                    }`}
                  >
                    {step.detail}
                  </p>
                )}
                {openLink(step.sessionId, step.eventId)}
              </li>
            ))}
          </ol>
        </Block>
      )}
      {empty && (
        <p
          data-testid='reward-hack-evidence-empty'
          className='mt-1 text-muted-foreground'
        >
          {t('securityScan.rewardHack.empty')}
        </p>
      )}
    </div>
  )
}
