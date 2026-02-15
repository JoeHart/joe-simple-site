module.exports = {
  eleventyComputed: {
    preloadImage: (data) => {
      const posts = (data.collections.blogs || []).filter((p) => p.data.draft !== true)
      const last = posts[posts.length - 1]
      return last?.data?.hero || last?.data?.socialImage || null
    },
  },
}
