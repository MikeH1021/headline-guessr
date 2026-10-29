import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminSessionValid, sameOrigin } from '@/lib/admin-auth'
import { DEFAULT_ETHNICITY_PROMPT, MODEL_IDS } from '@/lib/constants'
import { validRefreshTime } from '@/lib/feeds'
import { jobSnapshot } from '@/lib/job'
import { clearRum } from '@/lib/rum'
import { addFeed, addHeadline, dealQueued, dropQueued, dropRoundCard, removeFeed, saveSettings, useQueued } from '@/lib/store'
import { startRefresh } from '@/lib/classify'
import { beginSignIn, cancelSignIn, disconnectGrok } from '@/lib/xai-session'
import { publicUrl } from '@/lib/public-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const jar = await cookies()
  if (!sameOrigin(request) || !adminSessionValid(jar.get(ADMIN_COOKIE)?.value || '')) {
    return NextResponse.redirect(publicUrl(request, '/admin/login'), 303)
  }
  const form = await request.formData()
  const action = String(form.get('action') || '')
  let message = ''
  if (action === 'grok_connect') {
    message = (await beginSignIn()).message
  } else if (action === 'grok_cancel') {
    message = await cancelSignIn()
  } else if (action === 'grok_disconnect') {
    message = await disconnectGrok()
  } else if (action === 'refresh') {
    if (form.get('debug_refresh') !== '1') message = 'Check Debug refresh, then run it.'
    else if (!startRefresh('deal')) message = 'A refresh is already running.'
    else message = 'Debug refresh started.'
  } else if (action === 'queue_more') {
    if (!startRefresh('queue')) message = 'A refresh is already running.'
    else message = 'Looking for new headlines. Today’s round stays as it is.'
  } else if (action === 'clear_stats') {
    clearRum()
    message = 'Stats cleared.'
  } else if (action === 'add_feed') {
    message = addFeed(String(form.get('feed_name') || ''), String(form.get('feed_url') || ''))
  } else if (action === 'remove_feed') {
    message = removeFeed(String(form.get('feed_url') || ''))
  } else if (action === 'drop_queue') {
    message = dropQueued(String(form.get('queue_key') || ''), jobSnapshot().running)
  } else if (action === 'use_queue') {
    message = useQueued(String(form.get('queue_key') || ''), jobSnapshot().running)
  } else if (action === 'deal_queue') {
    message = dealQueued(jobSnapshot().running)
  } else if (action === 'drop_round') {
    message = dropRoundCard(String(form.get('queue_key') || ''), jobSnapshot().running)
  } else if (action === 'add_queue' || action === 'add_round') {
    message = addHeadline(action === 'add_round' ? 'round' : 'queue', {
      source: String(form.get('source') || ''),
      headline: String(form.get('headline') || ''),
      ethnicity: String(form.get('ethnicity') || ''),
      url: String(form.get('url') || ''),
    }, jobSnapshot().running)
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
  return NextResponse.redirect(publicUrl(request, `/admin?notice=${encodeURIComponent(message)}`), 303)
}
