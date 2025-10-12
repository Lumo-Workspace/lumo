'use client'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'

interface Agent {
  id: string
  name: string
  role: 'PM' | 'UX' | 'Dev' | 'QA' | 'BA'
  avatar: string
  status: 'online' | 'busy' | 'away' | 'offline'
  currentTask: string
  completedTasks: number
  totalTasks: number
  lastActive: string
  expertise: string[]
  workload: number
}

interface CommunicationLog {
  id: string
  agentId: string
  agentName: string
  message: string
  timestamp: string
  type: 'comment' | 'suggestion' | 'approval' | 'question' | 'decision'
}

interface VotingItem {
  id: string
  title: string
  description: string
  votes: Record<string, 'approve' | 'reject' | 'abstain'>
  status: 'pending' | 'approved' | 'rejected'
  deadline: string
}

interface AgentCollaborationSidebarProps {
  currentContext: {
    type: 'prd' | 'epic' | 'story'
    id: string
    title: string
  }
}

export default function AgentCollaborationSidebar({
  currentContext,
}: AgentCollaborationSidebarProps) {
  const [activeTab, setActiveTab] = useState('agents')

  // Mock data
  const agents: Agent[] = [
    {
      id: 'pm-1',
      name: '张产品',
      role: 'PM',
      avatar: '/avatars/pm.jpg',
      status: 'online',
      currentTask: '审查用户认证PRD',
      completedTasks: 8,
      totalTasks: 12,
      lastActive: '2分钟前',
      expertise: ['产品规划', '用户研究', '需求分析'],
      workload: 75,
    },
    {
      id: 'ux-1',
      name: '李设计',
      role: 'UX',
      avatar: '/avatars/ux.jpg',
      status: 'busy',
      currentTask: '设计登录界面原型',
      completedTasks: 6,
      totalTasks: 10,
      lastActive: '15分钟前',
      expertise: ['界面设计', '用户体验', '原型制作'],
      workload: 60,
    },
    {
      id: 'dev-1',
      name: '王开发',
      role: 'Dev',
      avatar: '/avatars/dev.jpg',
      status: 'online',
      currentTask: '评估技术可行性',
      completedTasks: 12,
      totalTasks: 15,
      lastActive: '5分钟前',
      expertise: ['前端开发', '后端架构', '数据库设计'],
      workload: 80,
    },
    {
      id: 'qa-1',
      name: '赵测试',
      role: 'QA',
      avatar: '/avatars/qa.jpg',
      status: 'away',
      currentTask: '制定测试计划',
      completedTasks: 4,
      totalTasks: 8,
      lastActive: '1小时前',
      expertise: ['功能测试', '自动化测试', '性能测试'],
      workload: 50,
    },
    {
      id: 'ba-1',
      name: '陈分析',
      role: 'BA',
      avatar: '/avatars/ba.jpg',
      status: 'online',
      currentTask: '分析业务流程',
      completedTasks: 5,
      totalTasks: 7,
      lastActive: '10分钟前',
      expertise: ['业务分析', '流程优化', '数据分析'],
      workload: 70,
    },
  ]

  const communicationLogs: CommunicationLog[] = [
    {
      id: 'log-1',
      agentId: 'pm-1',
      agentName: '张产品',
      message: '建议在登录功能中增加社交账号登录选项，提高用户转化率',
      timestamp: '2分钟前',
      type: 'suggestion',
    },
    {
      id: 'log-2',
      agentId: 'ux-1',
      agentName: '李设计',
      message: '同意PM的建议，我会在设计中预留社交登录的位置',
      timestamp: '5分钟前',
      type: 'approval',
    },
    {
      id: 'log-3',
      agentId: 'dev-1',
      agentName: '王开发',
      message: '技术上可行，但需要额外2天开发时间集成OAuth',
      timestamp: '8分钟前',
      type: 'comment',
    },
    {
      id: 'log-4',
      agentId: 'qa-1',
      agentName: '赵测试',
      message: '社交登录需要额外的测试用例，建议更新测试计划',
      timestamp: '12分钟前',
      type: 'question',
    },
    {
      id: 'log-5',
      agentId: 'ba-1',
      agentName: '陈分析',
      message: '从业务角度看，社交登录能降低注册门槛，建议优先实现',
      timestamp: '15分钟前',
      type: 'decision',
    },
  ]

  const votingItems: VotingItem[] = [
    {
      id: 'vote-1',
      title: '是否增加社交账号登录',
      description: '在用户认证系统中增加微信、QQ等社交账号登录功能',
      votes: {
        'pm-1': 'approve',
        'ux-1': 'approve',
        'dev-1': 'approve',
        'qa-1': 'abstain',
        'ba-1': 'approve',
      },
      status: 'approved',
      deadline: '2024-01-15',
    },
    {
      id: 'vote-2',
      title: '登录页面设计方案',
      description: '选择登录页面的设计风格：简约风格 vs 品牌风格',
      votes: {
        'pm-1': 'approve',
        'ux-1': 'approve',
        'dev-1': 'abstain',
      },
      status: 'pending',
      deadline: '2024-01-16',
    },
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-green-500'
      case 'busy':
        return 'bg-red-500'
      case 'away':
        return 'bg-yellow-500'
      case 'offline':
        return 'bg-gray-400'
      default:
        return 'bg-gray-400'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online':
        return '在线'
      case 'busy':
        return '忙碌'
      case 'away':
        return '离开'
      case 'offline':
        return '离线'
      default:
        return '未知'
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'PM':
        return 'bg-blue-100 text-blue-800'
      case 'UX':
        return 'bg-purple-100 text-purple-800'
      case 'Dev':
        return 'bg-green-100 text-green-800'
      case 'QA':
        return 'bg-orange-100 text-orange-800'
      case 'BA':
        return 'bg-pink-100 text-pink-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getMessageTypeIcon = (type: string) => {
    switch (type) {
      case 'comment':
        return '💬'
      case 'suggestion':
        return '💡'
      case 'approval':
        return '✅'
      case 'question':
        return '❓'
      case 'decision':
        return '⚡'
      default:
        return '📝'
    }
  }

  const getVoteIcon = (vote: string) => {
    switch (vote) {
      case 'approve':
        return '✅'
      case 'reject':
        return '❌'
      case 'abstain':
        return '⚪'
      default:
        return '⏳'
    }
  }

  const calculateConsensus = (votes: Record<string, string>) => {
    const totalVotes = Object.keys(votes).length
    const approvals = Object.values(votes).filter(v => v === 'approve').length
    return totalVotes > 0 ? (approvals / totalVotes) * 100 : 0
  }

  return (
    <div className='w-80 bg-white border-l border-gray-200 flex flex-col h-full'>
      <div className='p-4 border-b border-gray-200'>
        <h2 className='text-lg font-semibold text-gray-900 flex items-center gap-2'>
          <span className='text-blue-600'>👥</span>
          Agent 协作
        </h2>
        <p className='text-sm text-gray-600 mt-1'>
          {currentContext.type.toUpperCase()}: {currentContext.title}
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className='flex-1 flex flex-col'
      >
        <TabsList className='grid w-full grid-cols-3 mx-4 mt-4'>
          <TabsTrigger value='agents'>团队</TabsTrigger>
          <TabsTrigger value='communication'>沟通</TabsTrigger>
          <TabsTrigger value='voting'>投票</TabsTrigger>
        </TabsList>

        <TabsContent value='agents' className='flex-1 px-4 pb-4'>
          <ScrollArea className='h-full'>
            <div className='space-y-3'>
              {agents.map(agent => (
                <Card key={agent.id} className='p-3'>
                  <div className='flex items-center gap-3 mb-3'>
                    <div className='relative'>
                      <Avatar className='w-10 h-10'>
                        <AvatarImage
                          src={agent.avatar || '/placeholder.svg'}
                          alt={agent.name}
                        />
                        <AvatarFallback>
                          {agent.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div
                        className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(agent.status)}`}
                      />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <h3 className='font-medium text-sm text-gray-900 truncate'>
                          {agent.name}
                        </h3>
                        <Badge
                          className={`text-xs ${getRoleColor(agent.role)}`}
                        >
                          {agent.role}
                        </Badge>
                      </div>
                      <p className='text-xs text-gray-500'>
                        {getStatusLabel(agent.status)} • {agent.lastActive}
                      </p>
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <div>
                      <p className='text-xs text-gray-600 mb-1'>当前任务</p>
                      <p className='text-sm text-gray-900'>
                        {agent.currentTask}
                      </p>
                    </div>

                    <div>
                      <div className='flex items-center justify-between text-xs text-gray-600 mb-1'>
                        <span>任务进度</span>
                        <span>
                          {agent.completedTasks}/{agent.totalTasks}
                        </span>
                      </div>
                      <Progress
                        value={(agent.completedTasks / agent.totalTasks) * 100}
                        className='h-2'
                      />
                    </div>

                    <div>
                      <div className='flex items-center justify-between text-xs text-gray-600 mb-1'>
                        <span>工作负载</span>
                        <span>{agent.workload}%</span>
                      </div>
                      <Progress
                        value={agent.workload}
                        className={`h-2 ${agent.workload > 80 ? 'text-red-500' : agent.workload > 60 ? 'text-yellow-500' : 'text-green-500'}`}
                      />
                    </div>

                    <div>
                      <p className='text-xs text-gray-600 mb-1'>专业领域</p>
                      <div className='flex flex-wrap gap-1'>
                        {agent.expertise.map((skill, index) => (
                          <Badge
                            key={index}
                            variant='secondary'
                            className='text-xs'
                          >
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value='communication' className='flex-1 px-4 pb-4'>
          <ScrollArea className='h-full'>
            <div className='space-y-3'>
              {communicationLogs.map(log => (
                <Card key={log.id} className='p-3'>
                  <div className='flex items-start gap-3'>
                    <div className='flex-shrink-0'>
                      <Avatar className='w-8 h-8'>
                        <AvatarFallback className='text-xs'>
                          {log.agentName.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2 mb-1'>
                        <span className='font-medium text-sm text-gray-900'>
                          {log.agentName}
                        </span>
                        <span className='text-lg'>
                          {getMessageTypeIcon(log.type)}
                        </span>
                        <span className='text-xs text-gray-500'>
                          {log.timestamp}
                        </span>
                      </div>
                      <p className='text-sm text-gray-700 leading-relaxed'>
                        {log.message}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value='voting' className='flex-1 px-4 pb-4'>
          <ScrollArea className='h-full'>
            <div className='space-y-4'>
              {votingItems.map(item => {
                const consensus = calculateConsensus(item.votes)
                return (
                  <Card key={item.id} className='p-4'>
                    <div className='mb-3'>
                      <div className='flex items-center justify-between mb-2'>
                        <h3 className='font-medium text-sm text-gray-900'>
                          {item.title}
                        </h3>
                        <Badge
                          className={
                            item.status === 'approved'
                              ? 'bg-green-100 text-green-800'
                              : item.status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                          }
                        >
                          {item.status === 'approved'
                            ? '已通过'
                            : item.status === 'rejected'
                              ? '已拒绝'
                              : '待决定'}
                        </Badge>
                      </div>
                      <p className='text-xs text-gray-600 mb-2'>
                        {item.description}
                      </p>
                      <p className='text-xs text-gray-500'>
                        截止时间: {item.deadline}
                      </p>
                    </div>

                    <div className='space-y-2'>
                      <div className='flex items-center justify-between text-xs text-gray-600'>
                        <span>共识度</span>
                        <span>{Math.round(consensus)}%</span>
                      </div>
                      <Progress value={consensus} className='h-2' />
                    </div>

                    <div className='mt-3'>
                      <h4 className='text-xs font-medium text-gray-700 mb-2'>
                        投票情况
                      </h4>
                      <div className='space-y-1'>
                        {agents.map(agent => {
                          const vote = item.votes[agent.id]
                          return (
                            <div
                              key={agent.id}
                              className='flex items-center justify-between text-xs'
                            >
                              <div className='flex items-center gap-2'>
                                <Avatar className='w-5 h-5'>
                                  <AvatarFallback className='text-xs'>
                                    {agent.name.slice(0, 1)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className='text-gray-700'>
                                  {agent.name}
                                </span>
                              </div>
                              <span className='text-lg'>
                                {vote ? getVoteIcon(vote) : '⏳'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {item.status === 'pending' && (
                      <div className='mt-3 flex gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          className='flex-1 text-xs bg-transparent'
                        >
                          赞成
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='flex-1 text-xs bg-transparent'
                        >
                          反对
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='flex-1 text-xs bg-transparent'
                        >
                          弃权
                        </Button>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
