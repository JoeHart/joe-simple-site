const fs = require('fs')
const path = require('path')
const https = require('https')

const NOTES_DIR = path.join(__dirname, '..', '..', 'notes')
const MASTODON_INSTANCE = 'https://social.lol'
const MASTODON_HANDLE = 'joehart'

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'joe-simple-site/1.0' } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(JSON.parse(data)))
      })
      .on('error', reject)
  })
}

function fetchFeed(url) {
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

function noteUrlToFilePath(noteUrl) {
  const match = noteUrl.match(/\/notes\/([^/]+)\/?$/)
  if (!match) return null
  const filepath = path.join(NOTES_DIR, `${match[1]}.md`)
  return fs.existsSync(filepath) ? filepath : null
}

function addFrontmatterField(filepath, field, value) {
  const content = fs.readFileSync(filepath, 'utf8')
  if (content.includes(`${field}:`)) return false

  const updated = content.replace(/^(---\n[\s\S]*?)(tags:)/m, `$1${field}: ${value}\n$2`)
  fs.writeFileSync(filepath, updated)
  console.log(`  Added ${field} to ${path.basename(filepath)}`)
  return true
}

function normalizeText(text) {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function main() {
  console.log('Checking for Mastodon backlinks...')

  // Fetch the JSON feed to find syndicated notes
  const feed = await fetchFeed('https://www.joehart.co.uk/notes/feed.json')
  if (!feed.items || feed.items.length === 0) {
    console.log('No items in feed.')
    return
  }

  // Find notes missing mastodon_url
  const notesNeedingBacklink = []
  for (const item of feed.items) {
    const filepath = noteUrlToFilePath(item.url)
    if (!filepath) continue
    const content = fs.readFileSync(filepath, 'utf8')
    if (!content.includes('mastodon_url:')) {
      notesNeedingBacklink.push({ item, filepath, contentText: item.content_text })
    }
  }

  if (notesNeedingBacklink.length === 0) {
    console.log('All notes already have mastodon_url.')
    return
  }

  console.log(`Found ${notesNeedingBacklink.length} note(s) missing mastodon_url`)

  // Resolve Mastodon account ID
  const account = await fetch(`${MASTODON_INSTANCE}/api/v1/accounts/lookup?acct=${MASTODON_HANDLE}`)
  const accountId = account.id

  // Fetch recent toots
  const toots = await fetch(
    `${MASTODON_INSTANCE}/api/v1/accounts/${accountId}/statuses?exclude_replies=true&exclude_reblogs=true&limit=20`
  )

  // Match toots to notes by content similarity
  let updated = 0
  for (const note of notesNeedingBacklink) {
    const noteNorm = normalizeText(note.contentText)
    if (!noteNorm) continue

    for (const toot of toots) {
      // Strip HTML from toot content
      const tootText = toot.content.replace(/<[^>]+>/g, '')
      const tootNorm = normalizeText(tootText)
      if (!tootNorm) continue

      // Check if the toot text starts with the same content (truncation-safe)
      const shorter = noteNorm.length < tootNorm.length ? noteNorm : tootNorm
      const longer = noteNorm.length < tootNorm.length ? tootNorm : noteNorm

      if (longer.startsWith(shorter) || shorter.startsWith(longer.slice(0, shorter.length))) {
        addFrontmatterField(note.filepath, 'mastodon_url', toot.url)
        updated++
        break
      }
    }
  }

  console.log(`Done. Updated ${updated} note(s) with mastodon_url.`)
}

main().catch((err) => {
  console.error('Mastodon backlink failed:', err)
  process.exit(1)
})
