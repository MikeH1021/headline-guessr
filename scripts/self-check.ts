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
import { storiesFromRss, takeUnseen } from '../lib/rss'

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
assert.equal(feedUrl('javascript:alert(1)'), '')
assert.equal(feedUrl('https://example.com/crime/feed'), 'https://example.com/crime/feed')
assert.equal(publicFeedUrl('https://example.com/crime/feed'), 'https://example.com/crime/feed')
assert.equal(publicFeedUrl('http://127.0.0.1/feed'), '')
assert.equal(publicFeedUrl('http://169.254.169.254/latest'), '')
assert.equal(publicFeedUrl('http://10.1.2.3/feed'), '')
assert.equal(publicFeedUrl('https://localhost/feed'), '')
assert.equal(publicFeedUrl('https://user:pass@example.com/feed'), '')
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

const older = Array.from({ length: 20 }, (_, index) => index)
const dug = takeUnseen(older, (index) => index < 16, 16)
assert.deepEqual(dug.fresh, [16, 17, 18, 19])
assert.equal(dug.checked, 16)
const capped = takeUnseen(older, (index) => index < 2, 4)
assert.deepEqual(capped.fresh, [2, 3, 4, 5])
assert.equal(capped.checked, 2)

const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-legacy-'))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-data-'))
const scores = JSON.stringify([{ round: '2026-10-22:1', score: 1 }])
const round = JSON.stringify({
  refreshed_on: '2026-10-22',
  refreshed_at: '2026-10-22 12:00:00',
  cards: [{ source: 'CBS', headline: 'A reported robbery downtown', ethnicity: 'White' }],
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

  const { currentModel, readRound } = await import('../lib/store')
  const { buildRound } = await import('../lib/roundview')
  assert.equal(currentModel(), 'grok-4.3')
  assert.equal(readRound()?.cards.length, 1)
  assert.equal(buildRound()[0].ethnicity, 'White')

  const { saveRound, readArchive, listArchives, addHeadline, useQueued, dropRoundCard, readQueue: queueNow } = await import('../lib/store')
  const { hasSeen, markSeen } = await import('../lib/seen')
  saveRound(
    [{ source: 'CBS', headline: 'First saved robbery downtown', ethnicity: 'White' }],
    new Date(2026, 9, 20, 12, 0, 0),
  )
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
  const added = readArchive('2026-10-21')?.cards.find((card) => card.headline.includes('harbor'))
  assert.equal(added?.ethnicity, 'Hispanic')
  assert.equal(dropRoundCard(added ? added.headline.toLowerCase() : '', false), 'Removed from today’s round.')
  assert.equal(readArchive('2026-10-21')?.cards.length, 1)
  assert.equal(buildRound('2026-10-20')[0].source, 'CBS')

  database.close()
  fs.rmSync(legacy, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
  console.log('self-check ok')
}

checkImport().catch((error) => {
  console.error(error)
  process.exit(1)
})
