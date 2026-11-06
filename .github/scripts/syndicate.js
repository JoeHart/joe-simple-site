// Cross-post notes to Bluesky and Mastodon, then write the resulting post
// URLs back into each note's frontmatter.
//
// A note is posted to a network when it has `syndicate: true` and is missing
// that network's `*_url` field. The frontmatter is the only record of what has
// been posted, so re-running this script is safe.
//
// Runs in the deploy workflow *after* the site is live, so permalinks resolve.
//
//   node .github/scripts/syndicate.js            # post for real
//   node .github/scripts/syndicate.js --dry-run  # print what would be posted

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..', '..')
const NOTES_DIR = process.env.NOTES_DIR || path.join(ROOT, 'notes')
const SITE_URL = 'https://www.joehart.co.uk'
const MASTODON_INSTANCE = 'https://social.lol'
const BLUESKY_LIMIT = 300
const MASTODON_LIMIT = 500
const BLUESKY_MAX_IMAGE_BYTES = 950 * 1000
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
  return { file, raw, data, body: match[2].trim() }
}

// Mirrors notes/notes.11tydata.js: /notes/<yyyy-mm-dd>-<fileSlug>/, where
// Eleventy's fileSlug drops a leading yyyy-mm-dd- from the filename.
function notePermalink(note) {
  const name = path.basename(note.file, '.md')
  const date = noteDate(note).toISOString().slice(0, 10)
  const slug = name.replace(/^\d{4}-\d{2}-\d{2}-/, '')
  return `${SITE_URL}/notes/${date}-${slug}/`
}

function noteDate(note) {
  if (note.data.date) return new Date(note.data.date)
  const fromName = path.basename(note.file).match(/^(\d{4}-\d{2}-\d{2})/)
  return new Date(fromName ? fromName[1] : fs.statSync(note.file).mtime)
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

// Markdown note body -> plain text for posting, plus the images it contains.
function toPost(body) {
  const images = []
  let text = body.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) => {
    images.push({ alt, src })
    return ''
  })
  text = text
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) => (label === url ? url : `${label} (${url})`))
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, images: images.slice(0, 4) }
}

// --- Text --------------------------------------------------------------------

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

// --- Images ------------------------------------------------------------------

async function loadImage(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`Image fetch ${src}: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  return fs.readFileSync(path.join(ROOT, src.replace(/^\//, '')))
}

// Re-encode as JPEG, shrinking until it fits under maxBytes.
async function prepareImage(src, maxBytes) {
  const sharp = require('sharp')
  const input = await loadImage(src)
  const { width, height } = await sharp(input).rotate().metadata()
  for (const [size, quality] of [
    [2000, 85],
    [2000, 75],
    [1600, 70],
    [1200, 65],
    [1000, 60],
  ]) {
    const data = await sharp(input)
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (data.length <= maxBytes) {
      const meta = await sharp(data).metadata()
      return { data, mime: 'image/jpeg', width: meta.width || width, height: meta.height || height }
    }
  }
  throw new Error(`Could not shrink ${src} under ${maxBytes} bytes`)
}

// --- Bluesky -----------------------------------------------------------------

let bskyAgent
async function bluesky() {
  if (bskyAgent) return bskyAgent
  const { AtpAgent } = require('@atproto/api')
  bskyAgent = new AtpAgent({ service: 'https://bsky.social' })
  await bskyAgent.login({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD })
  return bskyAgent
}

async function postToBluesky(note) {
  const agent = await bluesky()
  const { RichText } = require('@atproto/api')
  const permalink = notePermalink(note)
  const { text, images } = toPost(note.body)

  const rt = new RichText({ text: fitText(text, BLUESKY_LIMIT, permalink) })
  await rt.detectFacets(agent)

  // Guard against double-posting if a previous run posted but failed to commit.
  const handle = agent.session.handle
  const feed = await agent.getAuthorFeed({ actor: agent.session.did, limit: 30, filter: 'posts_no_replies' })
  const existing = feed.data.feed.find((item) => item.post.record.text === rt.text)
  if (existing) {
    console.log('  Already on Bluesky, recording existing post.')
    return `https://bsky.app/profile/${handle}/post/${existing.post.uri.split('/').pop()}`
  }

  const record = { text: rt.text, facets: rt.facets, createdAt: new Date().toISOString() }
  if (images.length) {
    const uploaded = []
    for (const img of images) {
      const prepared = await prepareImage(img.src, BLUESKY_MAX_IMAGE_BYTES)
      const { data } = await agent.uploadBlob(prepared.data, { encoding: prepared.mime })
      uploaded.push({
        image: data.blob,
        alt: img.alt || '',
        aspectRatio: { width: prepared.width, height: prepared.height },
      })
    }
    record.embed = { $type: 'app.bsky.embed.images', images: uploaded }
  }

  const res = await agent.post(record)
  return `https://bsky.app/profile/${handle}/post/${res.uri.split('/').pop()}`
}

// --- Mastodon ----------------------------------------------------------------

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
    const prepared = await prepareImage(img.src, 8 * 1000 * 1000)
    const form = new FormData()
    form.append('file', new Blob([prepared.data], { type: prepared.mime }), 'image.jpg')
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
      // Mastodon dedupes retries with the same key for an hour.
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

// --- Main --------------------------------------------------------------------

const NETWORKS = [
  {
    name: 'Bluesky',
    field: 'bluesky_url',
    limit: BLUESKY_LIMIT,
    env: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
    post: postToBluesky,
  },
  {
    name: 'Mastodon',
    field: 'mastodon_url',
    limit: MASTODON_LIMIT,
    env: ['MASTODON_ACCESS_TOKEN'],
    post: postToMastodon,
  },
]

async function main() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  const notes = fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseNote(path.join(NOTES_DIR, f)))
    .filter((n) => n && n.data.syndicate === 'true')

  const failures = []

  for (const network of NETWORKS) {
    const pending = notes.filter((n) => !n.data[network.field])
    if (!pending.length) continue

    const missingEnv = network.env.filter((k) => !process.env[k])
    if (!DRY_RUN && missingEnv.length) {
      failures.push(`${network.name}: missing ${missingEnv.join(', ')}`)
      continue
    }

    for (const note of pending) {
      const name = path.basename(note.file)
      if (noteDate(note).getTime() < cutoff) {
        console.warn(`[${network.name}] Skipping ${name}: older than ${MAX_AGE_DAYS} days.`)
        continue
      }
      if (DRY_RUN) {
        const { text, images } = toPost(note.body)
        console.log(`[${network.name}] Would post ${name} with ${images.length} image(s):`)
        console.log(fitText(text, network.limit, notePermalink(note)).replace(/^/gm, '  | '))
        continue
      }
      try {
        console.log(`[${network.name}] Posting ${name}`)
        const url = await network.post(note)
        setFrontmatterField(note.file, network.field, url)
        console.log(`  -> ${url}`)
      } catch (err) {
        console.error(`  Failed: ${err.message}`)
        failures.push(`${network.name} ${name}: ${err.message}`)
      }
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Syndication failed:', err)
    process.exit(1)
  })
}

module.exports = { parseNote, notePermalink, setFrontmatterField, toPost, fitText, prepareImage }
