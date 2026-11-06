// Bluesky -> site -> Mastodon.
//
// 1. Pull: reads Joe's recent public Bluesky posts (no login needed) and writes
//    each new top-level post as a note in notes/, with its images and a
//    `bluesky_url` link back.
// 2. Push: posts every note with `syndicate: true` and no `mastodon_url` to
//    Mastodon, then writes the Mastodon URL into the note.
//
// The note frontmatter is the only record, so running this repeatedly is safe.
// Runs on a schedule from .github/workflows/deploy.yaml.
//
//   node .github/scripts/sync.js            # do it
//   node .github/scripts/sync.js --dry-run  # show what would happen, change nothing

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..', '..')
const NOTES_DIR = process.env.NOTES_DIR || path.join(ROOT, 'notes')
const IMG_DIR = path.join(ROOT, 'img', 'notes')
const SITE_URL = 'https://www.joehart.co.uk'
const BLUESKY_HANDLE = 'joehart.bsky.social'
const MASTODON_INSTANCE = 'https://social.lol'
const MASTODON_LIMIT = 500
// Bluesky posts from before this moment are never imported (the archive is already in notes/).
const SYNC_START = new Date(process.env.SYNC_START || '2026-11-06T12:00:00Z')
// Don't surprise-post a backlog of old notes if something was broken for ages.
const MAX_AGE_DAYS = 14

const DRY_RUN = process.argv.includes('--dry-run')

// --- Notes -------------------------------------------------------------------

function parseNote(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) data[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return { file, data, body: match[2].trim() }
}

function loadNotes() {
  return fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseNote(path.join(NOTES_DIR, f)))
    .filter(Boolean)
}

function noteDate(note) {
  if (note.data.date) return new Date(note.data.date)
  const fromName = path.basename(note.file).match(/^(\d{4}-\d{2}-\d{2})/)
  return new Date(fromName ? fromName[1] : fs.statSync(note.file).mtime)
}

// Mirrors notes/notes.11tydata.js: /notes/<yyyy-mm-dd>-<fileSlug>/, where
// Eleventy's fileSlug drops a leading yyyy-mm-dd- from the filename.
function notePermalink(note) {
  const date = noteDate(note).toISOString().slice(0, 10)
  const slug = path.basename(note.file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '')
  return `${SITE_URL}/notes/${date}-${slug}/`
}

function setFrontmatterField(file, key, value) {
  const raw = fs.readFileSync(file, 'utf8')
  const end = raw.indexOf('\n---', 3)
  const front = raw.slice(0, end)
  const line = `${key}: ${value}`
  const re = new RegExp(`^${key}:.*$`, 'm')
  const newFront = re.test(front) ? front.replace(re, line) : `${front}\n${line}`
  fs.writeFileSync(file, newFront + raw.slice(end))
}

// --- Pull from Bluesky -------------------------------------------------------

const rkey = (uri) => uri.split('/').pop()
const postUrl = (handle, uri) => `https://bsky.app/profile/${handle}/post/${rkey(uri)}`

// Bluesky shortens long links in the visible text ("example.com/some/pa...").
function isShortenedUrl(label, uri) {
  const bare = (s) => s.replace(/^https?:\/\/(www\.)?/, '').replace(/(\.\.\.|…)$/, '')
  return bare(uri).startsWith(bare(label))
}

// Bluesky text + facets (byte ranges) -> markdown.
function facetsToMarkdown(text, facets = []) {
  const bytes = new TextEncoder().encode(text)
  const decode = (from, to) => new TextDecoder().decode(bytes.slice(from, to))
  let out = ''
  let pos = 0
  for (const facet of [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart)) {
    const { byteStart, byteEnd } = facet.index
    if (byteStart < pos) continue
    const label = decode(byteStart, byteEnd)
    const feature = facet.features[0] || {}
    out += decode(pos, byteStart)
    if (feature.$type === 'app.bsky.richtext.facet#link') {
      out += isShortenedUrl(label, feature.uri) ? feature.uri : `[${label}](${feature.uri})`
    } else if (feature.$type === 'app.bsky.richtext.facet#mention') {
      out += `[${label}](https://bsky.app/profile/${feature.did})`
    } else {
      out += label
    }
    pos = byteEnd
  }
  return out + decode(pos)
}

