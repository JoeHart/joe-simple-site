module.exports = {
  tags: ['blogs', 'posts'],
  eleventyComputed: {
    permalink: (data) => {
      if (data.remoteURL) return false
    },
  },
}
