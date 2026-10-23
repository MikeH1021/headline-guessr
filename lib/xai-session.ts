import type { Database } from 'better-sqlite3'
import { loadEnv } from './env'
import {
  type OauthTransport,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_SCOPE,
  assertXaiUrl,
  deviceChallenge,
  deviceGrant,
  devicePollKind,
  discoveryEndpoints,
  refreshGrant,
  safeOauthDetail,
  tokenExpiring,
} from './xai-oauth'

export type OauthPublic = {
  connected: boolean
  email: string
  billing: 'subscription' | 'api-key' | 'none'
  pending: boolean
  userCode: string
  verificationUrl: string
  pollSeconds: number
  error: string
  fallback: string
}

type Row = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  deviceCode: string
  userCode: string
  verificationUrl: string
  pollInterval: number
  deviceExpiresAt: number
  lastPollAt: number
  tokenEndpoint: string
  lastError: string
  fallbackNote: string
  refreshFailedAt: number
}

const EMPTY: Row = {
  accessToken: '',
  refreshToken: '',
  expiresAt: 0,
  email: '',
  deviceCode: '',
  userCode: '',
  verificationUrl: '',
  pollInterval: 5,
  deviceExpiresAt: 0,
  lastPollAt: 0,
  tokenEndpoint: '',
  lastError: '',
  fallbackNote: '',
  refreshFailedAt: 0,
}

type Flight = { refresh: Promise<string | null> | null; poll: Promise<OauthPublic> | null }

function flight() {
  const g = globalThis as unknown as { __hgOauthFlight?: Flight }
  if (!g.__hgOauthFlight) g.__hgOauthFlight = { refresh: null, poll: null }
  return g.__hgOauthFlight
}

let transportOverride: OauthTransport | null = null
let signInEpoch = 0
let gate: Promise<void> = Promise.resolve()

export function setOauthTransport(transport: OauthTransport | null) {
  transportOverride = transport
  const current = flight()
  current.refresh = null
  current.poll = null
}

function transport(): OauthTransport {
  if (transportOverride) return transportOverride
  return {
    async getJson(url) {
      assertXaiUrl(url)
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      return { status: response.status, json: await response.json().catch(() => null) }
    },
    async postForm(url, body) {
      assertXaiUrl(url)
      const response = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20_000),
      })
      return { status: response.status, json: await response.json().catch(() => null) }
    },
  }
}

async function database() {
  const { db } = await import('./db')
  return db()
}

function mapRow(record: Record<string, unknown> | undefined): Row {
  if (!record) return { ...EMPTY }
  return {
    accessToken: String(record.access_token || ''),
    refreshToken: String(record.refresh_token || ''),
    expiresAt: Number(record.expires_at) || 0,
    email: String(record.email || ''),
    deviceCode: String(record.device_code || ''),
    userCode: String(record.user_code || ''),
    verificationUrl: String(record.verification_uri || ''),
    pollInterval: Number(record.poll_interval) || 5,
    deviceExpiresAt: Number(record.device_expires_at) || 0,
    lastPollAt: Number(record.last_poll_at) || 0,
    tokenEndpoint: String(record.token_endpoint || ''),
    lastError: String(record.last_error || ''),
    fallbackNote: String(record.fallback_note || ''),
    refreshFailedAt: Number(record.refresh_failed_at) || 0,
  }
}

function exclusive<T>(work: (db: Database) => T): Promise<T> {
  const run = gate.then(async () => {
    const db = await database()
    return work(db)
  })
  gate = run.then(() => undefined, () => undefined)
  return run
}

function readSync(db: Database) {
  const row = db.prepare('SELECT * FROM oauth WHERE id = 1').get() as Record<string, unknown> | undefined
  return mapRow(row)
}

function updateSync(db: Database, current: Row) {
  current.lastError = current.lastError.slice(0, 300)
  current.fallbackNote = current.fallbackNote.slice(0, 300)
  db.prepare(
    `UPDATE oauth SET
      access_token = ?, refresh_token = ?, expires_at = ?, email = ?,
      device_code = ?, user_code = ?, verification_uri = ?, poll_interval = ?,
      device_expires_at = ?, last_poll_at = ?, token_endpoint = ?,
      last_error = ?, fallback_note = ?, refresh_failed_at = ?, updated_at = ?
     WHERE id = 1`,
  ).run(
    current.accessToken,
    current.refreshToken,
    current.expiresAt,
    current.email,
    current.deviceCode,
    current.userCode,
    current.verificationUrl,
    current.pollInterval,
    current.deviceExpiresAt,
    current.lastPollAt,
    current.tokenEndpoint,
    current.lastError,
    current.fallbackNote,
    current.refreshFailedAt,
    Date.now(),
  )
  return current
}

async function readRow() {
  return exclusive((db) => readSync(db))
}

async function writeRow(patch: Partial<Row>) {
  return exclusive((db) => updateSync(db, { ...readSync(db), ...patch }))
}

