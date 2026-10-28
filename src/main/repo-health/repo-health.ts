import type { RepoHealth, RepoHealthAlerts, RepoHealthCi } from '../../shared/repo-health-types'
import { deployServices, missingEnv } from './deploy-config-scan'
import { liveSites } from './live-site-discovery'
import { parseJson, run } from './repo-command'

export { checkSite } from './live-site-discovery'

const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; value: RepoHealth }>()
const running = new Map<string, Promise<RepoHealth>>()

async function computeRepoHealth(path: string): Promise<RepoHealth> {
  const gitOut = async (args: string[]): Promise<string | null> => {
    const r = await run('git', args, path, 5_000)
    return r.ok ? r.out.trim() : null
  }
  const [top, branch, aheadBehind, remote] = await Promise.all([
    gitOut(['rev-parse', '--show-toplevel']),
    gitOut(['rev-parse', '--abbrev-ref', 'HEAD']),
    gitOut(['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    gitOut(['config', '--get', 'remote.origin.url'])
  ])
  const root = top ?? path
  const repo = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote ?? '')
  const repoName = repo ? `${repo[1]}/${repo[2]}` : null
  const [behind, ahead] = aheadBehind ? aheadBehind.split(/\s+/).map(Number) : [null, null]
  const login = await run('gh', ['api', 'user', '--jq', '.login'], root, 12_000)
  const health: RepoHealth = {
    path,
    repo: repoName,
    branch,
    ahead: ahead ?? null,
    behind: behind ?? null,
    ghLogin: login.ok ? login.out.trim() : null,
    ghMissing: login.missing,
    ci: null,
    prs: null,
    issues: null,
    alerts: null,
    envMissing: missingEnv(root),
    services: deployServices(root),
    live: [],
    checkedAt: Date.now()
  }
  if (repoName && health.ghLogin) {
    const fields = 'name,status,conclusion,url,createdAt,headBranch'
    const [ciRun, prs, issues, alerts] = await Promise.all([
      run(
        'gh',
        ['run', 'list', '-L', '1', ...(branch ? ['--branch', branch] : []), '--json', fields],
        root
      ),
      run('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number'], root),
      run('gh', ['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number'], root),
      run(
        'gh',
        [
          'api',
          '--paginate',
          `repos/${repoName}/dependabot/alerts?state=open&per_page=100`,
          '--jq',
          '.[].security_advisory.severity'
        ],
        root,
        20_000
      )
    ])
    health.ci = parseJson<RepoHealthCi[]>(ciRun.out)?.[0] ?? null
    if (!health.ci) {
      const any = await run('gh', ['run', 'list', '-L', '1', '--json', fields], root)
      health.ci = parseJson<RepoHealthCi[]>(any.out)?.[0] ?? null
    }
    health.prs = parseJson<unknown[]>(prs.out)?.length ?? null
    health.issues = parseJson<unknown[]>(issues.out)?.length ?? null
    if (alerts.ok) {
      const counts = { critical: 0, high: 0, medium: 0, low: 0 }
      for (const severity of alerts.out.split('\n').map((s) => s.trim())) {
        if (
          severity === 'critical' ||
          severity === 'high' ||
          severity === 'medium' ||
          severity === 'low'
        ) {
          counts[severity]++
        }
      }
      health.alerts = counts
    } else {
      const failure: RepoHealthAlerts = {
        error: /403|disabled|not enabled/i.test(alerts.err)
          ? 'Dependabot alerts are off'
          : 'Could not read alerts'
      }
      health.alerts = failure
    }
  }
  health.live = await liveSites(root, health.ghLogin ? repoName : null, health.services)
  return health
}

/** CI, Dependabot alerts, PRs/issues, missing env names, deploy targets and live-site checks for one repo (cached 5 min). */
export function getRepoHealth(path: string, force: boolean): Promise<RepoHealth> {
  const hit = cache.get(path)
  if (!force && hit && Date.now() - hit.at < CACHE_MS) {
    return Promise.resolve(hit.value)
  }
  const inFlight = running.get(path)
  if (inFlight) {
    return inFlight
  }
  const next = computeRepoHealth(path)
    .then((value) => {
      cache.set(path, { at: Date.now(), value })
      return value
    })
    .finally(() => running.delete(path))
  running.set(path, next)
  return next
}
