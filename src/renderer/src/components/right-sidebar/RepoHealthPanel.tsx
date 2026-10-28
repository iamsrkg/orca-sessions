import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, HeartPulse, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { isLocalExecutionHost } from '../../../../shared/execution-host'
import type { RepoHealth, RepoHealthSite } from '../../../../shared/repo-health-types'

type Tone = 'ok' | 'warn' | 'bad' | 'muted'
const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-status-success-border bg-status-success-background text-status-success',
  warn: 'border-status-warning-border bg-status-warning-background text-status-warning',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
  muted: 'border-border text-muted-foreground'
}

function Pill({
  tone,
  children,
  title
}: {
  tone: Tone
  children: React.ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs',
        TONE_CLASS[tone]
      )}
    >
      {children}
    </span>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="border-b border-border px-3 py-3">
      <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  )
}

function ago(iso: string | null): string {
  if (!iso) {
    return ''
  }
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

function siteTone(site: RepoHealthSite): [Tone, string] {
  if (site.check.ok) {
    return ['ok', site.check.auth ? 'up (login required)' : 'up']
  }
  if (site.check.asleep) {
    return ['warn', 'asleep / slow (free tier)']
  }
  return ['bad', site.check.code ? `error ${site.check.code}` : 'unreachable']
}

const open = (url: string): void => {
  void window.api.shell.openUrl(url)
}

/** Right sidebar "Repo health": CI, security alerts, PRs/issues, missing env vars, deploy targets and live sites. */
export default function RepoHealthPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const worktree = useAppStore((s) =>
    s.activeWorktreeId ? (s.getKnownWorktreeById(s.activeWorktreeId) ?? null) : null
  )
  const path = worktree?.path ?? null
  const local =
    isLocalExecutionHost(worktree?.hostId ?? 'local') && !worktree?.runtimeOwnerEnvironmentId
  const [health, setHealth] = useState<RepoHealth | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (force: boolean) => {
      if (!path || !local) {
        return
      }
      setLoading(true)
      try {
        const result = await window.api.repoHealth.get(path, force)
        setHealth(result)
      } finally {
        setLoading(false)
      }
    },
    [path, local]
  )
  useEffect(() => {
    setHealth(null)
    if (isVisible) {
      void load(false)
    }
  }, [isVisible, load])

  const header = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <HeartPulse className="size-4 text-muted-foreground" />
      <span className="flex-1 truncate text-xs font-medium">
        {health?.repo ?? worktree?.displayName ?? 'Repo health'}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh repo health"
        disabled={loading || !local}
        onClick={() => void load(true)}
      >
        <RefreshCw className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} />
      </Button>
    </div>
  )
  if (!path || !local) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <p className="p-4 text-xs text-muted-foreground">
          {path
            ? 'Repo health checks run for projects on this computer.'
            : 'Select a workspace to check its repo.'}
        </p>
      </div>
    )
  }
  if (!health) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <p className="p-4 text-xs text-muted-foreground">
          Checking git, GitHub, deploys and live sites…
        </p>
      </div>
    )
  }

  const ci = health.ci
  const ciTone: [Tone, string] | null = ci
    ? ci.status !== 'completed'
      ? ['warn', `CI ${ci.status.replace('_', ' ')}`]
      : ['success', 'skipped', 'neutral'].includes(ci.conclusion ?? '')
        ? ['ok', 'CI passed']
        : ['bad', `CI ${ci.conclusion ?? 'failed'}`]
    : null
  const alerts = health.alerts
  const alertTotal =
    alerts && !('error' in alerts) ? alerts.critical + alerts.high + alerts.medium + alerts.low : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        <Section title="Repository">
          <p className="mb-2 text-xs text-muted-foreground">
            {health.branch ?? '?'}
            {health.ahead ? ` · ↑${health.ahead}` : ''}
            {health.behind ? ` · ↓${health.behind}` : ''}
            {health.ghLogin ? ` · gh: ${health.ghLogin}` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ciTone && ci ? (
              <button
                type="button"
                onClick={() => open(ci.url)}
                title={`${ci.name} · ${ago(ci.createdAt)}`}
              >
                <Pill tone={ciTone[0]}>{ciTone[1]}</Pill>
              </button>
            ) : health.repo ? (
              <Pill tone="muted">no CI runs</Pill>
            ) : null}
            {alerts ? (
              'error' in alerts ? (
                <Pill tone="muted">{alerts.error}</Pill>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    health.repo && open(`https://github.com/${health.repo}/security/dependabot`)
                  }
                >
                  <Pill
                    tone={alerts.critical || alerts.high ? 'bad' : alertTotal ? 'warn' : 'ok'}
                    title={`Dependabot: ${alerts.critical} critical · ${alerts.high} high · ${alerts.medium} medium · ${alerts.low} low`}
                  >
                    {alertTotal
                      ? `${alertTotal} security alert${alertTotal === 1 ? '' : 's'}`
                      : 'no security alerts'}
                  </Pill>
                </button>
              )
            ) : null}
            {health.prs !== null ? (
              <Pill tone="muted">
                {health.prs} open PR{health.prs === 1 ? '' : 's'}
              </Pill>
            ) : null}
            {health.issues !== null ? (
              <Pill tone="muted">
                {health.issues} open issue{health.issues === 1 ? '' : 's'}
              </Pill>
            ) : null}
            {health.envMissing ? (
              <Pill
                tone={health.envMissing.length ? 'warn' : 'ok'}
                title={health.envMissing.join(', ')}
              >
                {health.envMissing.length
                  ? `${health.envMissing.length} env missing`
                  : 'env complete'}
              </Pill>
            ) : null}
          </div>
          {health.envMissing?.length ? (
            <p className="mt-2 text-2xs text-muted-foreground">
              In .env.example but not in .env / .env.local:{' '}
              {health.envMissing.slice(0, 8).join(', ')}
              {health.envMissing.length > 8 ? ` +${health.envMissing.length - 8}` : ''}
            </p>
          ) : null}
          {!health.ghLogin ? (
            <p className="mt-2 text-2xs text-muted-foreground">
              {health.ghMissing ? 'GitHub CLI (gh) is not installed' : 'gh is signed out'}: CI,
              alerts and PRs are not checked.
            </p>
          ) : null}
        </Section>
        <Section title="Live sites">
          {health.live.length ? (
            <ul className="flex flex-col gap-2">
              {health.live.map((site) => {
                const [tone, label] = siteTone(site)
                return (
                  <li key={site.url} className="flex items-start gap-2 text-xs">
                    <span
                      className={cn(
                        'mt-1 size-2 shrink-0 rounded-full',
                        tone === 'ok'
                          ? 'bg-status-success'
                          : tone === 'warn'
                            ? 'bg-status-warning'
                            : 'bg-destructive'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="flex max-w-full items-center gap-1 truncate text-left hover:underline"
                        onClick={() => open(site.url)}
                      >
                        <span className="font-medium">{site.host}</span>
                        <span className="truncate text-muted-foreground">
                          {site.url.replace(/^https?:\/\//, '')}
                        </span>
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                      </button>
                      <p className="text-2xs text-muted-foreground">
                        {[
                          label,
                          site.detail,
                          site.deployedAt ? `deployed ${ago(site.deployedAt)}` : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <label
                      className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground"
                      title="Notify me when this site goes down (checked every 10 minutes)"
                    >
                      <Switch
                        checked={site.watching}
                        onCheckedChange={(on) => {
                          void window.api.repoHealth.setWatch(site.url, on)
                          setHealth({
                            ...health,
                            live: health.live.map((s) =>
                              s.url === site.url ? { ...s, watching: on } : s
                            )
                          })
                        }}
                        aria-label={`Watch ${site.url}`}
                      />
                      Watch
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not deployed anywhere GitHub or the repo config shows.
            </p>
          )}
        </Section>
        <Section title="Deploys and backend">
          {health.services.length ? (
            <ul className="flex flex-col gap-1.5">
              {health.services.map((service) => (
                <li key={service.name} className="text-xs">
                  <span className="font-medium">{service.name}</span>
                  {service.project ? (
                    <span className="text-muted-foreground"> · {service.project}</span>
                  ) : null}
                  <p
                    className="truncate text-2xs text-muted-foreground"
                    title={service.files.join(', ')}
                  >
                    {[service.detail, service.files.join(', ')].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No hosting or backend config in this repo.
            </p>
          )}
        </Section>
        <p className="px-3 py-2 text-2xs text-muted-foreground">
          Checked{' '}
          {new Date(health.checkedAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
          })}{' '}
          · refreshes every 5 minutes when opened
        </p>
      </div>
    </div>
  )
}
