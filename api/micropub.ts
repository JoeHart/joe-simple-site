import type { VercelRequest, VercelResponse } from '@vercel/node'

const GITHUB_REPO = 'JoeHart/joe-simple-site'
const GITHUB_BRANCH = 'master'
const SITE_URL = 'https://www.joehart.co.uk'

interface GitHubFileResponse {
  content: { html_url: string }
}

async function verifyToken(token: string): Promise<boolean> {
  // Verify against IndieAuth token endpoint
  // Falls back to a shared secret stored in env for simple setups
  const micropubToken = process.env.MICROPUB_TOKEN
  if (micropubToken && token === micropubToken) {
    return true
  }

  // Full IndieAuth verification
  const tokenEndpoint = process.env.INDIEAUTH_TOKEN_ENDPOINT || 'https://tokens.indieauth.com/token'
  try {
    const res = await fetch(tokenEndpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return false
    const data = await res.json()
    return data.me && (data.me === SITE_URL || data.me === `${SITE_URL}/`)
  } catch {
    return false
  }
}

function generateSlug(content: string): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toISOString().slice(11, 16).replace(':', '')
  return `${dateStr}-${timeStr}`
}

function buildFrontmatter(properties: Record<string, unknown>): string {
  const now = new Date()
  const lines = ['---']
  lines.push(`date: ${now.toISOString().slice(0, 10)}`)
  lines.push('draft: false')

  if (properties.category) {
    const cats = Array.isArray(properties.category) ? properties.category : [properties.category]
    lines.push(`tags:`)
    for (const cat of cats) {
      lines.push(`  - "${cat}"`)
    }
  }

  lines.push('---')
  return lines.join('\n')
}

async function createNoteOnGitHub(content: string, slug: string, frontmatter: string): Promise<string> {
  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) throw new Error('GITHUB_TOKEN not configured')

  const filePath = `notes/${slug}.md`
  const fileContent = `${frontmatter}\n\n${content}\n`
  const encodedContent = Buffer.from(fileContent).toString('base64')

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      message: `New note via Micropub: ${slug}`,
      content: encodedContent,
      branch: GITHUB_BRANCH,
    }),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`GitHub API error: ${res.status} ${error}`)
  }

  return `${SITE_URL}/notes/${slug}/`
}

function parseFormEncoded(body: string): Record<string, string | string[]> {
  const params = new URLSearchParams(body)
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of params) {
    if (key.endsWith('[]')) {
      const cleanKey = key.slice(0, -2)
      if (!result[cleanKey]) result[cleanKey] = []
      ;(result[cleanKey] as string[]).push(value)
    } else {
      result[key] = value
    }
  }
  return result
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(204).end()
  }

  // GET: config/syndication query
  if (req.method === 'GET') {
    const q = req.query.q as string
    if (q === 'config') {
      return res.json({
        'media-endpoint': `${SITE_URL}/api/micropub?q=media`,
        'syndicate-to': [
          {
            uid: 'https://fed.brid.gy/',
            name: 'Bridgy Fed (Fediverse + Bluesky)',
          },
        ],
      })
    }
    if (q === 'syndicate-to') {
      return res.json({
        'syndicate-to': [
          {
            uid: 'https://fed.brid.gy/',
            name: 'Bridgy Fed (Fediverse + Bluesky)',
          },
        ],
      })
    }
    return res.status(400).json({ error: 'invalid_request' })
  }

  // POST: create a note
  if (req.method === 'POST') {
    // Verify auth
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    const token = authHeader.slice(7)
    const valid = await verifyToken(token)
    if (!valid) {
      return res.status(403).json({ error: 'forbidden' })
    }

    // Parse request body
    let content: string = ''
    let properties: Record<string, unknown> = {}

    const contentType = req.headers['content-type'] || ''

    if (contentType.includes('application/json')) {
      // JSON Micropub format
      const body = req.body
      if (body.type && body.type.includes('h-entry')) {
        content = Array.isArray(body.properties?.content) ? body.properties.content[0] : body.properties?.content || ''
        if (typeof content === 'object' && content !== null && 'value' in content) {
          content = (content as { value: string }).value
        }
        properties = body.properties || {}
      }
    } else {
      // Form-encoded Micropub format
      const body = typeof req.body === 'string' ? parseFormEncoded(req.body) : req.body
      if (body.h === 'entry') {
        content = (body.content as string) || ''
        properties = body
      }
    }

    if (!content) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'No content provided' })
    }

    try {
      const slug = generateSlug(content)
      const frontmatter = buildFrontmatter(properties)
      const noteUrl = await createNoteOnGitHub(content, slug, frontmatter)

      res.setHeader('Location', noteUrl)
      return res.status(201).json({ url: noteUrl })
    } catch (err) {
      console.error('Micropub error:', err)
      return res.status(500).json({ error: 'server_error', error_description: String(err) })
    }
  }

  return res.status(405).json({ error: 'method_not_allowed' })
}