async function downloadImage(url) {
  const name = crypto.createHash('md5').update(url).digest('hex').slice(0, 12) + '.jpeg'
  const file = path.join(IMG_DIR, name)
  if (!fs.existsSync(file)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Image download ${url}: HTTP ${res.status}`)
    fs.mkdirSync(IMG_DIR, { recursive: true })
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return `/img/notes/${name}`
}

async function blueskyPostToMarkdown(post) {
  const record = post.record
  const parts = [facetsToMarkdown(record.text || '', record.facets).trim()]
  const linked = (record.facets || []).flatMap((f) => f.features.map((x) => x.uri)).filter(Boolean)

  let embed = post.embed
  let media = embed
  if (embed?.$type === 'app.bsky.embed.recordWithMedia#view') media = embed.media

  if (media?.$type === 'app.bsky.embed.images#view') {
    for (const img of media.images) {
      const src = DRY_RUN ? img.fullsize : await downloadImage(img.fullsize)
      parts.push(`![${(img.alt || '').replace(/[\[\]\s]+/g, ' ').trim()}](${src})`)
    }
  }
  if (media?.$type === 'app.bsky.embed.video#view') {
    parts.push(`[Video on Bluesky](${postUrl(post.author.handle, post.uri)})`)
  }
  if (media?.$type === 'app.bsky.embed.external#view' && !linked.includes(media.external.uri)) {
    parts.push(media.external.uri)
  }
  // Quote posts: link to the quoted post.
  const quoted = embed?.$type === 'app.bsky.embed.record#view' ? embed.record : embed?.record?.record
  if (quoted?.uri && quoted.author) parts.push(postUrl(quoted.author.handle, quoted.uri))

  return parts.filter(Boolean).join('\n\n')
}

async function pullFromBluesky(notes) {
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${BLUESKY_HANDLE}&filter=posts_no_replies&limit=30`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Bluesky feed: HTTP ${res.status}`)
  const { feed } = await res.json()

  const known = new Set(notes.map((n) => n.data.bluesky_url && rkey(n.data.bluesky_url)).filter(Boolean))
  const fresh = feed
    .filter((item) => !item.reason) // not a repost
    .map((item) => item.post)
    .filter((post) => post.author.handle === BLUESKY_HANDLE && !post.record.reply)
    .filter((post) => new Date(post.record.createdAt) >= SYNC_START && !known.has(rkey(post.uri)))
    .reverse() // oldest first

  for (const post of fresh) {
    const date = new Date(post.record.createdAt)
    const file = path.join(NOTES_DIR, `${date.toISOString().slice(0, 10)}-${rkey(post.uri)}.md`)
    const body = await blueskyPostToMarkdown(post)
    const markdown = [
      '---',
      `date: ${date.toISOString()}`,
      'syndicate: true',
      // Stop Nunjucks interpreting {{ }} or {% %} in a post.
      'templateEngineOverride: md',
      `bluesky_url: ${postUrl(post.author.handle, post.uri)}`,
      'tags: []',
      '---',
      '',
      body,
      '',
    ].join('\n')
    if (DRY_RUN) {
      console.log(`[Bluesky] Would import ${path.basename(file)}:\n${body.replace(/^/gm, '  | ')}`)
      notes.push({ file, data: { syndicate: 'true', date: date.toISOString() }, body })
    } else {
      fs.writeFileSync(file, markdown)
      console.log(`[Bluesky] Imported ${path.basename(file)}`)
      notes.push(parseNote(file))
    }
  }
}

// --- Push to Mastodon --------------------------------------------------------

// Markdown note body -> plain text for posting, plus the images it contains.
function toPost(body) {
  const images = []
  let text = body.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) => {
    images.push({ alt, src })
    return ''
  })
  text = text
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) =>
      label === url || label.startsWith('@') ? label : `${label} (${url})`
    )
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, images: images.slice(0, 4) }
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const graphemes = (s) => [...segmenter.segment(s)].map((g) => g.segment)

// Fits as-is, or cut at a word boundary with "… <permalink>" appended.
function fitText(text, limit, permalink) {
  if (graphemes(text).length <= limit) return text
  const suffix = `… ${permalink}`
  const budget = limit - graphemes(suffix).length
  let cut = graphemes(text).slice(0, budget).join('')
  const lastSpace = cut.search(/\s\S*$/)
  if (lastSpace > budget * 0.6) cut = cut.slice(0, lastSpace)
  return cut.replace(/[\s.,;:!?…-]+$/, '') + suffix
}

async function mastodon(pathname, options = {}) {
  const res = await fetch(new URL(pathname, MASTODON_INSTANCE), {
    ...options,
    headers: { Authorization: `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`, ...options.headers },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Mastodon ${pathname}: HTTP ${res.status} ${body}`)
  return JSON.parse(body)
}

