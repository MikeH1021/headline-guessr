import { currentSession } from '@/lib/session'
import { saveSession } from '@/lib/store'
import { roundContext, todayPlay } from '@/lib/roundview'

export const metadata = { title: 'Headline Guessr' }

export default async function HomePage() {
  const { id, data } = await currentSession()
  const before = data.lastResult?.percentile
  const played = todayPlay(data)
  if (played && data.lastResult && data.lastResult.percentile !== before) saveSession(id, data)
  const round = roundContext()
  return (
    <div className="frame">
      <header className="topbar">
        <p className="dateline">{round.roundLabel || 'Daily'}</p>
        <div className="top-links">
          <button type="button" className="quiet stats-open" aria-haspopup="dialog">Stats</button>
          <a className="quiet" href="/admin">Admin</a>
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
          <p className="kicker">{played ? 'Today' : 'A daily round'}</p>
          <h1 className="logo">Headline<br /><em>Guessr</em></h1>
          {played ? (
            <>
              <div className="share played-row" aria-hidden="true">
                {played.marks.map((mark, index) => (
                  <span key={index} className={`share-tile ${mark ? 'is-right' : 'is-wrong'}`} />
                ))}
              </div>
              <p className={`played-rank is-${played.tierId}`}>{played.title}</p>
              <p className="played-score">{played.score}/{played.total}</p>
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
                <a className="btn btn-ghost" href="/game">Play again</a>
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
