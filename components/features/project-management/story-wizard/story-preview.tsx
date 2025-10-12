'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { StoryData } from './wizard-steps'

interface StoryPreviewProps {
  storyData: StoryData
}

export default function StoryPreview({ storyData }: StoryPreviewProps) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'low':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high':
        return '高'
      case 'medium':
        return '中'
      case 'low':
        return '低'
      default:
        return ''
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-xl'>
            {storyData.title || '未命名 Story'}
          </CardTitle>
          <div className='flex items-center gap-2'>
            <Badge className={getPriorityColor(storyData.priority)}>
              {getPriorityLabel(storyData.priority)}
            </Badge>
            <Badge variant='outline'>{storyData.estimatedPoints} 点</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div>
          <h4 className='font-medium text-gray-700 mb-2'>BMAD 描述</h4>
          <p className='text-gray-600'>
            {storyData.asA && storyData.iWant && storyData.soThat
              ? `${storyData.asA}，${storyData.iWant}，${storyData.soThat}。`
              : 'BMAD 描述未完整填写'}
          </p>
        </div>

        <div>
          <h4 className='font-medium text-gray-700 mb-2'>验收标准</h4>
          <ul className='space-y-1'>
            {storyData.acceptanceCriteria
              .filter(criteria => criteria.trim().length > 0)
              .map((criteria, index) => (
                <li
                  key={index}
                  className='flex items-start gap-2 text-gray-600'
                >
                  <span className='text-green-600 mt-0.5'>✓</span>
                  {criteria}
                </li>
              ))}
          </ul>
          {storyData.acceptanceCriteria.filter(c => c.trim().length > 0)
            .length === 0 && <p className='text-gray-400'>暂无验收标准</p>}
        </div>

        {storyData.businessValue && (
          <div>
            <h4 className='font-medium text-gray-700 mb-2'>业务价值</h4>
            <p className='text-gray-600'>{storyData.businessValue}</p>
          </div>
        )}

        {storyData.technicalNotes && (
          <div>
            <h4 className='font-medium text-gray-700 mb-2'>技术备注</h4>
            <p className='text-gray-600'>{storyData.technicalNotes}</p>
          </div>
        )}

        {storyData.dependencies && storyData.dependencies.length > 0 && (
          <div>
            <h4 className='font-medium text-gray-700 mb-2'>依赖关系</h4>
            <div className='flex flex-wrap gap-1'>
              {storyData.dependencies.map((dep, index) => (
                <Badge key={index} variant='secondary' className='text-xs'>
                  {dep}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