async function postToMastodon(note) {
  const permalink = notePermalink(note)
  const { text, images } = toPost(note.body)

  const mediaIds = []
  for (const img of images) {
    const data = /^https?:\/\//.test(img.src)
      ? Buffer.from(await (await fetch(img.src)).arrayBuffer())
      : fs.readFileSync(path.join(ROOT, img.src.replace(/^\//, '')))
    const form = new FormData()
    form.append('file', new Blob([data]), path.basename(img.src))
    if (img.alt) form.append('description', img.alt)
    let media = await mastodon('/api/v2/media', { method: 'POST', body: form })
    // Large uploads are processed asynchronously; wait until ready.
    for (let i = 0; !media.url && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      media = await mastodon(`/api/v1/media/${media.id}`)
    }
    mediaIds.push(media.id)
  }

  const status = await mastodon('/api/v1/statuses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Mastodon ignores a repeat with the same key for an hour, so a retry can't double-post.
      'Idempotency-Key': crypto.createHash('sha256').update(permalink).digest('hex'),
    },
    body: JSON.stringify({
      status: fitText(text, MASTODON_LIMIT, permalink),
      media_ids: mediaIds,
      visibility: 'public',
    }),
  })
  return status.url
}

async function pushToMastodon(notes) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  const pending = notes.filter((n) => n.data.syndicate === 'true' && !n.data.mastodon_url)
  const failures = []

  for (const note of pending) {
    const name = path.basename(note.file)
    if (noteDate(note).getTime() < cutoff) {
      console.warn(`[Mastodon] Skipping ${name}: older than ${MAX_AGE_DAYS} days.`)
      continue
    }
    if (DRY_RUN) {
      console.log(`[Mastodon] Would post ${name}:`)
      console.log(fitText(toPost(note.body).text, MASTODON_LIMIT, notePermalink(note)).replace(/^/gm, '  | '))
      continue
    }
    try {
      if (!process.env.MASTODON_ACCESS_TOKEN) throw new Error('MASTODON_ACCESS_TOKEN is not set')
      const url = await postToMastodon(note)
      setFrontmatterField(note.file, 'mastodon_url', url)
      console.log(`[Mastodon] Posted ${name} -> ${url}`)
    } catch (err) {
      console.error(`[Mastodon] Failed ${name}: ${err.message}`)
      failures.push(`${name}: ${err.message}`)
    }
  }
  return failures
}

// --- Main --------------------------------------------------------------------

async function main() {
  const notes = loadNotes()
  await pullFromBluesky(notes)
  const failures = await pushToMastodon(notes)
  if (failures.length) {
    console.error(`\n${failures.length} failure(s); they'll be retried on the next run.`)
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Sync failed:', err)
    process.exit(1)
  })
}

module.exports = { main, facetsToMarkdown, blueskyPostToMarkdown, toPost, fitText, notePermalink, parseNote }
