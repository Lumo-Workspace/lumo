'use client'

import { useState } from 'react'

export interface Task {
  id: string
  title: string
  content: string
  status: 'todo' | 'in-progress' | 'done'
  assignee?: string
  dueDate?: string
  createdAt: string
  updatedAt: string
}

export interface Story {
  id: string
  title: string
  content: string
  tasks: Task[]
  status: 'backlog' | 'in-progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt: string
  isExpanded?: boolean
}

export interface Epic {
  id: string
  title: string
  content: string
  stories: Story[]
  status: 'planning' | 'in-progress' | 'done'
  startDate?: string
  endDate?: string
  createdAt: string
  updatedAt: string
  isExpanded?: boolean
}

export interface PRD {
  id: string
  title: string
  content: string
  epics: Epic[]
  version: string
  status: 'draft' | 'review' | 'approved' | 'archived'
  createdAt: string
  updatedAt: string
  isExpanded?: boolean
}

export interface Project {
  id: string
  title: string
  description: string
  prds: PRD[]
  status: 'active' | 'on-hold' | 'completed' | 'archived'
  createdAt: string
  updatedAt: string
  isExpanded?: boolean
}

export interface Team {
  id: string
  name: string
  description: string
  projects: Project[]
  members: string[]
  createdAt: string
  updatedAt: string
  isExpanded?: boolean
}

