import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { db } from './db'
import { loadEnv } from './env'
import { passwordMatches } from './password'
import { publicOrigin } from './public-url'

export const ADMIN_COOKIE = 'hg_admin'
const MAX_AGE_SEC = 60 * 60 * 12
const WINDOW_MS = 15 * 60 * 1000
const PER_IP = 8
const GLOBAL = 40

export function adminCookie(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/admin',
    maxAge: MAX_AGE_SEC,
    secure,
  }
}

export function adminPasswordConfigured() {
  loadEnv()
  return Boolean((process.env.ADMIN_PASSWORD_HASH || '').trim())
}

export function adminPasswordOk(password: string) {
  loadEnv()
  return passwordMatches(password, (process.env.ADMIN_PASSWORD_HASH || '').trim())
}

function since() {
  return Date.now() - WINDOW_MS
}

export function loginLocked(ip: string) {
  const database = db()
  const cutoff = since()
  database.prepare('DELETE FROM admin_attempts WHERE at < ?').run(cutoff)
  const own = database.prepare('SELECT COUNT(*) AS n FROM admin_attempts WHERE ip = ?').get(ip) as { n: number }
  const all = database.prepare('SELECT COUNT(*) AS n FROM admin_attempts').get() as { n: number }
  return own.n >= PER_IP || all.n >= GLOBAL
}

export function noteLoginFailure(ip: string) {
  db().prepare('INSERT INTO admin_attempts (ip, at) VALUES (?, ?)').run(ip.slice(0, 80), Date.now())
}

export function clearLoginFailures(ip: string) {
  db().prepare('DELETE FROM admin_attempts WHERE ip = ?').run(ip.slice(0, 80))
}

export function createAdminSession() {
  const id = randomBytes(32).toString('base64url')
  const database = db()
  database.prepare('INSERT INTO admin_sessions (id, expires_at) VALUES (?, ?)').run(id, Date.now() + MAX_AGE_SEC * 1000)
  database.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now())
  return id
}

export function adminSessionValid(id: string) {
  if (!id || id.length > 80) return false
  const row = db().prepare('SELECT expires_at FROM admin_sessions WHERE id = ?').get(id) as
    | { expires_at: number }
    | undefined
  if (!row) return false
  if (row.expires_at < Date.now()) {
    db().prepare('DELETE FROM admin_sessions WHERE id = ?').run(id)
    return false
  }
  return true
}

export function destroyAdminSession(id: string) {
  if (id) db().prepare('DELETE FROM admin_sessions WHERE id = ?').run(id)
}

export async function adminAuthed() {
  const jar = await cookies()
  return adminSessionValid(jar.get(ADMIN_COOKIE)?.value || '')
}

export function sameOrigin(request: Request) {
  const host = request.headers.get('host') || ''
  if (!host) return false
  const origin = request.headers.get('origin')
  const source = origin || request.headers.get('referer') || ''
  if (!source) return false
  try {
    return new URL(source).host === host
  } catch {
    return false
  }
}

export function requestIsSecure(request: Request) {
  return publicOrigin(request).startsWith('https:')
}
