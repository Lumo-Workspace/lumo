import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

interface PageBreadcrumbProps {
  /** Shorthand: renders a single-item breadcrumb with this text. */
  title?: string
  /** For complex breadcrumbs (multi-level, extra buttons, etc.) */
  children?: React.ReactNode
  /** Right-aligned action slot rendered above the separator. */
  actions?: React.ReactNode
}

export function PageBreadcrumb({
  title,
  children,
  actions,
}: PageBreadcrumbProps) {
  return (
    <div className='shrink-0'>
      <div className='px-4 md:px-8 h-14 flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2 min-w-0'>
          <SidebarTrigger className='md:hidden shrink-0' />
          {title && !children ? (
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            children
          )}
        </div>
        {actions ? (
          <div className='flex items-center shrink-0'>{actions}</div>
        ) : null}
      </div>
      <Separator />
    </div>
  )
}
