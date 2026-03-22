import { Separator } from '@/components/ui/separator'

export function PageBreadcrumb({ children }: { children: React.ReactNode }) {
  return (
    <div className='shrink-0'>
      <div className='px-4 md:px-8 pt-4 md:pt-6 pb-3 min-h-6 flex items-center'>
        {children}
      </div>
      <Separator />
    </div>
  )
}
