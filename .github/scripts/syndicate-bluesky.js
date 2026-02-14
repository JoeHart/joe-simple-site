const { BskyAgent, RichText } = require('@atproto/api')
const fs = require('fs')
const path = require('path')
const https = require('https')

const POSTED_FILE = path.join(__dirname, '..', 'data', 'bluesky-posted.json')
const FEED_URL = 'https://www.joehart.co.uk/notes/feed.json'
const NOTES_DIR = path.join(__dirname, '..', '..', 'notes')

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

function loadPosted() {
  try {
    return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'))
  } catch {
    return { posted: [] }
  }
}

function savePosted(data) {
  fs.mkdirSync(path.dirname(POSTED_FILE), { recursive: true })
  fs.writeFileSync(POSTED_FILE, JSON.stringify(data, null, 2))
}

function noteUrlToFilePath(noteUrl) {
  // Extract slug from URL like https://www.joehart.co.uk/notes/2026-02-14-slug/
  const match = noteUrl.match(/\/notes\/([^/]+)\/?$/)
  if (!match) return null
  const filepath = path.join(NOTES_DIR, `${match[1]}.md`)
  return fs.existsSync(filepath) ? filepath : null
}

function addFrontmatterField(filepath, field, value) {
  const content = fs.readFileSync(filepath, 'utf8')
  if (content.includes(`${field}:`)) return // already has it

  // Insert before tags: line or before closing ---
  const updated = content.replace(/^(---\n[\s\S]*?)(tags:)/m, `$1${field}: ${value}\n$2`)
  fs.writeFileSync(filepath, updated)
  console.log(`  Added ${field} to ${path.basename(filepath)}`)
}

async function main() {
  const handle = process.env.BLUESKY_HANDLE
  const password = process.env.BLUESKY_APP_PASSWORD

  if (!handle || !password) {
    console.log('Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD, skipping.')
    return
  }

  // Fetch the JSON feed
  console.log('Fetching feed...')
  const feed = await fetchJSON(FEED_URL)

  if (!feed.items || feed.items.length === 0) {
    console.log('No items in feed.')
    return
  }

  // Load already-posted URLs
  const posted = loadPosted()

  // Find new items
  const newItems = feed.items.filter((item) => !posted.posted.includes(item.url))

  if (newItems.length === 0) {
    console.log('No new items to post.')
    return
  }

  // Login to Bluesky
  console.log('Logging into Bluesky...')
  const agent = new BskyAgent({ service: 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  // Post each new item (oldest first)
  for (const item of newItems.reverse()) {
    console.log(`Posting: ${item.url}`)

    const text = item.content_text.length > 280 ? item.content_text.slice(0, 277) + '...' : item.content_text

    // Use RichText for link/mention detection
    const rt = new RichText({ text })
    await rt.detectFacets(agent)

    const response = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    })

    posted.posted.push(item.url)
    console.log('  Posted successfully.')

    // Add bluesky_url back to the note's frontmatter
    const postId = response.uri.split('/').pop()
    const blueskyUrl = `https://bsky.app/profile/${handle}/post/${postId}`
    const filepath = noteUrlToFilePath(item.url)
    if (filepath) {
      addFrontmatterField(filepath, 'bluesky_url', blueskyUrl)
    }

    // Small delay between posts
    await new Promise((r) => setTimeout(r, 2000))
  }

  // Save updated tracker
  savePosted(posted)
  console.log(`Done. Posted ${newItems.length} item(s).`)
}

main().catch((err) => {
  console.error('Syndication failed:', err)
  process.exit(1)
})
