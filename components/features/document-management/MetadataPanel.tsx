'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, CheckCircle, FileText } from 'lucide-react'

interface MetadataItem {
  id: string
  title: string
  type: 'team' | 'project' | 'prd' | 'epic' | 'story' | 'task'
  status: string
  createdAt: string
  updatedAt: string
  owner?: string
  assignee?: string | undefined
  priority?: 'high' | 'medium' | 'low'
  dueDate?: string | undefined
  version?: string
  description?: string
}

interface MetadataPanelProps {
  item: MetadataItem
  onClose: () => void
}

export default function MetadataPanel({ item, onClose }: MetadataPanelProps) {
  // Generate unique ID based on type and current date
  const generateUniqueId = (type: string) => {
    const year = new Date().getFullYear()
    const typePrefix = type.toUpperCase().substring(0, 3)
    const randomNum = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')
    return `${typePrefix}-${year}-${randomNum}`
  }

  const getStatusConfig = (status: string) => {
    const statusMap = {
      // 状态相关
      draft: { color: 'bg-gray-100 text-gray-800', label: '草稿', icon: '📝' },
      'in-review': {
        color: 'bg-yellow-100 text-yellow-800',
        label: '评审中',
        icon: '👀',
      },
      approved: {
        color: 'bg-green-100 text-green-800',
        label: '已批准',
        icon: '✅',
      },
      'in-progress': {
        color: 'bg-blue-100 text-blue-800',
        label: '进行中',
        icon: '🔄',
      },
      done: {
        color: 'bg-green-100 text-green-800',
        label: '已完成',
        icon: '✅',
      },
      archived: {
        color: 'bg-gray-100 text-gray-800',
        label: '已归档',
        icon: '📦',
      },
      active: {
        color: 'bg-green-100 text-green-800',
        label: '活跃',
        icon: '🟢',
      },
      'on-hold': {
        color: 'bg-yellow-100 text-yellow-800',
        label: '暂停',
        icon: '⏸️',
      },
      completed: {
        color: 'bg-blue-100 text-blue-800',
        label: '已完成',
        icon: '✅',
      },
      planning: {
        color: 'bg-purple-100 text-purple-800',
        label: '规划中',
        icon: '📋',
      },
      backlog: {
        color: 'bg-gray-100 text-gray-800',
        label: '待办',
        icon: '📝',
      },
      todo: { color: 'bg-gray-100 text-gray-800', label: '待办', icon: '📝' },
      review: {
        color: 'bg-yellow-100 text-yellow-800',
        label: '评审中',
        icon: '👀',
      },
    }

    return (
      statusMap[status as keyof typeof statusMap] || {
        color: 'bg-gray-100 text-gray-800',
        label: status,
        icon: '❓',
      }
    )
  }

  const getPriorityConfig = (priority?: string) => {
    if (!priority) return null

    const priorityMap = {
      high: { color: 'bg-red-100 text-red-800', label: '高优先级', icon: '🔴' },
      medium: {
        color: 'bg-yellow-100 text-yellow-800',
        label: '中优先级',
        icon: '🟡',
      },
      low: {
        color: 'bg-green-100 text-green-800',
        label: '低优先级',
        icon: '🟢',
      },
    }

    return priorityMap[priority as keyof typeof priorityMap]
  }

  const getTypeConfig = (type: string) => {
    const typeMap = {
      team: { label: '团队', icon: '👥', color: 'bg-blue-100 text-blue-800' },
      project: {
        label: '项目',
        icon: '📊',
        color: 'bg-purple-100 text-purple-800',
      },
      prd: { label: 'PRD', icon: '📋', color: 'bg-green-100 text-green-800' },
      epic: {
        label: 'Epic',
        icon: '🎯',
        color: 'bg-orange-100 text-orange-800',
      },
      story: { label: 'Story', icon: '📖', color: 'bg-cyan-100 text-cyan-800' },
      task: { label: 'Task', icon: '✅', color: 'bg-pink-100 text-pink-800' },
    }

    return (
      typeMap[type as keyof typeof typeMap] || {
        label: type,
        icon: '📄',
        color: 'bg-gray-100 text-gray-800',
      }
    )
  }

  const getHealthStatus = () => {
    // AI 生成的健康度评估
    const now = new Date()
    const updated = new Date(item.updatedAt)
    const daysSinceUpdate = Math.floor(
      (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysSinceUpdate > 7) {
      return {
        status: 'red',
        label: '需要关注',
        icon: '🔴',
        reason: '超过7天未更新',
      }
    } else if (daysSinceUpdate > 3) {
      return {
        status: 'yellow',
        label: '正常',
        icon: '🟡',
        reason: '3-7天前更新',
      }
    } else {
      return { status: 'green', label: '健康', icon: '🟢', reason: '最近更新' }
    }
  }

  const getRiskSummary = () => {
    // AI 生成的风险摘要
    const risks = []

    if (item.dueDate) {
      const dueDate = new Date(item.dueDate)
      const now = new Date()
      const daysUntilDue = Math.floor(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysUntilDue < 0) {
        risks.push('已超期')
      } else if (daysUntilDue < 3) {
        risks.push('即将到期')
      }
    }

    if (item.status === 'in-progress' && !item.assignee) {
      risks.push('无负责人')
    }

    return risks
  }

  const statusConfig = getStatusConfig(item.status)
  const priorityConfig = getPriorityConfig(item.priority)
  const typeConfig = getTypeConfig(item.type)
  const healthStatus = getHealthStatus()
  const risks = getRiskSummary()

  return (
    <div className='w-80 bg-white border-l border-gray-200 flex flex-col h-full'>
      {/* Header */}
      <div className='p-4 border-b border-gray-200'>
        <div className='flex items-center justify-between mb-2'>
          <h2 className='text-lg font-semibold text-gray-900'>Meta Data</h2>
          <Button variant='ghost' size='sm' onClick={onClose}>
            ✕
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-auto p-4 space-y-6'>
        {/* 1. 基本属性 */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium flex items-center gap-2'>
              🏷️ 基本属性
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <label className='text-xs font-medium text-gray-500'>
                标题 (Title)
              </label>
              <p className='text-sm text-gray-900 mt-1'>{item.title}</p>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                唯一 ID
              </label>
              <p className='text-sm text-gray-900 mt-1 font-mono'>
                {generateUniqueId(item.type)}
              </p>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                Owner (主要负责人)
              </label>
              <p className='text-sm text-gray-900 mt-1'>
                {item.owner || item.assignee || '未分配'}
              </p>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                参与团队
              </label>
              <div className='flex items-center gap-2 mt-1'>
                <Badge className='bg-blue-100 text-blue-800 border-0'>
                  主导团队
                </Badge>
                <Badge className='bg-gray-100 text-gray-800 border-0'>
                  协作团队
                </Badge>
              </div>
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div>
                <label className='text-xs font-medium text-gray-500'>
                  创建时间
                </label>
                <p className='text-xs text-gray-900 mt-1'>
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div>
                <label className='text-xs font-medium text-gray-500'>
                  更新时间
                </label>
                <p className='text-xs text-gray-900 mt-1'>
                  {new Date(item.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. 状态相关 */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium flex items-center gap-2'>
              🚦 状态相关
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <label className='text-xs font-medium text-gray-500'>
                状态 (Status)
              </label>
              <div className='mt-1'>
                <Badge className={`${statusConfig.color} border-0`}>
                  {statusConfig.icon} {statusConfig.label}
                </Badge>
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                进度 (Progress)
              </label>
              <div className='mt-1'>
                <div className='flex items-center gap-2'>
                  <div className='flex-1 bg-gray-200 rounded-full h-2'>
                    <div
                      className='bg-blue-600 h-2 rounded-full'
                      style={{ width: `${Math.random() * 100}%` }}
                    ></div>
                  </div>
                  <span className='text-xs text-gray-600'>
                    {Math.floor(Math.random() * 100)}%
                  </span>
                </div>
              </div>
            </div>

            {priorityConfig && (
              <div>
                <label className='text-xs font-medium text-gray-500'>
                  优先级 (Priority)
                </label>
                <div className='mt-1'>
                  <Badge className={`${priorityConfig.color} border-0`}>
                    {priorityConfig.icon} {priorityConfig.label}
                  </Badge>
                </div>
              </div>
            )}

            <div>
              <label className='text-xs font-medium text-gray-500'>
                可见性 (Visibility)
              </label>
              <div className='mt-1'>
                <Badge className='bg-green-100 text-green-800 border-0'>
                  🔓 Team-only
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. 时间相关 */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium flex items-center gap-2'>
              📅 时间相关
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <label className='text-xs font-medium text-gray-500'>
                开始日期 (Start Date)
              </label>
              <p className='text-sm text-gray-900 mt-1'>
                {new Date(item.createdAt).toLocaleDateString()}
              </p>
            </div>

            {item.dueDate && (
              <div>
                <label className='text-xs font-medium text-gray-500'>
                  结束日期 (Target Delivery)
                </label>
                <p className='text-sm text-gray-900 mt-1'>
                  {new Date(item.dueDate).toLocaleDateString()}
                </p>
              </div>
            )}

            <div>
              <label className='text-xs font-medium text-gray-500'>
                里程碑 (Milestones)
              </label>
              <div className='mt-1 space-y-1'>
                <Badge className='bg-purple-100 text-purple-800 border-0'>
                  📍 设计评审
                </Badge>
                <Badge className='bg-purple-100 text-purple-800 border-0'>
                  📍 开发完成
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. 关联关系 */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium flex items-center gap-2'>
              🔗 关联关系
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <label className='text-xs font-medium text-gray-500'>
                上游依赖
              </label>
              <div className='mt-1 space-y-1'>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  📊 战略目标 2025
                </div>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  🎯 用户体验优化项目
                </div>
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                下游关联
              </label>
              <div className='mt-1 space-y-1'>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  📋 相关 PRD
                </div>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  🎯 关联 Epic
                </div>
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                相关文档
              </label>
              <div className='mt-1 space-y-1'>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  📄 市场调研报告
                </div>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  📝 会议纪要
                </div>
                <div className='text-xs text-blue-600 hover:underline cursor-pointer'>
                  👥 客户需求文档
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 5. 标签与分类 */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium flex items-center gap-2'>
              🏷️ 标签与分类
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <label className='text-xs font-medium text-gray-500'>
                标签 (Tags)
              </label>
              <div className='mt-1 flex flex-wrap gap-1'>
                <Badge className='bg-indigo-100 text-indigo-800 border-0'>
                  #Infrastructure
                </Badge>
                <Badge className='bg-indigo-100 text-indigo-800 border-0'>
                  #Frontend
                </Badge>
                <Badge className='bg-indigo-100 text-indigo-800 border-0'>
                  #AI
                </Badge>
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                项目类型 (Project Type)
              </label>
              <div className='mt-1'>
                <Badge className={`${typeConfig.color} border-0`}>
                  {typeConfig.icon} {typeConfig.label}
                </Badge>
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                归属领域 (Domain)
              </label>
              <div className='mt-1'>
                <Badge className='bg-teal-100 text-teal-800 border-0'>
                  📁 Travel Portal
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 6. AI & 系统生成 Meta */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium flex items-center gap-2'>
              🤖 AI & 系统生成
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <label className='text-xs font-medium text-gray-500'>
                风险摘要
              </label>
              <div className='mt-1'>
                {risks.length > 0 ? (
                  <div className='space-y-1'>
                    {risks.map((risk, index) => (
                      <div key={index} className='flex items-center gap-2'>
                        <AlertTriangle className='w-3 h-3 text-red-500' />
                        <span className='text-xs text-red-600'>{risk}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className='flex items-center gap-2'>
                    <CheckCircle className='w-3 h-3 text-green-500' />
                    <span className='text-xs text-green-600'>无风险检测</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                项目健康度
              </label>
              <div className='mt-1'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm'>{healthStatus.icon}</span>
                  <span className='text-xs text-gray-900'>
                    {healthStatus.label}
                  </span>
                  <span className='text-xs text-gray-500'>
                    ({healthStatus.reason})
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className='text-xs font-medium text-gray-500'>
                文档覆盖度
              </label>
              <div className='mt-1'>
                <div className='flex items-center gap-2'>
                  <FileText className='w-3 h-3 text-blue-500' />
                  <span className='text-xs text-gray-900'>85% 完整</span>
                  <span className='text-xs text-gray-500'>
                    (PRD ✓, Tech Design ✓, 任务 ⚠️)
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
