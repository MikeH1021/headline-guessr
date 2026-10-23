import { FINISH_CAP_MS, RUM_CAP, RUM_KINDS, RUM_PATHS } from './constants'
import { db } from './db'
import { median, msLabel, paceLabel } from './scoring'
import { localDateTimeISO, localISO } from './time'
import type { RumSummary } from './types'

const KINDS = new Set<string>(RUM_KINDS)

type RumRow = {
  id: number
  t: string
  kind: string
  path: string
  who: string
  payload_json: string
}

function payloadOf(row: RumRow) {
  try {
    const parsed = JSON.parse(row.payload_json) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function rumInt(value: unknown, limit: number) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number)) return null
  const rounded = Math.trunc(number)
  if (rounded < 0 || rounded > limit) return null
  return rounded
}

function rumFloat(value: unknown, limit: number) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number) || number < 0 || number > limit) return null
  return Math.round(number * 1000) / 1000
}

function browserName(agent: string) {
  if (agent.includes('Edg/')) return 'Edge'
  if (agent.includes('Firefox/')) return 'Firefox'
  if (agent.includes('Chrome/')) return 'Chrome'
  if (agent.includes('Safari/')) return 'Safari'
  return ''
}

function rows() {
  return (db().prepare('SELECT id, t, kind, path, who, payload_json FROM rum ORDER BY id ASC').all() as RumRow[])
}