async function writeRowIf(patch: Partial<Row>, allow: (latest: Row) => boolean) {
  return exclusive((db) => {
    const latest = readSync(db)
    if (!allow(latest)) return null
    return updateSync(db, { ...latest, ...patch })
  })
}

function pinnedUrl(value: string) {
  try {
    return assertXaiUrl(value)
  } catch {
    return ''
  }
}

function hasApiKey() {
  loadEnv()
  return Boolean((process.env.XAI_API_KEY || '').trim())
}

function signedIn(row: Row) {
  if (row.refreshToken) return true
  return Boolean(row.accessToken) && !tokenExpiring(row.accessToken, row.expiresAt)
}

export async function oauthPublic(): Promise<OauthPublic> {
  const row = await readRow()
  const pending = Boolean(row.deviceCode && row.deviceExpiresAt > Date.now())
  const verificationUrl = pending ? pinnedUrl(row.verificationUrl) : ''
  const connected = signedIn(row)
  return {
    connected,
    email: row.email,
    billing: connected ? 'subscription' : hasApiKey() ? 'api-key' : 'none',
    pending: pending && Boolean(verificationUrl),
    userCode: pending ? row.userCode : '',
    verificationUrl,
    pollSeconds: row.pollInterval || 5,
    error: row.lastError,
    fallback: row.fallbackNote,
  }
}

async function discover() {
  const found = await transport().getJson(XAI_OAUTH_DISCOVERY_URL)
  if (found.status !== 200) throw new Error('Grok sign-in could not be reached.')
  return discoveryEndpoints(found.json)
}

export async function beginSignIn() {
  try {
    const endpoints = await discover()
    const body = new URLSearchParams({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE })
    const response = await transport().postForm(endpoints.device, body)
    if (response.status !== 200) {
      const detail = safeOauthDetail(response.json)
      return { ok: false as const, message: detail || 'Grok did not start a sign-in.' }
    }
    const challenge = deviceChallenge(response.json)
    await writeRow({
      deviceCode: challenge.deviceCode,
      userCode: challenge.userCode,
      verificationUrl: challenge.verificationUrl,
      pollInterval: challenge.interval,
      deviceExpiresAt: Date.now() + challenge.expiresIn * 1000,
      lastPollAt: Date.now(),
      tokenEndpoint: endpoints.token,
      lastError: 'Waiting for the approval. This page checks xAI every few seconds.',
    })
    return { ok: true as const, message: 'Approve the code on this page. The current sign-in stays until you approve.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Grok sign-in could not be started.'
    return { ok: false as const, message: message.slice(0, 240) }
  }
}

export async function cancelSignIn() {
  await writeRow({
    deviceCode: '',
    userCode: '',
    verificationUrl: '',
    deviceExpiresAt: 0,
    lastPollAt: 0,
  })
  return 'Sign-in cancelled.'
}

export async function disconnectGrok() {
  signInEpoch += 1
  await writeRow({ ...EMPTY })
  return 'Signed out of Grok. Classification uses the API key when one is set.'
}

async function pollOnce() {
  const row = await readRow()
  if (!row.deviceCode) return oauthPublic()
  if (row.deviceExpiresAt <= Date.now()) {
    await writeRow({
      deviceCode: '',
      userCode: '',
      verificationUrl: '',
      deviceExpiresAt: 0,
      lastError: 'That sign-in code expired. Start again.',
    })
    return oauthPublic()
  }
  const wait = Math.max(5, row.pollInterval) * 1000
  if (row.lastPollAt && Date.now() - row.lastPollAt < wait) return oauthPublic()
  const endpoint = pinnedUrl(row.tokenEndpoint)
  if (!endpoint) {
    await writeRow({
      deviceCode: '',
      userCode: '',
      verificationUrl: '',
      deviceExpiresAt: 0,
      lastError: 'Grok sign-in could not be reached.',
    })
    return oauthPublic()
  }
  await writeRow({ lastPollAt: Date.now() })
  const response = await transport().postForm(endpoint, new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: XAI_OAUTH_CLIENT_ID,
    device_code: row.deviceCode,
  }))
  const kind = devicePollKind(response.status, response.json)
  const detail = safeOauthDetail(response.json, row.deviceCode)
  const reported = detail
    ? `xAI replied HTTP ${response.status}: ${detail}`
    : `xAI replied HTTP ${response.status} and no error code.`
  if (kind === 'pending' || kind === 'slow' || kind === 'wait') {
    await writeRow({
      pollInterval: kind === 'slow' ? Math.min(row.pollInterval + 5, 30) : row.pollInterval,
      lastError: kind === 'pending' ? 'xAI has not confirmed that approval yet (authorization_pending).' : reported,
    })
    return oauthPublic()
  }
  if (kind !== 'ok') {
    const detail = safeOauthDetail(response.json, row.deviceCode)
    await writeRow({
      deviceCode: '',
      userCode: '',
      verificationUrl: '',
      deviceExpiresAt: 0,
      lastError: detail || 'The sign-in was declined or expired. Start again.',
    })
    return oauthPublic()
  }
  const grant = deviceGrant(response.json)
  if (!grant) {
    await writeRow({ lastError: 'Grok did not finish the sign-in.' })
    return oauthPublic()
  }
  const saved = await writeRowIf({
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAt: Date.now() + grant.expiresIn * 1000,
    email: grant.email || row.email,
    deviceCode: '',
    userCode: '',
    verificationUrl: '',
    deviceExpiresAt: 0,
    lastPollAt: 0,
    lastError: '',
    fallbackNote: '',
    refreshFailedAt: 0,
  }, (latest) => latest.deviceCode === row.deviceCode)
  if (!saved) return oauthPublic()
  return oauthPublic()
}

