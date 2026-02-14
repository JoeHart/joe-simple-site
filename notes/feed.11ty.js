module.exports = class {
  data() {
    return {
      permalink: 'notes/feed.json',
      layout: false,
      eleventyExcludeFromCollections: true,
    }
  }

  render(data) {
    const siteUrl = data.metadata.url
    const notes = (data.collections.notes || []).filter((note) => note.data.syndicate === true).reverse()

    const items = notes.map((note) => {
      const url = `${siteUrl}${note.url.replace(/^\//, '')}`

      // Strip HTML tags for content_text
      const contentText = (note.templateContent || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()

      return {
        id: url,
        url: url,
        date_published: note.date.toISOString(),
        content_text: contentText,
        content_html: note.templateContent || '',
      }
    })

    const feed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: "Joe Hart's Notes",
      home_page_url: `${siteUrl}notes/`,
      feed_url: `${siteUrl}notes/feed.json`,
      items: items,
    }

    return JSON.stringify(feed, null, 2)
  }
}
