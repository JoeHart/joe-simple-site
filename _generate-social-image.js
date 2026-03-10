const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const WIDTH = 1200
const HEIGHT = 630
const PADDING = 80
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

  // Don't regenerate if already exists
  if (fs.existsSync(outputFile)) {
    return publicPath
  }

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
  const textStartY = Math.max(PADDING + fontSize, (HEIGHT - totalTextHeight) / 2 + fontSize * 0.5)

  const emojiDisplay = emoji || ''
  const emojiSize = fontSize * 1.2

  const titleLines = lines
    .map((line, i) => {
      const y = textStartY + i * lineHeight
      return `<text x="${PADDING}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${TEXT_COLOR}" letter-spacing="-1">${escapeXml(line)}</text>`
    })
    .join('\n    ')

  // Add the emoji above the title
  const emojiY = textStartY - lineHeight * 0.8
  const emojiElement = emojiDisplay
    ? `<text x="${PADDING}" y="${emojiY}" font-size="${emojiSize}">${emojiDisplay}</text>`
    : ''

  // Add site name at the bottom
  const footerY = HEIGHT - PADDING * 0.6
  const footerElement = `<text x="${PADDING}" y="${footerY}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="${BODY_COLOR}" letter-spacing="-0.5">joehart.co.uk</text>`

  // Decorative teal line at top
  const accentBar = `<rect x="0" y="0" width="${WIDTH}" height="6" fill="${TEXT_COLOR}" />`

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG_COLOR}" />
    ${accentBar}
    ${emojiElement}
    ${titleLines}
    ${footerElement}
  </svg>`

  await sharp(Buffer.from(svg)).png().toFile(outputFile)

  return publicPath
}

module.exports = { generateSocialImage }
