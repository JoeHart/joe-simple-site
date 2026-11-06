# Posting notes

```
Shortcut / curl / any Micropub client
  → https://micropub.joehart.co.uk   (micropub.js, a Bunny Edge Script)
  → commits notes/<date>-<id>.md (+ img/notes/*) to master
  → "Deploy and syndicate" workflow:
      build → deploy → post to Bluesky + Mastodon → commit the post links → build → deploy
```

A note is live on the site, Bluesky and Mastodon about 3 minutes after you post it, and the site links to both copies.

You can also skip Micropub and add a file to `notes/` yourself (GitHub web/app or locally). It goes through the same workflow:

```markdown
---
date: 2026-11-06T09:00:00Z
syndicate: true
templateEngineOverride: md
tags: []
---

Note text. Markdown is fine. ![alt text](/img/notes/photo.jpeg)
```

How syndication behaves (`.github/scripts/syndicate.js`):

- **Which notes are posted:** any note with `syndicate: true` and no `bluesky_url` / `mastodon_url` yet. Each URL is written into the note once it's posted, so nothing is posted twice.
- **Long notes:** a note that fits goes out as-is. Otherwise it's cut at a word and ends with `… <link to the note>` (300 characters on Bluesky, 500 on Mastodon).
- **Images:** up to 4, with alt text, shrunk to fit Bluesky's size limit.
- **Failures:** if one network fails, the other still gets posted. The run goes red (GitHub emails you), and re-running the workflow retries only what's missing.
- **Old notes:** anything older than 14 days is never auto-posted, so the archive can't suddenly flood out.
- **Keeping a note site-only:** set `syndicate: false`.

Check what would be posted without posting anything:

```bash
node .github/scripts/syndicate.js --dry-run
```

## One-time setup

### 1. GitHub token

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:

- **Repository access:** only `JoeHart/joe-simple-site`
- **Permissions:** Contents → Read and write (nothing else)

Unlike the workflow's own token, pushes made with this one _do_ trigger the deploy workflow.

### 2. Micropub token

Make a long random string. This is what your devices use to post:

```bash
openssl rand -hex 32
```

### 3. Bunny Edge Script

In the Bunny dashboard:

1. **Edge Scripting → Add script → Standalone.** Paste in the contents of `micropub/micropub.js`.
2. **Add secrets:**
   - `MICROPUB_TOKEN`: the string from step 2
   - `GITHUB_TOKEN`: the PAT from step 1
   - `GITHUB_REPO` and `GITHUB_BRANCH` are optional; they default to `JoeHart/joe-simple-site` and `master`.
3. **Add the custom hostname** `micropub.joehart.co.uk`, then add the CNAME record it asks for in DNS.
4. **Check it works:**

   ```bash
   curl -H "Authorization: Bearer $MICROPUB_TOKEN" "https://micropub.joehart.co.uk/?q=config"
   ```

   It should return `{"media-endpoint": …}`.

The site already advertises the endpoint with `<link rel="micropub">` in `_includes/layouts/base.njk`.

### 4. GitHub Actions secrets (already set)

`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `MASTODON_ACCESS_TOKEN`, plus the `BUNNY_*` deploy secrets.

## Ways to post

### iPhone / Mac: Shortcut

Make a Shortcut called **Post note**. Steps marked _(photo)_ are optional. The same Shortcut works on iPhone and Mac via iCloud.

1. **Ask for Input:** Text, prompt "Note". Turn on _Allow Multiple Lines_.
2. _(photo)_ **Select Photos.**
3. _(photo)_ **Convert Image:** to JPEG. This matters because iPhone photos are HEIC, which the endpoint rejects.
4. _(photo)_ **Ask for Input:** Text, prompt "Alt text".
5. **Get Contents of URL:**
   - URL `https://micropub.joehart.co.uk/`, Method **POST**
   - Header `Authorization` = `Bearer <your MICROPUB_TOKEN>`
   - Request Body **Form**:
     - `h` = `entry`
     - `content` = _Provided Input_ (step 1)
     - _(photo)_ `photo` = _Converted Image_ (type **File**)
     - _(photo)_ `mp-photo-alt` = _Provided Input_ (step 4)
6. **Show Notification:** "Posted ✨"

Extra options:

- **Share sheet:** turn on _Show in Share Sheet_ and use _Shortcut Input_ as the content, to post links or text from any app.
- **Home screen / Siri:** add it to the home screen or dock and say "Post note".
- **Ready-made versions:** [Chuck Grimmett's Micropub Shortcuts](https://cagrimmett.com/2023/02/12/ios-shortcut-actions-for-micropub-posting/) work too. Give them the endpoint and use the Micropub token as the "IndieAuth token".

### Any laptop (work laptop included): curl

```bash
curl https://micropub.joehart.co.uk/ \
  -H "Authorization: Bearer $MICROPUB_TOKEN" \
  -d h=entry --data-urlencode "content=Hello from the terminal"
```

With a photo:

```bash
curl https://micropub.joehart.co.uk/ \
  -H "Authorization: Bearer $MICROPUB_TOKEN" \
  -F h=entry -F "content=Look at this" -F "photo=@cat.jpg" -F "mp-photo-alt=A cat on a keyboard"
```

A successful post returns `201` with a `Location:` header pointing at the note's URL. It goes live once the workflow finishes.

### Other Micropub apps

Apps that sign in with IndieAuth (Quill, iA Writer, IndiePass) won't work yet: the endpoint only accepts the fixed token. IndieAuth could be added later if you want those apps.
