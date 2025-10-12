'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import type { PRD } from '../../../hooks/use-teams'

interface BMADStory {
  id: string
  title: string
  asA: string // "As a..."
  iWant: string // "I want..."
  soThat: string // "So that..."
  acceptanceCriteria: string[]
  priority: 'low' | 'medium' | 'high'
  estimatedPoints: number
  dependencies: string[]
}

interface BMADEpic {
  id: string
  title: string
  description: string
  stories: BMADStory[]
  businessValue: string
  successMetrics: string[]
}

interface BMADDecompositionResult {
  epics: BMADEpic[]
  totalStories: number
  totalPoints: number
  estimatedDuration: string
}

interface BMADEngineProps {
  prd: PRD
  onDecompositionComplete: (result: BMADDecompositionResult) => void
  onClose: () => void
}

export default function BMADEngine({
  prd,
  onDecompositionComplete,
  onClose,
}: BMADEngineProps) {
  const [isDecomposing, setIsDecomposing] = useState(false)
  const [decompositionProgress, setDecompositionProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [result, setResult] = useState<BMADDecompositionResult | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')

  const simulateAIDecomposition = async () => {
    setIsDecomposing(true)
    setDecompositionProgress(0)

    const steps = [
      '分析PRD内容结构...',
      '识别核心功能模块...',
      '生成Epic分解方案...',
      '创建BMAD格式Story...',
      '计算工作量估算...',
      '生成依赖关系图...',
      '完成智能分解...',
    ]

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (step) {
        setCurrentStep(step)
      }
      setDecompositionProgress(((i + 1) / steps.length) * 100)
      await new Promise(resolve => setTimeout(resolve, 800))
    }

    // Simulate AI-generated decomposition result
    const mockResult: BMADDecompositionResult = {
      epics: [
        {
          id: `epic-${Date.now()}-1`,
          title: '用户身份验证核心功能',
          description: '实现用户注册、登录、密码管理等核心身份验证功能',
          businessValue: '提供安全可靠的用户身份验证，确保系统安全性',
          successMetrics: [
            '注册成功率 > 95%',
            '登录响应时间 < 2秒',
            '密码重置成功率 > 90%',
          ],
          stories: [
            {
              id: `story-${Date.now()}-1`,
              title: '用户邮箱注册',
              asA: '新用户',
              iWant: '通过邮箱地址注册账号',
              soThat: '我可以创建个人账户并使用系统功能',
              acceptanceCriteria: [
                '用户可以输入有效的邮箱地址',
                '系统发送验证邮件到用户邮箱',
                '用户点击验证链接后账号激活',
                '注册成功后自动跳转到欢迎页面',
              ],
              priority: 'high',
              estimatedPoints: 8,
              dependencies: [],
            },
            {
              id: `story-${Date.now()}-2`,
              title: '用户密码登录',
              asA: '已注册用户',
              iWant: '使用邮箱和密码登录系统',
              soThat: '我可以访问我的个人账户和数据',
              acceptanceCriteria: [
                '用户可以输入邮箱和密码',
                '系统验证用户凭据',
                '登录成功后跳转到用户仪表板',
                '登录失败时显示明确的错误信息',
              ],
              priority: 'high',
              estimatedPoints: 5,
              dependencies: [`story-${Date.now()}-1`],
            },
            {
              id: `story-${Date.now()}-3`,
              title: '密码重置功能',
              asA: '忘记密码的用户',
              iWant: '通过邮箱重置我的密码',
              soThat: '我可以重新获得账户访问权限',
              acceptanceCriteria: [
                '用户可以请求密码重置',
                '系统发送重置链接到用户邮箱',
                '用户可以通过链接设置新密码',
                '新密码设置后旧密码失效',
              ],
              priority: 'medium',
              estimatedPoints: 6,
              dependencies: [`story-${Date.now()}-1`],
            },
          ],
        },
        {
          id: `epic-${Date.now()}-2`,
          title: '用户会话管理',
          description: '管理用户登录状态、会话超时、多设备登录等功能',
          businessValue: '提供良好的用户体验和安全的会话管理',
          successMetrics: [
            '会话保持时长 > 24小时',
            '多设备同步率 > 98%',
            '安全退出成功率 100%',
          ],
          stories: [
            {
              id: `story-${Date.now()}-4`,
              title: '自动会话保持',
              asA: '活跃用户',
              iWant: '系统自动保持我的登录状态',
              soThat: '我不需要频繁重新登录',
              acceptanceCriteria: [
                '用户活跃时会话自动延期',
                '会话过期前提醒用户',
                "支持'记住我'选项",
                '安全的token刷新机制',
              ],
              priority: 'medium',
              estimatedPoints: 7,
              dependencies: [`story-${Date.now()}-2`],
            },
            {
              id: `story-${Date.now()}-5`,
              title: '多设备登录管理',
              asA: '使用多设备的用户',
              iWant: '在不同设备上管理我的登录会话',
              soThat: '我可以控制账户安全并管理设备访问',
              acceptanceCriteria: [
                '显示所有活跃设备列表',
                '可以远程注销特定设备',
                '新设备登录时发送通知',
                '支持设备信任管理',
              ],
              priority: 'low',
              estimatedPoints: 9,
              dependencies: [`story-${Date.now()}-2`],
            },
          ],
        },
      ],
      totalStories: 5,
      totalPoints: 35,
      estimatedDuration: '4-6 周',
    }

    setResult(mockResult)
    setIsDecomposing(false)
  }

  const handleConfirmDecomposition = () => {
    if (result) {
      onDecompositionComplete(result)
    }
  }

  const renderStoryCard = (story: BMADStory) => (
    <Card key={story.id} className='mb-4'>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-lg'>{story.title}</CardTitle>
          <div className='flex items-center gap-2'>
            <Badge
              variant={
                story.priority === 'high'
                  ? 'destructive'
                  : story.priority === 'medium'
                    ? 'default'
                    : 'secondary'
              }
            >
              {story.priority === 'high'
                ? '高'
                : story.priority === 'medium'
                  ? '中'
                  : '低'}
            </Badge>
            <Badge variant='outline'>{story.estimatedPoints} 点</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className='space-y-3'>
          <div className='bg-blue-50 p-3 rounded-lg'>
            <p className='text-sm'>
              <strong>作为</strong> {story.asA}，<strong>我希望</strong>{' '}
              {story.iWant}，<strong>以便</strong> {story.soThat}
            </p>
          </div>

          <div>
            <Label className='text-sm font-medium'>验收标准：</Label>
            <ul className='mt-1 space-y-1'>
              {story.acceptanceCriteria.map((criteria, index) => (
                <li
                  key={index}
                  className='text-sm text-gray-600 flex items-start gap-2'
                >
                  <span className='text-green-600 mt-0.5'>✓</span>
                  {criteria}
                </li>
              ))}
            </ul>
          </div>

          {story.dependencies.length > 0 && (
            <div>
              <Label className='text-sm font-medium'>依赖关系：</Label>
              <div className='mt-1 flex flex-wrap gap-1'>
                {story.dependencies.map((dep, index) => (
                  <Badge key={index} variant='outline' className='text-xs'>
                    {dep}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
      <div className='bg-white rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col'>
        <div className='flex items-center justify-between p-6 border-b'>
          <div>
            <h2 className='text-2xl font-bold'>BMAD 智能分解引擎</h2>
            <p className='text-gray-600 mt-1'>
              自动将 PRD 分解为 Epic 和 Story
            </p>
          </div>
          <Button variant='ghost' onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className='flex-1 overflow-hidden flex'>
          {/* Left Panel - PRD Content */}
          <div className='w-1/3 border-r p-6 overflow-y-auto'>
            <h3 className='text-lg font-semibold mb-4'>PRD 内容</h3>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>{prd.title}</CardTitle>
                <Badge variant='outline'>{prd.version}</Badge>
              </CardHeader>
              <CardContent>
                <p className='text-sm text-gray-600 leading-relaxed'>
                  {prd.content}
                </p>
              </CardContent>
            </Card>

            <div className='mt-6'>
              <Label htmlFor='custom-prompt'>自定义分解提示（可选）</Label>
              <Textarea
                id='custom-prompt'
                placeholder='例如：重点关注移动端体验，优先考虑安全性...'
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                className='mt-2'
                rows={4}
              />
            </div>

            <Button
              onClick={simulateAIDecomposition}
              disabled={isDecomposing}
              className='w-full mt-4'
            >
              {isDecomposing ? '分解中...' : '开始智能分解'}
            </Button>
          </div>

          {/* Right Panel - Decomposition Results */}
          <div className='flex-1 p-6 overflow-y-auto'>
            {isDecomposing ? (
              <div className='flex flex-col items-center justify-center h-full'>
                <div className='w-full max-w-md'>
                  <div className='text-center mb-6'>
                    <div className='w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4'>
                      <span className='text-2xl'>🤖</span>
                    </div>
                    <h3 className='text-lg font-semibold'>AI 正在分解 PRD</h3>
                    <p className='text-gray-600 mt-1'>{currentStep}</p>
                  </div>
                  <Progress value={decompositionProgress} className='w-full' />
                  <p className='text-center text-sm text-gray-500 mt-2'>
                    {Math.round(decompositionProgress)}% 完成
                  </p>
                </div>
              </div>
            ) : result ? (
              <div>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-lg font-semibold'>分解结果</h3>
                  <div className='flex items-center gap-4 text-sm text-gray-600'>
                    <span>{result.totalStories} 个 Story</span>
                    <span>{result.totalPoints} 故事点</span>
                    <span>预计 {result.estimatedDuration}</span>
                  </div>
                </div>

                <div className='space-y-6'>
                  {result.epics.map(epic => (
                    <Card key={epic.id}>
                      <CardHeader>
                        <CardTitle className='text-xl'>{epic.title}</CardTitle>
                        <p className='text-gray-600'>{epic.description}</p>
                        <div className='flex items-center gap-4 text-sm'>
                          <div>
                            <Label className='font-medium'>业务价值：</Label>
                            <span className='text-gray-600 ml-1'>
                              {epic.businessValue}
                            </span>
                          </div>
                        </div>
                        <div>
                          <Label className='font-medium text-sm'>
                            成功指标：
                          </Label>
                          <ul className='mt-1 space-y-1'>
                            {epic.successMetrics.map((metric, index) => (
                              <li
                                key={index}
                                className='text-sm text-gray-600 flex items-center gap-2'
                              >
                                <span className='text-blue-600'>📊</span>
                                {metric}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Separator className='mb-4' />
                        <h4 className='font-medium mb-3'>包含的 Story：</h4>
                        {epic.stories.map(renderStoryCard)}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className='flex justify-end gap-3 mt-6 pt-6 border-t'>
                  <Button variant='outline' onClick={onClose}>
                    取消
                  </Button>
                  <Button onClick={handleConfirmDecomposition}>
                    确认并应用分解结果
                  </Button>
                </div>
              </div>
            ) : (
              <div className='flex flex-col items-center justify-center h-full text-center'>
                <div className='w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4'>
                  <span className='text-2xl'>📋</span>
                </div>
                <h3 className='text-lg font-semibold text-gray-900'>
                  准备开始智能分解
                </h3>
                <p className='text-gray-600 mt-2 max-w-md'>
                  点击左侧的&ldquo;开始智能分解&rdquo;按钮，AI 将自动分析 PRD
                  内容并生成 BMAD 格式的 Epic 和 Story
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
