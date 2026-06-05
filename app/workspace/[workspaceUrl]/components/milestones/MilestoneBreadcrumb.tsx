'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface MilestoneBreadcrumbProps {
  /** Link to the workspace's projects list (top-level anchor). */
  projectsHref: string
  /** Link to the milestone's parent project detail page. */
  projectHref: string
  /** Display name of the parent project. */
  projectName: string
  /** Current milestone name (rendered as the active page). */
  milestoneName: string
}

/**
 * Breadcrumb for the milestone detail page: `Projects > {project} > {milestone}`.
 *
 * Mirrors the `list > current` shape of the project and sprint detail pages by
 * leading with the shared "Projects" anchor, then the (clickable) parent
 * project, then the milestone as the current page. Pure presentational — it
 * takes flat values, owns no data fetching or state.
 */
export function MilestoneBreadcrumb({
  projectsHref,
  projectHref,
  projectName,
  milestoneName,
}: MilestoneBreadcrumbProps) {
  const intl = useIntl()
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={projectsHref}>
              {intl.formatMessage({ id: 'sidebar.projects' })}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={projectHref}>{projectName}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{milestoneName}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
