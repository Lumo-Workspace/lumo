'use client';

import { Search, Plus } from 'lucide-react';
import { ApiProject } from '../../types';

interface ProjectsPageProps {
  projects: ApiProject[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectProject: (project: ApiProject) => void;
  onNewProject: () => void;
}

export function ProjectsPage({
  projects,
  loading,
  error,
  onRetry,
  onSelectProject,
  onNewProject,
}: ProjectsPageProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0">
        <h2 className="text-sm font-semibold">Projects</h2>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              className="w-full bg-zinc-100/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md py-1.5 pl-9 pr-4 text-xs focus:ring-1 focus:ring-zinc-400 transition-all outline-none"
              placeholder="Search projects..."
              type="text"
            />
          </div>
          <button
            onClick={onNewProject}
            className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Plus size={14} />
            New Project
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-zinc-400">
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={onRetry} className="text-xs text-zinc-500 underline">
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-zinc-400">
            No projects yet. Create one to get started.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white dark:bg-zinc-950 z-10">
              <tr>
                <th className="text-left py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                  Project
                </th>
                <th className="text-left py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                  Tasks
                </th>
                <th className="text-left py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                  In Progress
                </th>
                <th className="text-right py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {projects.map(project => (
                <tr
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group"
                >
                  <td className="py-4 px-6 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                      <span className="font-medium group-hover:text-blue-500 transition-colors">
                        {project.name}
                      </span>
                      {project.isIdea && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800">
                          Draft
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-xs">
                        {project.description}
                      </p>
                    )}
                  </td>
                  <td className="py-4 px-6 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      {project._count.tasks} tasks
                    </span>
                  </td>
                  <td className="py-4 px-6 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full bg-blue-500" />
                      <span className="text-xs">{project.inProgressCount} in progress</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-right text-zinc-500 text-xs border-b border-zinc-200 dark:border-zinc-800">
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
