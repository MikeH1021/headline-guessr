from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import requests
import xml.etree.ElementTree as ET
import random
import json
import datetime
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from html import escape, unescape
import hashlib
import hmac
import base64

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET') or os.urandom(32)

# Crime RSS only. General news feeds stay out so the daily job is not reading unrelated stories.
# A saved settings list replaces this. Every refresh reads every feed.
DEFAULT_FEEDS = (
    ('CBS', 'https://www.cbsnews.com/latest/rss/crime'),
    ('NY Post', 'https://nypost.com/tag/crime/feed/'),
    ('Law & Crime', 'https://lawandcrime.com/feed/'),
    ('Oxygen', 'https://www.oxygen.com/feeds/crime-news'),
    ('CrimeOnline', 'https://crimeonline.com/feed/'),
    ('Mercury News', 'https://www.mercurynews.com/tag/crime/feed/'),
    ('Washington Examiner', 'https://www.washingtonexaminer.com/news/crime/feed'),
    ('Daily Mail', 'https://www.dailymail.com/news/crime/index.rss'),
    ('NJ.com', 'https://www.nj.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('Seattle Times', 'https://www.seattletimes.com/seattle-news/law-justice/feed/'),
    ('Boston Herald', 'https://www.bostonherald.com/tag/crime/feed/'),
    ('Cleveland.com', 'https://www.cleveland.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('MLive', 'https://www.mlive.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('OregonLive', 'https://www.oregonlive.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('AL.com', 'https://www.al.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('PennLive', 'https://www.pennlive.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('Syracuse.com', 'https://www.syracuse.com/arc/outboundfeeds/rss/category/crime/?outputType=xml'),
    ('Denver Post', 'https://www.denverpost.com/tag/crime/feed/'),
    ('OC Register', 'https://www.ocregister.com/tag/crime/feed/'),
    ('The Guardian', 'https://www.theguardian.com/us-news/us-crime/rss'),
)

ROUND_SIZE = 10
CANDIDATE_SIZE = 16
PER_FEED = 16
SCREEN_BATCH = 16
MAX_FEEDS = 40
_QUEUE_CAP = 200
# A tab left open is not a finish time. The median skips anything longer than this.
_FINISH_CAP_MS = 15 * 60 * 1000
DEFAULT_REFRESH_TIME = '06:00'
ETHNICITIES = ('White', 'Black', 'Hispanic', 'Asian', 'Middle Eastern')
DEFAULT_ETHNICITY_PROMPT = """Read each article and record the perpetrator's ethnicity only when a news report explicitly states it.

Use the article copy, not the headline alone. The copy is where the outlet may name the person or state who they are. Web search is available. If this article does not state the ethnicity, search for other news reporting on the same incident or person.

Do not infer or guess ethnicity from a name, a photo, a neighborhood, or a stereotype. If neither this article nor a news report you find states the perpetrator's race or ethnicity, set stated to false and ethnicity to null.

When a report does state it, set stated to true and set ethnicity to exactly one of: White, Black, Hispanic, Asian, Middle Eastern. Choose the label closest to the wording the report used.

If the article describes more than one perpetrator and they are not all the same stated ethnicity, set stated to false.

The ethnicity field is only that label. Do not put a name or any other detail in it."""
_XAI_URL = 'https://api.x.ai/v1/responses'
# Text models from the xAI models page. grok-4.7 is the current default.
GROK_MODELS = (
    {'id': 'grok-4.7', 'note': 'Most capable model on the models page.'},
    {'id': 'grok-4.6', 'note': 'Earlier Grok 4 text model.'},
    {'id': 'grok-4.5', 'note': 'Earlier Grok 4 text model.'},
    {'id': 'grok-4.3', 'note': 'Lower token price than grok-4.7.'},
    {'id': 'grok-4.20-0309-non-reasoning', 'note': 'Answers without a reasoning pass.'},
    {'id': 'grok-4.20-0309-reasoning', 'note': 'Reasons before it answers.'},
)
_MODEL_IDS = {model['id'] for model in GROK_MODELS}
_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_SETTINGS_PATH = os.path.join(_APP_DIR, 'settings.json')
_ROUND_PATH = os.path.join(_APP_DIR, 'round.json')
_STATUS_PATH = os.path.join(_APP_DIR, 'refresh_status.json')
_SCORES_PATH = os.path.join(_APP_DIR, 'scores.json')
_SCORES_LOCK = threading.Lock()
_RUM_PATH = os.path.join(_APP_DIR, 'rum.json')
_RUM_LOCK = threading.Lock()
_QUEUE_PATH = os.path.join(_APP_DIR, 'queue.json')
_QUEUE_LOCK = threading.Lock()
_RUM_KINDS = ('view', 'vital', 'finish', 'error')
_RUM_PATHS = {
    '/': 'Home',
    '/game': 'Game',
    '/results': 'Results',
    '/admin': 'Admin',
    '/hint': 'Hint',
}

_CNN_HEADLINE = re.compile(
    r'<span class="container__headline-text"[^>]*data-editable="headline"[^>]*>(.*?)</span>',
    re.S,
)
_NBC_HEADLINE = re.compile(
    r'class="(?:wide-tease-item__headline|multistoryline__headline)[^"]*"[^>]*>(.*?)</',
    re.S,
)
_PICK_SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['picks'],
    'properties': {
        'picks': {
            'type': 'array',
            'maxItems': CANDIDATE_SIZE,
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['id', 'event'],
                'properties': {
                    'id': {'type': 'integer'},
                    'event': {
                        'type': 'string',
                        'description': 'Short name of this one crime, shared by every headline about it',
                    },
                },
            },
        },
    },
}


class HeadlineError(Exception):
    pass


def _load_dotenv():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(path):
        return
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _read_settings():
    try:
        with open(_SETTINGS_PATH) as handle:
            saved = json.load(handle)
    except (OSError, ValueError):
        return {}
    return saved if isinstance(saved, dict) else {}


def current_model():
    saved = _read_settings().get('model')
    if saved in _MODEL_IDS:
        return saved
    return GROK_MODELS[0]['id']


def current_prompt():
    saved = _read_settings().get('prompt')
    if isinstance(saved, str) and saved.strip():
        return saved
    return DEFAULT_ETHNICITY_PROMPT


def current_refresh_time():
    saved = _read_settings().get('refresh_time')
    if _valid_refresh_time(saved):
        return saved
    return DEFAULT_REFRESH_TIME


def _valid_refresh_time(value):
    return isinstance(value, str) and re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', value) is not None


def _write_settings(saved):
    temporary = _SETTINGS_PATH + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(saved, handle, indent=2)
    os.replace(temporary, _SETTINGS_PATH)


def _save_settings(model_id, prompt, refresh_time):
    saved = _read_settings()
    saved['model'] = model_id
    saved['prompt'] = prompt
    saved['refresh_time'] = refresh_time
    _write_settings(saved)


def _feed_name(value):
    if not isinstance(value, str):
        return ''
    name = re.sub(r'\s+', ' ', value).strip()
    if not name or len(name) > 40 or not re.search(r'[A-Za-z0-9]', name):
        return ''
    return name


def _feed_url(value):
    if not isinstance(value, str):
        return ''
    url = value.strip()
    if len(url) > 300 or not re.fullmatch(r'https?://\S+', url):
        return ''
    return url


