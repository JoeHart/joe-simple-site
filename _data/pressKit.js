// Builds the downloadable press kit for /press/ from _data/press.json:
// for every photo, square / 16:9 / 4:5 crops plus the uncropped original,
// each at a web size and full size, and two zips of everything.
// Output goes straight to _site/press-kit/ and is cached between builds.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const sharp = require('sharp')
const archiver = require('archiver')
const press = require('./press.json')

const OUT_DIR = path.join(__dirname, '..', '_site', 'press-kit')
const URL_BASE = '/press-kit/'
const WEB_LONG_EDGE = 1600
// Only offer a separate web size when it is meaningfully smaller than full.
const WEB_THRESHOLD = 1900
const CACHE_VERSION = 1

const RATIOS = [
  { key: 'original', label: 'Original' },
  { key: 'square', label: 'Square 1:1', ratio: 1 },
  { key: 'wide', label: 'Wide 16:9', ratio: 16 / 9 },
  { key: 'portrait', label: 'Portrait 4:5', ratio: 4 / 5 },
]

const hash = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12)

function cropSize(width, height, ratio) {
  if (!ratio) return { width, height }
  return width / height > ratio
    ? { width: Math.round(height * ratio), height }
    : { width, height: Math.round(width / ratio) }
}

function scaleToLongEdge({ width, height }, longEdge) {
  const scale = longEdge / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function fileInfo(file, url, size) {
  return { url, width: size.width, height: size.height, bytes: fs.statSync(file).size }
}

async function buildVariant(photo, sourcePath, meta, ratio, slug, cache) {
  const full = cropSize(meta.width, meta.height, ratio.ratio)
  const position = photo.focus || sharp.strategy.attention
  const sizes = [{ name: 'full', size: full }]
  if (Math.max(full.width, full.height) > WEB_THRESHOLD) {
    sizes.unshift({ name: 'web', size: scaleToLongEdge(full, WEB_LONG_EDGE) })
  }

  const result = { key: ratio.key, label: ratio.label }
  for (const { name, size } of sizes) {
    // The uncropped full-size original is the source file itself.
    if (ratio.key === 'original' && name === 'full') {
      result.full = { ...fileInfo(sourcePath, photo.src, size), path: sourcePath }
      continue
    }
    const fileName = `joe-hart-${slug}-${ratio.key}-${name}.jpg`
    const outPath = path.join(OUT_DIR, fileName)
    const key = hash([CACHE_VERSION, meta.mtime, meta.bytes, photo.focus || null, ratio.key, size])
    if (cache[fileName] !== key || !fs.existsSync(outPath)) {
      await sharp(sourcePath)
        .rotate()
        // Same aspect ratio as the full crop, so this crops and scales in one step.
        .resize({ width: size.width, height: size.height, fit: 'cover', position })
        .jpeg({ quality: name === 'web' ? 80 : 88, mozjpeg: true })
        .toFile(outPath)
      cache[fileName] = key
    }
    result[name] = { ...fileInfo(outPath, URL_BASE + fileName, size), path: outPath }
  }
  return result
}

function textFiles() {
  const bios = press.bios.map((b) => `${b.label}\n\n${b.text}`).join('\n\n---\n\n')
  const talks = (press.talks || [])
    .map((t) => `${t.title}\n\n${t.abstract}${t.link ? `\n\n${t.link}` : ''}`)
    .join('\n\n---\n\n')
  const credits = press.photos
    .map((p) => `${p.download}: ${p.event}, ${p.caption}${p.credit ? ` (photo: ${p.credit})` : ''}`)
    .join('\n')
  const links = press.links.map((l) => `${l.label}: ${l.url.replace('mailto:', '')}`).join('\n')
  return [
    { name: 'bios.txt', content: bios + '\n' },
    { name: 'talks.txt', content: talks + '\n' },
    { name: 'photo-credits.txt', content: credits + '\n' },
    { name: 'links.txt', content: links + '\n' },
  ]
}

function writeZip(zipPath, entries, texts) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    // JPEGs don't compress further, so store them and only deflate the text files.
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    for (const { file, name } of entries) archive.file(file, { name: `photos/${name}`, store: true })
    for (const { name, content } of texts) archive.append(content, { name })
    archive.finalize()
  })
}

module.exports = async function () {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  // Kept outside _site so it isn't deployed.
  const cachePath = path.join(__dirname, '..', 'node_modules', '.cache', 'press-kit.json')
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  let cache = {}
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  } catch (e) {}

  const photos = []
  for (const photo of press.photos) {
    const sourcePath = path.join(__dirname, '..', decodeURIComponent(photo.src))
    const stat = fs.statSync(sourcePath)
    const { width, height, orientation } = await sharp(sourcePath).metadata()
    const rotated = orientation >= 5
    const meta = {
      width: rotated ? height : width,
      height: rotated ? width : height,
      mtime: stat.mtimeMs,
      bytes: stat.size,
    }
    const slug = photo.download.replace(/^joe-hart-/, '').replace(/\.\w+$/, '')
    const variants = await Promise.all(RATIOS.map((ratio) => buildVariant(photo, sourcePath, meta, ratio, slug, cache)))
    photos.push({ ...photo, slug, variants })
  }

  const texts = textFiles()
  const pick = (size) =>
    photos.flatMap((p) =>
      p.variants.map((v) => {
        const file = (size === 'web' && v.web) || v.full
        const ext = path.extname(file.path)
        return { file: file.path, name: `joe-hart-${p.slug}-${v.key}${ext}` }
      })
    )
  const zips = []
  for (const size of ['web', 'full']) {
    const fileName = `joe-hart-press-kit-${size}.zip`
    const zipPath = path.join(OUT_DIR, fileName)
    const entries = pick(size)
    const key = hash([
      CACHE_VERSION,
      texts,
      entries.map((e) => [e.name, fs.statSync(e.file).size, cache[path.basename(e.file)] || null]),
    ])
    if (cache[fileName] !== key || !fs.existsSync(zipPath)) {
      await writeZip(zipPath, entries, texts)
      cache[fileName] = key
    }
    zips.push({ size, url: URL_BASE + fileName, bytes: fs.statSync(zipPath).size, count: entries.length })
  }

  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  // Group photos by event, keeping the order they first appear in press.json.
  const groups = []
  for (const photo of photos) {
    let group = groups.find((g) => g.event === photo.event)
    if (!group) groups.push((group = { event: photo.event, photos: [] }))
    group.photos.push(photo)
  }
  for (const group of groups) {
    const credits = new Set(group.photos.map((p) => p.credit || ''))
    group.credit = credits.size === 1 ? [...credits][0] : ''
  }

  return { photos, groups, zips }
}
