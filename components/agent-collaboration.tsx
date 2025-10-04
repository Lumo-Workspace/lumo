"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"

interface Agent {
  id: string
  name: string
  role: "PM" | "UX" | "Dev" | "QA" | "BA"
  avatar: string
  status: "active" | "thinking" | "reviewing" | "idle"
  expertise: string[]
  currentTask?: string
}

interface AgentRequirement {
  agentId: string
  requirement: string
  priority: "high" | "medium" | "low"
  status: "pending" | "approved" | "rejected" | "needs_revision"
  timestamp: string
  comments?: string
}

interface CollaborationSession {
  id: string
  title: string
  description: string
  agents: Agent[]
  requirements: AgentRequirement[]
  consensusLevel: number
  status: "active" | "completed" | "paused"
}

interface AgentCollaborationProps {
  session: CollaborationSession
  onRequirementUpdate: (requirementId: string, status: AgentRequirement["status"], comments?: string) => void
  onConsensusReached: (finalRequirements: AgentRequirement[]) => void
  onClose: () => void
}

export default function AgentCollaboration({
  session,
  onRequirementUpdate,
  onConsensusReached,
  onClose,
}: AgentCollaborationProps) {
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [newRequirement, setNewRequirement] = useState("")
  const [selectedPriority, setSelectedPriority] = useState<"high" | "medium" | "low">("medium")

  // Simulate agent activity
  useEffect(() => {
    const interval = setInterval(() => {
      // Randomly update agent statuses to simulate activity
      const randomAgent = session.agents[Math.floor(Math.random() * session.agents.length)]
      const statuses: Agent["status"][] = ["active", "thinking", "reviewing", "idle"]
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]

      // This would normally update the agent status in the parent component
      // TODO: Update agent status in parent component
    }, 3000)

    return () => clearInterval(interval)
  }, [session.agents])

  const getAgentStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "active":
        return "bg-green-500"
      case "thinking":
        return "bg-yellow-500"
      case "reviewing":
        return "bg-blue-500"
      case "idle":
        return "bg-gray-400"
    }
  }

  const getAgentStatusText = (status: Agent["status"]) => {
    switch (status) {
      case "active":
        return "活跃"
      case "thinking":
        return "思考中"
      case "reviewing":
        return "评审中"
      case "idle":
        return "空闲"
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

  const getPriorityColor = (priority: "high" | "medium" | "low") => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-800"
      case "medium":
        return "bg-yellow-100 text-yellow-800"
      case "low":
        return "bg-green-100 text-green-800"
    }
  }

  const getStatusColor = (status: AgentRequirement["status"]) => {
    switch (status) {
      case "pending":
        return "bg-gray-100 text-gray-800"
      case "approved":
        return "bg-green-100 text-green-800"
      case "rejected":
        return "bg-red-100 text-red-800"
      case "needs_revision":
        return "bg-yellow-100 text-yellow-800"
    }
  }

  const handleAddRequirement = () => {
    if (!activeAgent || !newRequirement.trim()) return

    const requirement: AgentRequirement = {
      agentId: activeAgent,
      requirement: newRequirement,
      priority: selectedPriority,
      status: "pending",
      timestamp: new Date().toISOString(),
    }

    // This would normally be handled by the parent component
    // TODO: Handle new requirement in parent component
    setNewRequirement("")
  }

  const approvedRequirements = session.requirements.filter((req) => req.status === "approved")
  const pendingRequirements = session.requirements.filter((req) => req.status === "pending")

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">多 Agent 协作平台</h2>
            <p className="text-gray-600 mt-1">{session.title}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="font-medium">共识度：</span>
              <span className="ml-2">{session.consensusLevel}%</span>
            </div>
            <Progress value={session.consensusLevel} className="w-24" />
            <Button variant="ghost" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Agents */}
          <div className="w-1/4 border-r p-6 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">协作 Agent</h3>
            <div className="space-y-3">
              {session.agents.map((agent) => (
                <Card
                  key={agent.id}
                  className={`cursor-pointer transition-colors ${
                    activeAgent === agent.id ? "ring-2 ring-blue-500" : ""
                  }`}
                  onClick={() => setActiveAgent(agent.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback className={getRoleColor(agent.role)}>{agent.avatar}</AvatarFallback>
                        </Avatar>
                        <div
                          className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getAgentStatusColor(agent.status)}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm truncate">{agent.name}</h4>
                          <Badge variant="outline" className="text-xs">
                            {agent.role}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500">{getAgentStatusText(agent.status)}</p>
                        {agent.currentTask && <p className="text-xs text-blue-600 truncate">{agent.currentTask}</p>}
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="flex flex-wrap gap-1">
                        {agent.expertise.slice(0, 2).map((skill, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                        {agent.expertise.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{agent.expertise.length - 2}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {activeAgent && (
              <div className="mt-6">
                <h4 className="font-medium mb-3">添加需求</h4>
                <Textarea
                  placeholder="输入新的需求或建议..."
                  value={newRequirement}
                  onChange={(e) => setNewRequirement(e.target.value)}
                  rows={3}
                  className="mb-3"
                />
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">优先级：</span>
                  {(["high", "medium", "low"] as const).map((priority) => (
                    <Button
                      key={priority}
                      variant={selectedPriority === priority ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedPriority(priority)}
                    >
                      {priority === "high" ? "高" : priority === "medium" ? "中" : "低"}
                    </Button>
                  ))}
                </div>
                <Button onClick={handleAddRequirement} size="sm" className="w-full">
                  添加需求
                </Button>
              </div>
            )}
          </div>

          {/* Middle Panel - Requirements */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">需求列表</h3>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>{approvedRequirements.length} 已批准</span>
                <span>•</span>
                <span>{pendingRequirements.length} 待处理</span>
              </div>
            </div>

            <div className="space-y-4">
              {session.requirements.map((requirement) => {
                const agent = session.agents.find((a) => a.id === requirement.agentId)
                return (
                  <Card key={`${requirement.agentId}-${requirement.timestamp}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className={agent ? getRoleColor(agent.role) : "bg-gray-100"}>
                            {agent?.avatar || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-sm">{agent?.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {agent?.role}
                            </Badge>
                            <Badge className={`text-xs ${getPriorityColor(requirement.priority)}`}>
                              {requirement.priority === "high" ? "高" : requirement.priority === "medium" ? "中" : "低"}
                            </Badge>
                            <Badge className={`text-xs ${getStatusColor(requirement.status)}`}>
                              {requirement.status === "pending"
                                ? "待处理"
                                : requirement.status === "approved"
                                  ? "已批准"
                                  : requirement.status === "rejected"
                                    ? "已拒绝"
                                    : "需修订"}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-700 mb-2">{requirement.requirement}</p>
                          {requirement.comments && (
                            <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">{requirement.comments}</p>
                          )}
                          <div className="flex items-center gap-2 mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onRequirementUpdate(`${requirement.agentId}-${requirement.timestamp}`, "approved")
                              }
                              disabled={requirement.status === "approved"}
                            >
                              批准
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onRequirementUpdate(
                                  `${requirement.agentId}-${requirement.timestamp}`,
                                  "needs_revision",
                                  "需要进一步细化",
                                )
                              }
                              disabled={requirement.status === "approved"}
                            >
                              需修订
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onRequirementUpdate(
                                  `${requirement.agentId}-${requirement.timestamp}`,
                                  "rejected",
                                  "不符合当前需求",
                                )
                              }
                              disabled={requirement.status === "approved"}
                            >
                              拒绝
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* Right Panel - Consensus & Summary */}
          <div className="w-1/4 border-l p-6 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">共识状态</h3>

            <Card className="mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">整体进度</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>需求收集</span>
                      <span>85%</span>
                    </div>
                    <Progress value={85} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>评审进度</span>
                      <span>60%</span>
                    </div>
                    <Progress value={60} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>共识达成</span>
                      <span>{session.consensusLevel}%</span>
                    </div>
                    <Progress value={session.consensusLevel} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">质量互审</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>技术可行性</span>
                    <Badge variant="outline" className="text-xs">
                      已审核
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>用户体验</span>
                    <Badge variant="outline" className="text-xs">
                      审核中
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>业务价值</span>
                    <Badge variant="outline" className="text-xs">
                      待审核
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>测试覆盖</span>
                    <Badge variant="outline" className="text-xs">
                      待审核
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Button
                className="w-full"
                disabled={session.consensusLevel < 80}
                onClick={() => onConsensusReached(approvedRequirements)}
              >
                达成共识并继续
              </Button>
              <Button variant="outline" className="w-full bg-transparent">
                保存当前进度
              </Button>
              <Button variant="ghost" className="w-full" onClick={onClose}>
                暂停协作
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
