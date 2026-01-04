# Sveltia CMS Setup Guide

## Overview

This site uses Sveltia CMS with GitHub authentication via Vercel for content management. Sveltia CMS is a modern, drop-in replacement for Decap/Netlify CMS with improved performance and built-in asset management.

## Setup Steps

### 1. GitHub OAuth App Configuration

1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Create a new OAuth App with:
   - **Homepage URL**: `https://YOUR_PRODUCTION_DOMAIN` (e.g., https://joehart.co.uk)
   - **Authorization callback URL**: `https://YOUR_PRODUCTION_DOMAIN/api/callback`
3. Copy the **Client ID** and **Client Secret**

### 2. Vercel Environment Variables

In your Vercel project settings → Environment Variables, add:

- `OAUTH_CLIENT_ID` = Your GitHub OAuth App Client ID
- `OAUTH_CLIENT_SECRET` = Your GitHub OAuth App Client Secret

### 3. Update Configuration Files

#### In `/admin/config.yml`:

- Replace `YOUR_PRODUCTION_DOMAIN` with your actual domain (e.g., joehart.co.uk)

## Usage

### Accessing the CMS

Visit `https://YOUR_DOMAIN/admin/` (note the trailing slash) and log in with GitHub.

### Creating/Editing Posts

- Posts are stored as Markdown files in the `blogs/` directory
- Images are uploaded via Sveltia's built-in media library to `/img/uploads/`
- Changes are committed directly to the `master` branch

### Draft Workflow

- **New posts default to draft status** (`draft: true`)
- Drafts show a "DRAFT:" prefix in the CMS post list
- Uncheck the "Draft" checkbox to publish a post
- Draft posts are automatically filtered from the live site

### Using Images in Templates

The `clImage` shortcode is available for responsive image rendering:

```njk
{% if hero %}
  {% clImage hero, "Description of image" %}
{% endif %}
```

Or with custom widths and sizes:

```njk
{% clImage imageUrl, "Alt text", [400, 800, 1200], "(min-width: 1024px) 800px, 100vw" %}
```

## File Structure

- `/admin/` - Sveltia CMS interface
- `/api/` - Vercel serverless functions for GitHub OAuth
- `/blogs/` - Blog post markdown files
- `/img/uploads/` - Uploaded media files
- `/_siteimg/` - Cached/optimized images (generated at build time)

## Sveltia CMS Features

- **Built-in asset management** with drag-and-drop uploads
- **Image optimization** with WebP conversion
- **Stock photo integration** (Pexels, Pixabay, Unsplash)
- **Faster performance** using GitHub GraphQL API
- **Keyboard shortcuts** (Ctrl/Cmd+S to save)

## Troubleshooting

- If you can't log in, verify your GitHub OAuth app settings and Vercel environment variables
- For trailing slash issues, the `vercel.json` configuration should handle this automatically
- If assets don't upload, ensure the `img/uploads` folder exists in the repository

## Notes

- The CMS commits directly to the `master` branch (simple publish mode)
- Images are optimized at build time using Eleventy Image plugin
- Existing posts without a `draft` field are treated as published
