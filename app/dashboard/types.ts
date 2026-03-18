export type Priority = 'P0' | 'P1' | 'P2';
export type Status = 'Todo' | 'In Progress' | 'Review' | 'Done' | 'Backlog';

export interface User {
  id: string;
  name: string;
  avatar: string;
  initials: string;
}

export interface Task {
  id: string;
  title: string;
  status: Status;
  assignee: User;
  priority: Priority;
  updatedAt: string;
  description?: string;
  subtasks?: string[];
  projectId?: string;
}

export interface Project {
  id: string;
  title: string;
  icon: string;
  taskCount: number;
  inProgressCount: number;
  updatedAt: string;
  description?: string;
}

export interface Notification {
  id: string;
  type: 'mention' | 'review_request' | 'assignment' | 'comment' | 'status_change' | 'merge';
  user: User;
  targetId: string; // ENG-142, PR-451, etc.
  content?: string;
  timestamp: string;
  isUnread: boolean;
  metadata?: any;
}
