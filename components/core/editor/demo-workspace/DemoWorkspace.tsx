'use client'

/**
 * DemoWorkspace - Demo 工作区组件
 *
 * 使用 dynamic import 加载 DemoWorkspaceContainer，
 * 提供代码分割和加载状态。
 * 主要用于 demo 页面展示完整的工作区功能。
 */

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

const DemoWorkspaceContainer = dynamic(
  () => import('./DemoWorkspaceContainer'),
  {
    ssr: false,
    loading: () => (
      <div className='flex h-screen bg-gray-50 text-gray-800 items-center justify-center'>
        <div className='text-center space-y-4'>
          <Skeleton className='h-16 w-16 rounded-full mx-auto' />
          <Skeleton className='h-4 w-48 mx-auto' />
          <Skeleton className='h-3 w-64 mx-auto' />
        </div>
      </div>
    ),
  }
)

export default function DemoWorkspace() {
  return <DemoWorkspaceContainer />
}
