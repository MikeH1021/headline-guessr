import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomBytes, scryptSync } from 'crypto'
import { dealQueue, interleave, sameEvent } from '../lib/deal'
import { feedName, feedUrl, publicFeedUrl } from '../lib/feeds'
import { passwordMatches } from '../lib/password'
import { publicOrigin } from '../lib/public-url'
import { accuracyPercentile, median, ordinal, paceLabel, percentileRank, pythonRound, rankForScore, rankTier } from '../lib/scoring'
import { canonicalEthnicity } from '../lib/ethnicity'
import { shortRoundLabel } from '../lib/time'
import {
  XAI_OAUTH_DISCOVERY_URL,
  devicePollKind,
  emailFromIdToken,
  refreshGrant,
  tokenExpiring,
  xaiUrlProblem,
} from '../lib/xai-oauth'
import { articleText, storiesFromRss, takeUnseen } from '../lib/rss'
import { DEFAULT_FEEDS, QUEUE_TARGET, ROUND_SIZE, SHORT_REOPEN } from '../lib/constants'
import { articleHost, articleHref, chargeFirst, chargeHeadline, chargedStory, headlineKey, seenArticleUrl } from '../lib/text'

assert.equal(pythonRound(12.5), 12)
assert.equal(pythonRound(13.5), 14)
assert.equal(accuracyPercentile(1, 8), 12)
assert.equal(accuracyPercentile(0, 4), 1)
assert.equal(accuracyPercentile(2, 4), 50)
assert.equal(accuracyPercentile(4, 4), 100)

assert.equal(percentileRank(2, [2, 0, 1, 0], 4), 50)
assert.equal(rankTier(50).id, 'normie')
assert.equal(rankTier(50).title, 'Normie')
assert.equal(percentileRank(4, [4], 4), 100)
assert.equal(rankTier(100).title, 'Pattern recognition machine')
assert.equal(percentileRank(0, [0], 4), 1)
assert.equal(rankTier(1).title, 'Brainwashed liberal')
assert.equal(percentileRank(2, [2, 2, 2], 4), 50)
assert.equal(percentileRank(3, [3, 1, 0, 2], 4), 75)
assert.equal(accuracyPercentile(5, 6), 83)
assert.equal(percentileRank(5, [6, 5, 6], 6), 1)
assert.equal(rankForScore(5, 6).id, 'noticer')
assert.equal(rankForScore(5, 6).title, 'High-level noticer')
assert.equal(rankTier(94).title, 'Based autist')
assert.equal(rankTier(85).id, 'autist')
assert.equal(rankTier(95).id, 'machine')

assert.equal(ordinal(1), '1st')
assert.equal(ordinal(2), '2nd')
assert.equal(ordinal(3), '3rd')
assert.equal(ordinal(4), '4th')
assert.equal(ordinal(11), '11th')
assert.equal(ordinal(12), '12th')
assert.equal(ordinal(13), '13th')
assert.equal(ordinal(21), '21st')
assert.equal(ordinal(22), '22nd')
assert.equal(shortRoundLabel('2026-10-22', new Date(2026, 9, 23)), 'Oct 22')
assert.equal(shortRoundLabel('2025-01-03', new Date(2026, 9, 23)), 'Jan 3, 2025')
assert.equal(shortRoundLabel('nope', new Date(2026, 9, 23)), 'nope')
assert.equal(shortRoundLabel('2026-02-31', new Date(2026, 9, 23)), '2026-02-31')

