import { User, Task, Project, Notification } from './types';

export const USERS: Record<string, User> = {
  alex: {
    id: 'alex',
    name: 'Alex',
    initials: 'A',
    avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuArlQIWlowLVNCq6WYDdDVxiYsmmAXIfB09AK4IEgjwbGyjuks5yXk9oLc9jvg5e8eGcGQxGrHpjWlaltHOVAQ2oQoICvO941QJxvOrYXktiSpfS3T-UFiRjUgYL-g_qDyoooO2u0qLW5Ptw3JJQltlGbR-4uoRyCyYuC8VjJ-YrOhv9GOUQixnB5WHS_Ozhn3249bEb9bFEIe8XNuDTLasWGP34y2rajvh7Qsdu84lF6t3xl9gSac8lkRozliYkZSwWLq6J2DpFPQ',
  },
  sarah: {
    id: 'sarah',
    name: 'Sarah Chen',
    initials: 'S',
    avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCIUSBSSH_OlSVp8CiSgqVK2IjzR44vh-1hog3KQxXHd8iQpy0yThfirA9w_QDMqLs9w0kGqZ8BuGA8TLQ07AnyDd1Mf6acGpMSCF5bG5aUQ13LWEWbhqJQ2ezR6OAqhRsjmslOofgOqKblGg3OY3d-V8ha_xxdXBiEKVJwugtv1Qc6WfsR6xwSjRZA8bNHwzB4nmrh8G5Mhd_f-pbsFOtAxwUwgDxBNVEoruD7vxGhU03mK7KSNgDp-kUG8WWfGfZO5_Bc7WEtFT0',
  },
  emily: {
    id: 'emily',
    name: 'Emily',
    initials: 'E',
    avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBU6Vr5r9xAl-nuhcRnm6tEkDJ3t9nNmeZOEhKHwqugN5iOR_vp0uNlNTTR_8OibHRIKB3V7lOsMFKDJfRYRiTQg8UEfvVn61jIM1mIKtyKCOlZqoWrsoCp-gCzWlORzIR_Bh7TFI6gIchzkaCTaF4NCW_gS_nHjSDpR6QZNkObbAGfOELG6LUIFAFV4OUeVSBsPnWoJlj1FDk5KkE3uC7yuV6rVjZk7dpAuHHUMVm9-xOYdCJUVr3XZecbBkRYOXJMKR64QPuEWmo',
  },
  michael: {
    id: 'michael',
    name: 'Michael',
    initials: 'M',
    avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCE_Tt7nF3FaMgio7_XmY7s4t3x1op6tkknty64DOwqe5owmjhyPe5KtC2M0ozQQqVIJaeNth7eHIf4ulC5TxtXr4lV-W1JSgrYZV8QVWl3baBF7shpI6CadHBBJyl7HPF2sVds67v2A8nAwuBqnwyd-_7etOmzp_r4IZoK_pEXpQ1Xo7jc0j8UTNyWcnh6wAi_UT_TUfoxCV0rJVBGuzvvtL_lUhiKjQ3gW1OMZCx-BvPU_k-NqGyO8rnFkGBcJjg9D6IzmWCy4Yk',
  },
  mike: {
    id: 'mike',
    name: 'Mike',
    initials: 'M',
    avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBAT8Y_E0XzLTBpmWNlV-Uav9Xl2CxgLa4-pMyRYRhe95mA05qZBJpVicOqSYzvi_27yk_2YzZUCJrXbAdH-ODYKaXZaodh-T4mvmbHg-zZVDVWopvraxMxNzQNzZyFOa-PRH-0beCnqMKzUtFb76qk936C1T6N-FBEt2Aro8rhDL3hdfcqz96TosEaMJ6ppDsohCSTT3Efcz5qKMLJe0FAgHlDR_p2n-cLIAnaliS7XumFNPxpP-GbNPphu4FB97qYBbjCxxq_7sg',
  }
};

export const PROJECTS: Project[] = [
  {
    id: 'checkout-revamp',
    title: 'Checkout Revamp',
    icon: '💳',
    taskCount: 12,
    inProgressCount: 3,
    updatedAt: '2h ago',
    description: 'Modernizing the checkout flow for better conversion.'
  },
  {
    id: 'search-system',
    title: 'Search System',
    icon: '🔍',
    taskCount: 8,
    inProgressCount: 1,
    updatedAt: '1d ago',
    description: 'Improve product search performance'
  },
  {
    id: 'infra-migration',
    title: 'Infra Migration',
    icon: '☁️',
    taskCount: 15,
    inProgressCount: 2,
    updatedAt: '5h ago',
    description: 'Moving services to the new cloud provider.'
  }
];

export const TASKS: Task[] = [
  {
    id: 'ENG-142',
    title: 'Fix search bug',
    status: 'In Progress',
    assignee: USERS.alex,
    priority: 'P1',
    updatedAt: '2h ago',
    description: 'Product search currently queries the database directly. This causes high latency when traffic spikes.',
    projectId: 'search-system'
  },
  {
    id: 'ENG-150',
    title: 'Improve query caching',
    status: 'Review',
    assignee: USERS.sarah,
    priority: 'P0',
    updatedAt: '5h ago',
    projectId: 'search-system'
  },
  {
    id: 'ENG-158',
    title: 'Add fuzzy matching',
    status: 'Todo',
    assignee: USERS.mike,
    priority: 'P2',
    updatedAt: '1d ago',
    projectId: 'search-system'
  }
];

export const NOTIFICATIONS: Notification[] = [
  {
    id: '1',
    type: 'mention',
    user: USERS.sarah,
    targetId: 'ENG-142',
    content: '"Can you check the retry logic?"',
    timestamp: '2h ago',
    isUnread: true
  },
  {
    id: '2',
    type: 'review_request',
    user: USERS.emily,
    targetId: 'PR-451',
    timestamp: '5h ago',
    isUnread: false,
    metadata: { branch: 'feat/auth-v2', additions: 124, deletions: 12 }
  },
  {
    id: '3',
    type: 'assignment',
    user: USERS.michael,
    targetId: 'ENG-150',
    content: 'Implement search caching',
    timestamp: 'Yesterday, 4:30 PM',
    isUnread: false
  }
];
