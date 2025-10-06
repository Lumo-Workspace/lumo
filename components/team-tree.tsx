"use client"
import type { Team, Project, PRD, Epic, Story, Task } from "../hooks/use-teams"
import { 
  ChevronDown, 
  ChevronRight, 
  FileText, 
  FolderOpen, 
  Folder 
} from "lucide-react"

interface TeamTreeProps {
  teams: Record<string, Team>
  currentTeamId: string
  currentProjectId: string
  currentPRDId: string
  currentEpicId: string
  currentStoryId: string
  currentTaskId: string
  onTeamClick: (teamId: string) => void
  onProjectClick: (teamId: string, projectId: string) => void
  onPRDClick: (teamId: string, projectId: string, prdId: string) => void
  onEpicClick: (teamId: string, projectId: string, prdId: string, epicId: string) => void
  onStoryClick: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => void
  onTaskClick: (
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string,
    storyId: string,
    taskId: string,
  ) => void
  onToggleTeamExpansion: (teamId: string) => void
  onToggleProjectExpansion: (teamId: string, projectId: string) => void
  onTogglePRDExpansion: (teamId: string, projectId: string, prdId: string) => void
  onToggleEpicExpansion: (teamId: string, projectId: string, prdId: string, epicId: string) => void
  onToggleStoryExpansion: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => void
}