def _parse_feeds(saved):
    if not isinstance(saved, list):
        return []
    feeds = []
    seen = set()
    for item in saved:
        if not isinstance(item, dict):
            continue
        name = _feed_name(item.get('name'))
        url = _feed_url(item.get('url'))
        if not name or not url or url in seen:
            continue
        seen.add(url)
        feeds.append((name, url, 'rss'))
        if len(feeds) >= MAX_FEEDS:
            break
    return feeds


def current_feeds():
    saved = _parse_feeds(_read_settings().get('feeds'))
    if saved:
        return saved
    return [(name, url, 'rss') for name, url in DEFAULT_FEEDS]


def _store_feeds(feeds):
    saved = _read_settings()
    saved['feeds'] = [{'name': name, 'url': url} for name, url, _kind in feeds]
    _write_settings(saved)


def _add_feed(name, url):
    clean_name = _feed_name(name)
    clean_url = _feed_url(url)
    if not clean_name or not clean_url:
        return 'Enter a name and an http or https RSS URL.'
    feeds = current_feeds()
    if any(item[1] == clean_url for item in feeds):
        return 'That feed is already on the list.'
    if len(feeds) >= MAX_FEEDS:
        return 'The list already has %s feeds.' % MAX_FEEDS
    feeds.append((clean_name, clean_url, 'rss'))
    _store_feeds(feeds)
    return 'Added %s. The next refresh reads it.' % clean_name


def _remove_feed(url):
    target = _feed_url(url)
    feeds = current_feeds()
    kept = [item for item in feeds if item[1] != target]
    if len(kept) == len(feeds):
        return 'That feed is not on the list.'
    if not kept:
        return 'Keep at least one feed.'
    _store_feeds(kept)
    return 'Removed the feed. The next refresh skips it.'


def _clean_title(raw):
    title = unescape(re.sub(r'<[^>]+>', '', raw or ''))
    title = re.sub(r'\s+', ' ', title).strip()
    if not title or title.startswith(("'", '+', '{')) or 'function' in title:
        return ''
    return title


def _story_url(url, base):
    url = unescape((url or '').strip())
    if url.startswith('//'):
        url = 'https:' + url
    elif url.startswith('/'):
        url = base + url
    if not url.startswith('http'):
        return ''
    return url.split('#')[0]


def _plain_text(raw):
    text = unescape(re.sub(r'<[^>]+>', ' ', raw or ''))
    return re.sub(r'\s+', ' ', text).strip()


def _item_copy(item):
    chunks = []
    for child in list(item):
        if child.tag.endswith('encoded') and child.text:
            chunks.append(child.text)
    description = item.findtext('description') or ''
    if description:
        chunks.append(description)
    return _plain_text('\n'.join(chunks))[:7000]


def _rss_stories(response):
    if response is None or response.status_code != 200 or not response.content:
        return []
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        return []
    stories = []
    seen = set()
    for item in root.findall('.//item'):
        title = _clean_title(item.findtext('title') or '')
        link = item.findtext('link') or ''
        if not link.startswith('http'):
            guid = item.findtext('guid') or ''
            if guid.startswith('http'):
                link = guid
        link = _story_url(link, '')
        if not title or not link or title in seen or '/video/' in link:
            continue
        seen.add(title)
        stories.append({'headline': title, 'url': link, 'rss_copy': _item_copy(item)})
    return stories


_CNN_STORY = re.compile(
    r'<a href="([^"]+)"[^>]*class="[^"]*container__link[^"]*"[^>]*>[\s\S]{0,2500}?'
    r'<span class="container__headline-text"[^>]*data-editable="headline"[^>]*>(.*?)</span>',
    re.S,
)
_NBC_STORY = re.compile(
    r'<a href="(https://www\.nbcnews\.com/[^"]+)"[^>]*>\s*'
    r'<(?:h2|h3) class="(?:wide-tease-item__headline|multistoryline__headline)[^"]*"[^>]*>(.*?)</',
    re.S,
)


def _html_stories(response, pattern, base):
    if response is None or response.status_code != 200 or not response.text:
        return []
    stories = []
    seen = set()
    for match in pattern.finditer(response.text):
        title = _clean_title(match.group(2))
        link = _story_url(match.group(1), base)
        if not title or not link or title in seen:
            continue
        seen.add(title)
        stories.append({'headline': title, 'url': link})
    return stories


def _stories_from(outlet):
    source, url, kind = outlet
    response = _get_feed(url)
    if kind == 'cnn':
        found = _html_stories(response, _CNN_STORY, 'https://www.cnn.com')
    elif kind == 'nbc':
        found = _html_stories(response, _NBC_STORY, 'https://www.nbcnews.com')
    else:
        found = _rss_stories(response)
    stories = []
    for story in found[:PER_FEED]:
        story['source'] = source
        stories.append(story)
    return stories


def _interleave(groups, cap):
    mixed = []
    seen = set()
    while len(mixed) < cap and any(groups):
        for group in groups:
            if not group:
                continue
            story = group.pop(0)
            key = story['headline'].casefold()
            if key in seen:
                continue
            seen.add(key)
            mixed.append(story)
            if len(mixed) >= cap:
                break
    return mixed


def gather_stories():
    feeds = current_feeds()
    if not feeds:
        return []
    groups = []
    with ThreadPoolExecutor(max_workers=len(feeds)) as pool:
        for stories in pool.map(_stories_from, feeds):
            groups.append(list(stories))
    return _interleave(groups, len(feeds) * PER_FEED)


def _grok_body(model_id, instructions, schema_name, schema, tools=None):
    body = {
        'model': model_id,
        'input': instructions,
        'text': {
            'format': {
                'type': 'json_schema',
                'name': schema_name,
                'strict': True,
                'schema': schema,
            },
        },
    }
    if tools:
        body['tools'] = tools
    # grok-4.7 defaults to high effort, which spent about a minute on eight headlines.
    if model_id in ('grok-4.7', 'grok-4.6', 'grok-4.5'):
        body['reasoning'] = {'effort': 'low'}
    return body


def screen_stories(stories, on_reasoning=None, prior_events=None, limit=None):
    numbered = [
        {'id': index, 'source': story['source'], 'headline': story['headline']}
        for index, story in enumerate(stories)
    ]
    pick_limit = limit or min(CANDIDATE_SIZE, len(stories))
    instructions = (
        'Screen these headlines for a game. Pick at most %s. ' % pick_limit
        + 'Keep a headline only when its subject is a specific crime that has been committed: '
        'someone was attacked, killed, robbed, kidnapped, sexually assaulted, or otherwise victimized. '
        'Reject headlines that are mainly about a court, a judge, a trial, a retrial, a sentence, an appeal, '
        'a lawsuit, or another legal procedure, even if a crime is mentioned. '
        'Reject politics, policy, explainers, and follow-up roundups. '
        'Each pick must be a different crime. If several headlines cover one event, such as the same school shooting, '
        'keep only the single clearest report of that crime. '
        'Use a mix of publications when you can. Use only the id numbers given. Do not rewrite headlines.'
    )
    parsed, reasoning = _grok(
        instructions + '\n\nHeadlines:\n' + json.dumps(numbered),
        'headline_picks',
        _PICK_SCHEMA,
        'headline screening',
    )
    if on_reasoning and reasoning:
        on_reasoning(reasoning)
    picks = parsed.get('picks') if isinstance(parsed, dict) else None
    if not isinstance(picks, list):
        raise HeadlineError('Grok returned a screening result that could not be read.')
    return _apply_picks(stories, picks, prior_events, pick_limit)


