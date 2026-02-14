const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')

const NOTES_DIR = path.join(__dirname, '..', 'notes')
const IMG_DIR = path.join(__dirname, '..', 'img', 'notes')

// Ensure directories exist
fs.mkdirSync(NOTES_DIR, { recursive: true })
fs.mkdirSync(IMG_DIR, { recursive: true })

function fetch(url) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl) => {
      https
        .get(requestUrl, { headers: { 'User-Agent': 'joe-simple-site-importer/1.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            makeRequest(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`))
            return
          }
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => resolve(data))
        })
        .on('error', reject)
    }
    makeRequest(url)
  })
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl) => {
      https
        .get(requestUrl, { headers: { 'User-Agent': 'joe-simple-site-importer/1.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            makeRequest(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`))
            return
          }
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        .on('error', reject)
    }
    makeRequest(url)
  })
}

// Simple HTML to markdown conversion (replaces turndown dependency)
function htmlToMarkdown(html) {
  let md = html
  // Remove invisible/tracking spans
  md = md.replace(/<span class="invisible">.*?<\/span>/gs, '')
  md = md.replace(/<span class="ellipsis">(.*?)<\/span>/gs, '$1')
  md = md.replace(/<span[^>]*>(.*?)<\/span>/gs, '$1')
  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs, '[$2]($1)')
  // Bold/strong
  md = md.replace(/<(strong|b)>(.*?)<\/\1>/gs, '**$2**')
  // Italic/em
  md = md.replace(/<(em|i)>(.*?)<\/\1>/gs, '*$2*')
  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n')
  // Paragraphs
  md = md.replace(/<\/p>\s*<p>/gi, '\n\n')
  md = md.replace(/<\/?p>/gi, '')
  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '')
  // Decode HTML entities
  md = md.replace(/&amp;/g, '&')
  md = md.replace(/&lt;/g, '<')
  md = md.replace(/&gt;/g, '>')
  md = md.replace(/&quot;/g, '"')
  md = md.replace(/&#39;/g, "'")
  md = md.replace(/&apos;/g, "'")
  return md.trim()
}

// Download an image and return the local path
async function downloadImage(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12)
  const ext = path.extname(new URL(url).pathname).split('?')[0] || '.jpg'
  const filename = `${hash}${ext}`
  const filepath = path.join(IMG_DIR, filename)

  if (fs.existsSync(filepath)) {
    return `/img/notes/${filename}`
  }

  try {
    const data = await fetchBinary(url)
    fs.writeFileSync(filepath, data)
    console.log(`  Downloaded: ${filename}`)
    return `/img/notes/${filename}`
  } catch (err) {
    console.error(`  Failed to download image: ${url} - ${err.message}`)
    return null
  }
}

// --- Mastodon ---

async function fetchMastodonPosts() {
  console.log('Fetching Mastodon posts...')

  // Resolve account ID
  const lookupData = await fetch('https://social.lol/api/v1/accounts/lookup?acct=joehart')
  const account = JSON.parse(lookupData)
  const accountId = account.id
  console.log(`  Account ID: ${accountId}`)

  const allPosts = []
  let maxId = null

  while (true) {
    let url = `https://social.lol/api/v1/accounts/${accountId}/statuses?exclude_replies=true&exclude_reblogs=true&limit=40`
    if (maxId) url += `&max_id=${maxId}`

    const data = await fetch(url)
    const posts = JSON.parse(data)

    if (posts.length === 0) break

    allPosts.push(...posts)
    maxId = posts[posts.length - 1].id
    console.log(`  Fetched ${allPosts.length} posts so far...`)

    // Small delay to be polite
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`  Total Mastodon posts: ${allPosts.length}`)
  return allPosts
}