function fakeJwt(exp: number, email = 'player@example.com') {
  return `hdr.${Buffer.from(JSON.stringify({ exp, email })).toString('base64url')}.sig`
}
assert.equal(xaiUrlProblem('https://auth.x.ai/oauth2/token'), '')
assert.equal(xaiUrlProblem('https://api.x.ai/v1/responses'), '')
assert.equal(xaiUrlProblem('http://auth.x.ai/oauth2/token'), 'scheme')
assert.equal(xaiUrlProblem('https://evil.example/token'), 'origin')
assert.equal(xaiUrlProblem('https://auth.x.ai.evil.com/token'), 'origin')
assert.equal(xaiUrlProblem('https://user:pass@auth.x.ai/token'), 'host')
assert.equal(emailFromIdToken(fakeJwt(1_900_000_000, 'player@example.com')), 'player@example.com')
assert.equal(emailFromIdToken('not-a-token'), '')
assert.equal(tokenExpiring(fakeJwt(Math.floor(Date.now() / 1000) + 7200), 0), false)
assert.equal(tokenExpiring(fakeJwt(Math.floor(Date.now() / 1000) + 30), 0), true)
assert.equal(devicePollKind(400, { error: 'authorization_pending' }), 'pending')
assert.equal(devicePollKind(400, { error: 'slow_down' }), 'slow')
assert.equal(devicePollKind(429, null), 'slow')
assert.equal(devicePollKind(200, { access_token: 'access-only', expires_in: 900 }), 'ok')
assert.equal(devicePollKind(201, { access_token: 'access-only', refresh_token: 'refresh-new', expires_in: 900 }), 'ok')
assert.equal(devicePollKind(500, { error: 'server_error' }), 'wait')
assert.equal(devicePollKind(400, { error: 'access_denied' }), 'denied')
assert.equal(refreshGrant({ access_token: 'access-new', expires_in: 3600 }, 'refresh-old')?.refreshToken, 'refresh-old')
assert.equal(refreshGrant({ access_token: 'access-new', expires_in: 3600 }) , null)
assert.equal(XAI_OAUTH_DISCOVERY_URL, 'https://auth.x.ai/.well-known/openid-configuration')

assert.equal(median([34 * 60 * 1000, 90_000].filter((ms) => ms <= 15 * 60 * 1000)), 90_000)
assert.equal(paceLabel(90_000), '1m 30s')

const queue = [
  ...[0, 1, 2, 3].map((index) => ({ source: 'CNN', headline: `c${index}`, ethnicity: 'White' })),
  { source: 'Fox', headline: 'f', ethnicity: 'White' },
  { source: 'NBC', headline: 'n', ethnicity: 'White' },
  ...[0, 1, 2, 3].map((index) => ({ source: 'Post', headline: `p${index}`, ethnicity: 'White' })),
]
assert.deepEqual(
  dealQueue(queue, 10).dealt.map((card) => card.source),
  ['CNN', 'Fox', 'NBC', 'Post', 'CNN', 'Post', 'CNN', 'Post', 'CNN', 'Post'],
)
assert.deepEqual(
  interleave([[{ headline: 'A1' }, { headline: 'A2' }], [{ headline: 'B1' }]], 10).map((story) => story.headline),
  ['A1', 'B1', 'A2'],
)
assert.equal(sameEvent('school shooting', 'the school shooting downtown'), true)
const frat = 'Sexual assault reported at frat house near University of Chicago over the weekend'
const fratFollow = 'No arrests in wake of reported sexual assault at University of Chicago frat house, police say'
const fratCheer = 'Group cheered as woman was sexually assaulted at University of Chicago frat house, police report says'
const otherFrat = 'Another woman says she was sexually assaulted at a University of Chicago fraternity party'
assert.equal(sameEvent(frat, fratFollow), true)
assert.equal(sameEvent(frat, fratCheer), true)
assert.equal(sameEvent(fratFollow, fratCheer), true)
assert.equal(sameEvent(frat, otherFrat), false)
assert.equal(sameEvent('Girl, 15, killed in Arcadia; suspect suffers self-inflicted gunshot wound in Pasadena', 'Gun jammed when neo-Nazi attempted mass shooting at Hindu temple in Aurora'), false)
assert.equal(sameEvent('Woman accused of shoving 73-year-old CTA passenger off Loop bus', '3 who beat, dragged 65-year-old man off Red Line train sought by police'), false)
const dealtDupes = dealQueue([
  { source: 'WGN', headline: frat, ethnicity: 'Asian' },
  { source: 'Sun', headline: fratFollow, ethnicity: 'Asian' },
  { source: 'Mail', headline: 'Axe attack on his elderly parents', ethnicity: 'White' },
], 10)
assert.deepEqual(dealtDupes.dealt.map((card) => card.source), ['WGN', 'Mail'])
assert.equal(dealtDupes.rest.length, 0)
assert.equal(feedUrl('javascript:alert(1)'), '')
assert.equal(feedUrl('https://example.com/crime/feed'), 'https://example.com/crime/feed')
assert.equal(publicFeedUrl('https://example.com/crime/feed'), 'https://example.com/crime/feed')
assert.equal(publicFeedUrl('http://127.0.0.1/feed'), '')
assert.equal(publicFeedUrl('http://169.254.169.254/latest'), '')
assert.equal(publicFeedUrl('http://10.1.2.3/feed'), '')
assert.equal(publicFeedUrl('https://localhost/feed'), '')
assert.equal(publicFeedUrl('https://user:pass@example.com/feed'), '')
assert.equal(articleHref('https://example.com/story'), 'https://example.com/story')
assert.equal(articleHref('javascript:alert(1)'), '')
assert.equal(articleHref('https://user:pass@example.com/story'), '')
assert.equal(articleHost('https://www.example.com/story'), 'example.com')
assert.equal(articleHost('https://chicago.suntimes.com/crime/x'), 'chicago.suntimes.com')
assert.equal(articleHost('https://news.google.com/rss/articles/abc'), '')
assert.equal(DEFAULT_FEEDS.length, 44)
assert.deepEqual(DEFAULT_FEEDS.slice(-4).map(([name]) => name), ['Charged', 'Murder charges', 'Attempted murder', 'Kidnapping'])
assert.equal(publicFeedUrl(DEFAULT_FEEDS[DEFAULT_FEEDS.length - 1][1]), DEFAULT_FEEDS[DEFAULT_FEEDS.length - 1][1])
assert.equal(seenArticleUrl('https://example.com/short'), '')
assert.equal(seenArticleUrl(`https://news.google.com/rss/articles/${'a'.repeat(320)}`).includes('news.google.com'), true)
assert.deepEqual(
  chargeFirst([
    { headline: 'Shots fired overnight' },
    { headline: 'Man charged with murder after the shooting' },
    { headline: 'Police seek a suspect' },
  ]).map((story) => story.headline),
  ['Man charged with murder after the shooting', 'Shots fired overnight', 'Police seek a suspect'],
)
assert.equal(QUEUE_TARGET, 20)
assert.equal(SHORT_REOPEN, 40)
assert.ok(QUEUE_TARGET > ROUND_SIZE)
assert.deepEqual(
  chargedStory('Charged', 'Man charged with murder after the remains were found - KMOV'),
  { source: 'KMOV', headline: 'Man charged with murder after the remains were found' },
)
assert.deepEqual(
  chargedStory('WGN', 'Sexual assault reported at a house - weekend'),
  { source: 'WGN', headline: 'Sexual assault reported at a house - weekend' },
)
assert.deepEqual(
  chargedStory('Murder charges', 'Man charged with murder after the remains were found - KMOV', true),
  { source: 'KMOV', headline: 'Man charged with murder after the remains were found' },
)
const salt = randomBytes(16)
const sample = scryptSync('sample-pass', salt, 32, { N: 16384, r: 8, p: 1 })
const stored = `scrypt:16384:8:1:${salt.toString('base64url')}:${sample.toString('base64url')}`
assert.equal(passwordMatches('sample-pass', stored), true)
assert.equal(passwordMatches('wrong-pass', stored), false)
assert.equal(passwordMatches('sample-pass', 'scrypt$1$1$1$aa$bb'), false)

