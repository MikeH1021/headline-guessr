import {
  CANDIDATE_SIZE,
  CHARGE_REOPEN,
  ETHNICITIES,
  ETHNICITY_CONCURRENCY,
  ETHNICITY_SCHEMA,
  FEED_SCAN,
  PICK_SCHEMA,
  QUEUE_TAKE,
  QUEUE_TARGET,
  ROUND_SIZE,
  SCREEN_BATCH,
  SHORT_REOPEN,
} from './constants'
import { interleave, sameEvent } from './deal'
import { HeadlineError } from './errors'
import { canonicalEthnicity } from './ethnicity'
import { grok } from './grok'
import { jobLog, jobSet, jobSnapshot, markRefreshFinished, markRefreshStarted } from './job'
import { storiesFrom, storyCopy, takeUnseen, type GatheredStory } from './rss'
import { markSeen, seenStatuses } from './seen'
import { chargeHeadline, chargedStory, headlineKey } from './text'
import { appendQueue, currentFeeds, currentPrompt, currentRefreshTime, metaValue, readQueue, readRound, saveRound, setMeta, takeRound } from './store'
import { localISO } from './time'

type PickedStory = GatheredStory & { event: string }

function applyPicks(stories: GatheredStory[], picks: unknown, priorEvents: string[] = [], limit?: number) {
  const chosen: PickedStory[] = []
  const usedIds = new Set<number>()
  const usedEvents = [...priorEvents]
  const cap = limit === undefined ? CANDIDATE_SIZE : limit
  if (!Array.isArray(picks)) return chosen
  for (const pick of picks) {
    if (!pick || typeof pick !== 'object') continue
    const record = pick as Record<string, unknown>
    const index = Number(record.id)
    const event = String(record.event || '').trim()
    if (!Number.isInteger(index) || usedIds.has(index) || index < 0 || index >= stories.length || !event) continue
    const folded = event.toLowerCase()
    if (usedEvents.some((prior) => sameEvent(folded, prior))) continue
    usedIds.add(index)
    usedEvents.push(folded)
    chosen.push({
      source: stories[index].source,
      headline: stories[index].headline,
      url: stories[index].url,
      rssCopy: stories[index].rssCopy || '',
      event,
    })
    if (chosen.length >= cap) break
  }
  return chosen
}

async function screenStories(stories: GatheredStory[], priorEvents: string[] = [], limit?: number) {
  const numbered = stories.map((story, index) => ({ id: index, source: story.source, headline: story.headline }))
  const pickLimit = limit || Math.min(CANDIDATE_SIZE, stories.length)
  const instructions = `Screen these headlines for a game. Pick at most ${pickLimit}. `
    + 'Keep a headline only when its subject is a specific crime that has been committed: '
    + 'someone was attacked, killed, robbed, kidnapped, sexually assaulted, or otherwise victimized. '
    + 'An arrest or a charge for that crime is still the crime. Keep charged, arrested, accused, or in custody '
    + 'when the headline names the attack, killing, robbery, or other victimization. '
    + 'Reject a headline that is mainly a sentence, an appeal, a retrial, a verdict, or a lawsuit, and does not report the crime. '
    + 'Reject politics, policy, explainers, and roundups of unrelated crimes. '
    + 'Each pick must be a different crime. If several headlines cover one event, such as the same school shooting, '
    + 'keep only the single clearest report of that crime. '
    + 'Use a mix of publications when you can. Use only the id numbers given. Do not rewrite headlines.'
  const { parsed, reasoning } = await grok(
    `${instructions}\n\nHeadlines:\n${JSON.stringify(numbered)}`,
    'headline_picks',
    PICK_SCHEMA,
    'headline screening',
  )
  if (reasoning) jobLog('Screening notes.', reasoning)
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as { picks?: unknown } : null
  if (!record || !Array.isArray(record.picks)) {
    throw new HeadlineError('Grok returned a screening result that could not be read.')
  }
  return applyPicks(stories, record.picks, priorEvents, pickLimit)
}

