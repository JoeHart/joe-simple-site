const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const WIDTH = 1200
const HEIGHT = 630
const PADDING = 80
const EMOJI_SIZE = 72
const TEXT_COLOR = '#2cced2' // --color-accent (teal)
const BG_COLOR = '#ffffff'
const BODY_COLOR = '#404040'

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Convert an emoji string to its hex codepoint(s) for file lookup
function emojiToCodepoint(emoji) {
  const codepoints = []
  for (const char of emoji) {
    const cp = char.codePointAt(0)
    // Skip variation selectors (fe0f, fe0e)
    if (cp !== 0xfe0f && cp !== 0xfe0e) {
      codepoints.push(cp.toString(16))
    }
  }
  return codepoints.join('-')
}

// Load an Apple emoji PNG from the locally installed emoji-datasource-apple package
function getEmojiImage(emoji) {
  const codepoint = emojiToCodepoint(emoji)
  const emojiPath = path.join(
    __dirname,
    'node_modules',
    'emoji-datasource-apple',
    'img',
    'apple',
    '64',
    `${codepoint}.png`
  )

  if (!fs.existsSync(emojiPath)) {
    throw new Error(`Emoji image not found: ${emojiPath}`)
  }

  return fs.readFileSync(emojiPath)
}

// Simple word-wrap that respects the available width
// Returns array of lines
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/)
  const lines = []
  let current = ''

  for (const word of words) {
    if (current.length + word.length + 1 > maxCharsPerLine && current.length > 0) {
      lines.push(current)
      current = word
    } else {
      current = current ? current + ' ' + word : word
    }
  }
  if (current) lines.push(current)
  return lines
}

async function generateSocialImage(title, emoji, slug) {
  const outputDir = path.join(__dirname, 'img', 'social')
  const outputFile = path.join(outputDir, `${slug}.png`)
  const publicPath = `/img/social/${slug}.png`

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Calculate font size and wrapping based on title length
  let fontSize = 64
  let maxChars = 22
  if (title.length > 60) {
    fontSize = 48
    maxChars = 30
  }
  if (title.length > 100) {
    fontSize = 40
    maxChars = 36
  }

  const lines = wrapText(title, maxChars)
  const lineHeight = fontSize * 1.2
  const totalTextHeight = lines.length * lineHeight

  // Position text vertically centered, or slightly above center
  const emojiSpace = emoji ? EMOJI_SIZE + 16 : 0
  const contentHeight = emojiSpace + totalTextHeight
  const contentStartY = Math.max(PADDING, (HEIGHT - contentHeight) / 2)

  const textStartY = contentStartY + emojiSpace + fontSize

  const titleLines = lines
    .map((line, i) => {
      const y = textStartY + i * lineHeight
      return `<text x="${PADDING}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${TEXT_COLOR}" letter-spacing="-1">${escapeXml(line)}</text>`
    })
    .join('\n    ')

  // Add site name at the bottom
  const footerY = HEIGHT - PADDING * 0.6
  const footerElement = `<text x="${PADDING}" y="${footerY}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="${BODY_COLOR}" letter-spacing="-0.5">joehart.co.uk</text>`

  // Decorative teal line at top
  const accentBar = `<rect x="0" y="0" width="${WIDTH}" height="6" fill="${TEXT_COLOR}" />`

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG_COLOR}" />
    ${accentBar}
    ${titleLines}
    ${footerElement}
  </svg>`

  let image = sharp(Buffer.from(svg)).png()

  // Composite the Apple emoji on top if we have one
  if (emoji) {
    try {
      const emojiBuffer = getEmojiImage(emoji)
      // Resize emoji to desired size
      const emojiResized = await sharp(emojiBuffer).resize(EMOJI_SIZE, EMOJI_SIZE).png().toBuffer()

      // Get the base image as a buffer first, then composite
      const baseBuffer = await image.toBuffer()
      image = sharp(baseBuffer).composite([
        {
          input: emojiResized,
          top: Math.round(contentStartY),
          left: PADDING,
        },
      ])
    } catch (e) {
      console.warn(`[social-image] Could not fetch emoji "${emoji}":`, e.message)
      // Continue without emoji
    }
  }

  await image.png().toFile(outputFile)

  return publicPath
}

module.exports = { generateSocialImage }
