'use client'

import { useIntl } from 'react-intl'
import { usePolicyCoverage } from '@/ee/security/hooks/usePolicyCoverage'
import type {
  ProjectPolicyCoverage,
  UncheckedRule,
} from '@/ee/security/services/policy-coverage.service'

function RuleRow({ rule }: { rule: UncheckedRule }) {
  const intl = useIntl()
  return (
    <li className='py-2'>
      <p className='text-sm text-foreground break-words'>{rule.text}</p>
      <p className='text-xs text-muted-foreground mt-0.5'>
        {intl.formatMessage({
          id: `workspaceSettings.policyCoverage.reason.${rule.reason}`,
        })}
      </p>
    </li>
  )
}

function ProjectBlock({ project }: { project: ProjectPolicyCoverage }) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, number>) =>
    intl.formatMessage({ id: `workspaceSettings.policyCoverage.${id}` }, values)
  const summary =
    project.compiledAt === null
      ? t('notCompiled')
      : project.unchecked.length === 0
        ? t('allChecked', { total: project.totalRules })
        : t('someUnchecked', {
            unchecked: project.unchecked.length,
            total: project.totalRules,
          })
  return (
    <div className='px-5 py-4 border-b border-border last:border-b-0'>
      <p className='text-sm font-medium text-foreground'>
        {project.projectName}
      </p>
      <p className='text-xs text-muted-foreground mt-0.5'>{summary}</p>
      {project.unchecked.length > 0 && (
        <ul className='mt-2 divide-y divide-border'>
          {project.unchecked.map(rule => (
            <RuleRow key={`${rule.ruleId}:${rule.reason}`} rule={rule} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * LUM-1114 — the CLAUDE.md / AGENTS.md rules no detector checks
 * automatically, per project, so a team does not mistake every written rule
 * for an enforced one. Read-only; any member.
 */
export function PolicyCoverageCard() {
  const intl = useIntl()
  const { data, isLoading, isError } = usePolicyCoverage()
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.policyCoverage.${id}` })

  let body: React.ReactNode
  if (isLoading) {
    body = (
      <p className='px-5 py-4 text-xs text-muted-foreground'>{t('loading')}</p>
    )
  } else if (isError || !data) {
    // Never "all checked" when we could not find out.
    body = (
      <p className='px-5 py-4 text-xs text-muted-foreground'>
        {t('loadFailed')}
      </p>
    )
  } else if (data.projects.length === 0) {
    body = (
      <p className='px-5 py-4 text-xs text-muted-foreground'>
        {t('noProjects')}
      </p>
    )
  } else {
    body = data.projects.map(p => (
      <ProjectBlock key={p.projectId} project={p} />
    ))
  }

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='px-5 py-3 border-b border-border'>
        <p className='text-sm font-semibold text-foreground'>{t('title')}</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {t('description')}
        </p>
      </div>
      {body}
    </div>
  )
}
