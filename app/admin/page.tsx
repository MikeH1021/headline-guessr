import { redirect } from 'next/navigation'
import { BootScripts } from '@/components/boot-scripts'
import { adminAuthed } from '@/lib/admin-auth'
import { ETHNICITIES, FEED_SCAN, GROK_MODELS, QUEUE_TAKE, ROUND_SIZE } from '@/lib/constants'
import { rumPublic, rumSummary } from '@/lib/rum'
import { collapseQueue, currentFeeds, currentModel, currentPrompt, currentRefreshTime, queuePublic, readQueue, readRound } from '@/lib/store'
import { headlineKey } from '@/lib/text'
import { oauthPublic, pollPending } from '@/lib/xai-session'

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
  const removed = collapseQueue()
  const queueNotice = removed
    ? `Removed ${removed} repeated ${removed === 1 ? 'incident' : 'incidents'} from the queue.`
    : ''
  const queue = queuePublic(readQueue())
  const round = readRound()
  const roundCards = round?.cards || []
  const model = currentModel()
  const prompt = currentPrompt()
  const refreshTime = currentRefreshTime()
  const rum = rumPublic(rumSummary())
  let grok = await oauthPublic()
  if (grok.pending) grok = await pollPending()
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
        <p>The daily round is 10 headlines. Confirmed articles wait in the queue, and the round takes one source at a time.</p>
        {(notice || queueNotice) && <p className="message">{notice || queueNotice}</p>}
        <details className="drawer" open>
          <summary>Today’s round</summary>
          <p>{round ? `${roundCards.length} headlines saved ${round.refreshedAt}.` : 'No round is saved yet.'} Remove one, or move a queued headline in, without running a refresh.</p>
          <p className="note" hidden={roundCards.length > 0}>Today’s round is empty.</p>
          <ul className="queue-list">
            {roundCards.map((card) => (
              <li key={headlineKey(card.headline)}>
                <form method="post" action="/admin/post" {...formQuiet}>
                  <span className="feed-name">{card.source}</span>
                  <span className="feed-url">{card.headline} — {card.ethnicity}</span>
                  <input type="hidden" name="queue_key" value={headlineKey(card.headline)} />
                  <button className="btn btn-ghost" type="submit" name="action" value="drop_round">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
        <details className="drawer" open>
          <summary>Queue</summary>
          <p>Confirmed articles waiting for a round. Add one here when you already know the stated ethnicity. Anything not dealt today stays for the next one.</p>
          <p className="note" id="queue-empty" hidden={queue.length > 0}>The queue is empty.</p>
          <ul className="queue-list" id="queue-list" data-signature={signature}>
            {queue.map((item) => (
              <li key={item.key}>
                <form method="post" action="/admin/post" {...formQuiet}>
                  <span className="feed-name">{item.source}</span>
                  <span className="feed-url">{item.headline} — {item.ethnicity}</span>
                  <input type="hidden" name="queue_key" value={item.key} />
                  <button className="btn btn-ghost" type="submit" name="action" value="use_queue">Use today</button>
                  <button className="btn btn-ghost" type="submit" name="action" value="drop_queue">Remove</button>
                </form>
              </li>
            ))}
          </ul>
          <form className="feed-add headline-add" method="post" action="/admin/post" {...formQuiet}>
            <label>Source<input type="text" name="source" maxLength={40} placeholder="Boston Herald" required /></label>
            <label>Headline<input type="text" name="headline" maxLength={240} placeholder="Man arrested after the robbery" required /></label>
            <label>Ethnicity
              <select name="ethnicity" defaultValue="" required>
                <option value="" disabled>Choose</option>
                {ETHNICITIES.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
            <label>URL<input type="url" name="url" maxLength={300} placeholder="https://example.com/story" /></label>
            <div className="split-actions">
              <button className="btn" type="submit" name="action" value="add_queue">Add to queue</button>
              <button className="btn btn-ghost" type="submit" name="action" value="add_round">Add to today’s round</button>
            </div>
          </form>
        </details>
        <details className="drawer">
          <summary>Feeds</summary>
          <p>Add or remove a crime RSS feed. The next refresh reads the whole list.</p>
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
        </details>
        <details className="drawer">
          <summary>Model and prompt</summary>
          <p>Grok reads the headline and the article. It can search the web. The answer is kept only when a news report states an ethnicity.</p>
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
            <div className="split-actions">
              <button className="btn" type="submit" name="action" value="save">Save</button>
              <button className="btn btn-ghost" type="submit" name="action" value="reset">Restore default prompt</button>
            </div>
          </form>
        </details>
        <details className="drawer">
          <summary>Stats</summary>
          <RumStats rum={rum} />
        </details>
        <details className="drawer" open>
          <summary>Grok account</summary>
          <p>Sign in with the Grok subscription. Classification spends that allowance. The API key is used only when xAI refuses the subscription. Signing in does not classify headlines.</p>
          {!grok.pending && grok.error && <p className="message">{grok.error}</p>}
          {grok.fallback && <p className="message">{grok.fallback}</p>}
          {grok.connected ? (
            <p>Signed in{grok.email ? ` as ${grok.email}` : ''}. {grok.error || grok.fallback ? 'The note above is the last billing result.' : 'Requests use the subscription allowance.'}</p>
          ) : grok.billing === 'api-key' ? (
            <p>Not signed in. Requests use the API key and are billed per token.</p>
          ) : (
            <p>Not signed in, and no API key is set. A refresh cannot call Grok until you sign in.</p>
          )}
          {grok.pending && (
            <div id="grok-pending" data-poll={grok.pollSeconds}>
              <meta httpEquiv="refresh" content={String(Math.max(6, grok.pollSeconds + 1))} />
              <p>Open the sign-in page and approve this code. Leave this page open. It reloads on its own and changes to signed in when xAI confirms the approval.</p>
              <p className="grok-code" id="grok-user-code">{grok.userCode}</p>
              <p><a href={grok.verificationUrl} target="_blank" rel="noreferrer noopener">Open the sign-in page</a></p>
              <button className="btn btn-ghost" type="button" id="grok-copy">Copy code</button>
              <p className="message" id="grok-live">{grok.error || 'Checking the approval.'}</p>
              <form method="post" action="/admin/post" {...formQuiet}>
                <button className="btn btn-ghost" type="submit" name="action" value="grok_cancel">Cancel</button>
              </form>
            </div>
          )}
          {!grok.pending && (
            <form method="post" action="/admin/post" {...formQuiet}>
              <button className="btn" type="submit" name="action" value="grok_connect">{grok.connected ? 'Sign in again' : 'Sign in with Grok'}</button>
            </form>
          )}
          {grok.connected && (
            <form method="post" action="/admin/post" data-confirm="Sign out of Grok on this server?" {...formQuiet}>
              <button className="btn btn-ghost" type="submit" name="action" value="grok_disconnect">Sign out of Grok</button>
            </form>
          )}
        </details>
        <details className="drawer" open>
          <summary>Refresh</summary>
          <p>Queue new headlines reads past entries that were already checked, up to {FEED_SCAN} per feed, and sends at most {QUEUE_TAKE} new ones from each. It stops once the queue has {ROUND_SIZE}, enough for the next round. An arrest headline that was screened before can be tried once more. A checked headline, one already in the queue, and one already in a round are skipped, so Grok is not called for them again.</p>
          <form method="post" action="/admin/post" {...formQuiet}>
            <button className="btn" type="submit" name="action" value="queue_more">Queue new headlines</button>
          </form>
          <p>Debug refresh does the same skip, then deals today’s round from the queue. That replaces the round people are playing.</p>
          <form method="post" action="/admin/post" {...formQuiet}>
            <label className="check"><input type="checkbox" name="debug_refresh" value="1" id="debug-refresh" /> Debug refresh</label>
            <button className="btn" type="submit" name="action" value="refresh" id="refresh-btn" disabled>Run debug refresh</button>
          </form>
          <p id="refresh-state" className="note"></p>
          <div id="refresh-log"></div>
          <ul id="ready-list" className="ready-list"></ul>
        </details>
        <BootScripts src="/admin.js?v=3" />
      </main>
    </div>
  )
}
