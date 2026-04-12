import { ApiNotification, ApiStatus } from '../../../types'

export interface NotificationItemProps {
  notification: ApiNotification
  isSelected: boolean
  onSelect: () => void
  onMarkRead: () => void
  onMarkUnread: () => void
  onDelete: () => void
  onTaskAction: (status: ApiStatus) => void
  onRespond: (
    id: string,
    action: 'reply' | 'confirm' | 'send_back' | 'approve' | 'deny',
    reply?: string
  ) => void
}

export interface AgentClarifyWidgetProps {
  notification: ApiNotification
  onRespond: (id: string, action: 'reply', reply: string) => void
}

export interface AgentVerifyWidgetProps {
  notification: ApiNotification
  onRespond: (id: string, action: 'confirm' | 'send_back') => void
}

export interface AgentAuthorizeWidgetProps {
  notification: ApiNotification
  onRespond: (id: string, action: 'approve' | 'deny') => void
}
