"use client"
import type { Team, Project, PRD, Epic, Story, Task } from "../hooks/use-teams"

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
  const renderTask = (
    task: Task,
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string,
    storyId: string,
    level: number,
  ) => (
    <div
      key={task.id}
      className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 ${
        currentTaskId === task.id ? "bg-blue-100" : ""
      }`}
      style={{ marginLeft: `${level * 16}px` }}
      onClick={() => onTaskClick(teamId, projectId, prdId, epicId, storyId, task.id)}
    >
      <span className="text-gray-600 flex-shrink-0">☑️</span>
      <span className="text-sm text-gray-900 truncate">{task.title}</span>
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          task.status === "done" ? "bg-green-500" : task.status === "in-progress" ? "bg-yellow-500" : "bg-gray-300"
        }`}
      />
    </div>
  )

  const renderStory = (
    story: Story,
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string,
    level: number,
  ) => (
    <div key={story.id}>
      <div className="flex items-center gap-1" style={{ marginLeft: `${level * 16}px` }}>
        {story.tasks.length > 0 && (
          <button
            onClick={() => onToggleStoryExpansion(teamId, projectId, prdId, epicId, story.id)}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            <span className="text-gray-700">{story.isExpanded ? "▼" : "▶"}</span>
          </button>
        )}
        <div
          className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 flex-1 ${
            currentStoryId === story.id ? "bg-blue-100" : ""
          }`}
          onClick={() => onStoryClick(teamId, projectId, prdId, epicId, story.id)}
        >
          <span className="text-gray-600 flex-shrink-0">📖</span>
          <span className="text-sm text-gray-900 truncate">{story.title}</span>
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              story.status === "done"
                ? "bg-green-500"
                : story.status === "in-progress"
                  ? "bg-yellow-500"
                  : "bg-gray-300"
            }`}
          />
        </div>
      </div>
      {story.isExpanded &&
        story.tasks.map((task) => renderTask(task, teamId, projectId, prdId, epicId, story.id, level + 1))}
    </div>
  )

  const renderEpic = (epic: Epic, teamId: string, projectId: string, prdId: string, level: number) => (
    <div key={epic.id}>
      <div className="flex items-center gap-1" style={{ marginLeft: `${level * 16}px` }}>
        {epic.stories.length > 0 && (
          <button
            onClick={() => onToggleEpicExpansion(teamId, projectId, prdId, epic.id)}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            <span className="text-gray-700">{epic.isExpanded ? "▼" : "▶"}</span>
          </button>
        )}
        <div
          className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 flex-1 ${
            currentEpicId === epic.id ? "bg-blue-100" : ""
          }`}
          onClick={() => onEpicClick(teamId, projectId, prdId, epic.id)}
        >
          <span className="text-gray-600 flex-shrink-0">⚡</span>
          <span className="text-sm text-gray-900 truncate">{epic.title}</span>
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              epic.status === "done" ? "bg-green-500" : epic.status === "in-progress" ? "bg-yellow-500" : "bg-gray-300"
            }`}
          />
        </div>
      </div>
      {epic.isExpanded && epic.stories.map((story) => renderStory(story, teamId, projectId, prdId, epic.id, level + 1))}
    </div>
  )

  const renderPRD = (prd: PRD, teamId: string, projectId: string, level: number) => (
    <div key={prd.id}>
      <div className="flex items-center gap-1" style={{ marginLeft: `${level * 16}px` }}>
        {prd.epics.length > 0 && (
          <button
            onClick={() => onTogglePRDExpansion(teamId, projectId, prd.id)}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            <span className="text-gray-700">{prd.isExpanded ? "▼" : "▶"}</span>
          </button>
        )}
        <div
          className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 flex-1 ${
            currentPRDId === prd.id ? "bg-blue-100" : ""
          }`}
          onClick={() => onPRDClick(teamId, projectId, prd.id)}
        >
          <span className="text-gray-600 flex-shrink-0">📄</span>
          <span className="text-sm text-gray-900 truncate">{prd.title}</span>
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              prd.status === "approved"
                ? "bg-green-500"
                : prd.status === "review"
                  ? "bg-yellow-500"
                  : prd.status === "draft"
                    ? "bg-blue-500"
                    : "bg-gray-300"
            }`}
          />
        </div>
      </div>
      {prd.isExpanded && prd.epics.map((epic) => renderEpic(epic, teamId, projectId, prd.id, level + 1))}
    </div>
  )

  const renderProject = (project: Project, teamId: string, level: number) => (
    <div key={project.id}>
      <div className="flex items-center gap-1" style={{ marginLeft: `${level * 16}px` }}>
        {project.prds.length > 0 && (
          <button
            onClick={() => onToggleProjectExpansion(teamId, project.id)}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            <span className="text-gray-700">{project.isExpanded ? "▼" : "▶"}</span>
          </button>
        )}
        <div
          className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 flex-1 ${
            currentProjectId === project.id ? "bg-blue-100" : ""
          }`}
          onClick={() => onProjectClick(teamId, project.id)}
        >
          <span className="text-gray-600 flex-shrink-0">{project.isExpanded ? "📂" : "📁"}</span>
          <span className="text-sm text-gray-900 truncate">{project.title}</span>
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              project.status === "completed"
                ? "bg-green-500"
                : project.status === "active"
                  ? "bg-blue-500"
                  : project.status === "on-hold"
                    ? "bg-yellow-500"
                    : "bg-gray-300"
            }`}
          />
        </div>
      </div>
      {project.isExpanded && project.prds.map((prd) => renderPRD(prd, teamId, project.id, level + 1))}
    </div>
  )

  const renderTeam = (team: Team) => (
    <div key={team.id} className="mb-2">
      <div className="flex items-center gap-1">
        {team.projects.length > 0 && (
          <button onClick={() => onToggleTeamExpansion(team.id)} className="p-0.5 hover:bg-gray-200 rounded">
            <span className="text-gray-700">{team.isExpanded ? "▼" : "▶"}</span>
          </button>
        )}
        <div
          className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 flex-1 ${
            currentTeamId === team.id ? "bg-blue-100" : ""
          }`}
          onClick={() => onTeamClick(team.id)}
        >
          <span className="text-gray-600 flex-shrink-0">👥</span>
          <span className="text-sm font-medium text-gray-900 truncate">{team.name}</span>
          <span className="text-xs text-gray-500 flex-shrink-0">({team.projects.length})</span>
        </div>
      </div>
      {team.isExpanded && team.projects.map((project) => renderProject(project, team.id, 1))}
    </div>
  )

  return <div className="space-y-1">{Object.values(teams).map(renderTeam)}</div>
}
