'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { href: string; label: string }

const draftItems: NavItem[] = [{ href: '#/draft', label: 'Draft' }]

const workspaceItems: NavItem[] = [{ href: '#/documents', label: 'Documents' }]

export function Sidebar({ workspaceUrl }: { workspaceUrl: string }) {
  const pathname = usePathname()

  const renderGroup = (title: string, items: NavItem[]) => (
    <div className='mt-4'>
      <p className='px-3 mb-2 text-xs font-medium text-slate-500'>{title}</p>
      <ul className='space-y-1'>
        {items.map(item => {
          const isActive = pathname?.includes(item.href.replace('#', ''))
          return (
            <li key={item.label}>
              <Link
                href={`/workspace/${workspaceUrl}`}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-200 text-slate-900'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <aside className='h-full w-64 border-r border-slate-200 bg-white'>
      <div className='h-12 flex items-center px-3 text-sm font-medium text-slate-700'>
        Workspace
      </div>
      <nav className='px-2'>
        {renderGroup('Draft', draftItems)}
        {renderGroup('Workspace', workspaceItems)}
      </nav>
    </aside>
  )
}

export default Sidebar
