'use client'

import React, { useState } from 'react'
import { MermaidDiagram } from '@/components/core/editor/mermaid/mermaid-diagram'

export default function MermaidTestPage() {
  const [diagramContent, setDiagramContent] = useState(`graph TD
    A[开始] --> B{是否登录?}
    B -->|是| C[显示主页]
    B -->|否| D[显示登录页]
    D --> E[用户输入凭据]
    E --> F{验证成功?}
    F -->|是| C
    F -->|否| G[显示错误信息]
    G --> D
    C --> H[结束]`)

  return (
    <div className='min-h-screen bg-gray-50 p-8'>
      <div className='max-w-4xl mx-auto'>
        <h1 className='text-3xl font-bold text-gray-900 mb-8'>
          Mermaid 流程图测试
        </h1>

        <div className='bg-white rounded-lg shadow-sm border border-gray-200 p-6'>
          <h2 className='text-xl font-semibold text-gray-800 mb-4'>
            示例流程图
          </h2>
          <MermaidDiagram
            content={diagramContent}
            onUpdate={setDiagramContent}
          />
        </div>

        <div className='mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6'>
          <h2 className='text-xl font-semibold text-gray-800 mb-4'>其他示例</h2>

          <div className='space-y-6'>
            <div>
              <h3 className='text-lg font-medium text-gray-700 mb-2'>时序图</h3>
              <MermaidDiagram
                content={`sequenceDiagram
    participant A as 用户
    participant B as 前端
    participant C as 后端
    participant D as 数据库
    
    A->>B: 点击登录
    B->>C: 发送登录请求
    C->>D: 查询用户信息
    D-->>C: 返回用户数据
    C-->>B: 返回登录结果
    B-->>A: 显示登录状态`}
              />
            </div>

            <div>
              <h3 className='text-lg font-medium text-gray-700 mb-2'>甘特图</h3>
              <MermaidDiagram
                content={`gantt
    title 项目开发计划
    dateFormat  YYYY-MM-DD
    section 设计阶段
    需求分析           :done,    des1, 2024-01-01,2024-01-07
    原型设计           :active,  des2, 2024-01-08, 3d
    section 开发阶段
    前端开发           :         dev1, after des2, 5d
    后端开发           :         dev2, after des2, 5d
    section 测试阶段
    功能测试           :         test1, after dev1, 3d
    性能测试           :         test2, after dev2, 3d`}
              />
            </div>

            <div>
              <h3 className='text-lg font-medium text-gray-700 mb-2'>类图</h3>
              <MermaidDiagram
                content={`classDiagram
    class User {
        +String name
        +String email
        +login()
        +logout()
    }
    
    class Admin {
        +String role
        +manageUsers()
    }
    
    class Database {
        +save()
        +find()
        +delete()
    }
    
    User <|-- Admin
    User --> Database`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
