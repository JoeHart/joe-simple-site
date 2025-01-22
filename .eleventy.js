const { DateTime } = require("luxon");
const markdownIt = require("markdown-it");
const markdownItAnchor = require('markdown-it-anchor');
const markdownItTocDoneRight = require("markdown-it-toc-done-right");
const pluginRss = require("@11ty/eleventy-plugin-rss");


module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);


  let options = {
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
  };


  const myMarkdownIt = markdownIt(options)

  myMarkdownIt.use(markdownItAnchor,
    {
      permalink: markdownItAnchor.permalink.headerLink(),
    });
  myMarkdownIt.use(markdownItTocDoneRight);

  // Copy the  `css` folders to the output
  eleventyConfig.addPassthroughCopy("css");
  // eleventyConfig.addPassthroughCopy("img");

  eleventyConfig.addFilter("readableDate", dateObj => {
    return DateTime.fromJSDate(dateObj, { zone: 'utc' }).toFormat("dd LLL yyyy");
  });

  eleventyConfig.addFilter("activePostsOnly", postList => {
    return postList.filter(post => post.data.draft !== true);
  });

  // Return all the tags used in a collection
  eleventyConfig.addFilter("getAllTags", collection => {
    let tagSet = new Set();
    for (let item of collection) {
      (item.data.tags || []).forEach(tag => tagSet.add(tag));
    }
    return Array.from(tagSet);
  });



  eleventyConfig.addFilter("filterTagList", function filterTagList(tags) {
    return (tags || []).filter(tag => ["all", "nav", "post", "posts"].indexOf(tag) === -1);
  });

  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string
  eleventyConfig.addFilter('htmlDateString', (dateObj) => {
    return DateTime.fromJSDate(dateObj, { zone: 'utc' }).toFormat('yyyy-LL-dd');
  });

  eleventyConfig.setLibrary("md", myMarkdownIt);

  // Get the first `n` elements of a collection.
  eleventyConfig.addFilter("head", (array, n) => {
    if (!Array.isArray(array) || array.length === 0) {
      return [];
    }
    if (n < 0) {
      return array.slice(n);
    }

    return array.slice(0, n);
  });

  return {
    // Control which files Eleventy will process
    // e.g.: *.md, *.njk, *.html, *.liquid
    templateFormats: [
      "md",
      "njk",
      "html",
      "liquid",
      "jpg",
      "png",
      "gif",
    ],

    // Pre-process *.md files with: (default: `liquid`)
    markdownTemplateEngine: "njk",

    // Pre-process *.html files with: (default: `liquid`)
    htmlTemplateEngine: "njk",

    // -----------------------------------------------------------------
    // If your site deploys to a subdirectory, change `pathPrefix`.
    // Don’t worry about leading and trailing slashes, we normalize these.

    // If you don’t have a subdirectory, use "" or "/" (they do the same thing)
    // This is only used for link URLs (it does not affect your file structure)
    // Best paired with the `url` filter: https://www.11ty.dev/docs/filters/url/

    // You can also pass this in on the command line using `--pathprefix`

    // Optional (default is shown)
    pathPrefix: "/",
    // -----------------------------------------------------------------

    // These are all optional (defaults are shown):
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "_site"
    }
  };
};