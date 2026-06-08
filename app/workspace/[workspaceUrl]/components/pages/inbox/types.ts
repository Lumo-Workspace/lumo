import { ApiNotification, ApiStatus } from '../../../types'

export interface NotificationItemProps {
  notification: ApiNotification
  isSelected: boolean
  onSelect: () => void
  onMarkRead: () => void
  onMarkUnread: () => void
  onDelete: () => void
  onTaskAction: (status: ApiStatus) => void
}