async function assignEthnicities(stories: { source: string; headline: string; copy: string }[]) {
  const numbered = stories.map((story, index) => ({
    id: index,
    source: story.source,
    headline: story.headline,
    copy: story.copy,
  }))
  const instructions = `${currentPrompt().trim()}\n\nWeb search is available. If the article does not state the perpetrator's ethnicity, search for other news reports on the same incident or person and read them. If that search does not state it, search again with a different query. `
    + `Set stated to true only when the article or one of those news reports explicitly states an ethnicity, and only when it is one of ${ETHNICITIES.join(', ')}. `
    + 'Otherwise set stated to false and ethnicity to null. Do not infer ethnicity from a name, a photo, a neighborhood, or a stereotype. Do not include a person\'s name.'
    + `\n\nArticles:\n${JSON.stringify(numbered)}`
  const { parsed, reasoning } = await grok(
    instructions,
    'ethnicity_answers',
    ETHNICITY_SCHEMA,
    'ethnicity',
    [{ type: 'web_search' }],
    'high',
  )
  if (reasoning) jobLog('Ethnicity notes.', reasoning)
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as { answers?: unknown } : null
  if (!record || !Array.isArray(record.answers)) {
    throw new HeadlineError('Grok returned an ethnicity result that could not be read.')
  }
  const byId = new Map<number, string>()
  for (const answer of record.answers) {
    if (!answer || typeof answer !== 'object') continue
    const row = answer as Record<string, unknown>
    if (!row.stated) continue
    const index = Number(row.id)
    const label = canonicalEthnicity(row.ethnicity)
    if (label && Number.isInteger(index) && index >= 0 && index < stories.length) byId.set(index, label)
  }
  const chosen: { source: string; headline: string; ethnicity: string }[] = []
  stories.forEach((story, index) => {
    const label = byId.get(index)
    if (!label) return
    chosen.push({ source: story.source, headline: story.headline, ethnicity: label })
  })
  return chosen.slice(0, ROUND_SIZE)
}

async function classifyOne(story: GatheredStory) {
  jobLog(`Article: ${story.source} — ${story.headline}`)
  const page = await storyCopy(story)
  const copy = page.length >= 200 ? page : `${story.headline}\n\n${story.rssCopy || page}`.trim()
  if (copy.length < 40) {
    markSeen(story.headline, story.url, 'short')
    jobLog('Skipped. The article page did not include enough text.')
    return 'skip'
  }
  const answered = await assignEthnicities([{ source: story.source, headline: story.headline, copy }])
  if (!answered.length) {
    markSeen(story.headline, story.url, 'unstated')
    jobLog('Not stated. Skipped.')
    return 'done'
  }
  const card = { ...answered[0], url: story.url || '' }
  const { length, added, duplicate } = appendQueue(card)
  markSeen(story.headline, story.url, 'queued')
  jobSet({ kept: length })
  if (added) jobLog(`Stated: ${card.ethnicity}. Queue has ${length}.`)
  else jobLog(duplicate ? 'Same incident as a story already queued.' : 'Already in the queue.')
  return 'done'
}

async function readSlot(waiting: PickedStory[], stopAt: number) {
  while (waiting.length) {
    if (readQueue().length >= stopAt) return
    const story = waiting.shift()
    if (!story) return
    try {
      if (await classifyOne(story) !== 'skip') return
    } catch (err) {
      const message = err instanceof HeadlineError ? err.message : 'That article could not be read.'
      if (!message.includes('xai-')) jobLog(message)
      return
    }
  }
}

async function classifySpread(picked: PickedStory[], stopAt: number) {
  const waiting = [...picked]
  let pass = 0
  while (waiting.length) {
    if (readQueue().length >= stopAt) {
      jobLog(stopAt > ROUND_SIZE
        ? `The queue has enough for more than one round. Later headlines were left for the next run.`
        : `The queue can fill a round of ${ROUND_SIZE}. Later headlines in this pass were left for the next run.`)
      break
    }
    pass += 1
    const slots = Math.min(ETHNICITY_CONCURRENCY, waiting.length)
    jobLog(`Pass ${pass}. Reading ${slots} ${slots === 1 ? 'article' : 'articles'} at once.`)
    await Promise.all(Array.from({ length: slots }, () => readSlot(waiting, stopAt)))
  }
}

