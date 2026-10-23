import { redirect } from 'next/navigation'
import { BootScripts } from '@/components/boot-scripts'
import { adminAuthed } from '@/lib/admin-auth'
import { GROK_MODELS } from '@/lib/constants'
import { rumPublic, rumSummary } from '@/lib/rum'
import { currentFeeds, currentModel, currentPrompt, currentRefreshTime, queuePublic, readQueue } from '@/lib/store'

export const metadata = { title: 'Admin — Headline Guessr' }

const formQuiet = {
  autoComplete: 'off' as const,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-protonpass-ignore': 'true',
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : word === 'finish' ? 'es' : 's'}`
}

function RumStats({ rum }: { rum: ReturnType<typeof rumPublic> }) {
  const peak = rum.pages.reduce((max, row) => Math.max(max, row.count), 0)
  const score = rum.asked ? `${rum.right} of ${rum.asked} headlines right on finished rounds.` : ''
  return (
    <section className="rum" id="rum" aria-labelledby="rum-title">
      <h2 id="rum-title">Stats</h2>
      <p>Real use of the site. Each browser reports the page it opened, whether the round was finished, and how fast the page felt. The median skips a finish longer than 15 minutes, which is a tab left open.</p>
      <form method="post" action="/admin/post" data-confirm="Clear all stats on this server?" {...formQuiet}>
        <button className="btn btn-ghost" type="submit" name="action" value="clear_stats">Clear stats</button>
      </form>
      <p className="note" id="rum-empty" hidden={rum.views > 0}>No visits yet. Open the site and the counts fill in.</p>
      <div id="rum-body" hidden={rum.views === 0}>
        <div className="stat-row">
          <p><strong id="rum-views">{rum.views}</strong><span>Views</span></p>
          <p><strong id="rum-people">{rum.visitors}</strong><span>Visitors</span></p>
          <p><strong id="rum-finishes">{rum.finishes}</strong><span>Finishes</span></p>
          <p><strong id="rum-time">{rum.median_finish}</strong><span>Median finish</span></p>
        </div>
        <p className="rum-line" id="rum-today">Today: {plural(rum.today_views, 'view')} · {plural(rum.today_visitors, 'visitor')} · {plural(rum.today_finishes, 'finish')}</p>
        <p className="rum-line" id="rum-score">{score}</p>
        <p className="rum-line" id="rum-mix">{rum.mix}</p>
        <p className="rum-line" id="rum-vitals">{rum.vitals}</p>
        <ol className="career-ranks" id="rum-pages">
          {rum.pages.map((row) => (
            <li key={row.label}>
              <span className="career-name">{row.label}</span>
              <span className="career-count">{row.count}</span>
              <span className="career-track"><span style={{ width: `${peak ? Math.round(100 * row.count / peak) : 0}%` }} /></span>
            </li>
          ))}
        </ol>
        <ul className="rum-log" id="rum-recent">
          {rum.recent.map((row, index) => (
            <li key={`${row.time}-${row.kind}-${index}`}>
              <time>{row.time}</time>
              <span className="rum-kind">{row.kind}</span>
              <span>{row.detail}</span>
            </li>
          ))}
        </ul>
        <ul className="rum-errors" id="rum-errors">
          {rum.errors.map((message) => <li key={message}>{message}</li>)}
        </ul>
      </div>
    </section>
  )
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (!(await adminAuthed())) redirect('/admin/login')
  const params = await searchParams
  const notice = (params.notice || '').slice(0, 300)
  const feeds = currentFeeds()
  const queue = queuePublic(readQueue())
  const model = currentModel()
  const prompt = currentPrompt()
  const refreshTime = currentRefreshTime()
  const rum = rumPublic(rumSummary())
  const signature = queue.map((item) => item.key).join('|')
  return (
    <div className="frame frame-wide">
      <header className="topbar">
        <a className="mark" href="/">Headline <em>Guessr</em></a>
        <div className="top-links">
          <a className="quiet" href="/game">Play</a>
          <form method="post" action="/admin/logout">
            <button className="quiet" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main id="main">
        <h1>Admin</h1>
        <p>Choose the Grok model, and edit the prompt it uses when it reads an article and records the perpetrator’s ethnicity. The headline and the article copy are both sent. Grok can search the web when the article does not state an ethnicity. The answer is kept only when a news report states it.</p>
        <p>The daily round is 10 headlines. Every refresh reads each feed below, 16 headlines from each one. Confirmed articles wait in the queue. The round takes one source at a time, so the same outlet does not fill the row.</p>
        {notice && <p className="message">{notice}</p>}
        <RumStats rum={rum} />
        <h2>Feeds</h2>
        <p>Add or remove a crime RSS feed. The next refresh reads the whole list. Grok still keeps an ethnicity only when a news report states one.</p>
        <ul className="feed-list">
          {feeds.map((feed) => (
            <li key={feed.url}>
              <form method="post" action="/admin/post" {...formQuiet}>
                <span className="feed-name">{feed.name}</span>
                <span className="feed-url">{feed.url}</span>
                <input type="hidden" name="feed_url" value={feed.url} />
                <button className="btn btn-ghost" type="submit" name="action" value="remove_feed">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        <form className="feed-add" method="post" action="/admin/post" {...formQuiet}>
          <label>Name<input type="text" name="feed_name" maxLength={40} placeholder="Washington Post" required /></label>
          <label>RSS URL<input type="url" name="feed_url" maxLength={300} placeholder="https://example.com/crime/feed" required /></label>
          <button className="btn" type="submit" name="action" value="add_feed">Add feed</button>
        </form>
        <h2>Queue</h2>
        <p>Confirmed articles waiting for a round, with the outlet they came from. Anything not dealt today stays for the next one.</p>
        <p className="note" id="queue-empty" hidden={queue.length > 0}>The queue is empty. A refresh adds confirmed articles here, then deals the round from them.</p>
        <ul className="queue-list" id="queue-list" data-signature={signature}>
          {queue.map((item) => (
            <li key={item.key}>
              <form method="post" action="/admin/post" {...formQuiet}>
                <span className="feed-name">{item.source}</span>
                <span className="feed-url">{item.headline} — {item.ethnicity}</span>
                <input type="hidden" name="queue_key" value={item.key} />
                <button className="btn btn-ghost" type="submit" name="action" value="drop_queue">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        <form method="post" action="/admin/post" {...formQuiet}>
          <label htmlFor="model">Screening model</label>
          <select id="model" name="model" defaultValue={model}>
            {GROK_MODELS.map((item) => (
              <option key={item.id} value={item.id}>{item.id}</option>
            ))}
          </select>
          {GROK_MODELS.map((item) => (
            <p key={item.id} className="note" hidden={item.id !== model} data-note={item.id}>{item.note}</p>
          ))}
          <label htmlFor="refresh-time">Daily refresh time</label>
          <input id="refresh-time" type="time" name="refresh_time" defaultValue={refreshTime} required />
          <p className="note">Local time on this computer. After this time, the app classifies today’s round once.</p>
          <label htmlFor="prompt">Ethnicity prompt</label>
          <textarea id="prompt" name="prompt" defaultValue={prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n')} suppressHydrationWarning data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button className="btn" type="submit" name="action" value="save">Save</button>
          <button className="btn btn-ghost" type="submit" name="action" value="reset">Restore default prompt</button>
        </form>
        <h2>Debug refresh</h2>
        <p>Check the box and run a refresh now. Every feed is fetched. The log shows each feed, each candidate, and Grok’s reasoning. When it says done, the round is dealt from the queue and you can play.</p>
        <form method="post" action="/admin/post" {...formQuiet}>
          <label className="check"><input type="checkbox" name="debug_refresh" value="1" id="debug-refresh" /> Debug refresh</label>
          <button className="btn" type="submit" name="action" value="refresh" id="refresh-btn" disabled>Run debug refresh</button>
        </form>
        <p id="refresh-state" className="note"></p>
        <div id="refresh-log"></div>
        <ul id="ready-list" className="ready-list"></ul>
        <BootScripts src="/admin.js" />
      </main>
    </div>
  )
}
