import { redirect } from 'next/navigation'
import { adminAuthed } from '@/lib/admin-auth'

export const metadata = { title: 'Sign in — Headline Guessr' }
export const dynamic = 'force-dynamic'

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (await adminAuthed()) redirect('/admin')
  const params = await searchParams
  const notice = (params.notice || '').slice(0, 200)
  return (
    <div className="frame">
      <header className="topbar">
        <a className="mark" href="/">Headline <em>Guessr</em></a>
        <a className="quiet" href="/game">Play</a>
      </header>
      <main className="home-main" id="main">
        <div className="hero">
          <p className="kicker">Private</p>
          <h1 className="logo">Admin</h1>
          <p className="lede">The desk is locked. Scores, feeds, and the daily refresh stay behind this password.</p>
          {notice && <p className="message">{notice}</p>}
          <form className="login-form" method="post" action="/admin/session" autoComplete="on">
            <label htmlFor="admin-password">Password
              <input id="admin-password" type="password" name="password" autoComplete="current-password" required maxLength={200} />
            </label>
            <button className="play-btn" type="submit">Sign in</button>
          </form>
        </div>
      </main>
    </div>
  )
}
