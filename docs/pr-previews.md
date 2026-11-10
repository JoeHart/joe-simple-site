# Per-PR previews on Bunny

Status: **scoping**. Nothing is built yet.

## Goal

Every pull request gets its own preview site at `https://pr-<n>.preview.joehart.co.uk`.
The preview updates on each push and is deleted when the PR closes.

## Design (Option A: preview subdomain for each PR)

```
PR #42 opened or updated
  └─ GitHub Action: build _site → upload to preview-zone/pr-42/
       └─ comment on PR: https://pr-42.preview.joehart.co.uk
            └─ request → preview pull zone → Edge Script rewrites path
                 /blog/x  →  /pr-42/blog/x  → preview storage zone
PR closed or merged
  └─ GitHub Action: delete preview-zone/pr-42/ + purge cache
```

We chose subdomains over subfolders (`/pr-42/`) because the site uses
root-relative links (`/css/...`, `/blog/...`). There are about 12 in templates
that skip the `url` filter, and more in the Markdown posts. A subdomain for
each PR means none of those links need changing.

## Work items

1. **Bunny setup (Joe, in the dashboard)**
   - A separate storage zone (e.g. `joehart-previews`) and pull zone, kept
     apart from production so a preview can never touch the live site.
   - Hostname `*.preview.joehart.co.uk`, a CNAME pointing it at the pull
     zone's `b-cdn.net` address, and SSL (see the open questions).
   - Repo secrets: `BUNNY_PREVIEW_STORAGE_ZONE`, `BUNNY_PREVIEW_STORAGE_PASSWORD`,
     `BUNNY_PREVIEW_PULL_ZONE_ID`. `BUNNY_API_KEY` and `BUNNY_STORAGE_HOSTNAME`
     are reused.
2. **Edge Script (middleware)**: in `onOriginRequest`, read `pr-<n>` from
   the hostname and put `/pr-<n>` in front of the path. Map `/foo/` to
   `/foo/index.html` if needed. Add `X-Robots-Tag: noindex` to responses.
   - **Riskiest item; test it first.** Not yet confirmed: that middleware can
     rewrite the path sent to the origin, and that the cache key includes the
     hostname (otherwise PRs could serve each other's cached pages). If
     middleware can't do the rewrite, use a standalone Edge Script that
     fetches from storage itself.
3. **`.github/workflows/preview.yaml`**: on `pull_request` (opened,
   synchronize, reopened), for branches in this repo only. Steps: `npm ci`,
   `npm run build`, then upload. Never runs the Bluesky/Mastodon sync.
   Concurrency group per PR, separate from the production `deploy` group.
   Keeps one sticky PR comment with the preview URL up to date.
4. **`.github/scripts/bunny-preview.js`**: uses the Storage API directly with
   Node's built-in `fetch` and no dependencies.
   `upload <dir> <prefix>` clears `pr-<n>/`, then `PUT`s each file.
   `delete <prefix>` sends a `DELETE` for `pr-<n>/`. Check that Bunny deletes a
   folder and everything in it this way.
   (We're not reusing `R-J-dev/bunny-deploy`: it was archived in May 2026, and
   its README doesn't say whether delete stays inside `target-directory`.)
5. **Cleanup workflow**: on `pull_request: closed`, delete `pr-<n>/` and
   purge the cache. Optional: a weekly cleanup that removes folders left
   behind for closed PRs.
6. **Docs**: secrets and how it works.

Order: 1 → test item 2 with a folder uploaded by hand → 3–5 in one PR.

## Open questions / decisions

| #   | Question                                                      | Answer                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where is `joehart.co.uk`'s DNS hosted?                        | **Bunny DNS: confirmed** (2026-11-10). The domain is registered at Namecheap, with Custom DNS nameservers `kiki.bunny.net` and `coco.bunny.net`. Add `*.preview` in the Bunny DNS zone, and the wildcard certificate is free and automatic. Not yet checked: that the Bunny zone is named `joehart.co.uk`. If it covers only `www.joehart.co.uk`, create a zone named `preview.joehart.co.uk` in Bunny instead. |
| 2   | URL pattern                                                   | Proposed `pr-<n>.preview.joehart.co.uk`; not yet confirmed.                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Should `metadata.url` point at the preview in preview builds? | Not decided. The default leaves it as production, so the feed, canonical tags and social images point at the live site.                                                                                                                                                                                                                                                                                         |

How we checked #1: `dig` on Joe's home network returned nothing, because the
router seems to block or rewrite DNS. Asking Google DNS over HTTPS worked:
https://dns.google/resolve?name=joehart.co.uk&type=NS. The root domain returned no NS records. Asking for `www.joehart.co.uk`
returned a Bunny SOA record (above).

## Out of scope

- Previews for PRs from forks, since they can't read the repo's secrets.
- Moving production off the archived `R-J-dev/bunny-deploy` action. Worth
  doing later, possibly with the same script.
