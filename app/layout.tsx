import type { Metadata, Viewport } from 'next'
import { Newsreader, Outfit } from 'next/font/google'
import { headers } from 'next/headers'
import { BootScripts } from '@/components/boot-scripts'
import { roundContext } from '@/lib/roundview'
import './globals.css'

const sans = Outfit({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })
const serif = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-serif',
})

export async function generateMetadata(): Promise<Metadata> {
  const configured = (process.env.PUBLIC_ORIGIN || 'https://headlineguessr.com').trim()
  let metadataBase = new URL('https://headlineguessr.com')
  try { metadataBase = new URL(configured) } catch { metadataBase = new URL('https://headlineguessr.com') }
  const description = 'A daily round of crime headlines. Guess the perpetrator’s ethnicity, one card at a time.'
  return {
    title: 'Headline Guessr',
    description,
    icons: { icon: '/favicon.svg' },
    metadataBase,
    openGraph: {
      title: 'Headline Guessr',
      description,
      url: metadataBase.origin,
      siteName: 'Headline Guessr',
      type: 'website',
      images: [{ url: '/og.png', width: 2400, height: 1260, alt: 'Headline Guessr' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Headline Guessr',
      description,
      images: ['/og.png'],
    },
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4efe6' },
    { media: '(prefers-color-scheme: dark)', color: '#141311' },
  ],
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function bodyClass(path: string) {
  if (path.startsWith('/game')) return 'page-game'
  if (path.startsWith('/results') || path.startsWith('/hint')) return 'page-results'
  if (path.startsWith('/admin')) return 'page-admin'
  return 'page-home'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers()
  const path = headerList.get('x-pathname') || '/'
  const round = roundContext()
  const requested = headerList.get('x-round-day') || ''
  const roundDay = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : round.roundDay
  return (
    <html lang="en" className={`js ${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <body className={bodyClass(path)} data-round-day={roundDay} suppressHydrationWarning>
        <a className="skip" href="#main">Skip to content</a>
        {children}
        <div className="sheet" id="stats-sheet" hidden>
          <div className="sheet-card" role="dialog" aria-modal="true" aria-labelledby="stats-title">
            <div className="sheet-head">
              <h2 id="stats-title">Your desk</h2>
              <button type="button" className="quiet" id="stats-close">Close</button>
            </div>
            <p className="sheet-empty" id="stats-empty" hidden>Finish a round and this desk fills in.</p>
            <div id="stats-body" hidden>
              <div className="stat-row">
                <p><strong id="stat-played">0</strong><span>Played</span></p>
                <p><strong id="stat-streak">0</strong><span>Streak</span></p>
                <p><strong id="stat-best">0</strong><span>Best</span></p>
                <p><strong id="stat-sweeps">0</strong><span>Sweeps</span></p>
              </div>
              <p className="most" id="stats-most"></p>
              <ol className="career-ranks" id="career-ranks"></ol>
              <div className="editions" id="editions"></div>
              <p className="colophon">Kept on this browser.</p>
            </div>
          </div>
        </div>
        <BootScripts src="/rum.js,/desk.js?v=4" />
      </body>
    </html>
  )
}
