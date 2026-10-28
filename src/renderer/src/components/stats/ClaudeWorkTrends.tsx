import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import type { ClaudeWorkTrendDay } from '../../../../shared/claude-work-trends'
import { formatSessionWorkingTime } from '../../../../shared/claude-session-numbers'
import { cn } from '@/lib/utils'

type Metric = 'hours' | 'cost'
type Scale = 'day' | 'week' | 'month'
type Bucket = { key: string; label: string; workingMs: number; costUsd: number; current: boolean }

const parseDay = (day: string): Date => new Date(`${day}T12:00:00`)

function bucketKey(day: string, scale: Scale): string {
  const date = parseDay(day)
  if (scale === 'month') {
    return day.slice(0, 7)
  }
  if (scale === 'week') {
    // Weeks start on Monday.
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    return date.toLocaleDateString('en-CA')
  }
  return day
}

function bucketLabel(key: string, scale: Scale): string {
  if (scale === 'month') {
    return parseDay(`${key}-01`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }
  const date = parseDay(key)
  const text = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return scale === 'week'
    ? `Week of ${text}`
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function buildBuckets(days: ClaudeWorkTrendDay[], scale: Scale): Bucket[] {
  const map = new Map<string, Bucket>()
  const todayKey = bucketKey(new Date().toLocaleDateString('en-CA'), scale)
  for (const entry of days) {
    const key = bucketKey(entry.day, scale)
    const bucket = map.get(key) ?? {
      key,
      label: bucketLabel(key, scale),
      workingMs: 0,
      costUsd: 0,
      current: key === todayKey
    }
    bucket.workingMs += entry.workingMs
    bucket.costUsd += entry.costUsd
    map.set(key, bucket)
  }
  return [...map.values()]
}

const money = (usd: number): string => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

/** Hours worked and cost over six months, by day, week or month (parallel chats counted once). */
export function ClaudeWorkTrends(): React.JSX.Element {
  const [days, setDays] = useState<ClaudeWorkTrendDay[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<Metric>('hours')
  const [scale, setScale] = useState<Scale>('day')
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDays(await window.api.claudeSessionNumbers.trends())
    } catch {
      setDays([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const buckets = useMemo(() => (days ? buildBuckets(days, scale) : []), [days, scale])
  const valueOf = (b: Bucket): number => (metric === 'hours' ? b.workingMs : b.costUsd)
  const format = (v: number): string =>
    metric === 'hours' ? formatSessionWorkingTime(v) : money(v)
  const shown = scale === 'day' ? buckets.slice(-60) : buckets
  const max = Math.max(1e-9, ...shown.map(valueOf))
  const total = buckets.reduce((sum, b) => sum + valueOf(b), 0)
  const active = buckets.filter((b) => valueOf(b) > 0)
  const best = active.reduce<Bucket | null>(
    (top, b) => (!top || valueOf(b) > valueOf(top) ? b : top),
    null
  )
  const current = buckets.at(-1)
  const previous = buckets.at(-2)
  const pick = buckets.find((b) => b.key === selected) ?? null
  const unit = scale === 'day' ? 'day' : scale === 'week' ? 'week' : 'month'

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h4 className="text-sm font-semibold text-foreground">Trends</h4>
          <p className="text-xs text-muted-foreground">
            Hours worked (time between messages up to 10 minutes; parallel chats count once) and
            estimated cost, last 6 months.
          </p>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={metric}
          onValueChange={(next) => next && setMetric(next as Metric)}
        >
          <ToggleGroupItem value="hours">Hours</ToggleGroupItem>
          <ToggleGroupItem value="cost">Cost</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={scale}
          onValueChange={(next) => {
            if (next) {
              setScale(next as Scale)
              setSelected(null)
            }
          }}
        >
          <ToggleGroupItem value="day">Daily</ToggleGroupItem>
          <ToggleGroupItem value="week">Weekly</ToggleGroupItem>
          <ToggleGroupItem value="month">Monthly</ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh trends"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw
            className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')}
          />
        </Button>
      </div>
      {!days ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Reading your Claude chats…</p>
      ) : (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TrendTile label="6-month total" value={format(total)} />
            <TrendTile
              label={`Average per active ${unit}`}
              value={active.length ? format(total / active.length) : '–'}
            />
            <TrendTile
              label={`Best ${unit}`}
              value={best ? format(valueOf(best)) : '–'}
              detail={best?.label}
            />
            <TrendTile
              label={`This ${unit} so far`}
              value={current ? format(valueOf(current)) : '–'}
              detail={previous ? `previous ${format(valueOf(previous))}` : undefined}
            />
          </div>
          <TooltipProvider>
            <div
              className={cn(
                'flex h-40 items-end border-b border-border',
                shown.length > 40 ? 'gap-px' : 'gap-1'
              )}
            >
              {shown.map((b) => {
                const value = valueOf(b)
                return (
                  <Tooltip key={b.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${b.label}: ${format(value)}`}
                        onClick={() => setSelected(b.key === selected ? null : b.key)}
                        className={cn(
                          'min-w-0 flex-1 rounded-t-sm transition-opacity',
                          value > 0 ? 'bg-chart-2 opacity-80 hover:opacity-100' : 'h-px bg-border',
                          b.current && value > 0 && 'bg-chart-3 opacity-100',
                          b.key === selected && 'bg-foreground opacity-100'
                        )}
                        style={
                          value > 0 ? { height: `${Math.max(2, (value / max) * 100)}%` } : undefined
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      {b.label}: {formatSessionWorkingTime(b.workingMs)} · {money(b.costUsd)}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
          <div className="mt-1 flex justify-between text-2xs text-muted-foreground">
            <span>{shown[0]?.label}</span>
            <span>{shown.at(-1)?.label}</span>
          </div>
          {pick ? (
            <p className="mt-2 text-xs text-foreground">
              {pick.label}: <b>{formatSessionWorkingTime(pick.workingMs)}</b> worked ·{' '}
              <b>{money(pick.costUsd)}</b> estimated
            </p>
          ) : null}
          <div className="mt-3 max-h-64 overflow-auto rounded-md border border-border/60 scrollbar-sleek">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">
                    {scale === 'day' ? 'Day' : scale === 'week' ? 'Week' : 'Month'}
                  </th>
                  <th className="px-3 py-1.5 text-right font-medium">Hours</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {active.toReversed().map((b) => (
                  <tr
                    key={b.key}
                    onClick={() => setSelected(b.key)}
                    className={cn(
                      'cursor-pointer border-t border-border/50 hover:bg-accent',
                      b.key === selected && 'bg-accent'
                    )}
                  >
                    <td className="px-3 py-1">{b.label}</td>
                    <td className="px-3 py-1 text-right">
                      {formatSessionWorkingTime(b.workingMs)}
                    </td>
                    <td className="px-3 py-1 text-right">{money(b.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function TrendTile({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 px-4 py-3">
      <p className="text-lg font-semibold leading-tight text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {detail ? <p className="text-2xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}
