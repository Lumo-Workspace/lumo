import { apiFetch } from './base'

export interface ApiTeam {
  id: string
  name: string
  identifier: string
  isDefault: boolean
  sprintCadenceDays: number | null
}

interface TeamListResult {
  teams: ApiTeam[]
}

export const teamsClient = {
  list() {
    return apiFetch<TeamListResult>('/api/teams')
  },
}
