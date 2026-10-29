'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { FeedbackDialog } from './FeedbackDialog'

/** LUM-1287: the sidebar footer's "Send feedback" entry and its dialog. */
export function FeedbackSidebarItem() {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const label = intl.formatMessage({ id: 'sidebar.feedback' })

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={label} onClick={() => setOpen(true)}>
          <MessageSquare />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </SidebarMenu>
  )
}
