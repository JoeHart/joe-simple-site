const { generateSocialImage } = require('../_generate-social-image')

module.exports = {
  tags: ['blogs', 'posts'],
  eleventyComputed: {
    permalink: (data) => {
      if (data.remoteURL) return false
    },
    socialImage: async (data) => {
      // If a socialImage is already set, use it
      if (data.socialImage) return data.socialImage
      // If there's a hero image, it'll be used via the template fallback
      if (data.hero) return data.hero
      // Generate a social image from the title
      if (data.title && data.page?.fileSlug) {
        try {
          return await generateSocialImage(data.title, data.emoji, data.page.fileSlug)
        } catch (e) {
          console.warn(`[social-image] Failed to generate for "${data.title}":`, e.message)
          return undefined
        }
      }
    },
  },
}