export function recordRum(payload: unknown, agent: string) {
  if (!payload || typeof payload !== 'object') return
  const body = payload as Record<string, unknown>
  const kind = body.kind
  if (typeof kind !== 'string' || !KINDS.has(kind)) return
  const path = typeof body.path === 'string' && body.path in RUM_PATHS ? body.path : ''
  if ((kind === 'view' || kind === 'vital' || kind === 'finish') && !path) return
  const who = typeof body.who === 'string' && /^[a-z0-9]{6,16}$/.test(body.who) ? body.who : ''
  const event: Record<string, unknown> = {
    t: localDateTimeISO(new Date()),
    kind,
    path,
    who,
  }
  if (kind === 'view') {
    const width = rumInt(body.w, 10000)
    const height = rumInt(body.h, 10000)
    if (width) event.w = width
    if (height) event.h = height
    if (body.theme === 'light' || body.theme === 'dark') event.theme = body.theme
    const browser = browserName(agent || '')
    if (browser) event.browser = browser
  } else if (kind === 'vital') {
    for (const [key, limit] of [['load', 120000], ['lcp', 120000], ['inp', 10000]] as const) {
      const number = rumInt(body[key], limit)
      if (number) event[key] = number
    }
    const cls = rumFloat(body.cls, 5)
    if (cls !== null) event.cls = cls
    if (Object.keys(event).length === 4) return
  } else if (kind === 'finish') {
    const score = rumInt(body.score, 20)
    const total = rumInt(body.total, 20)
    const elapsed = rumInt(body.ms, 60 * 60 * 1000)
    if (score !== null) event.score = score
    if (total) event.total = total
    if (elapsed) event.ms = elapsed
  } else {
    const message = typeof body.message === 'string'
      ? body.message.replace(/\s+/g, ' ').trim().replace(/[<>]/g, '').slice(0, 180)
      : ''
    if (!message || /Minified React error #418|Hydration failed/.test(message)) return
    event.message = message
  }

  const database = db()
  database.transaction(() => {
    if (kind === 'vital') {
      const latest = database.prepare(
        `SELECT id, t, payload_json FROM rum
         WHERE kind = 'view' AND who = ? AND path = ?
         ORDER BY id DESC LIMIT 1`,
      ).get(who, path) as { id: number; t: string; payload_json: string } | undefined
      if (!latest) return
      const age = Date.now() - Date.parse(latest.t)
      if (!Number.isFinite(age) || age > 180_000) return
      const view = JSON.parse(latest.payload_json) as Record<string, unknown>
      for (const key of ['load', 'lcp', 'inp', 'cls']) {
        if (key in event) view[key] = event[key]
      }
      database.prepare('UPDATE rum SET payload_json = ? WHERE id = ?').run(JSON.stringify(view), latest.id)
      return
    }
    if (kind === 'error') {
      const last = database.prepare(
        'SELECT kind, payload_json, who FROM rum ORDER BY id DESC LIMIT 1',
      ).get() as { kind: string; payload_json: string; who: string } | undefined
      if (last?.kind === 'error' && last.who === who) {
        try {
          const previous = JSON.parse(last.payload_json) as { message?: string }
          if (previous.message === event.message) return
        } catch { /* record it */ }
      }
    }
    database.prepare(
      'INSERT INTO rum (t, kind, path, who, payload_json) VALUES (?, ?, ?, ?, ?)',
    ).run(event.t, kind, path, who, JSON.stringify(event))
    const count = database.prepare('SELECT COUNT(*) AS n FROM rum').get() as { n: number }
    if (count.n > RUM_CAP) {
      database.prepare('DELETE FROM rum WHERE id IN (SELECT id FROM rum ORDER BY id ASC LIMIT ?)').run(count.n - RUM_CAP)
    }
  })()
}

export function clearRum() {
  db().prepare('DELETE FROM rum').run()
}

export function rumPublic(summary = rumSummary()) {
  return {
    views: summary.views,
    today_views: summary.todayViews,
    visitors: summary.visitors,
    today_visitors: summary.todayVisitors,
    finishes: summary.finishes,
    today_finishes: summary.todayFinishes,
    median_finish: summary.medianFinish,
    mix: summary.mix,
    vitals: summary.vitals,
    right: summary.right,
    asked: summary.asked,
    pages: summary.pages,
    recent: summary.recent,
    errors: summary.errors,
  }
}

export function rumSummary(): RumSummary {
  const all = rows().map((row) => ({
    ...payloadOf(row),
    t: row.t,
    kind: row.kind,
    path: row.path,
    who: row.who,
  })) as Array<Record<string, unknown> & { t: string; kind: string; path: string; who: string }>
  const today = localISO()
  const views = all.filter((row) => row.kind === 'view')
  const finishes = all.filter((row) => row.kind === 'finish')
  const errors = all.filter((row) => row.kind === 'error' && row.message)
  const visitors = new Set(all.map((row) => row.who).filter(Boolean))
  const todayRows = all.filter((row) => String(row.t || '').startsWith(today))
  const todayViews = views.filter((row) => String(row.t || '').startsWith(today))
  const todayVisitors = new Set(todayRows.map((row) => row.who).filter(Boolean))
  const counts: Record<string, number> = {}
  for (const row of views) {
    const key = String(row.path || '')
    counts[key] = (counts[key] || 0) + 1
  }
  const pages = Object.entries(RUM_PATHS)
    .filter(([path]) => counts[path])
    .map(([path, label]) => ({ label, count: counts[path] }))
    .sort((a, b) => b.count - a.count)
  const phone = views.filter((row) => Number(row.w) && Number(row.w) < 700).length
  const desktop = views.filter((row) => Number(row.w) && Number(row.w) >= 700).length
  const light = views.filter((row) => row.theme === 'light').length
  const dark = views.filter((row) => row.theme === 'dark').length
  const browsers: Record<string, number> = {}
  for (const row of views) {
    if (typeof row.browser === 'string' && row.browser) browsers[row.browser] = (browsers[row.browser] || 0) + 1
  }
  const mix: string[] = []
  if (desktop) mix.push(`${desktop} desktop`)
  if (phone) mix.push(`${phone} phone`)
  if (light) mix.push(`${light} light`)
  if (dark) mix.push(`${dark} dark`)
  for (const [name, count] of Object.entries(browsers).sort((a, b) => b[1] - a[1])) mix.push(`${count} ${name}`)
  const vitalBits: string[] = []
  for (const [key, label] of [['load', 'Load'], ['lcp', 'LCP'], ['inp', 'INP']] as const) {
    const sample = views.map((row) => Number(row[key])).filter((value) => value > 0)
    const mid = median(sample)
    if (mid !== null) vitalBits.push(`${label} ${msLabel(mid)}`)
  }
  const clsValues = views
    .filter((row) => row.cls !== undefined && row.cls !== null)
    .map((row) => Number(row.cls))
    .filter((value) => Number.isFinite(value))
  const clsMid = median(clsValues)
  if (clsMid !== null) vitalBits.push(`CLS ${clsMid.toFixed(3)}`)
  const finishMid = median(
    finishes
      .map((row) => Number(row.ms))
      .filter((value) => value > 0 && value <= FINISH_CAP_MS),
  )
  const right = finishes.reduce((sum, row) => sum + (Number(row.score) || 0), 0)
  const asked = finishes.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
  const recent: RumSummary['recent'] = []
  for (const row of [...all].reverse()) {
    if (row.kind !== 'view' && row.kind !== 'finish' && row.kind !== 'error') continue
    const stamp = String(row.t || '')
    let clock = stamp.length >= 16 ? stamp.slice(11, 16) : stamp
    if (!stamp.startsWith(today) && stamp.length >= 10) clock = `${stamp.slice(5, 10)} ${clock}`
    let detail = ''
    let kindLabel = ''
    if (row.kind === 'view') {
      detail = RUM_PATHS[String(row.path)] || String(row.path || '')
      if (row.w) detail += Number(row.w) < 700 ? ' · phone' : ' · desktop'
      if (row.theme) detail += ` · ${row.theme}`
      kindLabel = 'View'
    } else if (row.kind === 'finish') {
      detail = 'Finished'
      if (row.total) detail += ` ${row.score || 0}/${row.total}`
      if (row.ms) detail += ` · ${paceLabel(Number(row.ms))}`
      kindLabel = 'Finish'
    } else {
      detail = String(row.message || '')
      kindLabel = 'Error'
    }
    recent.push({ time: clock, kind: kindLabel, detail })
    if (recent.length >= 12) break
  }
  const seen: string[] = []
  for (const row of [...errors].reverse()) {
    const message = String(row.message || '')
    if (/Minified React error #418|Hydration failed/.test(message)) continue
    if (message && !seen.includes(message)) seen.push(message)
    if (seen.length >= 4) break
  }
  return {
    views: views.length,
    todayViews: todayViews.length,
    visitors: visitors.size,
    todayVisitors: todayVisitors.size,
    finishes: finishes.length,
    todayFinishes: finishes.filter((row) => String(row.t || '').startsWith(today)).length,
    medianFinish: finishMid === null ? '—' : paceLabel(finishMid),
    mix: mix.join(' · '),
    vitals: vitalBits.join(' · '),
    right,
    asked,
    pages,
    recent,
    errors: seen,
  }
}


