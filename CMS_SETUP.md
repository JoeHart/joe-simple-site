# Decap CMS Setup Guide

## Overview

This site now has Decap CMS configured with GitHub authentication via Vercel and Cloudinary for media management.

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
- Replace `YOUR_CLOUDINARY_CLOUD_NAME` with your Cloudinary cloud name
- Replace `YOUR_CLOUDINARY_API_KEY` with your Cloudinary API key

### 4. Cloudinary Setup

1. Log into your Cloudinary account
2. Find your cloud name and API key in the Dashboard
3. Make sure you're logged into Cloudinary in the same browser when using the CMS

## Usage

### Accessing the CMS

Visit `https://YOUR_DOMAIN/admin/` (note the trailing slash) and log in with GitHub.

### Creating/Editing Posts

- Posts are stored as Markdown files in the `blogs/` directory
- Images are managed through Cloudinary's media library
- Changes are committed directly to the `master` branch

### Using Cloudinary Images in Templates

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

Alternatively, you can use Cloudinary URLs directly in your templates:

```njk
<img src="{{ hero }}" alt="Hero image">
```

## File Structure

- `/admin/` - Decap CMS interface
- `/api/` - Vercel serverless functions for GitHub OAuth
- `/blogs/` - Blog post markdown files
- `/_siteimg/` - Cached/optimized images (generated at build time)

## Troubleshooting

- If you can't log in, verify your GitHub OAuth app settings and Vercel environment variables
- If the media library doesn't show, ensure you're logged into Cloudinary in the same browser
- For trailing slash issues, the `vercel.json` configuration should handle this automatically

## Notes

- The Cloudinary API key in `config.yml` is public; authentication happens via browser session
- Images are optimized at build time using Eleventy Image plugin
- The CMS commits directly to the `master` branch (simple publish mode)