def _response_text(payload):
    if isinstance(payload.get('output_text'), str):
        return payload['output_text']
    for item in payload.get('output') or []:
        if not isinstance(item, dict) or item.get('type') != 'message':
            continue
        for part in item.get('content') or []:
            if isinstance(part, dict) and part.get('type') == 'output_text' and part.get('text'):
                return part['text']
    return ''


def _reasoning_text(payload):
    if not isinstance(payload, dict):
        return ''
    chunks = []
    for item in payload.get('output') or []:
        if not isinstance(item, dict) or item.get('type') != 'reasoning':
            continue
        summary = item.get('summary')
        if isinstance(summary, str) and summary.strip():
            chunks.append(summary.strip())
        elif isinstance(summary, list):
            for part in summary:
                if isinstance(part, dict) and part.get('text'):
                    chunks.append(str(part['text']).strip())
                elif isinstance(part, str) and part.strip():
                    chunks.append(part.strip())
    searches = _search_notes(payload)
    if searches:
        chunks.append(searches)
    return '\n\n'.join(chunk for chunk in chunks if chunk)[:6000]


def _search_notes(payload):
    if not isinstance(payload, dict):
        return ''
    lines = []
    for item in payload.get('output') or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get('type') or '')
        name = str(item.get('name') or '')
        if 'search' not in kind and 'search' not in name:
            continue
        action = item.get('action') if isinstance(item.get('action'), dict) else {}
        query = action.get('query') or item.get('query') or item.get('arguments') or item.get('input') or ''
        if isinstance(query, dict):
            query = json.dumps(query)
        query = str(query).strip()
        if query:
            lines.append('Search: %s' % query[:400])
        urls = []
        for source in action.get('sources') or []:
            if isinstance(source, dict) and source.get('url'):
                urls.append(str(source['url']))
            elif isinstance(source, str):
                urls.append(source)
        if urls:
            lines.append('Sources: ' + ', '.join(urls[:6]))
    citations = payload.get('citations') or []
    if isinstance(citations, list) and citations:
        lines.append('Sources: ' + ', '.join(str(url) for url in citations[:8]))
    return '\n'.join(lines)


def _same_event(left, right):
    if left == right:
        return True
    short, long = (left, right) if len(left) <= len(right) else (right, left)
    return len(short) >= 8 and short in long


def _apply_picks(stories, picks, prior_events=None, limit=None):
    chosen = []
    used_ids = set()
    used_events = list(prior_events or [])
    cap = CANDIDATE_SIZE if limit is None else limit
    for pick in picks:
        if not isinstance(pick, dict):
            continue
        try:
            index = int(pick.get('id'))
        except (TypeError, ValueError):
            continue
        event = str(pick.get('event') or '').strip()
        if index in used_ids or index < 0 or index >= len(stories) or not event:
            continue
        folded = event.casefold()
        if any(_same_event(folded, prior) for prior in used_events):
            continue
        used_ids.add(index)
        used_events.append(folded)
        chosen.append({
            'source': stories[index]['source'],
            'headline': stories[index]['headline'],
            'url': stories[index]['url'],
            'rss_copy': stories[index].get('rss_copy') or '',
            'event': event,
        })
        if len(chosen) >= cap:
            break
    return chosen


def _json_string_at(html, key):
    start = html.find(key)
    if start == -1:
        return ''
    start += len(key)
    chars = []
    index = start
    while index < len(html):
        char = html[index]
        if char == '\\':
            chars.append(html[index:index + 2])
            index += 2
            continue
        if char == '"':
            break
        chars.append(char)
        index += 1
    try:
        return json.loads('"' + ''.join(chars) + '"')
    except ValueError:
        return ''


def _paragraphs(html):
    marker = html.find('single__content entry-content')
    chunk = html[marker:marker + 60000] if marker != -1 else html
    paragraphs = []
    for match in re.finditer(r'<p[^>]*>(.*?)</p>', chunk, re.I | re.S):
        text = _clean_title(match.group(1))
        if len(text) < 80 or len(text) > 900 or '.' not in text:
            continue
        if '{' in text or 'function' in text or 'Primary Menu' in text or 'not fully supported' in text:
            continue
        paragraphs.append(text)
    return '\n'.join(paragraphs)


def _article_copy(url):
    response = _get_feed(url)
    if response is None or not response.text or response.status_code != 200:
        return ''
    html = response.text
    copy = _json_string_at(html, '"articleBody":"')
    if len(copy) < 200:
        copy = _paragraphs(html)
    copy = re.sub(r'\s+', ' ', copy).strip()
    return copy[:7000]


def _story_copy(story):
    copy = _article_copy(story['url'])
    if len(copy) >= 200:
        return copy
    fallback = (story.get('rss_copy') or '').strip()
    if len(fallback) >= 200:
        return fallback[:7000]
    return copy or fallback


def _with_copy(stories):
    urls = [story['url'] for story in stories]
    with ThreadPoolExecutor(max_workers=6) as pool:
        copies = list(pool.map(_article_copy, urls))
    ready = []
    for story, copy in zip(stories, copies):
        if len(copy) < 200:
            continue
        ready.append({
            'source': story['source'],
            'headline': story['headline'],
            'url': story['url'],
            'copy': copy,
        })
    return ready


_ETHNICITY_SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['answers'],
    'properties': {
        'answers': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['id', 'stated', 'ethnicity'],
                'properties': {
                    'id': {'type': 'integer'},
                    'stated': {'type': 'boolean'},
                    'ethnicity': {
                        'anyOf': [
                            {'type': 'string', 'enum': list(ETHNICITIES)},
                            {'type': 'null'},
                        ],
                    },
                },
            },
        },
    },
}


def _canonical_ethnicity(value):
    if not isinstance(value, str):
        return ''
    folded = value.strip().casefold()
    for label in ETHNICITIES:
        if label.casefold() == folded:
            return label
    return ''


def assign_ethnicities(stories, on_reasoning=None):
    numbered = [
        {
            'id': index,
            'source': story['source'],
            'headline': story['headline'],
            'copy': story['copy'],
        }
        for index, story in enumerate(stories)
    ]
    instructions = (
        current_prompt().strip()
        + '\n\nWeb search is available. If the article does not state the perpetrator\'s ethnicity, search for news reporting on the same incident or person. '
        + 'Set stated to true only when the article or a news report from that search explicitly states an ethnicity, and only when it is one of '
        + ', '.join(ETHNICITIES)
        + '. Otherwise set stated to false and ethnicity to null. Do not infer ethnicity from a name. Do not include a person\'s name.'
        + '\n\nArticles:\n'
        + json.dumps(numbered)
    )
    payload, reasoning = _grok(
        instructions,
        'ethnicity_answers',
        _ETHNICITY_SCHEMA,
        'ethnicity',
        tools=[{'type': 'web_search'}],
    )
    if on_reasoning and reasoning:
        on_reasoning(reasoning)
    try:
        answers = payload['answers']
    except (TypeError, KeyError):
        raise HeadlineError('Grok returned an ethnicity result that could not be read.')
    by_id = {}
    for answer in answers:
        if not isinstance(answer, dict) or not answer.get('stated'):
            continue
        try:
            index = int(answer.get('id'))
        except (TypeError, ValueError):
            continue
        label = _canonical_ethnicity(answer.get('ethnicity'))
        if label and 0 <= index < len(stories):
            by_id[index] = label
    chosen = []
    for index, story in enumerate(stories):
        label = by_id.get(index)
        if not label:
            continue
        chosen.append({
            'source': story['source'],
            'headline': story['headline'],
            'ethnicity': label,
        })
        if len(chosen) >= ROUND_SIZE:
            break
    return chosen


