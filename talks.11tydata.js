module.exports = {
  eleventyComputed: {
    preloadImage: (data) => {
      const posts = data.collections.talks || []
      const last = posts[posts.length - 1]
      return last?.data?.hero || last?.data?.socialImage || null
    },
  },
}
