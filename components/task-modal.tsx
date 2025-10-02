"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface TaskWidget {
  id: string
  title: string
  status: "draft" | "active" | "in-review" | "blocked" | "completed"
  assignee?: string
  dueDate?: Date
  priority: "low" | "medium" | "high"
  description?: string
}

interface TaskModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (task: TaskWidget) => void
  task?: TaskWidget | null
  mode: "create" | "edit"
}

const TaskModal: React.FC<TaskModalProps> = ({ isOpen, onClose, onSave, task, mode }) => {
  const [formData, setFormData] = useState<Partial<TaskWidget>>({
    title: "",
    status: "draft",
    priority: "medium",
    assignee: "",
    description: "",
  })
  const [isLoading, setIsLoading] = useState(false)

  // Sample assignees - in a real app, this would come from an API
  const assignees = ["Sarah Chen", "Mike Johnson", "Alex Rivera", "Emma Davis", "Tom Wilson", "Lisa Park", "David Kim"]

  // Reset form when modal opens/closes or task changes
  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && task) {
        setFormData({
          title: task.title,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee || "",
          dueDate: task.dueDate,
          description: task.description || "",
        })
      } else {
        setFormData({
          title: "",
          status: "draft",
          priority: "medium",
          assignee: "",
          description: "",
        })
      }
    }
  }, [isOpen, mode, task])

  const handleSave = async () => {
    if (!formData.title?.trim()) return

    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      const taskData: TaskWidget = {
        id: task?.id || Date.now().toString(),
        title: formData.title.trim(),
        status: formData.status || "draft",
        priority: formData.priority || "medium",
        assignee: formData.assignee || undefined,
        dueDate: formData.dueDate,
        description: formData.description || undefined,
      }

      onSave(taskData)
      onClose()
    } finally {
      setIsLoading(false)
    }
  }

  const handleFieldChange = (field: keyof TaskWidget, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create New Task" : "Edit Task"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium">
              Task Title *
            </Label>
            <Input
              id="title"
              placeholder="Enter task title..."
              value={formData.title || ""}
              onChange={(e) => handleFieldChange("title", e.target.value)}
              className="w-full"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium">
              Description
            </Label>
            <Textarea
              id="description"
              placeholder="Add task description..."
              value={formData.description || ""}
              onChange={(e) => handleFieldChange("description", e.target.value)}
              className="w-full min-h-[80px] resize-none"
            />
          </div>

          {/* Status and Priority Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Status</Label>
              <Select value={formData.status} onValueChange={(value) => handleFieldChange("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="in-review">In Review</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Priority</Label>
              <Select value={formData.priority} onValueChange={(value) => handleFieldChange("priority", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      Low
                    </div>
                  </SelectItem>
                  <SelectItem value="medium">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                      Medium
                    </div>
                  </SelectItem>
                  <SelectItem value="high">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      High
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignee */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Assignee</Label>
            <Select
              value={formData.assignee || ""}
              onValueChange={(value) => handleFieldChange("assignee", value === "unassigned" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select assignee..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee} value={assignee}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center text-xs font-medium">
                        {assignee.charAt(0).toUpperCase()}
                      </div>
                      {assignee}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !formData.dueDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.dueDate ? format(formData.dueDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.dueDate}
                  onSelect={(date) => handleFieldChange("dueDate", date)}
                  initialFocus
                />
                {formData.dueDate && (
                  <div className="p-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleFieldChange("dueDate", undefined)}
                      className="w-full"
                    >
                      Clear date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!formData.title?.trim() || isLoading} className="min-w-[80px]">
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Saving...
              </div>
            ) : mode === "create" ? (
              "Create Task"
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default TaskModal