const dockerRequest = new Request('https://0.0.0.0:3000/admin/session', {
  headers: {
    host: 'helios:8110',
    origin: 'http://helios:8110',
    'x-forwarded-proto': 'https',
  },
})
assert.equal(publicOrigin(dockerRequest), 'http://helios:8110')
const httpsRequest = new Request('http://0.0.0.0:3000/admin/session', {
  headers: {
    host: 'helios.example:8110',
    origin: 'https://helios.example:8110',
  },
})
assert.equal(publicOrigin(httpsRequest), 'https://helios.example:8110')
process.env.PUBLIC_ORIGIN = 'https://headlineguessr.com'
assert.equal(publicOrigin(dockerRequest), 'https://headlineguessr.com')
const siteRequest = new Request('http://0.0.0.0:3000/admin/session', {
  headers: { host: 'headlineguessr.com', origin: 'https://headlineguessr.com' },
})
assert.equal(publicOrigin(siteRequest), 'https://headlineguessr.com')
delete process.env.PUBLIC_ORIGIN
assert.equal(feedName(''), '')
assert.equal(feedName('Boston Herald'), 'Boston Herald')

const parsed = storiesFromRss(`<?xml version="1.0"?>
<rss><channel>
  <item><title>Man arrested after the robbery</title><link>https://example.com/a</link><description>Police described the scene.</description></item>
  <item><title>Clip</title><link>https://example.com/video/clip</link><description>Skip</description></item>
  <item><title>&lt;b&gt;Second &amp; last&lt;/b&gt;</title><link>https://example.com/b</link></item>
</channel></rss>`)
assert.deepEqual(parsed.map((story) => story.headline), ['Man arrested after the robbery', 'Second & last'])
const encoded = Array.from({ length: 1001 }, () => '&amp;').join('')
const wide = storiesFromRss(`<?xml version="1.0"?><rss><channel><item><title>Arrest ${encoded} reported</title><link>https://example.com/wide</link></item></channel></rss>`)
assert.equal(wide.length, 1)
assert.equal(wide[0]?.headline.startsWith('Arrest '), true)

