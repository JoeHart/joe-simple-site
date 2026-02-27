const fs = require('fs')
const path = require('path')
const https = require('https')

const DATA_DIR = path.join(__dirname, '..', 'data')
const BLUESKY_POSTED_FILE = path.join(DATA_DIR, 'bluesky-posted.json')
const MASTODON_POSTED_FILE = path.join(DATA_DIR, 'mastodon-posted.json')
const FEED_URL = 'https://www.joehart.co.uk/notes/feed.json'
const NOTES_DIR = path.join(__dirname, '..', '..', 'notes')
const MASTODON_INSTANCE = 'https://social.lol'

// --- Utilities ---

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(JSON.parse(data)))
      })
      .on('error', reject)
  })
}

function loadPosted(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { posted: [] }
  }
}

function savePosted(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

function noteUrlToFilePath(noteUrl) {
  const match = noteUrl.match(/\/notes\/([^/]+)\/?$/)
  if (!match) return null
  const filepath = path.join(NOTES_DIR, `${match[1]}.md`)
  return fs.existsSync(filepath) ? filepath : null
}

function addFrontmatterField(filepath, field, value) {
  const content = fs.readFileSync(filepath, 'utf8')
  if (content.includes(`${field}:`)) return

  const updated = content.replace(/^(---\n[\s\S]*?)(tags:)/m, `$1${field}: ${value}\n$2`)
  fs.writeFileSync(filepath, updated)
  console.log(`  Added ${field} to ${path.basename(filepath)}`)
}

// --- Bluesky ---

async function syndicateBluesky(feed) {
  const handle = process.env.BLUESKY_HANDLE
  const password = process.env.BLUESKY_APP_PASSWORD

  if (!handle || !password) {
    console.log('[Bluesky] Missing credentials, skipping.')
    return 0
  }

  const posted = loadPosted(BLUESKY_POSTED_FILE)
  const newItems = feed.items.filter((item) => !posted.posted.includes(item.url))

  if (newItems.length === 0) {
    console.log('[Bluesky] No new items to post.')
    return 0
  }

  console.log(`[Bluesky] Logging in as ${handle}...`)
  const { BskyAgent, RichText } = require('@atproto/api')
  const agent = new BskyAgent({ service: 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  let count = 0

  // Post oldest first
  for (const item of [...newItems].reverse()) {
    console.log(`[Bluesky] Posting: ${item.url}`)

    try {
      const text = item.content_text.length > 280 ? item.content_text.slice(0, 277) + '...' : item.content_text

      const rt = new RichText({ text })
      await rt.detectFacets(agent)

      const response = await agent.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      })

      // Track immediately after each successful post
      posted.posted.push(item.url)
      savePosted(BLUESKY_POSTED_FILE, posted)

      // Add backlink to note frontmatter
      const postId = response.uri.split('/').pop()
      const blueskyUrl = `https://bsky.app/profile/${handle}/post/${postId}`
      const filepath = noteUrlToFilePath(item.url)
      if (filepath) {
        addFrontmatterField(filepath, 'bluesky_url', blueskyUrl)
      }

      count++
      console.log('  Posted successfully.')
    } catch (err) {
      console.error(`  Failed to post ${item.url}: ${err.message}`)
      // Stop posting more if one fails (API issue likely affects all)
      break
    }

    // Small delay between posts
    await new Promise((r) => setTimeout(r, 2000))
  }

  console.log(`[Bluesky] Done. Posted ${count} item(s).`)
  return count
}

// --- Mastodon ---

function postMastodonStatus(token, text) {
  const body = JSON.stringify({ status: text, visibility: 'public' })
  const url = new URL('/api/v1/statuses', MASTODON_INSTANCE)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
            return
          }
          resolve(JSON.parse(data))
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function syndicateMastodon(feed) {
  const token = process.env.MASTODON_ACCESS_TOKEN

  if (!token) {
    console.log('[Mastodon] Missing credentials, skipping.')
    return 0
  }

  const posted = loadPosted(MASTODON_POSTED_FILE)
  const newItems = feed.items.filter((item) => !posted.posted.includes(item.url))

  if (newItems.length === 0) {
    console.log('[Mastodon] No new items to post.')
    return 0
  }

  let count = 0

  // Post oldest first
  for (const item of [...newItems].reverse()) {
    console.log(`[Mastodon] Posting: ${item.url}`)

    try {
      const text = item.content_text.length > 500 ? item.content_text.slice(0, 497) + '...' : item.content_text

      const response = await postMastodonStatus(token, text)

      // Track immediately after each successful post
      posted.posted.push(item.url)
      savePosted(MASTODON_POSTED_FILE, posted)

      // Add backlink to note frontmatter
      const filepath = noteUrlToFilePath(item.url)
      if (filepath) {
        addFrontmatterField(filepath, 'mastodon_url', response.url)
      }

      count++
      console.log('  Posted successfully.')
    } catch (err) {
      console.error(`  Failed to post ${item.url}: ${err.message}`)
      break
    }

    // Small delay between posts
    await new Promise((r) => setTimeout(r, 2000))
  }

  console.log(`[Mastodon] Done. Posted ${count} item(s).`)
  return count
}

// --- Main ---

async function main() {
  console.log('Fetching feed...')
  const feed = await fetchJSON(FEED_URL)

  if (!feed.items || feed.items.length === 0) {
    console.log('No items in feed.')
    return
  }

  // Only syndicate items that have syndicate: true
  // (the feed only contains notes, so all items are candidates)

  const blueskyCount = await syndicateBluesky(feed)
  const mastodonCount = await syndicateMastodon(feed)

  if (blueskyCount === 0 && mastodonCount === 0) {
    console.log('Nothing new to syndicate.')
  }
}

main().catch((err) => {
  console.error('Syndication failed:', err)
  process.exit(1)
})
