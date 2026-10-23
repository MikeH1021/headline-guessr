import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminSessionValid, sameOrigin } from '@/lib/admin-auth'
import { DEFAULT_ETHNICITY_PROMPT, MODEL_IDS } from '@/lib/constants'
import { validRefreshTime } from '@/lib/feeds'
import { jobSnapshot } from '@/lib/job'
import { clearRum } from '@/lib/rum'
import { addFeed, dropQueued, removeFeed, saveSettings } from '@/lib/store'
import { startRefresh } from '@/lib/classify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const jar = await cookies()
  if (!sameOrigin(request) || !adminSessionValid(jar.get(ADMIN_COOKIE)?.value || '')) {
    return NextResponse.redirect(new URL('/admin/login', request.url), 303)
  }
  const form = await request.formData()
  const action = String(form.get('action') || '')
  let message = ''
  if (action === 'refresh') {
    if (form.get('debug_refresh') !== '1') message = 'Check Debug refresh, then run it.'
    else if (!startRefresh()) message = 'A refresh is already running.'
    else message = 'Debug refresh started.'
  } else if (action === 'clear_stats') {
    clearRum()
    message = 'Stats cleared.'
  } else if (action === 'add_feed') {
    message = addFeed(String(form.get('feed_name') || ''), String(form.get('feed_url') || ''))
  } else if (action === 'remove_feed') {
    message = removeFeed(String(form.get('feed_url') || ''))
  } else if (action === 'drop_queue') {
    message = dropQueued(String(form.get('queue_key') || ''), jobSnapshot().running)
  } else {
    const chosen = String(form.get('model') || '')
    const refreshTime = String(form.get('refresh_time') || '')
    const prompt = action === 'reset' ? DEFAULT_ETHNICITY_PROMPT : String(form.get('prompt') || '')
    if (!MODEL_IDS.has(chosen)) message = 'That model is not available.'
    else if (!validRefreshTime(refreshTime)) message = 'Choose a refresh time.'
    else if (!prompt.trim()) message = 'The prompt cannot be empty.'
    else {
      saveSettings(chosen, prompt.trim(), refreshTime)
      message = `Saved. The daily refresh runs at ${refreshTime}. The model is ${chosen}.`
    }
  }
  return NextResponse.redirect(new URL(`/admin?notice=${encodeURIComponent(message)}`, request.url), 303)
}