const older = Array.from({ length: 20 }, (_, index) => index)
const dug = takeUnseen(older, (index) => index < 16, 16)
assert.deepEqual(dug.fresh, [16, 17, 18, 19])
assert.equal(dug.checked, 16)
const capped = takeUnseen(older, (index) => index < 2, 4)
assert.deepEqual(capped.fresh, [2, 3, 4, 5])
assert.equal(capped.checked, 2)
assert.equal(canonicalEthnicity('Latino'), 'Hispanic')
assert.equal(canonicalEthnicity('Latina'), 'Hispanic')
assert.equal(canonicalEthnicity('African-American'), 'Black')
assert.equal(canonicalEthnicity('Caucasian'), 'White')
assert.equal(canonicalEthnicity('Middle-Eastern'), 'Middle Eastern')
assert.equal(canonicalEthnicity('White'), 'White')
assert.equal(canonicalEthnicity('Chinese'), '')
assert.equal(canonicalEthnicity('mixed'), '')
assert.equal(chargeHeadline('Man charged with murder after the shooting'), true)
assert.equal(chargeHeadline('Suspect arrested in the robbery'), true)
assert.equal(chargeHeadline('4 injured in a drive-by shooting'), false)
assert.equal(chargeHeadline('Man sentenced for the killing'), false)
assert.equal(chargeHeadline('Lawsuit claims he was assaulted'), false)
const stated = 'Police said the suspect, described as a Black man, was arrested after the robbery downtown. '
const body = `<html><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","articleBody":"${stated.repeat(4)}"}]}</script><p>Menu item that should not win.</p></html>`
assert.ok(articleText(body).includes('described as a Black man'))
assert.ok(articleText(body).length >= 200)

const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-legacy-'))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-data-'))
const scores = JSON.stringify([{ round: '2026-10-22:1', score: 1 }])
const round = JSON.stringify({
  refreshed_on: '2026-10-22',
  refreshed_at: '2026-10-22 12:00:00',
  cards: [{ source: 'CBS', headline: 'A reported robbery downtown', ethnicity: 'White', url: 'https://example.com/robbery' }],
})
fs.writeFileSync(path.join(legacy, 'scores.json'), scores)
fs.writeFileSync(path.join(legacy, 'round.json'), round)
fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify({
  model: 'grok-4.3',
  prompt: 'Keep the explicit rule.',
  refresh_time: '06:00',
}))
const scoreMtime = fs.statSync(path.join(legacy, 'scores.json')).mtimeMs
process.env.DATA_DIR = data
process.env.LEGACY_DIR = legacy

