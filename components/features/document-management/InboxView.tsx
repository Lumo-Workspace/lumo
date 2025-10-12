'use client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Clock,
  User,
  Inbox,
  FileText,
  MessageCircle,
  CheckSquare,
  Bell,
  AtSign,
  Calendar,
  Hash,
} from 'lucide-react'
import type { Page } from '@/hooks/use-pages'

interface Notification {
  id: number
  title: string
  content: string
  time: string
  unread: boolean
  sender: string
  fullContent: string
  type: 'comment' | 'task' | 'update' | 'mention'
  documentId?: string
}

interface InboxViewProps {
  notifications: Notification[]
  selectedNotification: Notification | null
  onNotificationSelect: (notification: Notification | null) => void
  onMarkAsRead: (notificationId: number) => void
  onSwitchToDocument: (documentId: string) => void
  pages: Record<string, Page>
}

export default function InboxView({
  notifications,
  selectedNotification,
  onNotificationSelect,
  onMarkAsRead,
  onSwitchToDocument,
  pages,
}: InboxViewProps) {
  const handleNotificationClick = (notification: Notification) => {
    onNotificationSelect(notification)
    if (notification.unread) {
      onMarkAsRead(notification.id)
    }
  }

  const handleSwitchToDocument = () => {
    if (selectedNotification?.documentId) {
      onSwitchToDocument(selectedNotification.documentId)
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'comment':
        return MessageCircle
      case 'task':
        return CheckSquare
      case 'update':
        return Bell
      case 'mention':
        return AtSign
      default:
        return Bell
    }
  }

  const getDocumentInfo = (documentId: string) => {
    const document = pages[documentId]
    if (!document) return null

    return {
      title: document.title,
      blocksCount: document.blocks.length,
      hasChildren: document.children.length > 0,
      parentTitle: document.parentId ? pages[document.parentId]?.title : null,
    }
  }

  return (
    <div className='flex-1 flex bg-white'>
      <div className='w-80 bg-gray-50 border-r border-gray-200 flex flex-col'>
        <div className='h-14 border-b border-gray-200 flex items-center justify-between px-4'>
          <div className='flex items-center gap-2'>
            <Inbox className='w-5 h-5 text-gray-600' />
            <h2 className='font-medium text-gray-900'>收件箱</h2>
          </div>
          <Badge
            variant='secondary'
            className='text-xs bg-blue-100 text-blue-700'
          >
            {notifications.filter(n => n.unread).length}
          </Badge>
        </div>

        <div className='flex-1 overflow-auto'>
          {notifications.map(notification => {
            const Icon = getNotificationIcon(notification.type)
            const documentInfo = notification.documentId
              ? getDocumentInfo(notification.documentId)
              : null

            return (
              <div
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`
                  p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors
                  ${notification.unread ? 'bg-blue-50' : 'bg-white'}
                  ${selectedNotification?.id === notification.id ? 'bg-blue-100 border-r-2 border-r-blue-500' : ''}
                `}
              >
                <div className='flex items-start gap-3'>
                  <Icon className='w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0' />

                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 mb-1'>
                      <h3
                        className={`text-sm font-medium truncate ${notification.unread ? 'text-gray-900' : 'text-gray-600'}`}
                      >
                        {notification.title}
                      </h3>
                      {notification.unread && (
                        <div className='w-2 h-2 rounded-full bg-blue-500 flex-shrink-0' />
                      )}
                    </div>

                    <p className='text-xs text-gray-500 mb-2 line-clamp-2'>
                      {notification.content}
                    </p>

                    <div className='flex items-center gap-3 text-xs text-gray-400'>
                      <span>{notification.sender}</span>
                      <span>{notification.time}</span>
                      {documentInfo && (
                        <div className='flex items-center gap-1 text-blue-600'>
                          <FileText className='w-3 h-3' />
                          <span className='truncate max-w-20'>
                            {documentInfo.title}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selectedNotification ? (
        <div className='flex-1 flex flex-col bg-white'>
          <div className='h-14 border-b border-gray-200 flex items-center justify-between px-6'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => onNotificationSelect(null)}
              className='text-gray-600 hover:text-gray-900'
            >
              <ArrowLeft className='w-4 h-4 mr-1' />
              返回
            </Button>
            {selectedNotification.documentId && (
              <Button
                variant='default'
                size='sm'
                onClick={handleSwitchToDocument}
              >
                <FileText className='w-4 h-4 mr-1' />
                查看文档
              </Button>
            )}
          </div>

          <div className='flex-1 overflow-auto p-6'>
            <div className='max-w-3xl mx-auto space-y-6'>
              <div className='space-y-3'>
                <h1 className='text-2xl font-semibold text-gray-900'>
                  {selectedNotification.title}
                </h1>

                <div className='flex items-center gap-4 text-sm text-gray-500'>
                  <div className='flex items-center gap-1'>
                    <User className='w-4 h-4' />
                    <span>{selectedNotification.sender}</span>
                  </div>
                  <div className='flex items-center gap-1'>
                    <Clock className='w-4 h-4' />
                    <span>{selectedNotification.time}</span>
                  </div>
                </div>
              </div>

              <div className='prose prose-sm max-w-none'>
                <div className='whitespace-pre-wrap text-gray-800 leading-relaxed'>
                  {selectedNotification.fullContent}
                </div>
              </div>

              {selectedNotification.documentId &&
                (() => {
                  const documentInfo = getDocumentInfo(
                    selectedNotification.documentId
                  )
                  return documentInfo ? (
                    <div className='border border-gray-200 rounded-lg p-4 bg-gray-50'>
                      <div className='flex items-start gap-3'>
                        <FileText className='w-5 h-5 text-gray-500 mt-0.5' />
                        <div className='flex-1 space-y-2'>
                          <div>
                            <h4 className='font-medium text-gray-900'>
                              {documentInfo.title}
                            </h4>
                            <p className='text-sm text-gray-500'>相关文档</p>
                          </div>

                          <div className='flex items-center gap-4 text-xs text-gray-400'>
                            <div className='flex items-center gap-1'>
                              <Hash className='w-3 h-3' />
                              <span>{documentInfo.blocksCount} 个块</span>
                            </div>
                            {documentInfo.hasChildren && (
                              <div className='flex items-center gap-1'>
                                <FileText className='w-3 h-3' />
                                <span>包含子页面</span>
                              </div>
                            )}
                            {documentInfo.parentTitle && (
                              <div className='flex items-center gap-1'>
                                <Calendar className='w-3 h-3' />
                                <span>
                                  属于 &ldquo;{documentInfo.parentTitle}&rdquo;
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <Button
                          variant='secondary'
                          size='sm'
                          onClick={handleSwitchToDocument}
                          className='bg-blue-100 text-blue-700 hover:bg-blue-200'
                        >
                          查看
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className='border border-gray-200 rounded-lg p-4 bg-gray-50'>
                      <div className='flex items-center gap-3'>
                        <FileText className='w-5 h-5 text-gray-500' />
                        <div className='flex-1'>
                          <h4 className='font-medium text-gray-900'>
                            文档不存在
                          </h4>
                          <p className='text-sm text-gray-500'>
                            关联的文档可能已被删除
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </div>
          </div>
        </div>
      ) : (
        <div className='flex-1 flex items-center justify-center bg-white'>
          <div className='text-center space-y-3'>
            <Inbox className='w-12 h-12 text-gray-400 mx-auto' />
            <div className='space-y-1'>
              <h3 className='text-lg font-medium text-gray-900'>选择通知</h3>
              <p className='text-sm text-gray-500'>点击左侧通知查看详情</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