export default function TeamTree({
  teams,
  currentTeamId,
  currentProjectId,
  currentPRDId,
  currentEpicId,
  currentStoryId,
  currentTaskId,
  onTeamClick,
  onProjectClick,
  onPRDClick,
  onEpicClick,
  onStoryClick,
  onTaskClick,
  onToggleTeamExpansion,
  onToggleProjectExpansion,
  onTogglePRDExpansion,
  onToggleEpicExpansion,
  onToggleStoryExpansion,
}: TeamTreeProps) {
  // Simplified render function similar to PageTree
  const renderItem = (item: any, type: 'team' | 'project' | 'prd' | 'epic' | 'story' | 'task', level = 0) => {
    // Only show selection for the deepest level that has a selection
    const isSelected = 
      (type === 'team' && currentTeamId === item.id && !currentProjectId) ||
      (type === 'project' && currentProjectId === item.id && !currentPRDId) ||
      (type === 'prd' && currentPRDId === item.id && !currentEpicId) ||
      (type === 'epic' && currentEpicId === item.id && !currentStoryId) ||
      (type === 'story' && currentStoryId === item.id && !currentTaskId) ||
      (type === 'task' && currentTaskId === item.id)

    const hasChildren = type === 'team' ? item.projects?.length > 0 : 
                       type === 'project' ? item.prds?.length > 0 :
                       type === 'prd' ? item.epics?.length > 0 :
                       type === 'epic' ? item.stories?.length > 0 :
                       type === 'story' ? item.tasks?.length > 0 : false

    const handleClick = () => {
      if (type === 'team') onTeamClick(item.id)
      else if (type === 'project') onProjectClick(item.teamId, item.id)
      else if (type === 'prd') onPRDClick(item.teamId, item.projectId, item.id)
      else if (type === 'epic') onEpicClick(item.teamId, item.projectId, item.prdId, item.id)
      else if (type === 'story') onStoryClick(item.teamId, item.projectId, item.prdId, item.epicId, item.id)
      else if (type === 'task') onTaskClick(item.teamId, item.projectId, item.prdId, item.epicId, item.storyId, item.id)
    }

    const handleToggle = () => {
      if (type === 'team') onToggleTeamExpansion(item.id)
      else if (type === 'project') onToggleProjectExpansion(item.teamId, item.id)
      else if (type === 'prd') onTogglePRDExpansion(item.teamId, item.projectId, item.id)
      else if (type === 'epic') onToggleEpicExpansion(item.teamId, item.projectId, item.prdId, item.id)
      else if (type === 'story') onToggleStoryExpansion(item.teamId, item.projectId, item.prdId, item.epicId, item.id)
    }

    return (
      <div key={item.id} className="my-0.5">
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer -mx-2 ${
            isSelected ? "bg-blue-100" : ""
          }`}
          onClick={handleClick}
        >
          <div style={{ paddingLeft: `${level * 12}px` }} className="flex items-center gap-1">
            {hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggle()
                }}
                className="p-0.5 rounded"
              >
                {item.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            )}
            {!hasChildren && <div className="w-5" />}
            {hasChildren ? (
              item.isExpanded ? (
                <FolderOpen className="w-4 h-4 flex-shrink-0 text-gray-600" fill="none" />
              ) : (
                <Folder className="w-4 h-4 flex-shrink-0 text-gray-600" fill="none" />
              )
            ) : (
              <FileText
                className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-blue-600" : "text-gray-600"}`}
                fill={isSelected ? "currentColor" : "none"}
              />
            )}
          </div>
          <span 
            style={{ 
              color: '#1a1a1a',
              fontSize: '14px',
              backgroundColor: 'transparent',
              textShadow: 'none',
              display: 'block'
            }}
          >
            {item.title}
          </span>
        </div>

        {hasChildren && item.isExpanded && (
          <div>
            {type === 'team' && item.projects.map((project: Project) => 
              renderItem({...project, teamId: item.id}, 'project', level + 1)
            )}
            {type === 'project' && item.prds.map((prd: PRD) => 
              renderItem({...prd, teamId: item.teamId, projectId: item.id}, 'prd', level + 1)
            )}
            {type === 'prd' && item.epics.map((epic: Epic) => 
              renderItem({...epic, teamId: item.teamId, projectId: item.projectId, prdId: item.id}, 'epic', level + 1)
            )}
            {type === 'epic' && item.stories.map((story: Story) => 
              renderItem({...story, teamId: item.teamId, projectId: item.projectId, prdId: item.prdId, epicId: item.id}, 'story', level + 1)
            )}
            {type === 'story' && item.tasks.map((task: Task) => 
              renderItem({...task, teamId: item.teamId, projectId: item.projectId, prdId: item.prdId, epicId: item.epicId, storyId: item.id}, 'task', level + 1)
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-0">
      <div className="group">
        {Object.values(teams).map((team) => (
          <div key={team.id} className="my-0.5">
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer -mx-2 ${
                currentTeamId === team.id && !currentProjectId ? "bg-blue-100" : ""
              }`}
              onClick={() => onTeamClick(team.id)}
            >
              <div style={{ paddingLeft: `0px` }} className="flex items-center gap-1">
                {team.projects.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleTeamExpansion(team.id)
                    }}
                    className="p-0.5 rounded"
                  >
                    {team.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                {team.projects.length === 0 && <div className="w-5" />}
                {team.projects.length > 0 ? (
                  team.isExpanded ? (
                    <FolderOpen className="w-4 h-4 flex-shrink-0 text-gray-600" fill="none" />
                  ) : (
                    <Folder className="w-4 h-4 flex-shrink-0 text-gray-600" fill="none" />
                  )
                ) : (
                  <FileText
                    className={`w-4 h-4 flex-shrink-0 ${currentTeamId === team.id ? "text-blue-600" : "text-gray-600"}`}
                    fill={currentTeamId === team.id ? "currentColor" : "none"}
                  />
                )}
              </div>
              <div 
                ref={(el) => {
                  if (el) {
                    el.style.setProperty('color', '#1a1a1a', 'important');
                    el.style.setProperty('font-size', '14px', 'important');
                    el.style.setProperty('background-color', 'transparent', 'important');
                    el.style.setProperty('display', 'block', 'important');
                  }
                }}
                style={{ 
                  color: '#1a1a1a',
                  fontSize: '14px',
                  backgroundColor: 'transparent',
                  textShadow: 'none',
                  display: 'block'
                }}
              >
                {team.name}
              </div>
            </div>

            {team.projects.length > 0 && team.isExpanded && (
              <div>
                {team.projects.map((project: Project) => 
                  renderItem({...project, teamId: team.id}, 'project', 1)
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}