const initialTeams: Record<string, Team> = {
  'team-1': {
    id: 'team-1',
    name: '产品团队',
    description: '负责产品规划和设计',
    members: ['user1', 'user2', 'user3'],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    isExpanded: true,
    projects: [
      {
        id: 'project-1',
        title: '移动应用开发',
        description: '开发新的移动应用产品',
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        isExpanded: true,
        prds: [
          {
            id: 'prd-1',
            title: '用户认证系统 PRD',
            content:
              '用户认证系统的产品需求文档，包含登录、注册、密码重置等功能的详细说明...',
            version: 'v1.0',
            status: 'approved',
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            isExpanded: true,
            epics: [
              {
                id: 'epic-1',
                title: '用户注册流程',
                content: '实现用户注册的完整流程，包括邮箱验证、手机验证等',
                status: 'in-progress',
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
                isExpanded: true,
                stories: [
                  {
                    id: 'story-1',
                    title: '邮箱注册',
                    content: '用户可以通过邮箱注册账号',
                    status: 'done',
                    priority: 'high',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-01',
                    isExpanded: true,
                    tasks: [
                      {
                        id: 'task-1',
                        title: '设计注册页面',
                        content: '设计用户友好的注册页面UI',
                        status: 'done',
                        assignee: '张设计师',
                        createdAt: '2024-01-01',
                        updatedAt: '2024-01-01',
                      },
                      {
                        id: 'task-2',
                        title: '实现邮箱验证',
                        content: '开发邮箱验证功能',
                        status: 'in-progress',
                        assignee: '李开发',
                        dueDate: '2024-02-15',
                        createdAt: '2024-01-01',
                        updatedAt: '2024-01-01',
                      },
                      {
                        id: 'task-3',
                        title: '添加表单验证',
                        content: '添加前端表单验证逻辑',
                        status: 'todo',
                        assignee: '王前端',
                        dueDate: '2024-02-20',
                        createdAt: '2024-01-01',
                        updatedAt: '2024-01-01',
                      },
                    ],
                  },
                  {
                    id: 'story-2',
                    title: '手机号注册',
                    content: '用户可以通过手机号注册账号',
                    status: 'in-progress',
                    priority: 'medium',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-01',
                    isExpanded: false,
                    tasks: [
                      {
                        id: 'task-4',
                        title: '短信验证接口',
                        content: '集成短信验证服务',
                        status: 'in-progress',
                        assignee: '李开发',
                        dueDate: '2024-02-10',
                        createdAt: '2024-01-01',
                        updatedAt: '2024-01-01',
                      },
                    ],
                  },
                  {
                    id: 'story-3',
                    title: '社交账号登录',
                    content: '支持微信、QQ等社交账号登录',
                    status: 'backlog',
                    priority: 'low',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-01',
                    isExpanded: false,
                    tasks: [],
                  },
                ],
              },
              {
                id: 'epic-2',
                title: '用户登录流程',
                content: '实现用户登录的完整流程',
                status: 'planning',
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
                isExpanded: false,
                stories: [
                  {
                    id: 'story-4',
                    title: '密码登录',
                    content: '用户可以通过用户名密码登录',
                    status: 'backlog',
                    priority: 'high',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-01',
                    isExpanded: false,
                    tasks: [],
                  },
                ],
              },
            ],
          },
          {
            id: 'prd-2',
            title: '用户个人中心 PRD',
            content:
              '用户个人中心功能的产品需求文档，包含个人信息管理、设置等功能...',
            version: 'v1.0',
            status: 'draft',
            createdAt: '2024-01-02',
            updatedAt: '2024-01-02',
            isExpanded: false,
            epics: [
              {
                id: 'epic-3',
                title: '个人信息管理',
                content: '用户可以管理个人信息',
                status: 'planning',
                createdAt: '2024-01-02',
                updatedAt: '2024-01-02',
                isExpanded: false,
                stories: [],
              },
            ],
          },
          {
            id: 'prd-3',
            title: '消息通知系统 PRD',
            content:
              '消息通知系统的产品需求文档，包含站内信、推送通知等功能...',
            version: 'v1.0',
            status: 'review',
            createdAt: '2024-01-03',
            updatedAt: '2024-01-03',
            isExpanded: false,
            epics: [],
          },
        ],
      },
    ],
  },
  'team-2': {
    id: 'team-2',
    name: '技术团队',
    description: '负责技术实现和架构',
    members: ['dev1', 'dev2', 'dev3'],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    isExpanded: false,
    projects: [
      {
        id: 'project-2',
        title: '后端服务优化',
        description: '优化现有后端服务性能',
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        prds: [
          {
            id: 'prd-4',
            title: '数据库优化方案',
            content: '数据库性能优化的技术方案文档...',
            version: 'v1.0',
            status: 'approved',
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            isExpanded: true,
            epics: [
              {
                id: 'epic-4',
                title: '查询优化',
                content: '优化数据库查询性能',
                status: 'in-progress',
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
                isExpanded: true,
                stories: [
                  {
                    id: 'story-5',
                    title: '索引优化',
                    content: '优化数据库索引结构',
                    status: 'done',
                    priority: 'high',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-01',
                    isExpanded: true,
                    tasks: [],
                  },
                  {
                    id: 'story-6',
                    title: '慢查询分析',
                    content: '分析和优化慢查询',
                    status: 'in-progress',
                    priority: 'medium',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-01',
                    isExpanded: false,
                    tasks: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
}

export function useTeams() {
  const [teams, setTeams] = useState<Record<string, Team>>(initialTeams)
  const [currentTeamId, setCurrentTeamId] = useState<string>('')
  const [currentProjectId, setCurrentProjectId] = useState<string>('')
  const [currentPRDId, setCurrentPRDId] = useState<string>('')
  const [currentEpicId, setCurrentEpicId] = useState<string>('')
  const [currentStoryId, setCurrentStoryId] = useState<string>('')
  const [currentTaskId, setCurrentTaskId] = useState<string>('')

  const getCurrentTeam = () => teams[currentTeamId]
  const getCurrentProject = () => {
    const team = getCurrentTeam()
    return team?.projects.find(p => p.id === currentProjectId)
  }
  const getCurrentPRD = () => {
    const project = getCurrentProject()
    return project?.prds.find(p => p.id === currentPRDId)
  }
  const getCurrentEpic = () => {
    const prd = getCurrentPRD()
    return prd?.epics.find(e => e.id === currentEpicId)
  }
  const getCurrentStory = () => {
    const epic = getCurrentEpic()
    return epic?.stories.find(s => s.id === currentStoryId)
  }
  const getCurrentTask = () => {
    const story = getCurrentStory()
    return story?.tasks.find(t => t.id === currentTaskId)
  }

  const toggleTeamExpansion = (teamId: string) => {
    setTeams(prev => {
      const team = prev[teamId]
      if (!team) return prev
      return {
        ...prev,
        [teamId]: { ...team, isExpanded: !team.isExpanded },
      }
    })
  }

  const toggleProjectExpansion = (teamId: string, projectId: string) => {
    setTeams(prev => {
      const team = prev[teamId]
      if (!team) return prev

      const updatedProjects = team.projects.map(project =>
        project.id === projectId
          ? { ...project, isExpanded: !project.isExpanded }
          : project
      )

      return {
        ...prev,
        [teamId]: {
          ...team,
          projects: updatedProjects,
        },
      }
    })
  }

  const createNewTeam = (name: string, description: string) => {
    const newTeamId = `team-${Date.now()}`
    const newTeam: Team = {
      id: newTeamId,
      name,
      description,
      members: [],
      projects: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isExpanded: true,
    }

    setTeams(prev => ({ ...prev, [newTeamId]: newTeam }))
    return newTeamId
  }

  const createNewProject = (
    teamId: string,
    title: string,
    description: string
  ) => {
    const newProjectId = `project-${Date.now()}`
    const newProject: Project = {
      id: newProjectId,
      title,
      description,
      prds: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isExpanded: false,
    }

    setTeams(prev => {
      const team = prev[teamId]
      if (!team) return prev

      return {
        ...prev,
        [teamId]: {
          ...team,
          projects: [...team.projects, newProject],
          isExpanded: true,
        },
      }
    })
    return newProjectId
  }

  const updateItemStatus = (itemId: string, newStatus: string) => {
    setTeams(prev => {
      const updatedTeams = { ...prev }

      // Find and update the item across all teams
      Object.keys(updatedTeams).forEach(teamId => {
        const team = updatedTeams[teamId]
        if (!team) return

        // Update PRDs
        team.projects.forEach(project => {
          project.prds.forEach(prd => {
            if (prd.id === itemId) {
              prd.status = newStatus as PRD['status']
              prd.updatedAt = new Date().toISOString()
            }

            // Update Epics
            prd.epics.forEach(epic => {
              if (epic.id === itemId) {
                epic.status = newStatus as Epic['status']
                epic.updatedAt = new Date().toISOString()
              }

              // Update Stories
              epic.stories.forEach(story => {
                if (story.id === itemId) {
                  story.status = newStatus as Story['status']
                  story.updatedAt = new Date().toISOString()
                }

                // Update Tasks
                story.tasks.forEach(task => {
                  if (task.id === itemId) {
                    task.status = newStatus as Task['status']
                    task.updatedAt = new Date().toISOString()
                  }
                })
              })
            })
          })
        })
      })

      return updatedTeams
    })
  }

  const togglePRDExpansion = (
    teamId: string,
    projectId: string,
    prdId: string
  ) => {
    setTeams(prev => {
      const team = prev[teamId]
      if (!team) return prev

      const updatedProjects = team.projects.map(project =>
        project.id === projectId
          ? {
              ...project,
              prds: project.prds.map(prd =>
                prd.id === prdId ? { ...prd, isExpanded: !prd.isExpanded } : prd
              ),
            }
          : project
      )

      return {
        ...prev,
        [teamId]: {
          ...team,
          projects: updatedProjects,
        },
      }
    })
  }

  const toggleEpicExpansion = (
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string
  ) => {
    setTeams(prev => {
      const team = prev[teamId]
      if (!team) return prev

      const updatedProjects = team.projects.map(project =>
        project.id === projectId
          ? {
              ...project,
              prds: project.prds.map(prd =>
                prd.id === prdId
                  ? {
                      ...prd,
                      epics: prd.epics.map(epic =>
                        epic.id === epicId
                          ? { ...epic, isExpanded: !epic.isExpanded }
                          : epic
                      ),
                    }
                  : prd
              ),
            }
          : project
      )

      return {
        ...prev,
        [teamId]: {
          ...team,
          projects: updatedProjects,
        },
      }
    })
  }

  const toggleStoryExpansion = (
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string,
    storyId: string
  ) => {
    setTeams(prev => {
      const team = prev[teamId]
      if (!team) return prev

      const updatedProjects = team.projects.map(project =>
        project.id === projectId
          ? {
              ...project,
              prds: project.prds.map(prd =>
                prd.id === prdId
                  ? {
                      ...prd,
                      epics: prd.epics.map(epic =>
                        epic.id === epicId
                          ? {
                              ...epic,
                              stories: epic.stories.map(story =>
                                story.id === storyId
                                  ? { ...story, isExpanded: !story.isExpanded }
                                  : story
                              ),
                            }
                          : epic
                      ),
                    }
                  : prd
              ),
            }
          : project
      )

      return {
        ...prev,
        [teamId]: {
          ...team,
          projects: updatedProjects,
        },
      }
    })
  }

  return {
    teams,
    currentTeamId,
    currentProjectId,
    currentPRDId,
    currentEpicId,
    currentStoryId,
    currentTaskId,
    setCurrentTeamId,
    setCurrentProjectId,
    setCurrentPRDId,
    setCurrentEpicId,
    setCurrentStoryId,
    setCurrentTaskId,
    getCurrentTeam,
    getCurrentProject,
    getCurrentPRD,
    getCurrentEpic,
    getCurrentStory,
    getCurrentTask,
    toggleTeamExpansion,
    toggleProjectExpansion,
    togglePRDExpansion,
    toggleEpicExpansion,
    toggleStoryExpansion,
    createNewTeam,
    createNewProject,
    updateItemStatus,
    setTeams,
  }
}
