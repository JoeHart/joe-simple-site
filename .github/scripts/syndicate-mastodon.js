const fs = require('fs')
const path = require('path')
const https = require('https')

const POSTED_FILE = path.join(__dirname, '..', 'data', 'mastodon-posted.json')
const FEED_URL = 'https://www.joehart.co.uk/notes/feed.json'
const NOTES_DIR = path.join(__dirname, '..', '..', 'notes')
const MASTODON_INSTANCE = 'https://social.lol'

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

function postStatus(token, text) {
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

async function main() {
  const token = process.env.MASTODON_ACCESS_TOKEN

  if (!token) {
    console.log('Missing MASTODON_ACCESS_TOKEN, skipping.')
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

  // Post each new item (oldest first)
  for (const item of newItems.reverse()) {
    console.log(`Posting: ${item.url}`)

    const text = item.content_text.length > 500 ? item.content_text.slice(0, 497) + '...' : item.content_text

    const response = await postStatus(token, text)

    posted.posted.push(item.url)
    console.log('  Posted successfully.')

    // Add mastodon_url back to the note's frontmatter
    const filepath = noteUrlToFilePath(item.url)
    if (filepath) {
      addFrontmatterField(filepath, 'mastodon_url', response.url)
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
