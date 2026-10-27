import { BootScripts } from '@/components/boot-scripts'
import { redirect } from 'next/navigation'
import { rankForScore, rankLadder } from '@/lib/scoring'
import { playableDay, presentResult, refreshResult, resultForDay, roundContext } from '@/lib/roundview'
import { currentSession } from '@/lib/session'
import { repairRoundLinks } from '@/lib/repair-links'
import { articleUrls } from '@/lib/seen'
import { readArchive, readRound, saveSession } from '@/lib/store'
import { articleHost, articleHref, headlineKey, isBanner, isGoogleNewsUrl, preferArticleUrl } from '@/lib/text'

export const metadata = { title: 'Results — Headline Guessr' }

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const params = await searchParams
  const day = playableDay(params.day)
  const { id, data } = await currentSession()
  const stored = day ? resultForDay(data, day) : data.lastResult
  const result = day ? presentResult(stored) : (presentResult(stored, data.correctAnswers.length) || refreshResult(data))
  const answers = result?.answers?.length ? result.answers : data.correctAnswers
  const stories = result?.stories?.length ? result.stories : data.stories
  if (!result || !answers.length) redirect(day ? `/game?day=${day}` : '/game')
  if (day) data.plays = { ...(data.plays || {}), [day]: result }
  else {
    data.lastResult = result
    if (result.roundDay) data.plays = { ...(data.plays || {}), [result.roundDay]: result }
  }
  saveSession(id, data)
  const total = answers.length
  const tier = rankForScore(result.score, total)
  const ladder = rankLadder()
  const savedRound = await repairRoundLinks(day ? readArchive(day) : readRound())
  const round = roundContext(savedRound)
  const savedUrls = new Map<string, string>()
  for (const card of savedRound?.cards || []) {
    const href = articleHref(card.url)
    const key = headlineKey(card.headline)
    if (href && key) savedUrls.set(key, href)
  }
  const remembered = stories.some((story) => {
    if (!story) return false
    const saved = savedUrls.get(headlineKey(story.headline)) || ''
    const href = preferArticleUrl(story.url, saved)
    return !href || isGoogleNewsUrl(href)
  })
    ? articleUrls()
    : new Map<string, string>()
  const hrefFor = (story: { headline: string; url?: string }) => {
    const key = headlineKey(story.headline)
    return preferArticleUrl(story.url, key && savedUrls.get(key), key && remembered.get(key))
  }
  let linked = false
  for (const story of stories) {
    if (!story?.headline) continue
    const href = hrefFor(story)
    if (!href || href === (story.url || '')) continue
    if (story.url && !isGoogleNewsUrl(story.url)) continue
    story.url = href
    linked = true
  }
  if (linked) saveSession(id, data)
  const again = day ? `/game?day=${day}` : '/game'
  const perfect = result.score === total && total > 0
  const missCount = result.userAnswers.filter((guess, index) => guess !== (answers[index] || '')).length
  const oneShort = !perfect && total > 1 && missCount === 1
  const againLabel = perfect ? 'Hold the sweep' : result.score > 0 ? `Beat ${result.score}` : 'Play again'
  return (
    <div className="frame">
      <header className="topbar">
        <a className="mark" href="/">Headline <em>Guessr</em></a>
        <button type="button" className="quiet stats-open" aria-haspopup="dialog">Stats</button>
        {round.roundLabel && <p className="dateline">{round.roundLabel}</p>}
      </header>
      <main id="main">
        <div className="score-block">
          <p className="kicker">{day ? 'Earlier round' : 'Today’s round'}</p>
          <p className="score">
            <span className="score-num" data-score={result.score}>{result.score}</span>
            <span className="score-of">/{total}</span>
          </p>
          <p className="pace" hidden></p>
          {perfect && <p className="perfect">Clean sweep</p>}
          {oneShort && <p className="one-short">One short</p>}
          <div className="share-bar">
            <div className="share" aria-hidden="true">
              {result.userAnswers.map((guess, index) => {
                const right = answers[index] === guess
                return (
                  <span
                    key={index}
                    className={`share-tile ${right ? 'is-right' : 'is-wrong'}${oneShort && !right ? ' is-cost' : ''}`}
                    style={{ animationDelay: `${index * 70}ms` }}
                  />
                )
              })}
            </div>
            <button type="button" className="copy-result" id="copy-result">Copy result</button>
          </div>
          <p className="rank-kicker">You are</p>
          <h2 className={`rank-title is-${tier.id}`} data-tier={tier.id}>{tier.title}</h2>
          <p className="rank-line">{tier.line}</p>
          <ol className="ladder" aria-label="Ranks">
            {ladder.map((step) => (
              <li key={step.id} className={step.id === tier.id ? 'is-you' : undefined}>
                <span className="ladder-mark" aria-hidden="true"></span>
                <span>{step.title}</span>
              </li>
            ))}
          </ol>
          {result.plays === 1 ? (
            <>
              <p className="rank">First play of this round.</p>
              <p className="rank-note">The rank follows how many you got right.</p>
            </>
          ) : (
            <>
              <p className="rank">{result.ordinal} percentile</p>
              <p className="rank-note">Out of {result.plays} plays of this round.</p>
            </>
          )}
          <div className="actions score-again">
            <a className={`play-btn${againLabel === 'Play again' ? '' : ' is-chase'}`} href={again}>{againLabel}</a>
          </div>
        </div>
        {result.counts.length > 0 && (
          <ol className="dist" aria-label="Score distribution">
            {result.counts.map((count, index) => {
              const ratio = result.plays ? Math.floor((count / result.plays) * 100) : 0
              const bar = count === 0 ? 0 : Math.max(ratio, 12)
              return (
                <li key={index} className={index === result.score ? 'is-you' : undefined}>
                  <span className="dist-count">{count || ''}</span>
                  <span className="dist-track">
                    <span className="dist-bar" style={{ height: `${bar}%`, animationDelay: `${index * 45}ms` }} />
                  </span>
                  <span className="dist-label">{index}</span>
                </li>
              )
            })}
          </ol>
        )}
        <ul className="reviews">
          {result.userAnswers.map((guess, index) => {
            const answer = answers[index] || ''
            const story = stories[index]
            const right = guess === answer
            const cost = oneShort && !right
            const href = story ? hrefFor(story) : ''
            const host = href ? articleHost(href) : ''
            return (
              <li key={index} className={`review ${right ? 'is-right' : 'is-wrong'}${cost ? ' is-cost' : ''}`} style={{ animationDelay: `${index * 50}ms` }}>
                {story && (
                  <>
                    <p className="source">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">{story.source}</a>
                      ) : (
                        story.source
                      )}
                    </p>
                    <h2 className={isBanner(story.headline) ? 'is-banner' : undefined}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={host ? `${story.headline}. ${host}. Opens in a new tab.` : `${story.headline}. Opens in a new tab.`}
                        >
                          {story.headline}
                          {host && <span className="article-host">{host}</span>}
                        </a>
                      ) : (
                        story.headline
                      )}
                    </h2>
                  </>
                )}
                <p className="verdict">{right ? 'Right' : cost ? 'The miss' : 'Wrong'}</p>
                {right ? (
                  <p className="guess"><strong>{guess}</strong></p>
                ) : (
                  <>
                    <p className="guess">You said <strong>{guess}</strong></p>
                    {answer && <p className="answer">Answer <strong>{answer}</strong></p>}
                  </>
                )}
              </li>
            )
          })}
        </ul>
        <div className="actions">
          <a className={`play-btn${againLabel === 'Play again' ? '' : ' is-chase'}`} href={again}>{againLabel}</a>
          <a className="btn btn-ghost" href="/">Home</a>
        </div>
        <div className="daily-foot">
          <p className="streak" hidden></p>
          <p className="next-round" data-at={round.nextRoundIso}>Next round <time></time></p>
        </div>
      </main>
      <BootScripts src="/sound.js?v=8,/results.js?v=2" />
    </div>
  )
}
