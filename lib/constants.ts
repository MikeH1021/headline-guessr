export const ETHNICITIES = ['White', 'Black', 'Hispanic', 'Asian', 'Middle Eastern'] as const

export type Ethnicity = (typeof ETHNICITIES)[number]

export const DEFAULT_ETHNICITY_PROMPT = `Read each article and record the perpetrator's ethnicity only when a news report explicitly states it.

Use the article copy, not the headline alone. The copy is where the outlet may name the person or state who they are. Web search is available. If this article does not state the ethnicity, search for other news reporting on the same incident or person.

Do not infer or guess ethnicity from a name, a photo, a neighborhood, or a stereotype. If neither this article nor a news report you find states the perpetrator's race or ethnicity, set stated to false and ethnicity to null.

When a report does state it, set stated to true and set ethnicity to exactly one of: White, Black, Hispanic, Asian, Middle Eastern. Choose the label closest to the wording the report used.

If the article describes more than one perpetrator and they are not all the same stated ethnicity, set stated to false.

The ethnicity field is only that label. Do not put a name or any other detail in it.`

export const DEFAULT_FEEDS: ReadonlyArray<readonly [string, string]> = [
  ['CBS', 'https://www.cbsnews.com/latest/rss/crime'],
  ['NY Post', 'https://nypost.com/tag/crime/feed/'],
  ['Law & Crime', 'https://lawandcrime.com/feed/'],
  ['Oxygen', 'https://www.oxygen.com/feeds/crime-news'],
  ['CrimeOnline', 'https://crimeonline.com/feed/'],
  ['Mercury News', 'https://www.mercurynews.com/tag/crime/feed/'],
  ['Washington Examiner', 'https://www.washingtonexaminer.com/news/crime/feed'],
  ['Daily Mail', 'https://www.dailymail.com/news/crime/index.rss'],
  ['NJ.com', 'https://www.nj.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['Seattle Times', 'https://www.seattletimes.com/seattle-news/law-justice/feed/'],
  ['Boston Herald', 'https://www.bostonherald.com/tag/crime/feed/'],
  ['Cleveland.com', 'https://www.cleveland.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['MLive', 'https://www.mlive.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['OregonLive', 'https://www.oregonlive.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['AL.com', 'https://www.al.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['PennLive', 'https://www.pennlive.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['Syracuse.com', 'https://www.syracuse.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'],
  ['Denver Post', 'https://www.denverpost.com/tag/crime/feed/'],
  ['OC Register', 'https://www.ocregister.com/tag/crime/feed/'],
  ['The Guardian', 'https://www.theguardian.com/us-news/us-crime/rss'],
]

export const GROK_MODELS = [
  { id: 'grok-4.7', note: 'Most capable model on the models page.' },
  { id: 'grok-4.6', note: 'Earlier Grok 4 text model.' },
  { id: 'grok-4.5', note: 'Earlier Grok 4 text model.' },
  { id: 'grok-4.3', note: 'Lower token price than grok-4.7.' },
  { id: 'grok-4.20-0309-non-reasoning', note: 'Answers without a reasoning pass.' },
  { id: 'grok-4.20-0309-reasoning', note: 'Reasons before it answers.' },
] as const

export const MODEL_IDS = new Set<string>(GROK_MODELS.map((model) => model.id))

export const ROUND_SIZE = 10
export const CANDIDATE_SIZE = 16
export const PER_FEED = 16
export const SCREEN_BATCH = 16
export const MAX_FEEDS = 40
export const QUEUE_CAP = 200
export const SCORE_CAP = 250_000
export const RUM_CAP = 50_000
export const FINISH_CAP_MS = 15 * 60 * 1000
export const DEFAULT_REFRESH_TIME = '06:00'
export const XAI_URL = 'https://api.x.ai/v1/responses'
export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const RUM_KINDS = ['view', 'vital', 'finish', 'error'] as const

export const RUM_PATHS: Record<string, string> = {
  '/': 'Home',
  '/game': 'Game',
  '/results': 'Results',
  '/admin': 'Admin',
  '/hint': 'Hint',
}

export const TIERS = [
  [17, 'liberal', 'Brainwashed liberal', 'The broadcast tucked you in.'],
  [34, 'headline', 'Believes the headline', 'You took the banner at its word.'],
  [52, 'normie', 'Normie', 'Right down the middle.'],
  [69, 'squint', 'Starting to notice', 'That headline felt a little off.'],
  [84, 'noticer', 'High-level noticer', 'You saw the pattern in the deck.'],
  [94, 'autist', 'Based autist', 'You would not let the detail go.'],
  [100, 'machine', 'Pattern recognition machine', 'Nothing gets past the machine.'],
] as const

export const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      maxItems: CANDIDATE_SIZE,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'event'],
        properties: {
          id: { type: 'integer' },
          event: {
            type: 'string',
            description: 'Short name of this one crime, shared by every headline about it',
          },
        },
      },
    },
  },
}

export const ETHNICITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'stated', 'ethnicity'],
        properties: {
          id: { type: 'integer' },
          stated: { type: 'boolean' },
          ethnicity: {
            anyOf: [{ type: 'string', enum: [...ETHNICITIES] }, { type: 'null' }],
          },
        },
      },
    },
  },
}
