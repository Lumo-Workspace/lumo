'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { StoryData } from './wizard-steps'

interface BasicInfoStepProps {
  storyData: StoryData
  updateStoryData: (field: keyof StoryData, value: any) => void
}

export default function BasicInfoStep({
  storyData,
  updateStoryData,
}: BasicInfoStepProps) {
  return (
    <div className='space-y-6'>
      <div>
        <Label htmlFor='title'>Story 标题 *</Label>
        <Input
          id='title'
          placeholder='例如：用户登录功能'
          value={storyData.title}
          onChange={e => updateStoryData('title', e.target.value)}
          className='mt-1'
        />
        <p className='text-sm text-gray-500 mt-1'>
          简洁明确地描述这个 Story 的功能
        </p>
      </div>

      <div>
        <Label htmlFor='priority'>优先级</Label>
        <Select
          value={storyData.priority}
          onValueChange={value => updateStoryData('priority', value)}
        >
          <SelectTrigger className='mt-1'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='high'>高优先级</SelectItem>
            <SelectItem value='medium'>中优先级</SelectItem>
            <SelectItem value='low'>低优先级</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor='businessValue'>业务价值</Label>
        <Textarea
          id='businessValue'
          placeholder='描述这个 Story 为业务带来的价值...'
          value={storyData.businessValue}
          onChange={e => updateStoryData('businessValue', e.target.value)}
          rows={3}
          className='mt-1'
        />
      </div>

      <div>
        <Label htmlFor='technicalNotes'>技术备注</Label>
        <Textarea
          id='technicalNotes'
          placeholder='技术实现相关的备注和考虑...'
          value={storyData.technicalNotes}
          onChange={e => updateStoryData('technicalNotes', e.target.value)}
          rows={3}
          className='mt-1'
        />
      </div>
    </div>
  )
}
