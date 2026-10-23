import { redirect } from 'next/navigation'
import { hintText } from '@/lib/roundview'
import { currentSession } from '@/lib/session'

export const metadata = { title: 'Hint — Headline Guessr' }

export default async function HintPage() {
  const { data } = await currentSession()
  if (!data.stories.length) redirect('/game')
  const text = hintText(data.stories[0].headline, data.correctAnswers[0] || '')
  return (
    <div className="frame">
      <header className="topbar">
        <a className="mark" href="/">Headline <em>Guessr</em></a>
      </header>
      <main id="main">
        <h1 className="logo" style={{ fontSize: 'clamp(2.4rem, 8vw, 3.4rem)' }}>Hint</h1>
        <p className="hint-text">{text}</p>
        <div className="actions">
          <a className="play-btn" href="/game">Back to the round</a>
        </div>
      </main>
    </div>
  )
}
