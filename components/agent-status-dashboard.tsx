"use client"

import { Label } from "@/components/ui/label"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Agent {
  id: string
  name: string
  role: "PM" | "UX" | "Dev" | "QA" | "BA"
  avatar: string
  status: "active" | "thinking" | "reviewing" | "idle" | "offline"
  currentTask?: string
  expertise: string[]
  workload: number // 0-100
  efficiency: number // 0-100
  lastActivity: string
  completedTasks: number
  pendingTasks: number
  collaborationScore: number // 0-100
}

interface AgentRecommendation {
  agentId: string
  reason: string
  confidence: number
  taskType: string
}

interface AgentStatusDashboardProps {
  agents: Agent[]
  onAgentSelect?: (agentId: string) => void
  onRecommendationAccept?: (recommendation: AgentRecommendation) => void
}

export default function AgentStatusDashboard({
  agents,
  onAgentSelect,
  onRecommendationAccept,
}: AgentStatusDashboardProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState<AgentRecommendation[]>([])

  // Simulate real-time agent status updates
  useEffect(() => {
    const interval = setInterval(() => {
      // This would normally come from a real-time data source
      // TODO: Implement real-time status updates
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  // Generate AI recommendations for agent selection
  useEffect(() => {
    const generateRecommendations = () => {
      const mockRecommendations: AgentRecommendation[] = [
        {
          agentId: "agent-1",
          reason: "具有丰富的用户体验设计经验，当前工作负载较低",
          confidence: 92,
          taskType: "UI设计",
        },
        {
          agentId: "agent-2",
          reason: "在后端开发方面表现优秀，协作评分最高",
          confidence: 88,
          taskType: "API开发",
        },
        {
          agentId: "agent-3",
          reason: "测试覆盖率专家，可以提供质量保证建议",
          confidence: 85,
          taskType: "质量检查",
        },
      ]
      setRecommendations(mockRecommendations)
    }

    generateRecommendations()
  }, [agents])

  const getStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "active":
        return "bg-green-500"
      case "thinking":
        return "bg-yellow-500"
      case "reviewing":
        return "bg-blue-500"
      case "idle":
        return "bg-gray-400"
      case "offline":
        return "bg-red-500"
    }
  }

  const getStatusText = (status: Agent["status"]) => {
    switch (status) {
      case "active":
        return "活跃"
      case "thinking":
        return "思考中"
      case "reviewing":
        return "评审中"
      case "idle":
        return "空闲"
      case "offline":
        return "离线"
    }
  }

  const getRoleColor = (role: Agent["role"]) => {
    switch (role) {
      case "PM":
        return "bg-purple-100 text-purple-800"
      case "UX":
        return "bg-pink-100 text-pink-800"
      case "Dev":
        return "bg-blue-100 text-blue-800"
      case "QA":
        return "bg-green-100 text-green-800"
      case "BA":
        return "bg-orange-100 text-orange-800"
    }
  }

  const getWorkloadColor = (workload: number) => {
    if (workload >= 80) return "text-red-600"
    if (workload >= 60) return "text-yellow-600"
    return "text-green-600"
  }

  const getEfficiencyColor = (efficiency: number) => {
    if (efficiency >= 80) return "text-green-600"
    if (efficiency >= 60) return "text-yellow-600"
    return "text-red-600"
  }

  const activeAgents = agents.filter((agent) => agent.status !== "offline")
  const availableAgents = agents.filter((agent) => agent.status === "idle" || agent.workload < 70)
  const busyAgents = agents.filter((agent) => agent.workload >= 80)

  const averageEfficiency = agents.reduce((sum, agent) => sum + agent.efficiency, 0) / agents.length
  const totalTasks = agents.reduce((sum, agent) => sum + agent.completedTasks + agent.pendingTasks, 0)
  const completedTasks = agents.reduce((sum, agent) => sum + agent.completedTasks, 0)

  const selectedAgentData = selectedAgent ? agents.find((a) => a.id === selectedAgent) : null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Agent 状态仪表板</h2>
          <p className="text-gray-600 mt-1">实时监控所有 Agent 的状态和活动</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full" />
            <span>{activeAgents.length} 在线</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full" />
            <span>{availableAgents.length} 可用</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full" />
            <span>{busyAgents.length} 繁忙</span>
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 text-lg">👥</span>
              </div>
              <div>
                <p className="text-sm text-gray-600">总 Agent 数</p>
                <p className="text-2xl font-bold">{agents.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-green-600 text-lg">📊</span>
              </div>
              <div>
                <p className="text-sm text-gray-600">平均效率</p>
                <p className="text-2xl font-bold">{Math.round(averageEfficiency)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <span className="text-purple-600 text-lg">✅</span>
              </div>
              <div>
                <p className="text-sm text-gray-600">完成任务</p>
                <p className="text-2xl font-bold">{completedTasks}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                <span className="text-yellow-600 text-lg">⏳</span>
              </div>
              <div>
                <p className="text-sm text-gray-600">任务完成率</p>
                <p className="text-2xl font-bold">{Math.round((completedTasks / totalTasks) * 100)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">总览</TabsTrigger>
          <TabsTrigger value="recommendations">AI 推荐</TabsTrigger>
          <TabsTrigger value="performance">性能分析</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Agent List */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Agent 列表</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {agents.map((agent) => (
                      <div
                        key={agent.id}
                        className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                          selectedAgent === agent.id ? "bg-blue-50 border-blue-200" : "hover:bg-gray-50"
                        }`}
                        onClick={() => {
                          setSelectedAgent(agent.id)
                          onAgentSelect?.(agent.id)
                        }}
                      >
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <Avatar className="w-12 h-12">
                              <AvatarFallback className={getRoleColor(agent.role)}>{agent.avatar}</AvatarFallback>
                            </Avatar>
                            <div
                              className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${getStatusColor(agent.status)}`}
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-medium truncate">{agent.name}</h3>
                              <Badge variant="outline" className="text-xs">
                                {agent.role}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {getStatusText(agent.status)}
                              </Badge>
                            </div>

                            {agent.currentTask && (
                              <p className="text-sm text-blue-600 truncate mb-2">{agent.currentTask}</p>
                            )}

                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <div className="flex items-center gap-1">
                                <span>工作负载:</span>
                                <span className={getWorkloadColor(agent.workload)}>{agent.workload}%</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span>效率:</span>
                                <span className={getEfficiencyColor(agent.efficiency)}>{agent.efficiency}%</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span>协作:</span>
                                <span>{agent.collaborationScore}%</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-sm font-medium">{agent.completedTasks}</div>
                            <div className="text-xs text-gray-500">已完成</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Agent Details */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Agent 详情</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedAgentData ? (
                    <div className="space-y-4">
                      <div className="text-center">
                        <Avatar className="w-16 h-16 mx-auto mb-3">
                          <AvatarFallback className={getRoleColor(selectedAgentData.role)}>
                            {selectedAgentData.avatar}
                          </AvatarFallback>
                        </Avatar>
                        <h3 className="font-medium">{selectedAgentData.name}</h3>
                        <Badge className={getRoleColor(selectedAgentData.role)}>{selectedAgentData.role}</Badge>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <Label className="text-sm font-medium">当前状态</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <div className={`w-2 h-2 rounded-full ${getStatusColor(selectedAgentData.status)}`} />
                            <span className="text-sm">{getStatusText(selectedAgentData.status)}</span>
                          </div>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">工作负载</Label>
                          <div className="mt-1">
                            <Progress value={selectedAgentData.workload} className="h-2" />
                            <span className="text-xs text-gray-500 mt-1">{selectedAgentData.workload}%</span>
                          </div>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">效率评分</Label>
                          <div className="mt-1">
                            <Progress value={selectedAgentData.efficiency} className="h-2" />
                            <span className="text-xs text-gray-500 mt-1">{selectedAgentData.efficiency}%</span>
                          </div>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">专业技能</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {selectedAgentData.expertise.map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">任务统计</Label>
                          <div className="grid grid-cols-2 gap-2 mt-1 text-sm">
                            <div className="bg-green-50 p-2 rounded text-center">
                              <div className="font-medium text-green-800">{selectedAgentData.completedTasks}</div>
                              <div className="text-green-600 text-xs">已完成</div>
                            </div>
                            <div className="bg-yellow-50 p-2 rounded text-center">
                              <div className="font-medium text-yellow-800">{selectedAgentData.pendingTasks}</div>
                              <div className="text-yellow-600 text-xs">进行中</div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">最后活动</Label>
                          <p className="text-sm text-gray-600 mt-1">{selectedAgentData.lastActivity}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <span className="text-gray-400 text-xl">👤</span>
                      </div>
                      <p className="text-gray-500">选择一个 Agent 查看详细信息</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI 智能推荐</CardTitle>
              <p className="text-sm text-gray-600">基于当前工作负载和专业技能的 Agent 推荐</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recommendations.map((rec) => {
                  const agent = agents.find((a) => a.id === rec.agentId)
                  if (!agent) return null

                  return (
                    <div key={rec.agentId} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarFallback className={getRoleColor(agent.role)}>{agent.avatar}</AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-medium">{agent.name}</h3>
                            <Badge variant="outline" className="text-xs">
                              {rec.taskType}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">置信度 {rec.confidence}%</Badge>
                          <Button size="sm" onClick={() => onRecommendationAccept?.(rec)}>
                            采用推荐
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600">{rec.reason}</p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>效率排行</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agents
                    .sort((a, b) => b.efficiency - a.efficiency)
                    .slice(0, 5)
                    .map((agent, index) => (
                      <div key={agent.id} className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </div>
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className={getRoleColor(agent.role)}>{agent.avatar}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{agent.name}</span>
                            <span className="text-sm text-green-600">{agent.efficiency}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>协作评分</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agents
                    .sort((a, b) => b.collaborationScore - a.collaborationScore)
                    .slice(0, 5)
                    .map((agent, index) => (
                      <div key={agent.id} className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </div>
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className={getRoleColor(agent.role)}>{agent.avatar}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{agent.name}</span>
                            <span className="text-sm text-purple-600">{agent.collaborationScore}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
