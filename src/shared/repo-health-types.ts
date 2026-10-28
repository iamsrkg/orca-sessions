export type RepoHealthCi = {
  name: string
  status: string
  conclusion: string | null
  url: string
  createdAt: string
  headBranch?: string
}

export type RepoHealthAlerts =
  | { critical: number; high: number; medium: number; low: number }
  | { error: string }

export type RepoHealthService = {
  name: string
  project: string | null
  detail: string | null
  files: string[]
}

export type RepoHealthSiteCheck = {
  code: number | null
  ok: boolean
  /** 401/403: the server answered but wants a login, so it is up. */
  auth?: boolean
  /** Free tiers (Render, Fly, Heroku, Railway) sleep when idle and answer slowly. */
  asleep?: boolean
}

export type RepoHealthSite = {
  host: string
  url: string
  detail: string | null
  deployedAt: string | null
  check: RepoHealthSiteCheck
  watching: boolean
}

export type RepoHealth = {
  path: string
  repo: string | null
  branch: string | null
  ahead: number | null
  behind: number | null
  ghLogin: string | null
  ghMissing: boolean
  ci: RepoHealthCi | null
  prs: number | null
  issues: number | null
  alerts: RepoHealthAlerts | null
  /** Variable names listed in .env.example but in neither .env nor .env.local (values are never read). */
  envMissing: string[] | null
  services: RepoHealthService[]
  live: RepoHealthSite[]
  checkedAt: number
}
