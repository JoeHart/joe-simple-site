// Micropub endpoint for joehart.co.uk, deployed as a Bunny Edge Script.
//
// It turns a Micropub request into a note markdown file (plus any photos) and
// commits it to the site's GitHub repo. That push runs the deploy workflow,
// which builds the site and syndicates the note to Bluesky and Mastodon.
//
// Endpoints:
//   GET  /?q=config         Micropub config (advertises the media endpoint)
//   POST /                  Create a note (form-encoded, multipart or JSON)
//   POST /media             Upload a photo, returns its URL in Location
//
// Secrets / env vars (set in the Bunny dashboard):
//   MICROPUB_TOKEN   Long random string. Clients send it as "Authorization: Bearer <token>".
//   GITHUB_TOKEN     Fine-grained PAT with Contents: read & write on the site repo only.
//   GITHUB_REPO      Optional, defaults to JoeHart/joe-simple-site
//   GITHUB_BRANCH    Optional, defaults to master
//
// See micropub/README.md for setup and posting shortcuts.

const SITE_URL = 'https://www.joehart.co.uk'

export function createHandler(env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPO || 'JoeHart/joe-simple-site'
  const branch = env.GITHUB_BRANCH || 'master'

  return async function handle(request) {
    const url = new URL(request.url)
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    }
    const json = (status, body, headers = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors, ...headers },
      })
    const error = (status, code, description) => json(status, { error: code, error_description: description })

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      const isMedia = url.pathname.replace(/\/+$/, '') === '/media'
      const input = request.method === 'POST' ? await readBody(request) : null

      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || input?.access_token?.[0]
      if (!env.MICROPUB_TOKEN || !token || !safeEqual(token, env.MICROPUB_TOKEN)) {
        return error(401, 'unauthorized', 'Missing or invalid access token')
      }

      if (request.method === 'GET') {
        const q = url.searchParams.get('q')
        if (q === 'config') return json(200, { 'media-endpoint': new URL('/media', url).href, 'syndicate-to': [] })
        if (q === 'syndicate-to') return json(200, { 'syndicate-to': [] })
        return error(400, 'invalid_request', 'Unsupported query')
      }
      if (request.method !== 'POST') return error(405, 'invalid_request', 'Method not allowed')

      const github = makeGitHub(fetchImpl, env.GITHUB_TOKEN, repo, branch)

      if (isMedia) {
        const file = input.files.file?.[0] || input.files.photo?.[0]
        if (!file) return error(400, 'invalid_request', 'Expected a "file" upload')
        const image = await imageFile(file)
        await github.commit([image], 'Upload note image via Micropub')
        return json(201, { url: SITE_URL + image.webPath }, { Location: SITE_URL + image.webPath })
      }

      if (input.action?.[0]) return error(400, 'invalid_request', 'Only creating posts is supported')
      const type = (input.h?.[0] || 'entry').replace(/^h-/, '')
      if (type !== 'entry') return error(400, 'invalid_request', 'Only h-entry is supported')

      const content = (input.content || [])
        .map((c) => (typeof c === 'string' ? c : c.markdown || c.value || c.html || ''))
        .join('\n\n')
        .trim()
      const alts = input['mp-photo-alt'] || []
      const photos = []
      const files = []
      for (const file of [...(input.files.photo || []), ...(input.files['photo[]'] || [])]) {
        const image = await imageFile(file)
        files.push(image)
        photos.push({ src: image.webPath, alt: alts[photos.length] || '' })
      }
      for (const p of input.photo || []) {
        const src = typeof p === 'string' ? p : p.value
        const alt = (typeof p === 'object' && p.alt) || alts[photos.length] || ''
        if (src.startsWith(SITE_URL + '/img/')) {
          photos.push({ src: src.slice(SITE_URL.length), alt })
        } else {
          // Copy remote photos into the repo so the note doesn't depend on them.
          const res = await fetchImpl(src)
          if (!res.ok) return error(400, 'invalid_request', `Could not fetch photo ${src}`)
          const image = await imageFile(
            new File([await res.arrayBuffer()], src, { type: res.headers.get('content-type') || '' })
          )
          files.push(image)
          photos.push({ src: image.webPath, alt })
        }
      }
      if (!content && !photos.length) return error(400, 'invalid_request', 'A note needs content or a photo')

      const now = input.published?.[0] ? new Date(input.published[0]) : new Date()
      const day = now.toISOString().slice(0, 10)
      const id = randomHex(6)
      const tags = (input.category || []).filter(Boolean)
      const markdown = [
        '---',
        `date: ${now.toISOString()}`,
        'syndicate: true',
        // Stop Nunjucks interpreting {{ }} or {% %} typed in a note.
        'templateEngineOverride: md',
        `tags: ${JSON.stringify(tags)}`,
        '---',
        '',
        [content, ...photos.map((p) => `![${p.alt.replace(/[\[\]]/g, '')}](${p.src})`)].filter(Boolean).join('\n\n'),
        '',
      ].join('\n')

      files.push({ path: `notes/${day}-${id}.md`, content: new TextEncoder().encode(markdown) })
      await github.commit(files, `Add note ${day}-${id} via Micropub`)

      const permalink = `${SITE_URL}/notes/${day}-${id}/`
      return new Response(null, { status: 201, headers: { Location: permalink, ...cors } })
    } catch (err) {
      console.error(err)
      return error(500, 'server_error', err.message)
    }
  }
}