async function processMastodonPost(post) {
  const content = htmlToMarkdown(post.content)

  // Skip posts with no text content
  if (!content.trim()) return null

  const date = new Date(post.created_at)
  const dateStr = date.toISOString().split('T')[0]
  const shortId = post.id.slice(-8)

  // Download media
  const images = []
  for (const attachment of post.media_attachments || []) {
    if (attachment.type === 'image') {
      const localPath = await downloadImage(attachment.url)
      if (localPath) {
        images.push({ path: localPath, alt: attachment.description || '' })
      }
    }
  }

  return {
    date: dateStr,
    dateObj: date,
    content,
    images,
    mastodon_url: post.url,
    bluesky_url: null,
    shortId,
    platform: 'mastodon',
  }
}

// --- Bluesky ---

async function fetchBlueskyPosts() {
  console.log('Fetching Bluesky posts...')

  const allPosts = []
  let cursor = null

  while (true) {
    let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=joehart.bsky.social&filter=posts_no_replies&limit=100`
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

    const data = await fetch(url)
    const response = JSON.parse(data)

    if (!response.feed || response.feed.length === 0) break

    // Filter out reposts
    const ownPosts = response.feed.filter((item) => {
      return item.post.author.handle === 'joehart.bsky.social' && !item.reason
    })

    allPosts.push(...ownPosts)
    cursor = response.cursor
    console.log(`  Fetched ${allPosts.length} posts so far...`)

    if (!cursor) break
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`  Total Bluesky posts: ${allPosts.length}`)
  return allPosts
}

function blueskyFacetsToMarkdown(text, facets) {
  if (!facets || facets.length === 0) return text

  // Convert text to byte array for accurate byte-range slicing
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const bytes = encoder.encode(text)

  // Sort facets by byte start, descending, so replacements don't shift indices
  const sorted = [...facets].sort((a, b) => b.index.byteStart - a.index.byteStart)

  let result = bytes

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index
    const originalText = decoder.decode(result.slice(byteStart, byteEnd))

    for (const feature of facet.features) {
      let replacement = originalText
      if (feature.$type === 'app.bsky.richtext.facet#link') {
        replacement = `[${originalText}](${feature.uri})`
      } else if (feature.$type === 'app.bsky.richtext.facet#mention') {
        replacement = `[${originalText}](https://bsky.app/profile/${feature.did})`
      }
      // Tags are left as-is

      const replacementBytes = encoder.encode(replacement)
      const newResult = new Uint8Array(result.length - (byteEnd - byteStart) + replacementBytes.length)
      newResult.set(result.slice(0, byteStart))
      newResult.set(replacementBytes, byteStart)
      newResult.set(result.slice(byteEnd), byteStart + replacementBytes.length)
      result = newResult
    }
  }

  return decoder.decode(result)
}

async function processBlueskyPost(item) {
  const post = item.post
  const record = post.record

  const text = record.text || ''
  if (!text.trim()) return null

  const content = blueskyFacetsToMarkdown(text, record.facets)

  const date = new Date(record.createdAt)
  const dateStr = date.toISOString().split('T')[0]

  // Extract post ID from URI: at://did:plc:xxx/app.bsky.feed.post/shortid
  const uriParts = post.uri.split('/')
  const shortId = uriParts[uriParts.length - 1]

  // Build Bluesky web URL
  const blueskyUrl = `https://bsky.app/profile/${post.author.handle}/post/${shortId}`

  // Download images
  const images = []
  if (post.embed && post.embed.$type === 'app.bsky.embed.images#view') {
    for (const img of post.embed.images || []) {
      const localPath = await downloadImage(img.fullsize || img.thumb)
      if (localPath) {
        images.push({ path: localPath, alt: img.alt || '' })
      }
    }
  }

  return {
    date: dateStr,
    dateObj: date,
    content,
    images,
    mastodon_url: null,
    bluesky_url: blueskyUrl,
    shortId,
    platform: 'bluesky',
  }
}

// --- Deduplication ---

