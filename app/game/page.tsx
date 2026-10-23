import { BootScripts } from '@/components/boot-scripts'
import { ETHNICITIES } from '@/lib/constants'
import { HeadlineError } from '@/lib/errors'
import { buildRound, roundContext } from '@/lib/roundview'
import { currentSession } from '@/lib/session'
import { saveSession } from '@/lib/store'
import { isBanner } from '@/lib/text'

export const metadata = { title: 'Play — Headline Guessr' }

export default async function GamePage() {
  const { id, data } = await currentSession()
  const round = roundContext()
  let error = ''
  let cards: { source: string; headline: string; answer: string }[] = []
  try {
    const dealt = buildRound()
    data.stories = dealt.map((card) => ({ source: card.source, headline: card.headline }))
    data.correctAnswers = dealt.map((card) => card.ethnicity)
    saveSession(id, data)
    cards = dealt.map((card) => ({ source: card.source, headline: card.headline, answer: card.ethnicity }))
  } catch (err) {
    error = err instanceof HeadlineError ? err.message : 'The daily round is not ready. Set the refresh time on the admin page, or run a debug refresh.'
  }
  return (
    <div className="frame play">
      <header className="topbar">
        <a className="mark" href="/">Headline <em>Guessr</em></a>
        {cards.length > 0 && <p className="count" id="count" aria-live="polite">1 of {cards.length}</p>}
      </header>
      <main id="main" className="stage-wrap">
        <div className="board">
          {round.roundLabel && <p className="dateline">{round.roundLabel}</p>}
          {error && (
            <div className="panel">
              <p>{error}</p>
              <p><a href="/admin">Open admin</a></p>
            </div>
          )}
          {cards.length > 0 && (
            <>
              <p className="instructions">Guess the ethnicity of the perpetrator. <span className="keys">Keys 1–5, then Enter.</span></p>
              <div className="progress">
                <ol className="pips" aria-hidden="true">
                  {cards.map((card, index) => (
                    <li key={`${card.headline}-${index}`} className={`pip${index === 0 ? ' is-current' : ''}`} />
                  ))}
                </ol>
                <p className="pace-live" id="pace-live" hidden></p>
                <p className="tally" id="tally" aria-live="polite"></p>
              </div>
              <form method="post" action="/play" id="game-form" autoComplete="off" tabIndex={-1}>
                <div className="stage" id="stage">
                  {cards.map((card, index) => (
                    <section
                      key={`${card.source}-${index}`}
                      className={`card${index === 0 ? ' is-active' : ''}`}
                      data-answer={card.answer}
                    >
                      <div className="story">
                        <p className="source">{card.source}</p>
                        <h2 className={`headline${isBanner(card.headline) ? ' is-banner' : ''}`} tabIndex={-1}>{card.headline}</h2>
                      </div>
                      <div className="choices" role="group" aria-label="Ethnicity">
                        {ETHNICITIES.map((choice, choiceIndex) => (
                          <button key={choice} type="button" className="choice" data-value={choice} aria-pressed="false">
                            <span>{choice}</span>
                            <kbd aria-hidden="true">{choiceIndex + 1}</kbd>
                          </button>
                        ))}
                      </div>
                      <p className="miss" aria-live="polite"></p>
                      <button
                        type={index === cards.length - 1 ? 'submit' : 'button'}
                        className="lock"
                        data-label={index === cards.length - 1 ? 'Finish' : 'Lock in'}
                      >
                        {index === cards.length - 1 ? 'Finish' : 'Lock in'}
                      </button>
                      <select className="fallback" name="answer" aria-label="Ethnicity" defaultValue="">
                        <option value="">Select ethnicity</option>
                        {ETHNICITIES.map((choice) => (
                          <option key={choice} value={choice}>{choice}</option>
                        ))}
                      </select>
                    </section>
                  ))}
                </div>
                <button className="play-btn finish-fallback" type="submit">Finish</button>
              </form>
            </>
          )}
        </div>
      </main>
      {cards.length > 0 && (
        <>
          <BootScripts src="/sound.js,/game.js" />
        </>
      )}
    </div>
  )
}