def _grok(instructions, schema_name, schema, step='the request', tools=None):
    api_key = os.environ.get('XAI_API_KEY', '').strip()
    if not api_key:
        raise HeadlineError(
            'Add your xAI API key as XAI_API_KEY in a .env file in this folder, then restart the app.'
        )
    try:
        response = requests.post(
            _XAI_URL,
            timeout=240,
            headers={
                'Authorization': 'Bearer ' + api_key,
                'Content-Type': 'application/json',
            },
            json=_grok_body(current_model(), instructions, schema_name, schema, tools),
        )
    except requests.Timeout:
        raise HeadlineError('Grok took too long during %s.' % step)
    except requests.RequestException:
        raise HeadlineError('Grok could not be reached during %s.' % step)
    if response.status_code != 200:
        raise HeadlineError('Grok could not complete %s (HTTP %s).' % (step, response.status_code))
    raw = response.json()
    try:
        parsed = json.loads(_response_text(raw))
    except (ValueError, TypeError):
        raise HeadlineError('Grok returned a result that could not be read.')
    return parsed, _reasoning_text(raw)


_JOB_LOCK = threading.Lock()
_JOB = {
    'running': False,
    'kept': 0,
    'target': ROUND_SIZE,
    'error': '',
    'finished_at': '',
    'events': [],
}


def _write_job_unlocked():
    temporary = _STATUS_PATH + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(_JOB, handle)
    os.replace(temporary, _STATUS_PATH)


def _job_log(message, reasoning=''):
    event = {
        'at': datetime.datetime.now().strftime('%H:%M:%S'),
        'message': message,
        'reasoning': (reasoning or '')[:6000],
    }
    with _JOB_LOCK:
        _JOB['events'].append(event)
        if len(_JOB['events']) > 300:
            del _JOB['events'][:-300]
        _write_job_unlocked()


def _job_set(**values):
    with _JOB_LOCK:
        _JOB.update(values)
        _write_job_unlocked()


def _job_snapshot():
    with _JOB_LOCK:
        return {
            'running': _JOB['running'],
            'kept': _JOB['kept'],
            'target': _JOB['target'],
            'error': _JOB['error'],
            'finished_at': _JOB['finished_at'],
            'events': list(_JOB['events']),
        }


def _recover_job():
    try:
        with open(_STATUS_PATH) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return
    if not isinstance(data, dict):
        return
    with _JOB_LOCK:
        events = data.get('events')
        _JOB['events'] = events if isinstance(events, list) else []
        _JOB['kept'] = int(data.get('kept') or 0)
        _JOB['running'] = False
        _JOB['error'] = data.get('error') or ''
        _JOB['finished_at'] = data.get('finished_at') or ''
        if data.get('running'):
            _JOB['error'] = 'The last refresh stopped because the app restarted.'
        _write_job_unlocked()


def _read_round():
    try:
        with open(_ROUND_PATH) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _queue_key(item):
    headline = re.sub(r'\s+', ' ', str(item.get('headline') or '')).strip().casefold()
    return headline[:240]


def _read_queue():
    try:
        with open(_QUEUE_PATH) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    rows = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        source = _feed_name(item.get('source'))
        headline = _clean_title(item.get('headline') or '')
        ethnicity = _canonical_ethnicity(item.get('ethnicity'))
        if not source or not headline or not ethnicity:
            continue
        key = _queue_key({'headline': headline})
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append({
            'source': source,
            'headline': headline,
            'ethnicity': ethnicity,
            'url': _feed_url(item.get('url')) if item.get('url') else '',
        })
    return rows[:_QUEUE_CAP]


def _write_queue(rows):
    temporary = _QUEUE_PATH + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(rows[:_QUEUE_CAP], handle)
    os.replace(temporary, _QUEUE_PATH)


def _queue_public(rows):
    public = []
    for item in rows:
        public.append({
            'source': item['source'],
            'headline': item['headline'],
            'ethnicity': item['ethnicity'],
            'key': _queue_key(item),
        })
    return public


def _queue_append(card):
    key = _queue_key(card)
    ethnicity = _canonical_ethnicity(card.get('ethnicity'))
    if not key or not ethnicity:
        return 0, False
    with _QUEUE_LOCK:
        queue = _read_queue()
        if any(_queue_key(item) == key for item in queue):
            return len(queue), False
        queue.append({
            'source': card['source'],
            'headline': card['headline'],
            'ethnicity': ethnicity,
            'url': card.get('url') or '',
        })
        if len(queue) > _QUEUE_CAP:
            queue = queue[-_QUEUE_CAP:]
        _write_queue(queue)
        return len(queue), True


def _deal_queue(queue, size):
    """Take up to `size` cards, one source at a time, so one outlet cannot clump."""
    order = []
    groups = {}
    for item in queue:
        source = item['source']
        if source not in groups:
            groups[source] = []
            order.append(source)
        groups[source].append(item)
    dealt = []
    while len(dealt) < size and any(groups[source] for source in order):
        for source in order:
            group = groups[source]
            if not group:
                continue
            dealt.append(group.pop(0))
            if len(dealt) >= size:
                break
    rest = []
    for source in order:
        rest.extend(groups[source])
    return dealt, rest


def _take_round():
    with _QUEUE_LOCK:
        dealt, rest = _deal_queue(_read_queue(), ROUND_SIZE)
        _write_queue(rest)
        return dealt, rest


def _drop_queued(key):
    if _job_snapshot()['running']:
        return 'A refresh is running. The queue can be edited when it finishes.'
    wanted = (key or '').strip().casefold()
    with _QUEUE_LOCK:
        queue = _read_queue()
        kept = [item for item in queue if _queue_key(item) != wanted]
        if len(kept) == len(queue):
            return 'That article is not in the queue.'
        _write_queue(kept)
    return 'Removed from the queue.'


def _save_round(cards):
    now = datetime.datetime.now()
    payload = {
        'refreshed_on': now.date().isoformat(),
        'refreshed_at': now.strftime('%Y-%m-%d %H:%M:%S'),
        'cards': [
            {
                'source': card['source'],
                'headline': card['headline'],
                'ethnicity': card['ethnicity'],
            }
            for card in cards
        ],
    }
    temporary = _ROUND_PATH + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(payload, handle)
    os.replace(temporary, _ROUND_PATH)