function normalizeText(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip markdown links, keep text
    .replace(/https?:\/\/\S+/g, '') // strip URLs
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function textSimilarity(a, b) {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (na === nb) return 1
  if (!na || !nb) return 0

  // Simple Jaccard similarity on words
  const wordsA = new Set(na.split(' '))
  const wordsB = new Set(nb.split(' '))
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
  const union = new Set([...wordsA, ...wordsB])
  return intersection.size / union.size
}

function deduplicatePosts(mastodonNotes, blueskyNotes) {
  const merged = []
  const matchedBluesky = new Set()

  for (const mNote of mastodonNotes) {
    let bestMatch = null
    let bestSimilarity = 0

    for (let i = 0; i < blueskyNotes.length; i++) {
      if (matchedBluesky.has(i)) continue

      const bNote = blueskyNotes[i]

      // Check date proximity (same day)
      if (mNote.date !== bNote.date) continue

      const sim = textSimilarity(mNote.content, bNote.content)
      if (sim > bestSimilarity && sim > 0.6) {
        bestSimilarity = sim
        bestMatch = i
      }
    }

    if (bestMatch !== null) {
      // Merge: keep mastodon content (richer HTML->markdown), add bluesky URL
      const bNote = blueskyNotes[bestMatch]
      matchedBluesky.add(bestMatch)
      merged.push({
        ...mNote,
        bluesky_url: bNote.bluesky_url,
        images: [...mNote.images, ...bNote.images.filter((bi) => !mNote.images.some((mi) => mi.path === bi.path))],
        platform: 'both',
      })
      console.log(`  Matched: "${mNote.content.slice(0, 50)}..." (similarity: ${bestSimilarity.toFixed(2)})`)
    } else {
      merged.push(mNote)
    }
  }

  // Add unmatched Bluesky posts
  for (let i = 0; i < blueskyNotes.length; i++) {
    if (!matchedBluesky.has(i)) {
      merged.push(blueskyNotes[i])
    }
  }

  return merged
}

// --- Write notes ---

function writeNote(note) {
  const slug =
    note.platform === 'both' ? `${note.date}-${note.shortId}` : `${note.date}-${note.platform}-${note.shortId}`

  const filename = `${slug}.md`
  const filepath = path.join(NOTES_DIR, filename)

  const frontmatter = [`date: ${note.date}`, `syndicate: false`]

  if (note.mastodon_url) frontmatter.push(`mastodon_url: ${note.mastodon_url}`)
  if (note.bluesky_url) frontmatter.push(`bluesky_url: ${note.bluesky_url}`)
  frontmatter.push(`tags: []`)

  let body = note.content

  // Append images
  for (const img of note.images) {
    body += `\n\n![${img.alt}](${img.path})`
  }

  const content = `---\n${frontmatter.join('\n')}\n---\n\n${body}\n`

  fs.writeFileSync(filepath, content)
  return filename
}

// --- Main ---

async function main() {
  console.log('Starting social post import...\n')

  // Fetch from both platforms
  const [mastodonPosts, blueskyFeed] = await Promise.all([fetchMastodonPosts(), fetchBlueskyPosts()])

  // Process posts
  console.log('\nProcessing Mastodon posts...')
  const mastodonNotes = []
  for (const post of mastodonPosts) {
    const note = await processMastodonPost(post)
    if (note) mastodonNotes.push(note)
  }
  console.log(`  Processed ${mastodonNotes.length} Mastodon notes`)

  console.log('\nProcessing Bluesky posts...')
  const blueskyNotes = []
  for (const item of blueskyFeed) {
    const note = await processBlueskyPost(item)
    if (note) blueskyNotes.push(note)
  }
  console.log(`  Processed ${blueskyNotes.length} Bluesky notes`)

  // Deduplicate
  console.log('\nDeduplicating...')
  const allNotes = deduplicatePosts(mastodonNotes, blueskyNotes)
  console.log(`  Total unique notes: ${allNotes.length}`)

  // Sort by date descending
  allNotes.sort((a, b) => b.dateObj - a.dateObj)

  // Write files
  console.log('\nWriting note files...')
  let count = 0
  for (const note of allNotes) {
    const filename = writeNote(note)
    count++
    if (count <= 5) console.log(`  ${filename}`)
  }
  if (count > 5) console.log(`  ... and ${count - 5} more`)

  console.log(`\nDone! Imported ${count} notes to ${NOTES_DIR}`)
  console.log(`Review the generated files before committing.`)
}

main().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