export function pollPending() {
  const current = flight()
  if (!current.poll) {
    let pending: Promise<OauthPublic>
    pending = pollOnce().catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Grok sign-in could not be reached.'
      await writeRow({ lastError: message.slice(0, 240) }).catch(() => undefined)
      return oauthPublic()
    }).finally(() => {
      if (current.poll === pending) current.poll = null
    })
    current.poll = pending
  }
  return current.poll
}

async function refreshOnce() {
  const started = signInEpoch
  const row = await readRow()
  if (!row.refreshToken) return null
  if (row.refreshFailedAt && Date.now() - row.refreshFailedAt < 10 * 60 * 1000) return null
  let endpoint = pinnedUrl(row.tokenEndpoint)
  if (!endpoint) {
    try {
      endpoint = (await discover()).token
    } catch {
      if (row.accessToken && !tokenExpiring(row.accessToken, row.expiresAt)) return row.accessToken
      return null
    }
  }
  const sent = row.refreshToken
  const stillOurs = (latest: Row) => started === signInEpoch && latest.refreshToken === sent
  const response = await transport().postForm(endpoint, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: XAI_OAUTH_CLIENT_ID,
    refresh_token: sent,
  }))
  if (response.status === 403) {
    await writeRowIf({
      refreshFailedAt: Date.now(),
      lastError: 'xAI refused this Grok subscription for API access. Classification uses the API key when one is set.',
    }, stillOurs)
    return null
  }
  const grant = response.status === 200 ? refreshGrant(response.json, sent) : null
  if (!grant) {
    if (response.status === 400 || response.status === 401) {
      await writeRowIf({
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
        email: '',
        lastError: 'The Grok sign-in expired. Sign in again.',
        refreshFailedAt: 0,
      }, stillOurs)
      return null
    }
    if (row.accessToken && !tokenExpiring(row.accessToken, row.expiresAt)) return row.accessToken
    await writeRowIf({ lastError: 'The Grok sign-in could not be refreshed.' }, stillOurs)
    return null
  }
  const saved = await writeRowIf({
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAt: Date.now() + grant.expiresIn * 1000,
    email: grant.email || row.email,
    tokenEndpoint: endpoint,
    lastError: '',
    refreshFailedAt: 0,
  }, stillOurs)
  return saved?.accessToken || null
}

export function subscriptionAccessToken() {
  const current = flight()
  if (!current.refresh) {
    let pending: Promise<string | null>
    pending = (async () => {
      try {
        const row = await readRow()
        if (row.accessToken && !tokenExpiring(row.accessToken, row.expiresAt)) return row.accessToken
        if (!row.refreshToken) return null
        return await refreshOnce()
      } catch {
        const row = await readRow().catch(() => null)
        if (row?.accessToken && !tokenExpiring(row.accessToken, row.expiresAt)) return row.accessToken
        return null
      }
    })().finally(() => {
      if (current.refresh === pending) current.refresh = null
    })
    current.refresh = pending
  }
  return current.refresh
}

export function forceRefreshSubscription() {
  const current = flight()
  const previous = current.refresh
  let pending: Promise<string | null>
  pending = (async () => {
    if (previous) await previous.catch(() => null)
    try {
      return await refreshOnce()
    } catch {
      return null
    }
  })().finally(() => {
    if (current.refresh === pending) current.refresh = null
  })
  current.refresh = pending
  return pending
}

export async function noteSubscriptionFallback(message: string) {
  const wrote = await exclusive((db) => {
    const row = readSync(db)
    if (row.fallbackNote === message) return false
    updateSync(db, { ...row, fallbackNote: message })
    return true
  })
  if (!wrote) return
  const { jobLog } = await import('./job')
  jobLog(message)
}

export async function clearSubscriptionFallback() {
  await exclusive((db) => {
    const row = readSync(db)
    if (!row.fallbackNote && !row.lastError.startsWith('xAI refused')) return
    updateSync(db, {
      ...row,
      fallbackNote: '',
      lastError: row.lastError.startsWith('xAI refused') ? '' : row.lastError,
    })
  })
}