def _classify_one(story):
    _job_log('Article: %s — %s' % (story['source'], story['headline']))
    copy = _story_copy(story)
    if len(copy) < 200:
        _job_log('Skipped. The article page did not include enough text.')
        return 'skip'
    answered = assign_ethnicities(
        [{
            'source': story['source'],
            'headline': story['headline'],
            'copy': copy,
        }],
        on_reasoning=lambda text: _job_log('Ethnicity notes.', text),
    )
    if not answered:
        _job_log('Not stated. Skipped.')
        return 'done'
    card = answered[0]
    card['url'] = story.get('url') or ''
    queued, added = _queue_append(card)
    _job_set(kept=queued)
    if added:
        _job_log('Stated: %s. Queue has %s.' % (card['ethnicity'], queued))
    else:
        _job_log('Already in the queue.')
    return 'done'


def _classify_spread(picked):
    """One source per turn. Keep reading until the queue can fill a round or the candidates run out. Finish the pass that fills a round, then stop."""
    order = []
    groups = {}
    for story in picked:
        source = story['source']
        if source not in groups:
            groups[source] = []
            order.append(source)
        groups[source].append(story)
    _pass = 0
    while any(groups.values()):
        _pass += 1
        _job_log('Pass %s. One article from each source that still has a candidate.' % _pass)
        for source in order:
            while groups[source]:
                story = groups[source].pop(0)
                if _classify_one(story) != 'skip':
                    break
        queued = len(_read_queue())
        if queued >= ROUND_SIZE:
            _job_log('The queue can fill a round of %s. Later sources in this pass were included.' % ROUND_SIZE)
            break


def _classify_daily():
    if not os.environ.get('XAI_API_KEY', '').strip():
        raise HeadlineError(
            'Add your xAI API key as XAI_API_KEY in a .env file in this folder, then restart the app.'
        )
    feeds = current_feeds()
    _job_log('Fetching %s crime RSS feeds, %s headlines each.' % (len(feeds), PER_FEED))
    fetched = []
    if feeds:
        with ThreadPoolExecutor(max_workers=len(feeds)) as pool:
            fetched = list(pool.map(_stories_from, feeds))
    groups = []
    for outlet, found in zip(feeds, fetched):
        _job_log('%s: %s headlines.' % (outlet[0], len(found)))
        groups.append(list(found))
    stories = _interleave(groups, max(1, len(feeds)) * PER_FEED)
    _job_log('Collected %s headlines from %s feeds. Screening for distinct crimes.' % (len(stories), len(feeds)))
    picked = []
    prior = []
    for start in range(0, len(stories), SCREEN_BATCH):
        batch = stories[start:start + SCREEN_BATCH]
        _job_log('Screening headlines %s–%s.' % (start + 1, start + len(batch)))
        chosen = screen_stories(
            batch,
            on_reasoning=lambda text: _job_log('Screening notes.', text),
            prior_events=prior,
            limit=len(batch),
        )
        if not chosen:
            _job_log('No new crimes in this batch.')
            continue
        for story in chosen:
            prior.append(story['event'].casefold())
            picked.append(story)
            _job_log('Candidate: %s — %s' % (story['source'], story['headline']))
    if picked:
        _job_log('Reading %s candidates. Confirmed articles join the queue.' % len(picked))
        _classify_spread(picked)
    else:
        _job_log('No new crimes to classify.')
    dealt, waiting = _take_round()
    _save_round(dealt)
    _job_set(kept=len(dealt))
    if dealt:
        _job_log('Round: %s.' % ', '.join(card['source'] for card in dealt))
    _job_log('Done. %s in the round. %s left in the queue.' % (len(dealt), len(waiting)))


def _refresh_worker():
    error = ''
    try:
        _classify_daily()
    except HeadlineError as exc:
        error = str(exc)
        _job_log(error)
    except Exception:
        error = 'The refresh failed.'
        _job_log(error)
    _job_set(
        running=False,
        error=error,
        finished_at=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    )


def start_refresh():
    with _JOB_LOCK:
        if _JOB['running']:
            return False
        _JOB['running'] = True
        _JOB['kept'] = 0
        _JOB['target'] = ROUND_SIZE
        _JOB['error'] = ''
        _JOB['finished_at'] = ''
        _JOB['events'] = []
        _write_job_unlocked()
    threading.Thread(target=_refresh_worker, name='refresh', daemon=True).start()
    return True


def _maybe_daily():
    now = datetime.datetime.now()
    hour, minute = [int(part) for part in current_refresh_time().split(':')]
    scheduled = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now < scheduled:
        return
    if _read_round().get('refreshed_on') == now.date().isoformat():
        return
    start_refresh()


def _schedule_loop():
    while True:
        time.sleep(30)
        try:
            _maybe_daily()
        except Exception:
            continue


def _start_scheduler():
    threading.Thread(target=_schedule_loop, name='daily-refresh', daemon=True).start()


def build_round():
    data = _read_round()
    cards = data.get('cards') or []
    if cards:
        return cards
    if _job_snapshot()['running']:
        raise HeadlineError('The daily refresh is still classifying articles. Watch the progress on the admin page.')
    if data.get('refreshed_on'):
        raise HeadlineError('Today\'s refresh finished, and none of the articles stated an ethnicity. Change the prompt or run a debug refresh.')
    raise HeadlineError('The daily round is not ready. Set the refresh time on the admin page, or run a debug refresh.')


def _get_feed(feed_url):
    # rss.cnn.com closes the HTTPS handshake on this machine's LibreSSL
    # (SSLEOFError). The same feed answers over HTTP.
    candidates = [feed_url]
    if feed_url.startswith('https://rss.cnn.com/'):
        candidates.append('http://' + feed_url[len('https://'):])
    for url in candidates:
        try:
            response = requests.get(
                url,
                timeout=20,
                verify=False,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'},
            )
        except requests.RequestException:
            continue
        if response.status_code == 200:
            return response
    return None

# Function to get the user's score
user_scores = {}

def get_user_score(user_id):
    if user_id not in user_scores:
        user_scores[user_id] = 0
    return user_scores[user_id]

# Function to update the user's score
def update_user_score(user_id, score):
    user_scores[user_id] = score

def _ordinal(number):
    number = int(number)
    if 10 <= number % 100 <= 20:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(number % 10, 'th')
    return '%d%s' % (number, suffix)


# Percentile bands, worst first. The title follows the percentile, which cannot rise above the share that was right.
_TIERS = (
    (17, 'liberal', 'Brainwashed liberal', 'The broadcast tucked you in.'),
    (34, 'headline', 'Believes the headline', 'You took the banner at its word.'),
    (52, 'normie', 'Normie', 'Right down the middle.'),
    (69, 'squint', 'Starting to notice', 'That headline felt a little off.'),
    (84, 'noticer', 'High-level noticer', 'You saw the pattern in the deck.'),
    (94, 'autist', 'Based autist', 'You would not let the detail go.'),
    (100, 'machine', 'Pattern recognition machine', 'Nothing gets past the machine.'),
)


def rank_tier(percentile):
    try:
        percentile = int(percentile)
    except (TypeError, ValueError):
        percentile = 1
    if percentile < 1:
        percentile = 1
    if percentile > 100:
        percentile = 100
    for ceiling, tier_id, title, line in _TIERS:
        if percentile <= ceiling:
            return {'id': tier_id, 'title': title, 'line': line}
    last = _TIERS[-1]
    return {'id': last[1], 'title': last[2], 'line': last[3]}


