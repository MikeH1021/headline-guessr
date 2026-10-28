import { currentSession } from '@/lib/session'
import { listArchives, saveSession } from '@/lib/store'
import { resultForDay, roundContext, todayPlay } from '@/lib/roundview'
import { shortRoundLabel } from '@/lib/time'
import type { LastResult } from '@/lib/types'

export const metadata = { title: 'Headline Guessr' }

function marksFor(saved: LastResult | null) {
  const answers = saved?.answers || []
  const guesses = saved?.userAnswers || []
  if (!answers.length || guesses.length !== answers.length) return null
  return guesses.map((guess, index) => guess === answers[index])
}

function replayLabel(saved: LastResult | null, total: number) {
  const score = Number(saved?.score) || 0
  if (!saved) return 'Play'
  if (total > 0 && score === total) return 'Hold the sweep'
  if (score > 0) return `Beat ${score}`
  return 'Play again'
}

export default async function HomePage() {
  const { id, data } = await currentSession()
  const round = roundContext()
  const todaySaved = resultForDay(data, round.roundDay)
  const before = todaySaved?.percentile
  const played = todayPlay(data)
  const oneShort = !!played && played.total > 1 && played.score === played.total - 1
  const swept = !!played && played.total > 0 && played.score === played.total
  if (played && todaySaved && todaySaved.percentile !== before) saveSession(id, data)
  const past = listArchives().filter((item) => item.refreshedOn !== round.roundDay)
  return (
    <div className="frame">
      <header className="topbar">
        <p className="dateline">{round.roundLabel || 'Daily'}</p>
        <div className="top-links">
          <button type="button" className="quiet stats-open" aria-haspopup="dialog">Stats</button>
        </div>
      </header>
      <main className="home-main" id="main">
        <div className="hero">
          {!played && round.cardCount > 0 && (
            <div className="mark-grid" aria-hidden="true">
              {Array.from({ length: round.cardCount }, (_, index) => (
                <span key={index} style={{ animationDelay: `${index * 45}ms` }} />
              ))}
            </div>
          )}
          <div className="bug" aria-hidden="true"><span /><span /><span /><span /></div>
          <p className="kicker">{played ? 'Today' : 'A daily round'}</p>
          <h1 className="logo">Headline<br /><em>Guessr</em></h1>
          {played ? (
            <>
              <div className="share played-row" aria-hidden="true">
                {played.marks.map((mark, index) => (
                  <span key={index} className={`share-tile ${mark ? 'is-right' : 'is-wrong'}${swept && played.total > 1 && mark ? ' is-sweep' : ''}${oneShort && !mark ? ' is-cost' : ''}`} />
                ))}
              </div>
              <p className={`played-rank is-${played.tierId}`}>{played.title}</p>
              <p className="played-score">{played.score}/{played.total}</p>
              {swept && <p className="perfect">Clean sweep</p>}
              {oneShort && <p className="one-short">One short</p>}
              <p className="pace" hidden></p>
              <div
                id="today-play"
                hidden
                data-score={played.score}
                data-total={played.total}
                data-tier={played.tierId}
                data-title={played.title}
                data-marks={played.marks.map((mark) => (mark ? 'r' : 'w')).join('')}
              />
              <div className="actions hero-actions">
                <a className="play-btn" href="/results">See result</a>
                <a className={`btn btn-ghost${played.score > 0 ? ' is-chase' : ''}`} href="/game">
                  {played.score === played.total ? 'Hold the sweep' : played.score > 0 ? `Beat ${played.score}` : 'Play again'}
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="lede">Guess the perpetrator’s ethnicity from today’s crime headlines. One card at a time.</p>
              <a className="play-btn" href="/game">Play</a>
              <ol className="steps">
                <li><span>1</span> Read the headline</li>
                <li><span>2</span> Lock an answer</li>
                <li><span>3</span> See right or wrong</li>
              </ol>
            </>
          )}
        </div>
        {past.length > 0 && (
          <section className="archive" aria-labelledby="archive-title">
            <p className="kicker" id="archive-title">Earlier rounds</p>
            <ul className="archive-list">
              {past.map((item) => {
                const saved = resultForDay(data, item.refreshedOn)
                const marks = marksFor(saved)
                const total = saved?.answers?.length || item.count
                return (
                  <li key={item.refreshedOn} data-day={item.refreshedOn}>
                    <span className="archive-day">{shortRoundLabel(item.refreshedOn)}</span>
                    {marks && (
                      <span className="mini" aria-hidden="true">
                        {marks.map((right, index) => (
                          <span key={index} className={right ? 'is-right' : 'is-wrong'} />
                        ))}
                      </span>
                    )}
                    {saved && <span className="edition-score">{saved.score}/{total}</span>}
                    <span className="archive-links">
                      <a
                        className={saved && (Number(saved.score) || 0) > 0 ? 'is-chase' : undefined}
                        href={`/game?day=${item.refreshedOn}`}
                      >
                        {replayLabel(saved, total)}
                      </a>
                      {saved && <a href={`/results?day=${item.refreshedOn}`}>Result</a>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        <div className="earlier" id="earlier" hidden></div>
        <div className="daily-foot">
          <p className="meta">
            {round.cardCount
              ? `${round.cardCount} headline${round.cardCount === 1 ? '' : 's'} today`
              : 'Today’s round is not ready yet'}
          </p>
          <p className="streak" hidden></p>
          <p className="next-round" data-at={round.nextRoundIso}>Next round <time></time></p>
        </div>
      </main>
    </div>
  )
}