// --- Request parsing ---------------------------------------------------------

// Normalises form-encoded, multipart and JSON bodies to { key: [values], files: { key: [File] } }.
async function readBody(request) {
  const type = request.headers.get('Content-Type') || ''
  const out = { files: {} }
  const add = (key, value) => {
    const k = key.replace(/\[\]$/, '')
    ;(out[k] = out[k] || []).push(value)
  }

  if (type.includes('application/json')) {
    const body = await request.json()
    if (body.action) out.action = [body.action]
    if (body.type) out.h = [String(body.type[0] || body.type)]
    for (const [key, values] of Object.entries(body.properties || {})) {
      for (const v of [].concat(values)) add(key, v)
    }
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('mp-') || key === 'access_token') for (const v of [].concat(value)) add(key, v)
    }
    return out
  }

  const form = type.includes('multipart/form-data')
    ? await request.formData()
    : new URLSearchParams(await request.text())
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') add(key, value)
    else (out.files[key] = out.files[key] || []).push(value)
  }
  return out
}

const EXTENSIONS = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

async function imageFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = EXTENSIONS[file.type] || (file.name || '').match(/\.(jpe?g|png|gif|webp)$/i)?.[1]?.toLowerCase()
  if (!ext || ext === 'heic')
    throw new Error(`Unsupported image type ${file.type || file.name} (use JPEG/PNG/GIF/WebP)`)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const name = [...new Uint8Array(hash)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const path = `img/notes/${name}.${ext}`
  return { path, webPath: `/${path}`, content: bytes }
}

// --- GitHub ------------------------------------------------------------------

// Commits several files in one commit using the Git Data API.
function makeGitHub(fetchImpl, token, repo, branch) {
  const api = async (path, init = {}) => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'joehart-micropub',
        'Content-Type': 'application/json',
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(`GitHub ${init.method || 'GET'} ${path}: ${res.status} ${body.message || ''}`)
      err.status = res.status
      throw err
    }
    return body
  }

  return {
    async commit(files, message) {
      const blobs = []
      for (const f of files) {
        const blob = await api('/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: toBase64(f.content), encoding: 'base64' }),
        })
        blobs.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
      }
      // Retry if someone else pushed between reading and updating the branch.
      for (let attempt = 0; ; attempt++) {
        const ref = await api(`/git/ref/heads/${branch}`)
        const parent = await api(`/git/commits/${ref.object.sha}`)
        const tree = await api('/git/trees', {
          method: 'POST',
          body: JSON.stringify({ base_tree: parent.tree.sha, tree: blobs }),
        })
        const commit = await api('/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
        })
        try {
          await api(`/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
          return commit.sha
        } catch (err) {
          if (err.status !== 422 || attempt >= 2) throw err
        }
      }
    },
  }
}

// --- Utilities ---------------------------------------------------------------

function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// --- Bunny Edge Scripting entry point ----------------------------------------

if (typeof Deno !== 'undefined') {
  const BunnySDK = await import('https://esm.sh/@bunny.net/edgescript-sdk@0.12.1')
  const handle = createHandler({
    MICROPUB_TOKEN: Deno.env.get('MICROPUB_TOKEN'),
    GITHUB_TOKEN: Deno.env.get('GITHUB_TOKEN'),
    GITHUB_REPO: Deno.env.get('GITHUB_REPO'),
    GITHUB_BRANCH: Deno.env.get('GITHUB_BRANCH'),
  })
  BunnySDK.net.http.serve(handle)
}
