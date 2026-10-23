import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { DEFAULT_ETHNICITY_PROMPT, DEFAULT_REFRESH_TIME, MODEL_IDS, RUM_KINDS } from './constants'
import { loadEnv } from './env'
import { canonicalEthnicity } from './ethnicity'
import { feedName, feedUrl, parseFeeds, validRefreshTime } from './feeds'
import { recoverJob } from './job'
import { startScheduler } from './scheduler'
import { cleanTitle } from './text'

const RUM_KIND_SET = new Set<string>(RUM_KINDS)

function dataDir() {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data')
}

function legacyDir() {
  return process.env.LEGACY_DIR || process.cwd()
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function importLegacy(database: Database.Database) {
  const imported = database.prepare('SELECT value FROM meta WHERE key = ?').get('json_imported') as
    | { value: string }
    | undefined
  if (imported?.value === '1') return

  const dir = legacyDir()
  const settings = readJson(path.join(dir, 'settings.json'))
  const settingsRow = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const model = typeof settingsRow.model === 'string' && MODEL_IDS.has(settingsRow.model)
    ? settingsRow.model
    : 'grok-4.7'
  const prompt = typeof settingsRow.prompt === 'string' && settingsRow.prompt.trim()
    ? settingsRow.prompt
    : DEFAULT_ETHNICITY_PROMPT
  const refresh = validRefreshTime(settingsRow.refresh_time) ? settingsRow.refresh_time : DEFAULT_REFRESH_TIME
  const feeds = parseFeeds(settingsRow.feeds)
  database.prepare(
    'INSERT INTO settings (id, model, prompt, refresh_time, feeds_json) VALUES (1, ?, ?, ?, ?)',
  ).run(model, prompt, refresh, feeds.length ? JSON.stringify(feeds.map(({ name, url }) => ({ name, url }))) : null)

  const round = readJson(path.join(dir, 'round.json'))
  if (round && typeof round === 'object') {
    const record = round as Record<string, unknown>
    const cards = Array.isArray(record.cards) ? record.cards : []
    const clean = []
    for (const card of cards) {
      if (!card || typeof card !== 'object') continue
      const item = card as Record<string, unknown>
      const source = feedName(item.source)
      const headline = cleanTitle(typeof item.headline === 'string' ? item.headline : '')
      const ethnicity = canonicalEthnicity(item.ethnicity)
      if (source && headline && ethnicity) clean.push({ source, headline, ethnicity })
    }
    if (typeof record.refreshed_on === 'string' && record.refreshed_on) {
      database.prepare(
        'INSERT INTO rounds (id, refreshed_on, refreshed_at, cards_json) VALUES (1, ?, ?, ?)',
      ).run(record.refreshed_on, typeof record.refreshed_at === 'string' ? record.refreshed_at : '', JSON.stringify(clean))
    }
  }

  const scores = readJson(path.join(dir, 'scores.json'))
  if (Array.isArray(scores)) {
    const insert = database.prepare('INSERT INTO scores (round_key, score, created_at) VALUES (?, ?, ?)')
    let stamp = Date.now() - scores.length
    for (const row of scores) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const key = item.round
      const score = Number(item.score)
      if (typeof key !== 'string' || !key || !Number.isFinite(score)) continue
      insert.run(key, Math.trunc(score), stamp)
      stamp += 1
    }
  }

  const queue = readJson(path.join(dir, 'queue.json'))
  if (Array.isArray(queue)) {
    const insert = database.prepare(
      'INSERT INTO queue (position, source, headline, ethnicity, url) VALUES (?, ?, ?, ?, ?)',
    )
    let position = 1
    const seen = new Set<string>()
    for (const row of queue) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const source = feedName(item.source)
      const headline = cleanTitle(typeof item.headline === 'string' ? item.headline : '')
      const ethnicity = canonicalEthnicity(item.ethnicity)
      const key = headline.toLowerCase()
      if (!source || !headline || !ethnicity || seen.has(key)) continue
      seen.add(key)
      insert.run(position, source, headline, ethnicity, feedUrl(item.url))
      position += 1
      if (position > 200) break
    }
  }

  const rum = readJson(path.join(dir, 'rum.json'))
  if (Array.isArray(rum)) {
    const insert = database.prepare(
      'INSERT INTO rum (t, kind, path, who, payload_json) VALUES (?, ?, ?, ?, ?)',
    )
    for (const row of rum) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      if (typeof item.t !== 'string' || typeof item.kind !== 'string' || !RUM_KIND_SET.has(item.kind)) continue
      insert.run(item.t, item.kind, typeof item.path === 'string' ? item.path : '', typeof item.who === 'string' ? item.who : '', JSON.stringify(item))
    }
  }

  const status = readJson(path.join(dir, 'refresh_status.json'))
  if (status && typeof status === 'object') {
    const record = status as Record<string, unknown>
    const events = Array.isArray(record.events) ? record.events : []
    const stopped = Boolean(record.running)
    database.prepare(
      `INSERT INTO job (id, running, kept, target, error, finished_at, events_json)
       VALUES (1, 0, ?, 10, ?, ?, ?)`,
    ).run(
      Number(record.kept) || 0,
      stopped ? 'The last refresh stopped because the app restarted.' : String(record.error || ''),
      typeof record.finished_at === 'string' ? record.finished_at : '',
      JSON.stringify(events),
    )
  } else {
    database.prepare(
      `INSERT INTO job (id, running, kept, target, error, finished_at, events_json)
       VALUES (1, 0, 0, 10, '', '', '[]')`,
    ).run()
  }

  database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('json_imported', '1')
  const names = ['settings.json', 'round.json', 'scores.json', 'rum.json', 'queue.json', 'refresh_status.json']
  if (!names.some((name) => fs.existsSync(path.join(dir, name)))) return
  const scoreCount = database.prepare('SELECT COUNT(*) AS n FROM scores').get() as { n: number }
  const cardCount = database.prepare('SELECT cards_json FROM rounds WHERE id = 1').get() as
    | { cards_json: string }
    | undefined
  let cards = 0
  if (cardCount) {
    try { cards = (JSON.parse(cardCount.cards_json) as unknown[]).length } catch { cards = 0 }
  }
  console.log(`Headline Guessr imported the existing round (${cards} cards) and ${scoreCount.n} scores.`)
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      refresh_time TEXT NOT NULL,
      feeds_json TEXT
    );
    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      refreshed_on TEXT NOT NULL,
      refreshed_at TEXT NOT NULL,
      cards_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue (
      position INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      headline TEXT NOT NULL,
      ethnicity TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY,
      round_key TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_round ON scores(round_key, score);
    CREATE TABLE IF NOT EXISTS rum (
      id INTEGER PRIMARY KEY,
      t TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      who TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rum_who ON rum(who, path, id);
    CREATE INDEX IF NOT EXISTS idx_rum_kind ON rum(kind, id);
    CREATE TABLE IF NOT EXISTS job (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      running INTEGER NOT NULL,
      kept INTEGER NOT NULL,
      target INTEGER NOT NULL,
      error TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      events_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_attempts (
      id INTEGER PRIMARY KEY,
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_attempts_ip ON admin_attempts(ip, at);
  `)
  const scoreColumns = database.prepare('PRAGMA table_info(scores)').all() as { name: string }[]
  if (!scoreColumns.some((column) => column.name === 'session_id')) {
    database.exec("ALTER TABLE scores ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_scores_session ON scores(session_id, round_key)')
  const hasSettings = database.prepare('SELECT id FROM settings WHERE id = 1').get()
  if (!hasSettings) database.transaction(() => importLegacy(database))()
  const hasJob = database.prepare('SELECT id FROM job WHERE id = 1').get()
  if (!hasJob) {
    database.prepare(
      `INSERT INTO job (id, running, kept, target, error, finished_at, events_json)
       VALUES (1, 0, 0, 10, '', '', '[]')`,
    ).run()
  }
  const ready = database.prepare('SELECT id FROM settings WHERE id = 1').get()
  if (!ready) {
    database.prepare(
      'INSERT INTO settings (id, model, prompt, refresh_time, feeds_json) VALUES (1, ?, ?, ?, NULL)',
    ).run('grok-4.7', DEFAULT_ETHNICITY_PROMPT, DEFAULT_REFRESH_TIME)
    database.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('json_imported', '1')
  }
}

function openDatabase() {
  loadEnv()
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })
  const database = new Database(path.join(dir, 'headline.sqlite'))
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('busy_timeout = 5000')
  database.pragma('cache_size = -131072')
  database.pragma('temp_store = MEMORY')
  database.pragma('mmap_size = 268435456')
  database.pragma('foreign_keys = ON')
  database.pragma('wal_autocheckpoint = 1000')
  migrate(database)
  return database
}

const globalForDb = globalThis as unknown as { __hgDb?: Database.Database }

function arm() {
  const g = globalThis as unknown as { __hgBoot?: boolean }
  if (g.__hgBoot) return
  g.__hgBoot = true
  recoverJob()
  startScheduler()
}

export function db() {
  if (!globalForDb.__hgDb) {
    globalForDb.__hgDb = openDatabase()
    arm()
  }
  return globalForDb.__hgDb
}