def rank_ladder():
    steps = []
    for ceiling, tier_id, title, line in reversed(_TIERS):
        steps.append({'id': tier_id, 'title': title, 'line': line})
    return steps


def _accuracy_percentile(score, total):
    # No crowd to beat: the rank follows how many answers were right.
    total = int(total)
    if total <= 0:
        return 1
    pct = int(round(100.0 * int(score) / total))
    if pct < 1:
        return 1
    if pct > 100:
        return 100
    return pct


def percentile_rank(score, sample, total):
    # With other plays on the board, this is how many of them you beat.
    # That standing cannot rise above your own hit rate, so the best score
    # on a weak board still wears the rank that score earned.
    # A lone play, or a board where everybody tied, follows your accuracy.
    score = int(score)
    sample = [int(item) for item in sample]
    accuracy = _accuracy_percentile(score, total)
    if len(sample) <= 1:
        return accuracy
    better = sum(1 for item in sample if item > score)
    worse = sum(1 for item in sample if item < score)
    if better == 0 and worse == 0:
        return accuracy
    if better == 0:
        standing = 100
    else:
        standing = int(round(100.0 * worse / len(sample)))
        if standing < 1:
            standing = 1
        if standing > 100:
            standing = 100
    if standing > accuracy:
        return accuracy
    return standing


def _read_scores():
    try:
        with open(_SCORES_PATH) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    rows = []
    for row in data:
        if not isinstance(row, dict):
            continue
        key = row.get('round')
        try:
            score = int(row.get('score'))
        except (TypeError, ValueError):
            continue
        if isinstance(key, str) and key:
            rows.append({'round': key, 'score': score})
    return rows


def _write_scores(rows):
    temporary = _SCORES_PATH + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(rows, handle)
    os.replace(temporary, _SCORES_PATH)


def _round_key(total):
    data = _read_round()
    day = data.get('refreshed_on') or datetime.date.today().isoformat()
    if not isinstance(day, str) or not day:
        day = datetime.date.today().isoformat()
    return '%s:%s' % (day, int(total))


def _next_round_at():
    hour, minute = [int(part) for part in current_refresh_time().split(':')]
    now = datetime.datetime.now()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    refreshed = (_read_round().get('refreshed_on') or '')
    if refreshed == now.date().isoformat() or now >= target:
        target = target + datetime.timedelta(days=1)
    return target


def _round_context():
    data = _read_round()
    raw = data.get('refreshed_on') or ''
    cards = data.get('cards') if isinstance(data.get('cards'), list) else []
    label = ''
    round_day = raw if isinstance(raw, str) else ''
    if isinstance(raw, str) and raw:
        try:
            day = datetime.date.fromisoformat(raw)
            weekdays = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
            months = ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December')
            label = '%s, %s %d' % (weekdays[day.weekday()], months[day.month - 1], day.day)
        except ValueError:
            label = raw
            round_day = ''
    return {
        'round_label': label,
        'round_day': round_day,
        'card_count': len(cards),
        'next_round_iso': _next_round_at().strftime('%Y-%m-%dT%H:%M:%S'),
    }


def _today_play():
    result = session.get('last_result') or {}
    answers = session.get('correct_answers') or []
    guesses = result.get('user_answers') or []
    if not answers or len(guesses) != len(answers):
        return None
    if result.get('round_key') != _round_key(len(answers)):
        return None
    total = len(answers)
    sample = [row['score'] for row in _read_scores() if row['round'] == result.get('round_key')]
    percentile = result.get('percentile')
    if sample and result.get('score') is not None:
        percentile = percentile_rank(result['score'], sample, total)
        if percentile != result.get('percentile'):
            updated = dict(result)
            updated['percentile'] = percentile
            updated['ordinal'] = _ordinal(percentile)
            session['last_result'] = updated
    tier = rank_tier(percentile)
    return {
        'score': result.get('score'),
        'total': len(answers),
        'title': tier['title'],
        'tier_id': tier['id'],
        'marks': [guesses[i] == answers[i] for i in range(len(answers))],
    }


def record_percentile(score, total):
    score = int(score)
    total = int(total)
    key = _round_key(total)
    with _SCORES_LOCK:
        rows = _read_scores()
        rows.append({'round': key, 'score': score})
        if len(rows) > 5000:
            rows = rows[-5000:]
        _write_scores(rows)
        sample = [row['score'] for row in rows if row['round'] == key]
    counts = [0] * (total + 1)
    for value in sample:
        if 0 <= value <= total:
            counts[value] += 1
    return percentile_rank(score, sample, total), len(sample), counts

# Function to get the hint for a headline
def get_hint(headline, correct_answer):
    return "This is a hint for the headline: " + headline + "\nThe correct answer is: " + correct_answer

# Route to display the game
@app.route('/game', methods=['GET', 'POST'])
def game():
    if 'user_id' not in session:
        session['user_id'] = str(random.randint(1000, 9999))
    user_id = session['user_id']

    # Score the round the player just saw. A new fetch would replace that round.
    if request.method == 'POST':
        user_answers = request.form.getlist('answer')
        correct_answers = session.get('correct_answers')
        if not correct_answers or len(user_answers) != len(correct_answers):
            return redirect(url_for('game'))
        score = sum(1 for i in range(len(correct_answers)) if user_answers[i] == correct_answers[i])
        update_user_score(user_id, score)
        percentile, plays, counts = record_percentile(score, len(correct_answers))
        session['last_result'] = {
            'score': score,
            'percentile': percentile,
            'ordinal': _ordinal(percentile),
            'plays': plays,
            'counts': counts,
            'user_answers': user_answers,
            'round_key': _round_key(len(correct_answers)),
        }
        return redirect(url_for('results'))

    try:
        cards = build_round()
    except HeadlineError as exc:
        return render_template('game.html', cards=[], error=str(exc), choices=ETHNICITIES, **_round_context())

    session['stories'] = [{'source': card['source'], 'headline': card['headline']} for card in cards]
    session['correct_answers'] = [card['ethnicity'] for card in cards]
    play_cards = [
        {'source': card['source'], 'headline': card['headline'], 'answer': card['ethnicity']}
        for card in cards
    ]
    return render_template(
        'game.html',
        cards=play_cards,
        error=None,
        choices=ETHNICITIES,
        **_round_context(),
    )


@app.route('/results')
def results():
    payload = session.get('last_result')
    correct_answers = session.get('correct_answers') or []
    if not payload or not correct_answers:
        return redirect(url_for('game'))
    payload = dict(payload)
    total = len(correct_answers)
    if not payload.get('round_key'):
        payload['round_key'] = _round_key(total)
    sample = [row['score'] for row in _read_scores() if row['round'] == _round_key(total)]
    if sample and payload.get('score') is not None:
        percentile = percentile_rank(payload['score'], sample, total)
        counts = [0] * (total + 1)
        for value in sample:
            if 0 <= value <= total:
                counts[value] += 1
        payload['percentile'] = percentile
        payload['ordinal'] = _ordinal(percentile)
        payload['plays'] = len(sample)
        payload['counts'] = counts
        session['last_result'] = payload
    return render_template(
        'results.html',
        correct_answers=correct_answers,
        stories=session.get('stories') or [],
        tier=rank_tier(payload.get('percentile')),
        ladder=rank_ladder(),
        **payload,
        **_round_context(),
    )

