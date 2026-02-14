const { DateTime } = require('luxon')

module.exports = {
  tags: ['notes'],
  layout: 'layouts/note.njk',
  eleventyComputed: {
    permalink: (data) => {
      if (data.eleventyExcludeFromCollections) return data.permalink
      const dt = DateTime.fromJSDate(data.page.date, { zone: 'utc' })
      return `/notes/${dt.toFormat('yyyy-LL-dd')}-${data.page.fileSlug}/`
    },
  },
}
