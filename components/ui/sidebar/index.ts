/**
 * shadcn/ui sidebar — split into SRP units (context, frame, group, menu,
 * submenu). This barrel preserves the original `@/components/ui/sidebar`
 * import path so existing callers don't need to change.
 *
 * Internal callers should still import from this barrel rather than the
 * sub-files; the sub-files are an implementation detail.
 */

export { SidebarProvider, useSidebar } from './context'

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from './frame'

export {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from './group'

export {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from './menu'

export {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './submenu'
