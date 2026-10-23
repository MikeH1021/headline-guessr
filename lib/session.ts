import { headers } from 'next/headers'
import { loadSession, newSessionId, saveSession } from './store'
import type { SessionData } from './types'

export const SESSION_COOKIE = 'hg'

export function emptySession(): SessionData {
  return {
    userId: String(1000 + Math.floor(Math.random() * 9000)),
    stories: [],
    correctAnswers: [],
    lastResult: null,
  }
}

export async function currentSession() {
  const headerList = await headers()
  const headerId = headerList.get('x-session') || ''
  const id = headerId || newSessionId()
  const loaded = headerId ? loadSession(headerId) : null
  const data = loaded || emptySession()
  if (!loaded) saveSession(id, data)
  return { id, data }
}