# Route to display the hint
@app.route('/hint', methods=['GET'])
def hint():
    # Get the user's ID
    user_id = session.get('user_id', str(random.randint(1000, 9999)))
    # Store user ID in session
    session['user_id'] = user_id
    if not user_id:
        return redirect(url_for('game'))
    stories = session.get('stories') or []
    if not stories:
        return redirect(url_for('game'))
    first_headline = stories[0]['headline']
    correct_answer = (session.get('correct_answers') or [''])[0]
    hint_text = get_hint(first_headline, correct_answer)
    # Render the hint page
    return render_template('hint.html', hint_text=hint_text, correct_answer=correct_answer)

# Route to display the home page
@app.route('/')
def home():
    return render_template('home.html', played=_today_play(), **_round_context())

def _rum_int(value, limit):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < 0 or number > limit:
        return None
    return number


def _rum_float(value, limit):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0 or number > limit:
        return None
    return round(number, 3)


def _read_rum():
    try:
        with open(_RUM_PATH) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    rows = []
    for row in data:
        if isinstance(row, dict) and row.get('kind') in _RUM_KINDS and isinstance(row.get('t'), str):
            rows.append(row)
    return rows


def _write_rum(rows):
    temporary = _RUM_PATH + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(rows, handle, separators=(',', ':'))
    os.replace(temporary, _RUM_PATH)


def _browser_name(agent):
    agent = agent or ''
    if 'Edg/' in agent:
        return 'Edge'
    if 'Firefox/' in agent:
        return 'Firefox'
    if 'Chrome/' in agent:
        return 'Chrome'
    if 'Safari/' in agent:
        return 'Safari'
    return ''


def _record_rum(payload, agent):
    if not isinstance(payload, dict):
        return
    kind = payload.get('kind')
    if kind not in _RUM_KINDS:
        return
    path = payload.get('path') if payload.get('path') in _RUM_PATHS else ''
    if kind in ('view', 'vital', 'finish') and not path:
        return
    who = payload.get('who') if isinstance(payload.get('who'), str) else ''
    if not re.fullmatch(r'[a-z0-9]{6,16}', who or ''):
        who = ''
    event = {
        't': datetime.datetime.now().isoformat(timespec='seconds'),
        'kind': kind,
        'path': path,
        'who': who,
    }
    if kind == 'view':
        width = _rum_int(payload.get('w'), 10000)
        height = _rum_int(payload.get('h'), 10000)
        if width:
            event['w'] = width
        if height:
            event['h'] = height
        if payload.get('theme') in ('light', 'dark'):
            event['theme'] = payload.get('theme')
        browser = _browser_name(agent)
        if browser:
            event['browser'] = browser
    elif kind == 'vital':
        for key, limit in (('load', 120000), ('lcp', 120000), ('inp', 10000)):
            number = _rum_int(payload.get(key), limit)
            if number:
                event[key] = number
        cls = _rum_float(payload.get('cls'), 5)
        if cls is not None:
            event['cls'] = cls
        if len(event) == 4:
            return
    elif kind == 'finish':
        score = _rum_int(payload.get('score'), 20)
        total = _rum_int(payload.get('total'), 20)
        elapsed = _rum_int(payload.get('ms'), 60 * 60 * 1000)
        if score is not None:
            event['score'] = score
        if total:
            event['total'] = total
        if elapsed:
            event['ms'] = elapsed
    else:
        message = payload.get('message') if isinstance(payload.get('message'), str) else ''
        message = re.sub(r'\s+', ' ', message).strip().replace('<', '').replace('>', '')[:180]
        if not message:
            return
        event['message'] = message
    with _RUM_LOCK:
        rows = _read_rum()
        if kind == 'vital':
            for row in reversed(rows):
                if row.get('kind') == 'view' and row.get('who') == who and row.get('path') == path:
                    try:
                        age = datetime.datetime.now() - datetime.datetime.fromisoformat(row['t'])
                    except ValueError:
                        break
                    if age.total_seconds() > 180:
                        break
                    for key in ('load', 'lcp', 'inp', 'cls'):
                        if key in event:
                            row[key] = event[key]
                    _write_rum(rows)
                    return
            return
        if kind == 'error' and rows:
            last = rows[-1]
            if last.get('kind') == 'error' and last.get('message') == event['message'] and last.get('who') == who:
                return
        rows.append(event)
        if len(rows) > 4000:
            rows = rows[-4000:]
        _write_rum(rows)


def _median(values):
    values = sorted(values)
    if not values:
        return None
    mid = len(values) // 2
    if len(values) % 2:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2.0


def _ms_label(value):
    value = int(round(value))
    if value < 1000:
        return '%d ms' % value
    return '%.1f s' % (value / 1000.0)


def _pace_label(value):
    total = max(1, int(round(float(value) / 1000.0)))
    minutes, seconds = divmod(total, 60)
    if minutes <= 0:
        return '%ds' % seconds
    return '%dm %02ds' % (minutes, seconds)


def _rum_summary():
    rows = _read_rum()
    today = datetime.date.today().isoformat()
    views = [row for row in rows if row.get('kind') == 'view']
    finishes = [row for row in rows if row.get('kind') == 'finish']
    errors = [row for row in rows if row.get('kind') == 'error' and row.get('message')]
    visitors = {row.get('who') for row in rows if row.get('who')}
    today_rows = [row for row in rows if str(row.get('t', '')).startswith(today)]
    today_views = [row for row in views if str(row.get('t', '')).startswith(today)]
    today_visitors = {row.get('who') for row in today_rows if row.get('who')}
    counts = {}
    for row in views:
        counts[row.get('path') or ''] = counts.get(row.get('path') or '', 0) + 1
    pages = []
    for path, label in _RUM_PATHS.items():
        if counts.get(path):
            pages.append({'label': label, 'count': counts[path]})
    pages.sort(key=lambda item: item['count'], reverse=True)
    phone = sum(1 for row in views if row.get('w') and row['w'] < 700)
    desktop = sum(1 for row in views if row.get('w') and row['w'] >= 700)
    light = sum(1 for row in views if row.get('theme') == 'light')
    dark = sum(1 for row in views if row.get('theme') == 'dark')
    browsers = {}
    for row in views:
        name = row.get('browser')
        if name:
            browsers[name] = browsers.get(name, 0) + 1
    mix = []
    if desktop:
        mix.append('%d desktop' % desktop)
    if phone:
        mix.append('%d phone' % phone)
    if light:
        mix.append('%d light' % light)
    if dark:
        mix.append('%d dark' % dark)
    for name, count in sorted(browsers.items(), key=lambda item: item[1], reverse=True):
        mix.append('%d %s' % (count, name))
    vital_bits = []
    for key, label in (('load', 'Load'), ('lcp', 'LCP'), ('inp', 'INP')):
        sample = [row[key] for row in views if row.get(key)]
        mid = _median(sample)
        if mid is not None:
            vital_bits.append('%s %s' % (label, _ms_label(mid)))
    cls_sample = [row['cls'] for row in views if row.get('cls') is not None]
    cls_mid = _median(cls_sample)
    if cls_mid is not None:
        vital_bits.append('CLS %.3f' % cls_mid)
    finish_mid = _median([
        row['ms'] for row in finishes
        if row.get('ms') and row['ms'] <= _FINISH_CAP_MS
    ])
    right = sum(int(row.get('score') or 0) for row in finishes)
    asked = sum(int(row.get('total') or 0) for row in finishes)
    recent = []
    for row in reversed(rows):
        if row.get('kind') not in ('view', 'finish', 'error'):
            continue
        stamp = str(row.get('t') or '')
        clock = stamp[11:16] if len(stamp) >= 16 else stamp
        if not stamp.startswith(today) and len(stamp) >= 10:
            clock = stamp[5:10] + ' ' + clock
        if row.get('kind') == 'view':
            detail = _RUM_PATHS.get(row.get('path'), row.get('path') or '')
            if row.get('w'):
                detail += ' · phone' if row['w'] < 700 else ' · desktop'
            if row.get('theme'):
                detail += ' · ' + row['theme']
            kind_label = 'View'
        elif row.get('kind') == 'finish':
            detail = 'Finished'
            if row.get('total'):
                detail += ' %s/%s' % (row.get('score') or 0, row.get('total'))
            if row.get('ms'):
                detail += ' · ' + _pace_label(row['ms'])
            kind_label = 'Finish'
        else:
            detail = row.get('message') or ''
            kind_label = 'Error'
        recent.append({'time': clock, 'kind': kind_label, 'detail': detail})
        if len(recent) >= 12:
            break
    seen = []
    for row in reversed(errors):
        message = row.get('message')
        if message and message not in seen:
            seen.append(message)
        if len(seen) >= 4:
            break
    return {
        'views': len(views),
        'today_views': len(today_views),
        'visitors': len(visitors),
        'today_visitors': len(today_visitors),
        'finishes': len(finishes),
        'today_finishes': sum(1 for row in finishes if str(row.get('t', '')).startswith(today)),
        'median_finish': _pace_label(finish_mid) if finish_mid is not None else '—',
        'mix': ' · '.join(mix),
        'vitals': ' · '.join(vital_bits),
        'right': right,
        'asked': asked,
        'pages': pages,
        'recent': recent,
        'errors': seen,
    }


