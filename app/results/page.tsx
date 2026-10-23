import { BootScripts } from '@/components/boot-scripts'
import { redirect } from 'next/navigation'
import { rankForScore, rankLadder } from '@/lib/scoring'
import { refreshResult, roundContext } from '@/lib/roundview'
import { currentSession } from '@/lib/session'
import { saveSession } from '@/lib/store'
import { isBanner } from '@/lib/text'

export const metadata = { title: 'Results — Headline Guessr' }

export default async function ResultsPage() {
  const { id, data } = await currentSession()
  const result = refreshResult(data)
  if (!result || !data.correctAnswers.length) redirect('/game')
  data.lastResult = result
  saveSession(id, data)
  const total = data.correctAnswers.length
  const tier = rankForScore(result.score, total)
  const ladder = rankLadder()
  const round = roundContext()
  const perfect = result.score === total && total > 0
  return (
    <div className="frame">
      <header className="topbar">
        <a className="mark" href="/">Headline <em>Guessr</em></a>
        <button type="button" className="quiet stats-open" aria-haspopup="dialog">Stats</button>
        {round.roundLabel && <p className="dateline">{round.roundLabel}</p>}
      </header>
      <main id="main">
        <div className="score-block">
          <p className="kicker">Today’s round</p>
          <p className="score">
            <span className="score-num" data-score={result.score}>{result.score}</span>
            <span className="score-of">/{total}</span>
          </p>
          <p className="pace" hidden></p>
          {perfect && <p className="perfect">Clean sweep</p>}
          <div className="share-bar">
            <div className="share" aria-hidden="true">
              {result.userAnswers.map((guess, index) => (
                <span
                  key={index}
                  className={`share-tile ${data.correctAnswers[index] === guess ? 'is-right' : 'is-wrong'}`}
                  style={{ animationDelay: `${index * 70}ms` }}
                />
              ))}
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
            const answer = data.correctAnswers[index] || ''
            const story = data.stories[index]
            const right = guess === answer
            return (
              <li key={index} className={`review ${right ? 'is-right' : 'is-wrong'}`} style={{ animationDelay: `${index * 50}ms` }}>
                {story && (
                  <>
                    <p className="source">{story.source}</p>
                    <h2 className={isBanner(story.headline) ? 'is-banner' : undefined}>{story.headline}</h2>
                  </>
                )}
                <p className="verdict">{right ? 'Right' : 'Wrong'}</p>
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
          <a className="play-btn" href="/game">Play again</a>
          <a className="btn btn-ghost" href="/">Home</a>
        </div>
        <div className="daily-foot">
          <p className="streak" hidden></p>
          <p className="next-round" data-at={round.nextRoundIso}>Next round <time></time></p>
        </div>
      </main>
      <BootScripts src="/sound.js,/results.js" />
    </div>
  )
}
