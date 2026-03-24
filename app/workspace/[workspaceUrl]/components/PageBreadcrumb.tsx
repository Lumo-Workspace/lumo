import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function PageBreadcrumb({ children }: { children: React.ReactNode }) {
  return (
    <div className='shrink-0'>
      <div className='px-4 md:px-8 h-10 flex items-center justify-between'>
        <div className='flex items-center gap-2 min-w-0'>
          <SidebarTrigger className='md:hidden shrink-0' />
          {children}
        </div>
      </div>
      <Separator />
    </div>
  )
}