def _clear_rum():
    with _RUM_LOCK:
        _write_rum([])


@app.route('/rum', methods=['POST'])
def rum():
    if request.content_length and request.content_length > 4000:
        return ('', 204)
    payload = request.get_json(force=True, silent=True)
    _record_rum(payload, request.headers.get('User-Agent', ''))
    return ('', 204)


def _b64url(value):
    pad = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _admin_password_ok(password):
    stored = os.environ.get('ADMIN_PASSWORD_HASH', '').strip()
    parts = stored.split(':')
    if len(parts) != 6 or parts[0] != 'scrypt':
        return False
    if parts[1:4] != ['16384', '8', '1']:
        return False
    if not password or len(password) > 200:
        return False
    try:
        salt = _b64url(parts[4])
        expected = _b64url(parts[5])
        if len(salt) < 8 or len(expected) != 32:
            return False
        actual = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1, dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def _flask_admin_ok():
    token = request.cookies.get('hg_flask_admin', '')
    if token.count('.') != 1:
        return False
    exp, sig = token.split('.', 1)
    if not exp.isdigit() or int(exp) < int(time.time()):
        return False
    key = hashlib.sha256(os.environ.get('ADMIN_PASSWORD_HASH', '').encode()).digest()
    good = hmac.new(key, exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good)


def _flask_admin_token():
    exp = str(int(time.time()) + 12 * 60 * 60)
    key = hashlib.sha256(os.environ.get('ADMIN_PASSWORD_HASH', '').encode()).digest()
    sig = hmac.new(key, exp.encode(), hashlib.sha256).hexdigest()
    return '%s.%s' % (exp, sig)


def _flask_login_page(message=''):
    note = '<p>%s</p>' % escape(message) if message else ''
    return (
        '<!doctype html><meta charset="utf-8"><title>Sign in — Headline Guessr</title>'
        '<main style="font-family:sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem">'
        '<h1>Admin</h1><p>The desk is locked.</p>%s'
        '<form method="post"><input type="hidden" name="action" value="login">'
        '<label>Password <input type="password" name="password" autocomplete="current-password" required maxlength="200"></label> '
        '<button type="submit">Sign in</button></form></main>'
    ) % note


@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST' and request.form.get('action') == 'login':
        if _admin_password_ok(request.form.get('password', '')):
            response = redirect(url_for('admin'))
            response.set_cookie(
                'hg_flask_admin',
                _flask_admin_token(),
                httponly=True,
                samesite='Lax',
                max_age=12 * 60 * 60,
                path='/admin',
            )
            return response
        return _flask_login_page('That password is wrong.'), 401
    if not _flask_admin_ok():
        return _flask_login_page()
    message = None
    action = request.form.get('action') if request.method == 'POST' else ''
    if action == 'refresh':
        if request.form.get('debug_refresh') != '1':
            message = 'Check Debug refresh, then run it.'
        elif not start_refresh():
            message = 'A refresh is already running.'
        else:
            message = 'Debug refresh started.'
    elif action == 'clear_stats':
        _clear_rum()
        message = 'Stats cleared.'
    elif action == 'add_feed':
        message = _add_feed(request.form.get('feed_name', ''), request.form.get('feed_url', ''))
    elif action == 'remove_feed':
        message = _remove_feed(request.form.get('feed_url', ''))
    elif action == 'drop_queue':
        message = _drop_queued(request.form.get('queue_key', ''))
    elif request.method == 'POST':
        chosen = request.form.get('model', '')
        refresh_time = request.form.get('refresh_time', '')
        if action == 'reset':
            prompt = DEFAULT_ETHNICITY_PROMPT
        else:
            prompt = request.form.get('prompt', '')
        if chosen not in _MODEL_IDS:
            message = 'That model is not available.'
        elif not _valid_refresh_time(refresh_time):
            message = 'Choose a refresh time.'
        elif not prompt.strip():
            message = 'The prompt cannot be empty.'
        else:
            _save_settings(chosen, prompt.strip(), refresh_time)
            message = 'Saved. The daily refresh runs at %s. The model is %s.' % (refresh_time, chosen)
    feeds = current_feeds()
    queue = _queue_public(_read_queue())
    return render_template(
        'admin.html',
        models=GROK_MODELS,
        current=current_model(),
        prompt=current_prompt(),
        refresh_time=current_refresh_time(),
        feeds=[{'name': name, 'url': url} for name, url, _kind in feeds],
        queue=queue,
        message=message,
        rum=_rum_summary(),
    )


@app.route('/admin/status')
def admin_status():
    if not _flask_admin_ok():
        return jsonify({'error': 'Sign in.'}), 401
    state = _job_snapshot()
    data = _read_round()
    cards = data.get('cards') or []
    state['refreshed_at'] = data.get('refreshed_at') or ''
    state['ready'] = len(cards)
    queue = _queue_public(_read_queue())
    state['cards'] = cards
    state['queued'] = len(queue)
    state['queue'] = queue
    state['rum'] = _rum_summary()
    return jsonify(state)

if __name__ == '__main__':
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        _recover_job()
        _start_scheduler()
    app.run(debug=False)