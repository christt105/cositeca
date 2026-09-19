# Cositeca

A small static catalog of Telegram links to movies and series, enriched with
[TMDB](https://www.themoviedb.org/) metadata. Deployed on GitHub Pages.

## How it works

- Each title is a YAML file under `movies/<tmdbId>.yaml` or `series/<tmdbId>.yaml`.
- `npm run validate` checks every file against the rules below.
- `npm run build` fetches metadata from TMDB and writes `site/catalog.json`
  (minified) plus one `site/titles/<type>-<id>.json` per title with the
  synopsis, tagline, genres, runtime or season count, backdrop and vote,
  taken from the same TMDB responses the catalog already needs (no extra
  requests). `site/titles/` is wiped on every build so deleted titles leave
  no orphans; both outputs are gitignored.
- `site/` is a static, dependency-free page that reads `catalog.json`. A
  hash router in `app.js` serves `#/` (grid with search and filters, both
  kept in the hash so back/forward and shared URLs restore them),
  `#/movie/<tmdbId>` and `#/series/<tmdbId>` (one page per title, which
  also fetches `titles/<type>-<id>.json` when it exists) and `#/add`
  (`add.js`: TMDB search through the proxy, poster picker and a form that
  opens the add issue with every field prefilled by query string; it reads
  `site/meta.json`, written by `build`, for the quality, language and group
  lists). It accepts `#/add?q=<search>` and `#/add?tmdb=<url>`.
- `site/rules.js` holds the regexes and URL helpers shared by the page and
  the Node scripts (`scripts/lib.js` imports it), so `site/` needs no build
  step and the rules exist once.
- New entries, link fixes/deletions and poster changes come in through
  GitHub Issue forms (`add.yml`, `fix.yml`, `poster.yml`, `reidentify.yml`, told apart by
  their `add`/`fix`/`poster` label), processed by
  `.github/workflows/add-entry.yml`, which commits directly to `main`. The
  title page and the add page open those forms with every field prefilled
  by query string, so users only review and submit.
- `reidentify.yml` moves one link (`old_link`) or, if empty, every link of
  the entry at `tmdb` to another title (`new_tmdb`), creating the target
  file or appending to an existing one and deleting the source if it ends
  up empty. Seasons: movie to series requires `season` (applied to every
  moved link), series to movie drops it, series to series keeps each link's
  own unless `season` overrides it. `poster` and `seasonPosters` describe
  the old title, so they are never carried over; the optional `poster`
  field sets one for the target. Moving a single link only prunes
  `seasonPosters` entries for seasons with no links left. Batch mode
  accepts it as an operation of type `reidentify`.

## Data format

`groups.yaml` maps an internal Telegram group id to a display name.
`qualities.yaml` is the closed, ordered list of valid quality values.
`languages.yaml` holds the closed lists of valid `audio` and `subs` values
(the `subs` list is the audio one plus `Forzados`). Add a language there and
it becomes valid everywhere; the issue forms mention the options in the
field description (quality, audio and subs are plain text inputs because
GitHub only prefills `input` fields from the query string, not dropdowns).

```yaml
title: Some title          # informational only, the site uses the TMDB title
poster: https://example.com/poster.jpg  # optional, overrides the TMDB poster
seasonPosters:              # series only, optional: per-season poster override
  1: https://example.com/season1.jpg  # key matches a `season` value below
  all: https://example.com/complete.jpg
links:
  - season: 1               # series only: integer >= 0 (0 = specials), "all", or any
                             # other number, does not need to exist in TMDB
    quality: 1080p           # required, must be one of qualities.yaml
    audio: [Castellano]      # optional, values from languages.yaml audio
    subs: [Castellano]       # optional, values from languages.yaml subs
    tags: [HDR]              # optional, free-form strings
    link: https://t.me/c/2142474284/1036/81222
```

Validation rules (implemented once in `scripts/lib.js`, reused by `validate`,
`build` and `add-entry`):

- Filename matches `^\d+\.yaml$` and lives under `movies/` or `series/`.
- `links` is non-empty. `quality` must be listed in `qualities.yaml`.
- `audio` and `subs`, if present, are arrays of strings listed in
  `languages.yaml`, without duplicates. Language goes here, not in `tags`.
- `season` is required under `series/` (integer >= 0 or the string `all`) and
  forbidden under `movies/`. It does not need to match a season TMDB knows
  about: if `build` can't find it there, the season falls back to a
  "Temporada N" name and the poster described below, instead of dropping
  the whole title.
- `link` must match `^https://t\.me/c/(\d+)/(?:(\d+)/)?(\d+)$`. The captured
  group id must exist in `groups.yaml`. Invite links (`t.me/+...`,
  `joinchat`, or anything not starting with `https://t.me/c/`) are rejected.
- The same `link` cannot appear twice in the whole repository.
- `poster`, if present, must be a non-empty string and is used as-is instead
  of the TMDB poster. The add issue form has an optional Portada field for
  it; the bot writes it at the top of the file (and replaces an existing
  one).
- `seasonPosters`, series only, optional: a map from a `season` value (same
  number or `"all"` used in `links`) to a poster URL. Checked before the
  TMDB season poster, and used as the fallback when TMDB has no poster for
  that season or the season doesn't exist there at all.

## TMDB

A minimal client in `scripts/lib.js` uses native `fetch`. If the API key
starts with `eyJ` it is sent as a `Bearer` token, otherwise as `?api_key=`.
Every request uses `language=es-ES`. Titles can be identified by a
`themoviedb.org` URL, a `tmdb:<id>` reference, or an IMDB id (resolved via
`/3/find`).

`validate` and `build` share a JSON response cache (`.cache/tmdb.json` by
default, override with `TMDB_CACHE_PATH`) so re-running them only fetches
TMDB data for ids not already cached. In CI (`deploy.yml`) that directory is
persisted with `actions/cache`, keyed per run and restored from the most
recent previous run, so a push that only adds one new title doesn't refetch
metadata for the whole catalog.

## PWA and offline

`site/manifest.webmanifest` (relative `start_url`/`scope`, standalone,
icons in `site/assets/`, generated from `icon.svg`) makes the site
installable; `index.html` also carries the `apple-touch-icon` and
`apple-mobile-web-app-*` tags iOS needs. `site/sw.js` is a service worker
registered from `app.js`: it precaches the shell plus `catalog.json` and
`meta.json` on install, then serves everything same-origin (and posters
from `image.tmdb.org`, capped at 300) network-first with cache fallback,
so a deploy is picked up as soon as there is network and the last seen
catalog still opens offline. A new worker activates immediately
(`skipWaiting` + `clients.claim`) and the page reloads once when the
controller changes. Bump `CACHE` in `sw.js` when the shell file list
changes.

## TMDB proxy (Cloudflare Worker)

The page never holds a TMDB key. The guided "Añadir" page searches TMDB
through a small Cloudflare Worker in `tools/tmdb-proxy/` (`worker.js`, no
dependencies, `wrangler.toml`). It exposes only a few read-only routes,
always with `language=es-ES`, and rejects anything else with 404:

- `GET /search?q=<text>&type=movie|tv|multi&page=<1-99>`
- `GET /images?type=movie|tv&id=<tmdbId>` (posters, `es,en,null`)
- `GET /movie/<tmdbId>` and `GET /tv/<tmdbId>` (title info; series include
  the seasons list)
- `GET /find/<imdbId>` (resolve an IMDB id)

CORS is limited to `https://christt105.github.io`, `localhost`,
`127.0.0.1` and `192.168.x.x` (local previews). Responses are cached at
the edge (1 h for searches, 1 day for images and series) and a
`[[ratelimits]]` binding caps each IP at 60 requests per minute so the
Worker cannot be used as a public TMDB mirror.

Local development (no account needed): put `TMDB_API_KEY=...` in
`tools/tmdb-proxy/.dev.vars` (gitignored) and run
`npx wrangler dev` from that directory; it listens on `localhost:8787`.

Deploy (once per change, from `tools/tmdb-proxy/`, with
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment):

```sh
npx wrangler deploy
npx wrangler secret put TMDB_API_KEY
```

The Worker is deployed at
`https://cositeca-tmdb-proxy.christt105.workers.dev`, which is the
`TMDB_PROXY_URL` constant in `site/rules.js`. If that constant were empty
the page would use `localStorage.tmdbProxy` if set (development only) and
otherwise fall back to the plain GitHub issue form.

## Catalog order

`build` sorts the catalog by when each `movies/<id>.yaml` / `series/<id>.yaml`
file was first added to git history (newest first), not alphabetically. It
reads this from `git log --diff-filter=A`, so it needs full history
(`fetch-depth: 0` in `deploy.yml`); files not yet committed sort first. Ties
(e.g. files added in the same bulk-import commit) fall back to alphabetical
by title.

## Adding or fixing an entry

See [`GUIA.md`](GUIA.md) (Spanish) for the end-user flow through GitHub
Issues.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

The footer shows the official TMDB logo (`site/assets/tmdb.svg`, the
"primary short, blue" SVG from
[TMDB's logos and attribution page](https://www.themoviedb.org/about/logos-attribution)),
unmodified and linked to themoviedb.org, as their terms require.
