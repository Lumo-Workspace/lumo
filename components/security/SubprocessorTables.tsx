'use client'

import { useIntl } from 'react-intl'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AI_HOST_SUBPROCESSORS,
  CUSTOMER_INTEGRATIONS,
  INFRASTRUCTURE_SUBPROCESSORS,
  type DataLocation,
} from '@/lib/legal/subprocessors'

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className='mt-8 mb-2 text-base font-semibold'>{children}</h3>
}

/** Renders the subprocessor registry (lib/legal/subprocessors.ts) as tables. */
export function SubprocessorTables() {
  const intl = useIntl()
  const t = (id: string) => intl.formatMessage({ id })
  const location = (loc: DataLocation, region?: string) => {
    const label = t(`security.subprocessors.location.${loc}`)
    return region ? `${label} (${region})` : label
  }

  return (
    <div data-testid='subprocessor-tables'>
      <SubHeading>{t('security.subprocessors.infra.heading')}</SubHeading>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('security.subprocessors.col.service')}</TableHead>
            <TableHead>
              {t('security.subprocessors.col.subprocessor')}
            </TableHead>
            <TableHead>{t('security.subprocessors.col.purpose')}</TableHead>
            <TableHead>{t('security.subprocessors.col.location')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {INFRASTRUCTURE_SUBPROCESSORS.map(s => (
            <TableRow key={s.id}>
              <TableCell className='font-medium'>{s.product}</TableCell>
              <TableCell>{s.entity}</TableCell>
              <TableCell>
                {t(`security.subprocessors.purpose.${s.id}`)}
              </TableCell>
              <TableCell>{location(s.location, s.region)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <SubHeading>{t('security.subprocessors.ai.heading')}</SubHeading>
      <p className='mb-2 text-sm text-muted-foreground'>
        {t('security.subprocessors.ai.intro')}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {t('security.subprocessors.col.subprocessor')}
            </TableHead>
            <TableHead>{t('security.subprocessors.col.location')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {AI_HOST_SUBPROCESSORS.map(h => (
            <TableRow key={h.gatewaySlug}>
              <TableCell className='font-medium'>{h.entity}</TableCell>
              <TableCell>{location(h.location)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <SubHeading>
        {t('security.subprocessors.integrations.heading')}
      </SubHeading>
      <p className='mb-2 text-sm text-muted-foreground'>
        {t('security.subprocessors.integrations.intro')}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('security.subprocessors.col.service')}</TableHead>
            <TableHead>{t('security.subprocessors.col.provider')}</TableHead>
            <TableHead>{t('security.subprocessors.col.access')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CUSTOMER_INTEGRATIONS.map(i => (
            <TableRow key={i.id}>
              <TableCell className='font-medium'>{i.product}</TableCell>
              <TableCell>{i.provider}</TableCell>
              <TableCell>
                {t(`security.subprocessors.access.${i.id}`)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