async function searchHeadlines(stopAt: number) {
  const feeds = currentFeeds()
  jobLog(`Fetching ${feeds.length} crime RSS feeds. Reading past already-checked headlines, up to ${QUEUE_TAKE} new ones from each.`)
  const fetched = await Promise.all(feeds.map(async (feed) => {
    try {
      return await storiesFrom(feed, FEED_SCAN)
    } catch {
      return null
    }
  }))
  const heldHeadlines: string[] = []
  const held = new Set<string>()
  for (const card of [...readQueue(), ...(readRound()?.cards || [])]) {
    const key = headlineKey(card.headline)
    if (key) held.add(key)
    if (card.headline) heldHeadlines.push(card.headline)
  }
  let reopened = 0
  let reopenedShort = 0
  const seenStory = (story: GatheredStory) => {
    const key = headlineKey(story.headline)
    if (key && held.has(key)) {
      markSeen(story.headline, story.url, 'queued')
      return true
    }
    const statuses = seenStatuses(story.headline, story.url)
    if (!statuses.length) return false
    if (
      statuses.every((status) => status === 'screened')
      && chargeHeadline(story.headline)
      && reopened < CHARGE_REOPEN
    ) {
      reopened += 1
      return false
    }
    if (statuses.every((status) => status === 'short') && reopenedShort < SHORT_REOPEN) {
      reopenedShort += 1
      return false
    }
    return true
  }
  let passed = 0
  const groups = feeds.map((feed, index) => {
    const batch = fetched[index]
    if (!batch) {
      jobLog(`${feed.name}: the feed could not be read.`)
      return []
    }
    const found = batch.map((story) => {
      const named = chargedStory(story.source, story.headline)
      return named.source === story.source && named.headline === story.headline ? story : { ...story, ...named }
    })
    const { fresh: unseen, checked } = takeUnseen(found, seenStory, QUEUE_TAKE)
    passed += checked
    jobLog(`${feed.name}: ${unseen.length} new. ${checked} already checked.`)
    return unseen
  })
  const fresh = interleave(groups, Math.max(1, feeds.length) * QUEUE_TAKE)
  jobLog(`Collected ${fresh.length} headlines from ${feeds.length} feeds. ${passed} already checked. ${fresh.length} new.`)
  if (reopened) jobLog(`Including ${reopened} arrest headlines that were screened before.`)
  if (reopenedShort) jobLog(`Including ${reopenedShort} headlines whose pages were too short to read before.`)
  const prior: string[] = [...held]
  if (!fresh.length) {
    jobLog('No new headlines. Grok was not called.')
    return
  }
  jobLog('Screening the new headlines for distinct crimes.')
  for (let start = 0; start < fresh.length; start += SCREEN_BATCH) {
    if (readQueue().length >= stopAt) break
    const batch = fresh.slice(start, start + SCREEN_BATCH)
    jobLog(`Screening headlines ${start + 1}–${start + batch.length}.`)
    const chosen = await screenStories(batch, prior, batch.length)
    const chosenKeys = new Set(chosen.map((story) => headlineKey(story.headline)))
    for (const story of batch) {
      if (!chosenKeys.has(headlineKey(story.headline))) {
        markSeen(story.headline, story.url, chargeHeadline(story.headline) ? 'drop' : 'screened')
      }
    }
    const ready: PickedStory[] = []
    for (const story of chosen) {
      if (heldHeadlines.some((headline) => sameEvent(story.headline, headline))) {
        markSeen(story.headline, story.url, 'queued')
        jobLog('Same incident as a story already queued.')
        continue
      }
      heldHeadlines.push(story.headline)
      prior.push(story.event.toLowerCase())
      ready.push(story)
      jobLog(`Candidate: ${story.source} — ${story.headline}`)
    }
    if (!ready.length) {
      jobLog('No new crimes in this batch.')
      continue
    }
    jobLog(`Reading ${ready.length} ${ready.length === 1 ? 'candidate' : 'candidates'}. Confirmed articles join the queue.`)
    await classifySpread(ready, stopAt)
  }
}

async function classifyDaily(deal: boolean) {
  if (!(process.env.XAI_API_KEY || '').trim()) {
    throw new HeadlineError('Add your xAI API key as XAI_API_KEY in a .env file in this folder, then restart the app.')
  }
  const stopAt = QUEUE_TARGET
  if (readQueue().length >= stopAt) {
    jobLog(`The queue already has ${readQueue().length}, enough for more than one round.`)
  } else {
    await searchHeadlines(stopAt)
  }
  if (!deal) {
    jobLog(`Queue has ${readQueue().length}. Today’s round was left as it is.`)
    return
  }
  if (readQueue().length < ROUND_SIZE) {
    jobLog(`Queue has ${readQueue().length}. A round needs ${ROUND_SIZE} confirmed headlines, so today’s round was left as it is.`)
    return
  }
  const { dealt, rest } = takeRound()
  saveRound(dealt)
  for (const card of dealt) markSeen(card.headline, card.url || '', 'round')
  jobSet({ kept: dealt.length })
  if (dealt.length) jobLog(`Round: ${dealt.map((card) => card.source).join(', ')}.`)
  jobLog(`Done. ${dealt.length} in the round. ${rest.length} left in the queue.`)
}

async function refreshWorker(deal: boolean) {
  let error = ''
  try {
    await classifyDaily(deal)
  } catch (err) {
    error = err instanceof HeadlineError ? err.message : 'The refresh failed.'
    if (error.includes('xai-')) error = 'The refresh failed.'
    jobLog(error)
  }
  markRefreshFinished(error)
}

export function startRefresh(mode: 'deal' | 'queue' = 'deal') {
  if (!markRefreshStarted()) return false
  void refreshWorker(mode === 'deal')
  return true
}

export async function maybeDaily() {
  const now = new Date()
  const [hour, minute] = currentRefreshTime().split(':').map((part) => Number(part))
  const scheduled = new Date(now)
  scheduled.setHours(hour, minute, 0, 0)
  if (now < scheduled) return
  const today = localISO(now)
  if (metaValue('deal_on') === today) return
  const round = readRound()
  if (round?.refreshedOn === today && round.cards.length >= ROUND_SIZE) return
  if (jobSnapshot().running) return
  setMeta('deal_on', today)
  if (!startRefresh()) setMeta('deal_on', '')
}