async function checkImport() {
  const { db } = await import('../lib/db')
  const database = db()
  const count = database.prepare('SELECT COUNT(*) AS n FROM scores').get() as { n: number }
  assert.equal(count.n, 1)
  assert.equal(fs.readFileSync(path.join(legacy, 'scores.json'), 'utf8'), scores)
  assert.equal(fs.statSync(path.join(legacy, 'scores.json')).mtimeMs, scoreMtime)

  const { grokBody } = await import('../lib/grok')
  const high = grokBody('grok-4.7', 'x', 'n', { type: 'object' }, undefined, 'high') as { reasoning?: { effort: string } }
  const low = grokBody('grok-4.7', 'x', 'n', { type: 'object' }) as { reasoning?: { effort: string } }
  const olderModel = grokBody('grok-4.3', 'x', 'n', { type: 'object' }, undefined, 'high') as { reasoning?: unknown }
  assert.equal(high.reasoning?.effort, 'high')
  assert.equal(low.reasoning?.effort, 'low')
  assert.equal(olderModel.reasoning, undefined)

  const { currentModel, readRound } = await import('../lib/store')
  const { buildRound } = await import('../lib/roundview')
  assert.equal(currentModel(), 'grok-4.3')
  assert.equal(readRound()?.cards.length, 1)
  assert.equal(buildRound()[0].ethnicity, 'White')
  assert.equal(readRound()?.cards[0].url, 'https://example.com/robbery')

  const { saveRound, readArchive, listArchives, addHeadline, useQueued, dropRoundCard, readQueue: queueNow } = await import('../lib/store')
  const { hasSeen, markSeen } = await import('../lib/seen')
  saveRound(
    [{ source: 'CBS', headline: 'First saved robbery downtown', ethnicity: 'White', url: 'javascript:alert(1)' }],
    new Date(2026, 9, 20, 12, 0, 0),
  )
  assert.equal(readArchive('2026-10-20')?.cards[0].url, undefined)
  saveRound(
    [{ source: 'CBS', headline: 'First saved robbery downtown', ethnicity: 'White', url: 'https://example.com/first' }],
    new Date(2026, 9, 20, 12, 0, 0),
  )
  assert.equal(readArchive('2026-10-20')?.cards[0].url, 'https://example.com/first')
  saveRound(
    [{ source: 'NY Post', headline: 'Second saved robbery downtown', ethnicity: 'Black' }],
    new Date(2026, 9, 21, 12, 0, 0),
  )
  assert.equal(readArchive('2026-10-20')?.cards[0].ethnicity, 'White')
  assert.equal(readArchive('2026-10-21')?.cards.length, 1)
  assert.ok(listArchives().some((item) => item.refreshedOn === '2026-10-20'))
  assert.equal(hasSeen('A brand new headline', 'https://example.com/new'), false)
  markSeen('A brand new headline', 'https://example.com/new', 'screened')
  assert.equal(hasSeen('A brand new headline', 'https://example.com/new'), true)
  assert.equal(
    addHeadline('queue', {
      source: 'Boston Herald',
      headline: 'Man arrested after the harbor theft',
      ethnicity: 'Hispanic',
      url: 'https://example.com/harbor',
    }, false),
    'Added to the queue. 1 waiting.',
  )
  const queued = queueNow()
  assert.equal(queued.length, 1)
  assert.equal(useQueued(queued[0] ? queued[0].headline.toLowerCase() : '', false).includes('Moved'), true)
  assert.equal(readArchive('2026-10-21')?.cards.length, 2)
  assert.equal(queueNow().length, 0)
  const longUrl = `https://news.google.com/rss/articles/${'a'.repeat(280)}`
  assert.ok(longUrl.length > 300)
  assert.equal(feedUrl(longUrl), '')
  assert.equal(articleHref(longUrl), longUrl)
  assert.equal(
    addHeadline('queue', {
      source: 'KMOV',
      headline: 'Man charged with murder after the long article link',
      ethnicity: 'White',
      url: longUrl,
    }, false),
    'Added to the queue. 1 waiting.',
  )
  assert.equal(queueNow()[0]?.url, longUrl)
  assert.equal(
    addHeadline('queue', {
      source: 'KMOV',
      headline: 'Man charged with murder after a bad link',
      ethnicity: 'White',
      url: 'javascript:alert(1)',
    }, false),
    'That URL needs to be an http or https link.',
  )
  const added = readArchive('2026-10-21')?.cards.find((card) => card.headline.includes('harbor'))
  assert.equal(added?.ethnicity, 'Hispanic')
  assert.equal(added?.url, 'https://example.com/harbor')
  const { articleUrls } = await import('../lib/seen')
  markSeen('Harbor headline for the link', 'https://example.com/harbor-story', 'round')
  markSeen('Second headline for the link', 'https://example.com/second-story', 'round')
  const urls = articleUrls()
  assert.equal(urls.get(headlineKey('Harbor headline for the link')), 'https://example.com/harbor-story')
  assert.equal(urls.get(headlineKey('Second headline for the link')), 'https://example.com/second-story')
  assert.equal(dropRoundCard(added ? added.headline.toLowerCase() : '', false), 'Removed from today’s round.')
  assert.equal(readArchive('2026-10-21')?.cards.length, 1)
  assert.equal(buildRound('2026-10-20')[0].source, 'CBS')

  const session = await import('../lib/xai-session')
  const { XAI_OAUTH_CLIENT_ID } = await import('../lib/xai-oauth')
  const posts: { url: string; body: URLSearchParams }[] = []
  let refreshShape: 'rotate' | 'keep' = 'rotate'
  session.setOauthTransport({
    async getJson(url) {
      assert.equal(url, 'https://auth.x.ai/.well-known/openid-configuration')
      return {
        status: 200,
        json: {
          token_endpoint: 'https://auth.x.ai/oauth2/token',
          device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
        },
      }
    },
    async postForm(url, body) {
      posts.push({ url, body })
      if (body.get('scope')) {
        assert.equal(body.get('client_id'), XAI_OAUTH_CLIENT_ID)
        assert.equal(url, 'https://auth.x.ai/oauth2/device/code')
        return {
          status: 200,
          json: {
            device_code: 'device-secret',
            user_code: 'ABCD-EFGH',
            verification_uri_complete: 'https://auth.x.ai/device?user_code=ABCD-EFGH',
            expires_in: 600,
            interval: 5,
          },
        }
      }
      if (body.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
        assert.equal(body.get('device_code'), 'device-secret')
        return {
          status: 200,
          json: {
            access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
            refresh_token: 'refresh-secret',
            expires_in: 3600,
            id_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
          },
        }
      }
      if (body.get('grant_type') === 'refresh_token') {
        if (refreshShape === 'keep') {
          refreshShape = 'rotate'
          return {
            status: 200,
            json: {
              access_token: fakeJwt(Math.floor(Date.now() / 1000) + 5000, 'player@example.com'),
              expires_in: 5000,
            },
          }
        }
        return {
          status: 200,
          json: {
            access_token: fakeJwt(Math.floor(Date.now() / 1000) + 7200, 'player@example.com'),
            refresh_token: 'refresh-next',
            expires_in: 7200,
          },
        }
      }
      throw new Error(`unexpected Grok sign-in post to ${url}`)
    },
  })
  const started = await session.beginSignIn()
  assert.equal(started.ok, true)
  let account = await session.oauthPublic()
  assert.equal(account.pending, true)
  assert.equal(account.userCode, 'ABCD-EFGH')
  assert.equal(JSON.stringify(account).includes('device-secret'), false)
  const hidden = database.prepare('SELECT device_code FROM oauth WHERE id = 1').get() as { device_code: string }
  assert.equal(hidden.device_code, 'device-secret')
  const beforeWait = posts.length
  const waiting = await session.pollPending()
  assert.equal(waiting.pending, true)
  assert.equal(posts.length, beforeWait)
  database.prepare('UPDATE oauth SET last_poll_at = 0 WHERE id = 1').run()
  account = await session.pollPending()
  assert.equal(account.connected, true)
  assert.equal(account.pending, false)
  assert.equal(account.email, 'player@example.com')
  assert.equal(account.billing, 'subscription')
  assert.equal(JSON.stringify(account).includes('refresh-secret'), false)
  assert.equal(JSON.stringify(account).includes('device-secret'), false)
  const current = await session.subscriptionAccessToken()
  assert.equal(typeof current, 'string')
  assert.equal(posts.filter((item) => item.body.get('grant_type') === 'refresh_token').length, 0)
  database.prepare('UPDATE oauth SET access_token = ?, expires_at = ? WHERE id = 1').run(
    fakeJwt(Math.floor(Date.now() / 1000) - 30),
    Date.now() - 1000,
  )
  const beforeRefresh = posts.length
  const [first, second] = await Promise.all([
    session.subscriptionAccessToken(),
    session.subscriptionAccessToken(),
  ])
  assert.equal(first, second)
  assert.equal(posts.length, beforeRefresh + 1)
  const rotated = database.prepare('SELECT refresh_token FROM oauth WHERE id = 1').get() as { refresh_token: string }
  assert.equal(rotated.refresh_token, 'refresh-next')
  database.prepare('UPDATE oauth SET access_token = ?, expires_at = ? WHERE id = 1').run(
    fakeJwt(Math.floor(Date.now() / 1000) - 30),
    Date.now() - 1000,
  )
  const beforeSecond = posts.length
  const again = await session.subscriptionAccessToken()
  assert.equal(typeof again, 'string')
  assert.equal(posts.length, beforeSecond + 1)
  const expiredKeep = fakeJwt(Math.floor(Date.now() / 1000) - 30)
  refreshShape = 'keep'
  database.prepare('UPDATE oauth SET access_token = ?, expires_at = ? WHERE id = 1').run(expiredKeep, Date.now() - 1000)
  const keptToken = await session.subscriptionAccessToken()
  assert.equal(typeof keptToken, 'string')
  assert.notEqual(keptToken, expiredKeep)
  const kept = database.prepare('SELECT access_token, refresh_token FROM oauth WHERE id = 1').get() as {
    access_token: string
    refresh_token: string
  }
  assert.equal(kept.refresh_token, 'refresh-next')
  assert.equal(kept.access_token, keptToken)
  const previousKey = process.env.XAI_API_KEY
  const previousFetch = globalThis.fetch
  process.env.XAI_API_KEY = 'xai-self-check'
  const seenAuth: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url !== 'https://api.x.ai/v1/responses') return previousFetch(input, init)
    const auth = new Headers(init?.headers).get('authorization') || ''
    seenAuth.push(auth === 'Bearer xai-self-check' ? 'key' : 'sub')
    if (auth !== 'Bearer xai-self-check') return new Response('no', { status: 401 })
    return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 })
  }) as typeof fetch
  try {
    const { grok } = await import('../lib/grok')
    const answered = await grok('Say ok.', 'check', { type: 'object' }, 'the check')
    assert.equal((answered.parsed as { ok?: boolean }).ok, true)
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = previousKey
  }
  assert.deepEqual(seenAuth, ['sub', 'sub', 'key'])
  assert.match((await session.oauthPublic()).fallback, /API key/)
  database.prepare('UPDATE oauth SET access_token = ?, expires_at = ?, refresh_failed_at = 0 WHERE id = 1').run(
    fakeJwt(Math.floor(Date.now() / 1000) - 30),
    Date.now() - 1000,
  )
  session.setOauthTransport({
    async getJson() {
      return { status: 200, json: { token_endpoint: 'https://auth.x.ai/oauth2/token' } }
    },
    async postForm() {
      return { status: 403, json: { error: 'access_denied', error_description: 'no subscription' } }
    },
  })
  assert.equal(await session.subscriptionAccessToken(), null)
  const refused = database.prepare('SELECT refresh_token, last_error FROM oauth WHERE id = 1').get() as {
    refresh_token: string
    last_error: string
  }
  assert.equal(refused.refresh_token, 'refresh-next')
  assert.match(refused.last_error, /refused/)
  session.setOauthTransport({
    async getJson() {
      return {
        status: 200,
        json: {
          token_endpoint: 'https://evil.example/token',
          device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
        },
      }
    },
    async postForm() {
      throw new Error('should not post')
    },
  })
  const bad = await session.beginSignIn()
  assert.equal(bad.ok, false)
  assert.equal((await session.oauthPublic()).connected, true)
  assert.equal(await session.disconnectGrok(), 'Signed out of Grok. Classification uses the API key when one is set.')
  account = await session.oauthPublic()
  assert.equal(account.connected, false)
  assert.equal(account.pending, false)
  const cleared = database.prepare('SELECT access_token, refresh_token, device_code FROM oauth WHERE id = 1').get() as {
    access_token: string
    refresh_token: string
    device_code: string
  }
  assert.equal(cleared.access_token, '')
  assert.equal(cleared.refresh_token, '')
  assert.equal(cleared.device_code, '')

  database.prepare(
    `UPDATE oauth SET access_token = ?, refresh_token = ?, expires_at = ?, token_endpoint = ?,
      refresh_failed_at = 0, last_error = '', device_code = '' WHERE id = 1`,
  ).run(
    fakeJwt(Math.floor(Date.now() / 1000) - 30),
    'refresh-live',
    Date.now() - 1000,
    'https://auth.x.ai/oauth2/token',
  )
  let releaseRefresh = () => {}
  const refreshHold = new Promise<void>((resolve) => { releaseRefresh = resolve })
  let markRefresh = () => {}
  const refreshHit = new Promise<void>((resolve) => { markRefresh = resolve })
  session.setOauthTransport({
    async getJson() {
      return {
        status: 200,
        json: {
          token_endpoint: 'https://auth.x.ai/oauth2/token',
          device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
        },
      }
    },
    async postForm(_url, body) {
      if (body.get('grant_type') !== 'refresh_token') throw new Error('unexpected post')
      markRefresh()
      await refreshHold
      return {
        status: 200,
        json: {
          access_token: fakeJwt(Math.floor(Date.now() / 1000) + 7200),
          refresh_token: 'resurrected',
          expires_in: 7200,
        },
      }
    },
  })
  const pendingToken = session.subscriptionAccessToken()
  await refreshHit
  assert.equal(await session.disconnectGrok(), 'Signed out of Grok. Classification uses the API key when one is set.')
  releaseRefresh()
  assert.equal(await pendingToken, null)
  const buried = database.prepare('SELECT access_token, refresh_token FROM oauth WHERE id = 1').get() as {
    access_token: string
    refresh_token: string
  }
  assert.equal(buried.access_token, '')
  assert.equal(buried.refresh_token, '')

  let releasePoll = () => {}
  const pollHold = new Promise<void>((resolve) => { releasePoll = resolve })
  let markPoll = () => {}
  const pollHit = new Promise<void>((resolve) => { markPoll = resolve })
  session.setOauthTransport({
    async getJson() {
      return {
        status: 200,
        json: {
          token_endpoint: 'https://auth.x.ai/oauth2/token',
          device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
        },
      }
    },
    async postForm(_url, body) {
      if (body.get('scope')) {
        return {
          status: 200,
          json: {
            device_code: 'device-late',
            user_code: 'WXYZ-1234',
            verification_uri_complete: 'https://auth.x.ai/device?user_code=WXYZ-1234',
            expires_in: 600,
            interval: 5,
          },
        }
      }
      markPoll()
      await pollHold
      return {
        status: 200,
        json: {
          access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: 'late-refresh',
          expires_in: 3600,
          id_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
        },
      }
    },
  })
  assert.equal((await session.beginSignIn()).ok, true)
  const polling = session.pollPending()
  await pollHit
  assert.equal(await session.cancelSignIn(), 'Sign-in cancelled.')
  releasePoll()
  const cancelled = await polling
  assert.equal(cancelled.connected, false)
  assert.equal(cancelled.pending, false)
  const late = database.prepare('SELECT refresh_token, device_code FROM oauth WHERE id = 1').get() as {
    refresh_token: string
    device_code: string
  }
  assert.equal(late.refresh_token, '')
  assert.equal(late.device_code, '')

  database.prepare(
    `UPDATE oauth SET access_token = ?, refresh_token = ?, expires_at = ?, email = ?,
      device_code = ?, user_code = ?, verification_uri = ?, poll_interval = ?,
      device_expires_at = ?, token_endpoint = ?, refresh_failed_at = 0, last_error = ''
     WHERE id = 1`,
  ).run(
    fakeJwt(Math.floor(Date.now() / 1000) - 30),
    'refresh-400',
    Date.now() - 1000,
    'player@example.com',
    'device-keep',
    'KEEP-CODE',
    'https://auth.x.ai/device',
    30,
    Date.now() + 600_000,
    'https://auth.x.ai/oauth2/token',
  )
  session.setOauthTransport({
    async getJson() {
      return { status: 200, json: { token_endpoint: 'https://auth.x.ai/oauth2/token' } }
    },
    async postForm() {
      return { status: 400, json: { error: 'invalid_grant' } }
    },
  })
  assert.equal(await session.subscriptionAccessToken(), null)
  const expiredRow = database.prepare(
    'SELECT refresh_token, device_code, user_code, last_error FROM oauth WHERE id = 1',
  ).get() as { refresh_token: string; device_code: string; user_code: string; last_error: string }
  assert.equal(expiredRow.refresh_token, '')
  assert.equal(expiredRow.device_code, 'device-keep')
  assert.equal(expiredRow.user_code, 'KEEP-CODE')
  assert.match(expiredRow.last_error, /expired/)

  const { jobSnapshot } = await import('../lib/job')
  const note = 'xAI refused the Grok subscription (HTTP 403). This call used the API key.'
  await Promise.all([
    session.noteSubscriptionFallback(note),
    session.noteSubscriptionFallback(note),
  ])
  assert.equal(jobSnapshot().events.filter((event) => event.message === note).length, 1)

  const keepUntil = Date.now() + 600_000
  database.prepare(
    `UPDATE oauth SET device_code = ?, user_code = ?, verification_uri = ?, poll_interval = ?,
      device_expires_at = ?, last_poll_at = 0, token_endpoint = ?, refresh_token = '', access_token = ''
     WHERE id = 1`,
  ).run('device-keep', 'KEEP-CODE', 'https://auth.x.ai/device', 5, keepUntil, 'https://auth.x.ai/oauth2/token')
  session.setOauthTransport({
    async getJson() {
      return { status: 200, json: { token_endpoint: 'https://auth.x.ai/oauth2/token' } }
    },
    async postForm() {
      return { status: 429, json: null }
    },
  })
  const paced = await session.pollPending()
  assert.equal(paced.pending, true)
  assert.equal(paced.connected, false)
  const keptDevice = database.prepare('SELECT device_code FROM oauth WHERE id = 1').get() as { device_code: string }
  assert.equal(keptDevice.device_code, 'device-keep')
  session.setOauthTransport(null)

  database.close()
  fs.rmSync(legacy, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
  console.log('self-check ok')
}

checkImport().catch((error) => {
  console.error(error)
  process.exit(1)
})
