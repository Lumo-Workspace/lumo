import { apiFetch } from './base'

export interface ApiTeam {
  id: string
  name: string
  identifier: string
  isDefault: boolean
  sprintsEnabled: boolean
  sprintDurationDays: number
  sprintCooldownDays: number
  sprintStartWeekday: number
  sprintAutoCreate: number
  sprintAutoAddCompleted: boolean
  timezone: string
}

interface TeamListResult {
  teams: ApiTeam[]
}

export const teamsClient = {
  list() {
    return apiFetch<TeamListResult>('/api/teams')
  },
}
