'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  DndContext, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  useDroppable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  LayoutGrid, 
  Inbox, 
  Home, 
  Layers, 
  Settings, 
  Search, 
  Plus, 
  MoreHorizontal, 
  Edit2, 
  ChevronRight,
  RotateCcw,
  X,
  CheckCircle2,
  MessageSquare,
  GitMerge,
  UserPlus,
  ArrowRightLeft,
  FileText,
  AtSign,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { USERS, PROJECTS, TASKS, NOTIFICATIONS } from './constants';
import { Task, Project, Status, Priority, Notification } from './types';

// --- Components ---

const SortableTaskCard = ({ task, isOverlay }: { task: Task, isOverlay?: boolean, key?: string }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging && !isOverlay ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className={cn(
        "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing",
        isOverlay && "shadow-xl border-blue-500/50 rotate-2 cursor-grabbing"
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-mono text-zinc-400">{task.id}</span>
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 className="text-sm font-medium mb-4 leading-relaxed line-clamp-2">{task.title}</h4>
      <div className="flex justify-end">
        <Avatar src={task.assignee.avatar} size="sm" />
      </div>
    </div>
  );
};

const BoardColumn = ({ status, tasks, sensors, handleDragEnd, onAddTask }: { 
  status: Status, 
  tasks: Task[], 
  sensors: any,
  handleDragEnd: (event: DragEndEvent) => void,
  onAddTask: () => void,
  key?: string
}) => {
  const { setNodeRef } = useDroppable({
    id: status,
  });

  return (
    <div ref={setNodeRef} className="w-80 flex flex-col min-w-[320px]">
      <div className="flex items-center justify-between px-1 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{status}</span>
          <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            {tasks.filter(t => t.status === status).length}
          </span>
        </div>
        <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
          <MoreHorizontal size={14} />
        </button>
      </div>
      <SortableContext 
        id={status}
        items={tasks.filter(t => t.status === status).map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 space-y-3 min-h-[200px]">
          {tasks.filter(t => t.status === status).map(task => (
            <SortableTaskCard key={task.id} task={task} />
          ))}
          <button 
            onClick={onAddTask}
            className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 mt-1 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Plus size={16} />
            Add task
          </button>
        </div>
      </SortableContext>
    </div>
  );
};

const SidebarItem = ({ 
  icon: Icon, 
  label, 
  active, 
  onClick, 
  shortcut, 
  badge 
}: { 
  icon: any, 
  label: string, 
  active?: boolean, 
  onClick?: () => void,
  shortcut?: string,
  badge?: boolean
}) => (
  <button 
    onClick={onClick}
    className={cn(
      "w-full flex items-center justify-between px-3 py-2 rounded-md transition-all duration-200 group",
      active 
        ? "bg-zinc-100 text-zinc-900 font-semibold dark:bg-zinc-800 dark:text-zinc-50" 
        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900"
    )}
  >
    <div className="flex items-center gap-3">
      <Icon size={20} />
      <span className="text-sm font-medium">{label}</span>
    </div>
    {shortcut && <span className="text-[10px] text-zinc-400 font-mono">{shortcut}</span>}
    {badge && <span className="size-2 bg-blue-500 rounded-full"></span>}
  </button>
);

const Avatar = ({ src, initials, size = "md", className }: { src?: string, initials?: string, size?: "sm" | "md" | "lg", className?: string }) => {
  const sizeClasses = {
    sm: "size-5 text-[8px]",
    md: "size-7 text-[10px]",
    lg: "size-10 text-[14px]"
  };
  
  return (
    <div className={cn(
      "rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center font-bold overflow-hidden shrink-0",
      sizeClasses[size],
      className
    )}>
      {src ? (
        <img src={src} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
};

const StatusDot = ({ status }: { status: Status }) => {
  const colors: Record<Status, string> = {
    'Todo': 'bg-zinc-300 dark:bg-zinc-600',
    'In Progress': 'bg-blue-500',
    'Review': 'bg-purple-500',
    'Done': 'bg-emerald-500',
    'Backlog': 'bg-zinc-400'
  };
  return <span className={cn("size-2 rounded-full", colors[status])}></span>;
};

const PriorityBadge = ({ priority }: { priority: Priority }) => {
  const styles: Record<Priority, string> = {
    'P0': 'text-red-600 bg-red-50 border-red-100 dark:bg-red-950/30 dark:border-red-900/50',
    'P1': 'text-orange-600 bg-orange-50 border-orange-100 dark:bg-orange-950/30 dark:border-orange-900/50',
    'P2': 'text-zinc-600 bg-zinc-50 border-zinc-100 dark:bg-zinc-800 dark:border-zinc-700'
  };
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium border", styles[priority])}>
      {priority}
    </span>
  );
};

// --- Modals ---

const Modal = ({ isOpen, onClose, title, children, footer }: { isOpen: boolean, onClose: () => void, title: React.ReactNode, children: React.ReactNode, footer?: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-[640px] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-900 flex items-center justify-end">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  );
};

// --- Main App ---

// Type for tasks returned from GET /api/tasks/me
type WorkspaceMemberInfo = {
  id: string;        // WorkspaceMember.id — used as assigneeId
  clerkId: string;
  role: string;
  name: string;
  imageUrl: string | null;
};

type MyTask = {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  projectId: string;
  project: { id: string; name: string };
  updatedAt: string;
};

// Type for projects returned from GET /api/projects
type ApiProject = {
  id: string;
  name: string;
  description: string | null;
  isIdea: boolean;
  updatedAt: string;
  createdAt: string;
  _count: { tasks: number };
  inProgressCount: number;
};

// Type for tasks returned from GET /api/projects/[id]/tasks (flattened)
type ApiTask = {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  projectId: string;
  parentTaskId: string | null;
  updatedAt: string;
};

// Flatten task tree to a list
function flattenTasks(nodes: (ApiTask & { children?: ApiTask[] })[]): ApiTask[] {
  const result: ApiTask[] = [];
  function walk(list: (ApiTask & { children?: ApiTask[] })[]) {
    for (const node of list) {
      const { children, ...task } = node as ApiTask & { children?: ApiTask[] };
      result.push(task);
      if (children?.length) walk(children);
    }
  }
  walk(nodes);
  return result;
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(TASKS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<'my-tasks' | 'inbox' | 'projects' | 'project-detail' | 'tos' | 'privacy'>('projects');
  const [selectedProject, setSelectedProject] = useState<ApiProject | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState<'TODO' | 'IN_PROGRESS' | 'DONE'>('TODO');
  const [newTaskProjectId, setNewTaskProjectId] = useState<string>('');
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState<string>('');
  const [newTaskLoading, setNewTaskLoading] = useState(false);
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectLoading, setNewProjectLoading] = useState(false);
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const [isAIDraftModalOpen, setIsAIDraftModalOpen] = useState(false);
  const [aiDraftSource, setAiDraftSource] = useState<'task' | 'project' | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // ─── Stale-while-revalidate helpers ────────────────────────────────────────
  // Track whether each dataset has been fetched at least once.
  // On subsequent fetches we skip the loading spinner and update silently.
  const myTasksSeeded    = useRef(false);
  const projectsSeeded   = useRef(false);
  const projectTasksSeeded = useRef(false);

  // My Tasks
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [myTasksLoading, setMyTasksLoading] = useState(false);
  const [myTasksError, setMyTasksError] = useState<string | null>(null);

  const fetchMyTasks = useCallback(async () => {
    if (!myTasksSeeded.current) setMyTasksLoading(true);
    setMyTasksError(null);
    try {
      const res = await fetch('/api/tasks/me');
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json() as { tasks: MyTask[] };
      setMyTasks(data.tasks);
      myTasksSeeded.current = true;
    } catch {
      if (!myTasksSeeded.current) setMyTasksError('Could not load your tasks.');
    } finally {
      setMyTasksLoading(false);
    }
  }, []);

  // Projects list
  const [apiProjects, setApiProjects] = useState<ApiProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!projectsSeeded.current) setProjectsLoading(true);
    setProjectsError(null);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json() as { projects: ApiProject[] };
      setApiProjects(data.projects);
      projectsSeeded.current = true;
    } catch {
      if (!projectsSeeded.current) setProjectsError('Could not load projects.');
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // Workspace members (for assignee picker)
  const membersSeeded = useRef(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberInfo[]>([]);

  const fetchMembers = useCallback(async () => {
    if (membersSeeded.current) return; // fetch once per session
    try {
      const res = await fetch('/api/workspaces/members');
      if (!res.ok) return;
      const data = await res.json() as { members: WorkspaceMemberInfo[] };
      setWorkspaceMembers(data.members);
      membersSeeded.current = true;
    } catch {
      // non-critical — assignee picker just stays empty
    }
  }, []);

  // Project detail tasks
  const [projectTasks, setProjectTasks] = useState<ApiTask[]>([]);
  const [projectTasksLoading, setProjectTasksLoading] = useState(false);
  const [projectTasksError, setProjectTasksError] = useState<string | null>(null);

  const fetchProjectTasks = useCallback(async (projectId: string) => {
    if (!projectTasksSeeded.current) setProjectTasksLoading(true);
    setProjectTasksError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`);
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json() as { tasks: (ApiTask & { children?: ApiTask[] })[] };
      setProjectTasks(flattenTasks(data.tasks));
      projectTasksSeeded.current = true;
    } catch {
      if (!projectTasksSeeded.current) setProjectTasksError('Could not load tasks.');
    } finally {
      setProjectTasksLoading(false);
    }
  }, []);

  // ─── Optimistic create project ──────────────────────────────────────────────
  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;

    // 1. Close modal + reset form immediately
    setIsNewProjectModalOpen(false);
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectError(null);

    // 2. Insert optimistic placeholder
    const tempId = `optimistic-${Date.now()}`;
    const now = new Date().toISOString();
    const optimistic: ApiProject = {
      id: tempId,
      name,
      description: newProjectDescription.trim() || null,
      isIdea: false,
      createdAt: now,
      updatedAt: now,
      _count: { tasks: 0 },
      inProgressCount: 0,
    };
    setApiProjects(prev => [optimistic, ...prev]);

    // 3. Navigate to detail page right away
    setSelectedProject(optimistic);
    setCurrentPage('project-detail');

    // 4. Fire API in background
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: newProjectDescription.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Failed to create project');
      }
      const { project } = await res.json() as { project: ApiProject };
      const confirmed: ApiProject = { ...project, _count: { tasks: 0 }, inProgressCount: 0 };

      // Replace temp with confirmed
      setApiProjects(prev => prev.map(p => p.id === tempId ? confirmed : p));
      setSelectedProject(prev => prev?.id === tempId ? confirmed : prev);
    } catch (e) {
      // Rollback
      setApiProjects(prev => prev.filter(p => p.id !== tempId));
      setNewProjectError(e instanceof Error ? e.message : 'Something went wrong');
      setIsNewProjectModalOpen(true);   // Reopen modal with error
      setNewProjectName(name);
      setNewProjectDescription(optimistic.description ?? '');
      setCurrentPage('projects');
    }
  }, [newProjectName, newProjectDescription]);

  // ─── Optimistic create task ─────────────────────────────────────────────────
  const handleCreateTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    const projectId = newTaskProjectId || selectedProject?.id || '';
    if (!title || !projectId) return;

    // 1. Close modal + reset form immediately
    setIsNewTaskModalOpen(false);
    setNewTaskTitle('');
    setNewTaskDescription('');
    setNewTaskStatus('TODO');
    setNewTaskAssigneeId('');
    setNewTaskError(null);

    // 2. Optimistic task
    const tempId = `optimistic-task-${Date.now()}`;
    const now = new Date().toISOString();
    const optimistic: ApiTask = {
      id: tempId,
      title,
      status: newTaskStatus,
      priority: 'MEDIUM',
      projectId,
      parentTaskId: null,
      updatedAt: now,
    };
    if (projectId === selectedProject?.id) {
      setProjectTasks(prev => [...prev, optimistic]);
    }

    // 3. Fire API
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: newTaskDescription.trim() || undefined,
          status: newTaskStatus,
          assigneeId: newTaskAssigneeId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Failed to create task');
      }
      const { task } = await res.json() as { task: ApiTask };
      // Replace optimistic with confirmed
      setProjectTasks(prev => prev.map(t => t.id === tempId ? task : t));
      // Update project task count
      setApiProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, _count: { tasks: p._count.tasks + 1 } } : p
      ));
    } catch (e) {
      // Rollback
      setProjectTasks(prev => prev.filter(t => t.id !== tempId));
      setNewTaskError(e instanceof Error ? e.message : 'Something went wrong');
      setNewTaskTitle(title);
      setNewTaskProjectId(projectId);
      setNewTaskAssigneeId(newTaskAssigneeId);
      setIsNewTaskModalOpen(true);
    }
  }, [newTaskTitle, newTaskDescription, newTaskStatus, newTaskProjectId, newTaskAssigneeId, selectedProject]);

  useEffect(() => {
    if (currentPage === 'my-tasks') fetchMyTasks();
    if (currentPage === 'projects') fetchProjects();
  }, [currentPage, fetchMyTasks, fetchProjects]);

  // Fetch members the first time the task modal opens
  useEffect(() => {
    if (isNewTaskModalOpen) fetchMembers();
  }, [isNewTaskModalOpen, fetchMembers]);

  useEffect(() => {
    if (currentPage === 'project-detail' && selectedProject) {
      // Reset seed when switching to a different project
      projectTasksSeeded.current = false;
      fetchProjectTasks(selectedProject.id);
    }
  }, [currentPage, selectedProject?.id, fetchProjectTasks]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find(t => t.id === activeId);
    if (!activeTask) return;

    const statuses: Status[] = ['Todo', 'In Progress', 'Review', 'Done'];
    
    // If over a column
    if (statuses.includes(overId as Status)) {
      if (activeTask.status !== overId) {
        setTasks(prev => prev.map(task => 
          task.id === activeId ? { ...task, status: overId as Status } : task
        ));
      }
      return;
    }

    // If over another task
    const overTask = tasks.find(t => t.id === overId);
    if (overTask && activeTask.status !== overTask.status) {
      setTasks(prev => prev.map(task => 
        task.id === activeId ? { ...task, status: overTask.status } : task
      ));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find(t => t.id === activeId);
    const overTask = tasks.find(t => t.id === overId);

    if (activeTask && overTask && activeId !== overId && activeTask.status === overTask.status) {
      setTasks((items) => {
        const oldIndex = items.findIndex(t => t.id === activeId);
        const newIndex = items.findIndex(t => t.id === overId);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const renderContent = () => {
    switch (currentPage) {
      case 'projects':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0">
              <h2 className="text-sm font-semibold">Projects</h2>
              <div className="flex items-center gap-4">
                <div className="relative w-64">
                  <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    className="w-full bg-zinc-100/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md py-1.5 pl-9 pr-4 text-xs focus:ring-1 focus:ring-zinc-400 transition-all outline-none"
                    placeholder="Search projects..."
                    type="text"
                  />
                </div>
                <button
                  onClick={() => setIsNewProjectModalOpen(true)}
                  className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  New Project
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto">
              {projectsLoading ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400">Loading…</div>
              ) : projectsError ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <p className="text-sm text-red-500">{projectsError}</p>
                  <button onClick={fetchProjects} className="text-xs text-zinc-500 underline">Retry</button>
                </div>
              ) : apiProjects.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400">No projects yet. Create one to get started.</div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-950 z-10">
                    <tr>
                      <th className="text-left py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">Project</th>
                      <th className="text-left py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">Tasks</th>
                      <th className="text-left py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">In Progress</th>
                      <th className="text-right py-3 px-6 text-xs font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {apiProjects.map(project => (
                      <tr
                        key={project.id}
                        onClick={() => { setSelectedProject(project); setCurrentPage('project-detail'); }}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group"
                      >
                        <td className="py-4 px-6 border-b border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center gap-3">
                            <span className="font-medium group-hover:text-blue-500 transition-colors">{project.name}</span>
                            {project.isIdea && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800">Draft</span>
                            )}
                          </div>
                          {project.description && (
                            <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-xs">{project.description}</p>
                          )}
                        </td>
                        <td className="py-4 px-6 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                            {project._count.tasks} tasks
                          </span>
                        </td>
                        <td className="py-4 px-6 border-b border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center gap-2">
                            <div className="size-2 rounded-full bg-blue-500"></div>
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
      case 'project-detail':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-8 pt-6">
              <nav className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500 font-medium mb-3">
                <span className="hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer" onClick={() => setCurrentPage('projects')}>Projects</span>
                <span className="text-zinc-300 dark:text-zinc-800">/</span>
                <span className="text-zinc-900 dark:text-zinc-100">{selectedProject?.name}</span>
              </nav>
            </div>
            <header className="pb-4 px-8 flex items-start justify-between shrink-0">
              <div className="flex items-start gap-4">
                <div className="size-10 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <Layers size={18} className="text-zinc-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">{selectedProject?.name}</h2>
                    {selectedProject?.isIdea && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800">Draft</span>
                    )}
                    <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors p-1">
                      <Edit2 size={14} />
                    </button>
                    <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors p-1">
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  {selectedProject?.description && (
                    <p className="text-sm text-zinc-500 mt-0.5">{selectedProject.description}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setIsNewTaskModalOpen(true)}
                className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold px-4 py-2 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Plus size={18} />
                Create Task
              </button>
            </header>
            <div className="h-12 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-8 shrink-0 bg-white dark:bg-zinc-950">
              <div className="flex items-center gap-1">
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                  <LayoutGrid size={16} />
                  Filter
                </button>
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                  <ArrowRightLeft size={16} className="rotate-90" />
                  Sort
                </button>
              </div>
              <div className="flex items-center p-1 bg-zinc-100 dark:bg-zinc-900 rounded-md">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded transition-all",
                    viewMode === 'list' ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  <Layers size={16} />
                  List
                </button>
                <button
                  onClick={() => setViewMode('board')}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded transition-all",
                    viewMode === 'board' ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  <LayoutGrid size={16} />
                  Board
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {projectTasksLoading ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400">Loading…</div>
              ) : projectTasksError ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <p className="text-sm text-red-500">{projectTasksError}</p>
                  <button onClick={() => selectedProject && fetchProjectTasks(selectedProject.id)} className="text-xs text-zinc-500 underline">Retry</button>
                </div>
              ) : projectTasks.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400">No tasks yet.</div>
              ) : viewMode === 'list' ? (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10">
                    <tr>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 min-w-[300px]">Title</th>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-32">Status</th>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-24">Priority</th>
                      <th className="text-right py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 pr-8">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {projectTasks.map(task => (
                      <tr key={task.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group">
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center gap-2">
                            {task.parentTaskId && <span className="w-3 h-px bg-zinc-300 dark:bg-zinc-700 inline-block" />}
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 transition-colors">{task.title}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center gap-2">
                            <StatusDot status={task.status as Status} />
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">
                              {task.status === 'IN_PROGRESS' ? 'In Progress' : task.status === 'TODO' ? 'Todo' : 'Done'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <PriorityBadge priority={task.priority as Priority} />
                        </td>
                        <td className="py-2.5 px-8 text-xs text-zinc-400 text-right border-b border-zinc-200 dark:border-zinc-800 pr-8">
                          {new Date(task.updatedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex gap-4 p-6 overflow-x-auto h-full items-start">
                  {(['TODO', 'IN_PROGRESS', 'DONE'] as const).map(status => {
                    const col = projectTasks.filter(t => t.status === status);
                    const label = status === 'TODO' ? 'Todo' : status === 'IN_PROGRESS' ? 'In Progress' : 'Done';
                    return (
                      <div key={status} className="w-72 shrink-0 flex flex-col">
                        <div className="flex items-center gap-2 mb-3 px-1">
                          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</span>
                          <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{col.length}</span>
                        </div>
                        <div className="space-y-2 min-h-[80px]">
                          {col.map(task => (
                            <div key={task.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg hover:shadow-md transition-shadow cursor-pointer">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-mono text-zinc-400">{task.id.slice(0, 8)}</span>
                                <PriorityBadge priority={task.priority as Priority} />
                              </div>
                              <p className="text-sm font-medium leading-relaxed line-clamp-2">{task.title}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      case 'inbox':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0">
              <h2 className="text-sm font-semibold">Inbox</h2>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input 
                    className="w-full bg-zinc-100/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md py-1.5 pl-9 pr-4 text-xs focus:ring-1 focus:ring-zinc-400 transition-all outline-none" 
                    placeholder="Search notifications..." 
                    type="text" 
                  />
                </div>
                <button className="text-zinc-600 dark:text-zinc-400 text-xs font-medium px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                  Mark all as read
                </button>
              </div>
            </header>
            <div className="px-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center shrink-0">
              <div className="flex gap-8">
                <button className="py-3.5 text-sm font-medium text-zinc-900 dark:text-zinc-50 border-zinc-900 dark:border-zinc-50 border-b-2">All</button>
                <button className="py-3.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors">
                  Mentions <span className="ml-1 text-xs text-zinc-400 font-normal">(2)</span>
                </button>
                <button className="py-3.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors">
                  Review Requests <span className="ml-1 text-xs text-zinc-400 font-normal">(1)</span>
                </button>
                <button className="py-3.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors">Assignments</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-5xl mx-auto py-10 px-6 lg:px-12 space-y-12">
                <section>
                  <div className="flex items-center gap-4 mb-6">
                    <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Today</h3>
                    <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800"></div>
                  </div>
                  <div className="space-y-1">
                    {NOTIFICATIONS.map(notif => (
                      <div key={notif.id} className="group relative flex items-start gap-4 p-4 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                        {notif.isUnread && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full"></div>}
                        <div className="relative shrink-0">
                          <Avatar src={notif.user.avatar} size="lg" />
                          <div className="absolute -bottom-1 -right-1 size-4.5 rounded-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center">
                            {notif.type === 'mention' && <AtSign size={11} className="text-blue-500 font-bold" />}
                            {notif.type === 'review_request' && <RotateCcw size={11} className="text-purple-500 font-bold" />}
                            {notif.type === 'assignment' && <FileText size={11} className="text-amber-500 font-bold" />}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-[14px] text-zinc-600 dark:text-zinc-400">
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{notif.user.name}</span>
                              {notif.type === 'mention' && <> mentioned you on <span className="font-mono text-[12px] text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800">{notif.targetId}</span></>}
                              {notif.type === 'review_request' && <> requested review on <span className="text-blue-500 hover:underline cursor-pointer font-medium">{notif.targetId}</span></>}
                              {notif.type === 'assignment' && <> assigned you to <span className="font-mono text-[12px] text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800">{notif.targetId}</span></>}
                            </p>
                            <span className="text-[11px] text-zinc-400">{notif.timestamp}</span>
                          </div>
                          {notif.content && (
                            <div className="mt-3 text-[14px] text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-md border border-zinc-100 dark:border-zinc-800 p-4 leading-relaxed">
                              {notif.content}
                            </div>
                          )}
                          {notif.metadata && (
                            <div className="mt-2.5 flex items-center gap-3">
                              <span className="text-[11px] px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 flex items-center gap-1.5">
                                <RotateCcw size={13} />
                                {notif.metadata.branch}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-emerald-600 font-semibold">+{notif.metadata.additions}</span>
                                <span className="text-[11px] text-rose-600 font-semibold">-{notif.metadata.deletions}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <div className="flex justify-center pt-8">
                  <button className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 uppercase tracking-[0.2em] transition-colors">
                    View archived notifications
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      case 'my-tasks':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-8 pt-6">
              <nav className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500 font-medium mb-3">
                <span className="text-zinc-900 dark:text-zinc-100">My Tasks</span>
              </nav>
            </div>
            <header className="pb-4 px-8 flex items-start justify-between shrink-0">
              <div className="flex items-start gap-4">
                <div className="size-10 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 text-lg">
                  <Home size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">My Tasks</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">Tasks assigned to you across all projects.</p>
                </div>
              </div>
              <button
                onClick={fetchMyTasks}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 px-3 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Refresh
              </button>
            </header>
            <div className="h-12 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-8 shrink-0 bg-white dark:bg-zinc-950">
              <div className="flex items-center gap-1">
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                  <LayoutGrid size={16} />
                  Filter
                </button>
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                  <ArrowRightLeft size={16} className="rotate-90" />
                  Sort
                </button>
              </div>
              <div className="flex items-center p-1 bg-zinc-100 dark:bg-zinc-900 rounded-md">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded transition-all",
                    viewMode === 'list' ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  <Layers size={16} />
                  List
                </button>
                <button
                  onClick={() => setViewMode('board')}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded transition-all",
                    viewMode === 'board' ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  <LayoutGrid size={16} />
                  Board
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {myTasksLoading ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400">Loading…</div>
              ) : myTasksError ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <p className="text-sm text-red-500">{myTasksError}</p>
                  <button onClick={fetchMyTasks} className="text-xs text-zinc-500 underline">Retry</button>
                </div>
              ) : myTasks.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400">No tasks assigned to you.</div>
              ) : viewMode === 'list' ? (
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10">
                    <tr>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 min-w-[300px]">Title</th>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-40">Project</th>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-32">Status</th>
                      <th className="text-left py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 w-24">Priority</th>
                      <th className="text-right py-2 px-8 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 pr-8">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {myTasks.map(task => (
                      <tr key={task.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group">
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 transition-colors">{task.title}</span>
                        </td>
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-xs text-zinc-500">{task.project.name}</span>
                        </td>
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center gap-2">
                            <StatusDot status={task.status as Status} />
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">
                              {task.status === 'IN_PROGRESS' ? 'In Progress' : task.status === 'TODO' ? 'Todo' : 'Done'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800">
                          <PriorityBadge priority={task.priority as Priority} />
                        </td>
                        <td className="py-2.5 px-8 text-xs text-zinc-400 text-right border-b border-zinc-200 dark:border-zinc-800 pr-8">
                          {new Date(task.updatedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex gap-4 p-6 overflow-x-auto h-full items-start">
                  {(['TODO', 'IN_PROGRESS', 'DONE'] as const).map(status => {
                    const col = myTasks.filter(t => t.status === status);
                    const label = status === 'TODO' ? 'Todo' : status === 'IN_PROGRESS' ? 'In Progress' : 'Done';
                    return (
                      <div key={status} className="w-72 shrink-0 flex flex-col">
                        <div className="flex items-center gap-2 mb-3 px-1">
                          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</span>
                          <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{col.length}</span>
                        </div>
                        <div className="space-y-2 min-h-[80px]">
                          {col.map(task => (
                            <div key={task.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg hover:shadow-md transition-shadow cursor-pointer">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] text-zinc-400 truncate max-w-[120px]">{task.project.name}</span>
                                <PriorityBadge priority={task.priority as Priority} />
                              </div>
                              <p className="text-sm font-medium leading-relaxed line-clamp-2">{task.title}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      case 'tos':
        return (
          <div className="flex-1 overflow-y-auto p-12 max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
            <div className="prose dark:prose-invert space-y-6 text-zinc-600 dark:text-zinc-400">
              <p>Welcome to Lumo. By using our services, you agree to the following terms...</p>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">1. Acceptance of Terms</h2>
              <p>By accessing or using Lumo, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">2. Use License</h2>
              <p>Permission is granted to temporarily download one copy of the materials on Lumo's website for personal, non-commercial transitory viewing only.</p>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">3. Disclaimer</h2>
              <p>The materials on Lumo's website are provided on an 'as is' basis. Lumo makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.</p>
            </div>
          </div>
        );
      case 'privacy':
        return (
          <div className="flex-1 overflow-y-auto p-12 max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
            <div className="prose dark:prose-invert space-y-6 text-zinc-600 dark:text-zinc-400">
              <p>Your privacy is important to us. It is Lumo's policy to respect your privacy regarding any information we may collect from you across our website...</p>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">1. Information We Collect</h2>
              <p>We only ask for personal information when we truly need it to provide a service to you. We collect it by fair and lawful means, with your knowledge and consent.</p>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">2. Use of Information</h2>
              <p>We only retain collected information for as long as necessary to provide you with your requested service.</p>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">3. Data Security</h2>
              <p>What data we store, we'll protect within commercially acceptable means to prevent loss and theft, as well as unauthorized access, disclosure, copying, use or modification.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col shrink-0">
        <div className="p-4 mb-2 flex items-center gap-3">
          <div className="size-8 bg-zinc-900 dark:bg-zinc-100 rounded flex items-center justify-center text-white dark:text-zinc-900">
            <Layers size={20} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Lumo</h1>
            <p className="text-[11px] text-zinc-500 font-medium">Engineering OS</p>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          <div className="mb-4">
            <SidebarItem
              icon={Home}
              label="My Tasks"
              active={currentPage === 'my-tasks'}
              onClick={() => setCurrentPage('my-tasks')}
              shortcut="⌘1"
            />
          </div>
          <div className="space-y-1">
            <p className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Workspace</p>
            <SidebarItem
              icon={Layers}
              label="Projects"
              active={currentPage === 'projects' || currentPage === 'project-detail'}
              onClick={() => setCurrentPage('projects')}
            />
          </div>
        </nav>
        <div className="p-3 mt-auto border-t border-zinc-200 dark:border-zinc-800">
          <SidebarItem 
            icon={isDarkMode ? Sparkles : Settings} 
            label={isDarkMode ? "Dark Mode" : "Settings"} 
            onClick={() => setIsDarkMode(!isDarkMode)}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderContent()}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isNewTaskModalOpen && (
          <Modal
            isOpen={isNewTaskModalOpen}
            onClose={() => {
              setIsNewTaskModalOpen(false);
              setNewTaskTitle('');
              setNewTaskDescription('');
              setNewTaskStatus('TODO');
              setNewTaskError(null);
            }}
            title="New task"
            footer={
              <div className="flex items-center gap-3 ml-auto">
                {newTaskError && <p className="text-xs text-red-500 mr-auto">{newTaskError}</p>}
                <button
                  onClick={() => {
                    setIsNewTaskModalOpen(false);
                    setNewTaskTitle('');
                    setNewTaskDescription('');
                    setNewTaskStatus('TODO');
                    setNewTaskError(null);
                  }}
                  disabled={newTaskLoading}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTask}
                  disabled={newTaskLoading || !newTaskTitle.trim() || !(newTaskProjectId || selectedProject?.id)}
                  className="px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {newTaskLoading ? 'Creating…' : 'Create task ⏎'}
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <input
                autoFocus
                className="w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0"
                placeholder="Task title"
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleCreateTask(); }}
              />
              <textarea
                className="w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 focus:ring-0 resize-none leading-relaxed min-h-[80px] font-sans"
                placeholder="Add description..."
                rows={4}
                value={newTaskDescription}
                onChange={e => setNewTaskDescription(e.target.value)}
              />
              {/* Status + Project selectors */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                {/* Status */}
                <select
                  value={newTaskStatus}
                  onChange={e => setNewTaskStatus(e.target.value as 'TODO' | 'IN_PROGRESS' | 'DONE')}
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300"
                >
                  <option value="TODO">Todo</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
                {/* Project */}
                <select
                  value={newTaskProjectId || selectedProject?.id || ''}
                  onChange={e => setNewTaskProjectId(e.target.value)}
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300 max-w-[180px] truncate"
                >
                  {apiProjects.length === 0 && <option value="">No projects</option>}
                  {apiProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {/* Assignee */}
                <select
                  value={newTaskAssigneeId}
                  onChange={e => setNewTaskAssigneeId(e.target.value)}
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-300 max-w-[180px] truncate"
                >
                  <option value="">Unassigned</option>
                  {workspaceMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </Modal>
        )}

        {isAIDraftModalOpen && (
          <Modal 
            isOpen={isAIDraftModalOpen} 
            onClose={() => setIsAIDraftModalOpen(false)} 
            title={
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-zinc-900 dark:text-zinc-100" />
                <span>AI Project Draft</span>
                <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Draft</span>
              </div>
            }
            footer={
              <div className="flex items-center justify-between w-full">
                <button className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
                  <RotateCcw size={16} />
                  Regenerate
                </button>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      setIsAIDraftModalOpen(false);
                      if (aiDraftSource === 'task') setIsNewTaskModalOpen(true);
                      if (aiDraftSource === 'project') setIsNewProjectModalOpen(true);
                      setAiDraftSource(null);
                    }} 
                    className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    Discard
                  </button>
                  <button className="px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">
                    Create Project
                  </button>
                </div>
              </div>
            }
          >
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Search Caching Infrastructure</h2>
                <p className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  To address current performance bottlenecks, we will introduce a distributed caching layer designed to significantly reduce search latency across all global regions. By leveraging Redis clusters, we aim to provide a highly available and low-latency data store for frequently accessed search queries. 
                </p>
                <p className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Our primary success metric is achieving a p95 latency of less than 200ms. The project is structured into three distinct phases: architectural design, core implementation, and post-deployment monitoring to validate performance gains and ensure system stability.
                </p>
              </div>

              <div className="space-y-4">
                <h4 className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Suggested Issues</h4>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      <span className="text-zinc-400">-</span>
                      Implement Redis cache
                    </div>
                    <div className="pl-6 space-y-2">
                      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                        Setup Redis cluster
                      </div>
                      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                        Configure TTL policy
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-zinc-400">-</span>
                    Design caching architecture
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-zinc-400">-</span>
                    Add cache invalidation triggers
                  </div>
                </div>
              </div>
            </div>
          </Modal>
        )}

        {isNewProjectModalOpen && (
          <Modal
            isOpen={isNewProjectModalOpen}
            onClose={() => {
              setIsNewProjectModalOpen(false);
              setNewProjectName('');
              setNewProjectDescription('');
              setNewProjectError(null);
            }}
            title="New Project"
            footer={
              <div className="flex items-center gap-3">
                {newProjectError && (
                  <p className="text-xs text-red-500 mr-auto">{newProjectError}</p>
                )}
                <button
                  onClick={() => {
                    setIsNewProjectModalOpen(false);
                    setNewProjectName('');
                    setNewProjectDescription('');
                    setNewProjectError(null);
                  }}
                  disabled={newProjectLoading}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={newProjectLoading || !newProjectName.trim()}
                  className="px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {newProjectLoading ? 'Creating…' : 'Create Project ⏎'}
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <input
                autoFocus
                className="w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0"
                placeholder="Project title"
                type="text"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleCreateProject(); }}
              />
              <div className="relative">
                <textarea
                  className="w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 focus:ring-0 resize-none leading-relaxed min-h-[120px] font-sans"
                  placeholder="Add description..."
                  rows={6}
                  value={newProjectDescription}
                  onChange={e => setNewProjectDescription(e.target.value)}
                />
                <div className="flex justify-start mt-2">
                  <button
                    onClick={() => {
                      setAiDraftSource('project');
                      setIsNewProjectModalOpen(false);
                      setIsAIDraftModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-500 hover:text-blue-600 transition-colors"
                  >
                    <Sparkles size={14} />
                    Refine with AI
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
