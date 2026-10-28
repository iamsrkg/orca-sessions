import type {
  RepoHealthService,
  RepoHealthSite,
  RepoHealthSiteCheck
} from '../../shared/repo-health-types'
import { isWatching, rememberSites } from './live-site-watch'
import { parseJson, run } from './repo-command'

const SLEEPY_HOSTS = /\.onrender\.com|\.fly\.dev|\.herokuapp\.com|\.railway\.app/i

export async function checkSite(url: string): Promise<RepoHealthSiteCheck> {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12_000) })
    const auth = response.status === 401 || response.status === 403
    return { code: response.status, ok: response.ok || auth, auth }
  } catch {
    return { code: null, ok: false, asleep: SLEEPY_HOSTS.test(url) }
  }
}

function hostOf(url: string): string | null {
  const host = /^https?:\/\/([^/]+)/i.exec(url)?.[1] ?? ''
  const table: [RegExp, string][] = [
    [/github\.io$/, 'GitHub Pages'],
    [/vercel\.app$/, 'Vercel'],
    [/netlify\.app$/, 'Netlify'],
    [/onrender\.com$/, 'Render'],
    [/(web\.app|firebaseapp\.com)$/, 'Firebase Hosting'],
    [/pages\.dev$|workers\.dev$/, 'Cloudflare'],
    [/fly\.dev$/, 'Fly.io'],
    [/herokuapp\.com$/, 'Heroku'],
    [/railway\.app$/, 'Railway']
  ]
  return table.find(([re]) => re.test(host))?.[1] ?? null
}

type PendingSite = Omit<RepoHealthSite, 'check' | 'watching'>

// GitHub Pages, GitHub deployments (Vercel/Netlify/Render report there), the repo's website field, config URLs.
export async function liveSites(
  top: string,
  repo: string | null,
  services: RepoHealthService[]
): Promise<RepoHealthSite[]> {
  const sites: PendingSite[] = []
  const add = (site: PendingSite): void => {
    const norm = site.url.replace(/\/$/, '')
    if (!sites.some((s) => s.url.replace(/\/$/, '') === norm)) {
      sites.push(site)
    }
  }
  const ghApi = async <T>(path: string): Promise<T | null> => {
    const r = await run('gh', ['api', path], top, 12_000)
    return r.ok ? parseJson<T>(r.out) : null
  }
  if (repo) {
    type Pages = { html_url?: string; cname?: string | null; build_type?: string }
    type Deployment = { id: number; environment: string; created_at: string }
    type Status = { environment_url?: string; target_url?: string }
    const [info, pages, deployments] = await Promise.all([
      ghApi<{ homepage?: string | null }>(`repos/${repo}`),
      ghApi<Pages>(`repos/${repo}/pages`),
      ghApi<Deployment[]>(`repos/${repo}/deployments?per_page=30`)
    ])
    const latestByEnv = new Map<string, Deployment>()
    for (const d of Array.isArray(deployments) ? deployments : []) {
      if (!latestByEnv.has(d.environment)) {
        latestByEnv.set(d.environment, d)
      }
    }
    if (pages?.html_url) {
      add({
        host: 'GitHub Pages',
        url: pages.html_url,
        detail: pages.cname ? `custom domain ${pages.cname}` : null,
        deployedAt: latestByEnv.get('github-pages')?.created_at ?? null
      })
    }
    const others = [...latestByEnv.entries()].filter(([env]) => env !== 'github-pages').slice(0, 3)
    const statuses = await Promise.all(
      others.map(([, d]) =>
        ghApi<Status[]>(`repos/${repo}/deployments/${d.id}/statuses?per_page=1`)
      )
    )
    others.forEach(([env, d], i) => {
      const status = statuses[i]?.[0]
      const url = status?.environment_url || status?.target_url
      if (url) {
        add({
          host: hostOf(url) ?? 'Deployment',
          url,
          detail: `environment "${env}"`,
          deployedAt: d.created_at
        })
      }
    })
    if (info?.homepage && /^https?:\/\//.test(info.homepage)) {
      add({
        host: hostOf(info.homepage) ?? 'Website',
        url: info.homepage,
        detail: 'GitHub website field',
        deployedAt: null
      })
    }
  }
  for (const s of services) {
    if (s.name === 'Firebase' && s.project && s.detail?.includes('hosting')) {
      add({
        host: 'Firebase Hosting',
        url: `https://${s.project}.web.app/`,
        detail: 'from .firebaserc',
        deployedAt: null
      })
    }
    if (s.name === 'Fly.io' && s.project) {
      add({
        host: 'Fly.io',
        url: `https://${s.project}.fly.dev/`,
        detail: 'from fly.toml',
        deployedAt: null
      })
    }
  }
  const checks = await Promise.all(sites.map((s) => checkSite(s.url)))
  const result = sites.map((s, i) => ({ ...s, check: checks[i], watching: isWatching(s.url) }))
  rememberSites(result, repo)
  return result
}
