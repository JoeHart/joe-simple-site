const { DateTime } = require('luxon')
const markdownIt = require('markdown-it')
const markdownItAnchor = require('markdown-it-anchor')
const markdownItTocDoneRight = require('markdown-it-toc-done-right')
const pluginRss = require('@11ty/eleventy-plugin-rss')
const Image = require('@11ty/eleventy-img')

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss)
  // eleventyConfig.addPlugin(eleventyImageTransformPlugin);

  let options = {
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
  }

  const myMarkdownIt = markdownIt(options)

  myMarkdownIt.use(markdownItAnchor, {
    permalink: markdownItAnchor.permalink.headerLink(),
  })
  myMarkdownIt.use(markdownItTocDoneRight)

  // Copy the  `css` folders to the output
  eleventyConfig.addPassthroughCopy('css')
  eleventyConfig.addPassthroughCopy('img')
  eleventyConfig.addPassthroughCopy('js')
  eleventyConfig.addPassthroughCopy('play')
  eleventyConfig.addPassthroughCopy('admin')
  eleventyConfig.addPassthroughCopy('admin-sveltia')
  eleventyConfig.addPassthroughCopy('_siteimg')

  eleventyConfig.addShortcode('year', () => `${new Date().getFullYear()}`)

  eleventyConfig.addNunjucksAsyncShortcode(
    'clImage',
    async function (src, alt = '', widths = [480, 800, 1280], sizes = '(min-width: 800px) 800px, 100vw') {
      if (!src) return ''
      let metadata = await Image(src, {
        widths,
        formats: ['webp', 'jpeg'],
        urlPath: '/_siteimg/',
        outputDir: './_siteimg/',
        cacheOptions: { duration: '1y' },
      })
      let imageAttrs = {
        alt,
        sizes,
        loading: 'lazy',
        decoding: 'async',
      }
      return Image.generateHTML(metadata, imageAttrs)
    }
  )

  eleventyConfig.addTransform('optimizeImages', async function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith('.html')) {
      return content
    }

    const imgRegex = /<img\b([^>]*)>/gi
    const matches = [...content.matchAll(imgRegex)]
    if (matches.length === 0) return content

    const replacements = await Promise.all(
      matches.map(async (match) => {
        const imgTag = match[0]
        const attrs = match[1]

        const srcMatch = attrs.match(/src="([^"]+)"/)
        if (!srcMatch) return null
        const src = srcMatch[1]

        if (!src.startsWith('/img/')) return null
        if (/\.(gif|svg|ico)$/i.test(src)) return null

        const existingAttrs = {}
        const attrRegex = /([\w-]+)="([^"]*)"/g
        let attrMatch
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          const [, name, value] = attrMatch
          if (name !== 'src' && name !== 'width' && name !== 'height') {
            existingAttrs[name] = value
          }
        }

        try {
          const metadata = await Image(`.${src}`, {
            widths: [480, 800, 1280],
            formats: ['webp', 'jpeg'],
            urlPath: '/_siteimg/',
            outputDir: './_siteimg/',
          })

          const imageAttrs = {
            ...existingAttrs,
            sizes: existingAttrs.sizes || '(min-width: 800px) 800px, 100vw',
            loading: existingAttrs.loading || 'lazy',
            decoding: existingAttrs.decoding || 'async',
          }

          let pictureHtml = Image.generateHTML(metadata, imageAttrs)
          if (existingAttrs.class && existingAttrs.class.includes('post-hero')) {
            pictureHtml = pictureHtml.replace(/ width="\d+"/, '').replace(/ height="\d+"/, '')
          }
          return { index: match.index, length: imgTag.length, replacement: pictureHtml }
        } catch (e) {
          console.warn(`[image transform] Failed to process ${src}:`, e.message)
          return null
        }
      })
    )

    const validReplacements = replacements.filter(Boolean).sort((a, b) => b.index - a.index)
    let result = content
    for (const { index, length, replacement } of validReplacements) {
      result = result.slice(0, index) + replacement + result.slice(index + length)
    }

    // Rewrite preload links to point to the largest webp
    const preloadRegex = /<link\b[^>]*rel="preload"[^>]*as="image"[^>]*>/gi
    result = result.replace(preloadRegex, (tag) => {
      const hrefMatch = tag.match(/href="([^"]+)"/)
      if (!hrefMatch) return tag
      const href = hrefMatch[1]
      if (!href.startsWith('/img/') || /\.(gif|svg|ico)$/i.test(href)) return tag
      try {
        const metadata = Image.statsSync(`.${href}`, {
          widths: [480, 800, 1280],
          formats: ['webp', 'jpeg'],
          urlPath: '/_siteimg/',
          outputDir: './_siteimg/',
        })
        const largestWebp = metadata.webp[metadata.webp.length - 1]
        return `<link rel="preload" as="image" type="image/webp" href="${largestWebp.url}" />`
      } catch (e) {
        return tag
      }
    })

    return result
  })

  eleventyConfig.addFilter('readableDate', (dateObj) => {
    return DateTime.fromJSDate(dateObj, { zone: 'utc' }).toFormat('dd LLL yyyy')
  })

  eleventyConfig.addFilter('readableDateFromString', (dateString) => {
    return DateTime.fromISO(dateString, { zone: 'utc' }).toFormat('dd LLL yyyy')
  })

  eleventyConfig.addFilter('activePostsOnly', (postList) => {
    return postList.filter((post) => post.data.draft !== true)
  })

  // Return all the tags used in a collection
  eleventyConfig.addFilter('getAllTags', (collection) => {
    let tagSet = new Set()
    for (let item of collection) {
      ;(item.data.tags || []).forEach((tag) => tagSet.add(tag))
    }
    return Array.from(tagSet)
  })

  eleventyConfig.addFilter('filterTagList', function filterTagList(tags) {
    return (tags || []).filter(
      (tag) => ['all', 'nav', 'post', 'posts', 'talks', 'blog', 'blogs', 'playgames', 'notes'].indexOf(tag) === -1
    )
  })

  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string
  eleventyConfig.addFilter('htmlDateString', (dateObj) => {
    return DateTime.fromJSDate(dateObj, { zone: 'utc' }).toFormat('yyyy-LL-dd')
  })

  eleventyConfig.setLibrary('md', myMarkdownIt)

  // Get the first `n` elements of a collection.
  eleventyConfig.addFilter('head', (array, n) => {
    if (!Array.isArray(array) || array.length === 0) {
      return []
    }
    if (n < 0) {
      return array.slice(n)
    }

    return array.slice(0, n)
  })

  return {
    // Control which files Eleventy will process
    // e.g.: *.md, *.njk, *.html, *.liquid
    templateFormats: [
      'md',
      'njk',
      'html',
      'liquid',
      '11ty.js',
      // "jpg",
      // "png",
      // "gif",
    ],

    // Pre-process *.md files with: (default: `liquid`)
    markdownTemplateEngine: 'njk',

    // Pre-process *.html files with: (default: `liquid`)
    htmlTemplateEngine: 'njk',

    // -----------------------------------------------------------------
    // If your site deploys to a subdirectory, change `pathPrefix`.
    // Don’t worry about leading and trailing slashes, we normalize these.

    // If you don’t have a subdirectory, use "" or "/" (they do the same thing)
    // This is only used for link URLs (it does not affect your file structure)
    // Best paired with the `url` filter: https://www.11ty.dev/docs/filters/url/

    // You can also pass this in on the command line using `--pathprefix`

    // Optional (default is shown)
    pathPrefix: '/',
    // -----------------------------------------------------------------

    // These are all optional (defaults are shown):
    dir: {
      input: '.',
      includes: '_includes',
      data: '_data',
      output: '_site',
    },
  }
}
