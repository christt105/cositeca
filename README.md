# Cositeca

A small static catalog of Telegram links to movies and series, enriched with
[TMDB](https://www.themoviedb.org/) metadata. Deployed on GitHub Pages.

## How it works

- Each title is a YAML file under `movies/<tmdbId>.yaml` or `series/<tmdbId>.yaml`.
- `npm run validate` checks every file against the rules below.
- `npm run build` fetches metadata from TMDB and writes `site/catalog.json`.
- `site/` is a static, dependency-free page that reads `catalog.json`.
- New entries and fixes come in through a GitHub Issue form, processed by
  `.github/workflows/add-entry.yml`, which commits directly to `main`.

## Data format

`groups.yaml` maps an internal Telegram group id to a display name.
`qualities.yaml` is the closed, ordered list of valid quality values.

```yaml
title: Some title          # informational only, the site uses the TMDB title
links:
  - season: 1               # series only: integer >= 0 (0 = specials) or "all"
    quality: 1080p           # required, must be one of qualities.yaml
    tags: [Latino]           # optional, free-form strings
    link: https://t.me/c/2142474284/1036/81222
```

Validation rules (implemented once in `scripts/lib.js`, reused by `validate`,
`build` and `add-entry`):

- Filename matches `^\d+\.yaml$` and lives under `movies/` or `series/`.
- `links` is non-empty. `quality` must be listed in `qualities.yaml`.
- `season` is required under `series/` (integer >= 0 or the string `all`) and
  forbidden under `movies/`.
- `link` must match `^https://t\.me/c/(\d+)/(?:(\d+)/)?(\d+)$`. The captured
  group id must exist in `groups.yaml`. Invite links (`t.me/+...`,
  `joinchat`, or anything not starting with `https://t.me/c/`) are rejected.
- The same `link` cannot appear twice in the whole repository.

## TMDB

A minimal client in `scripts/lib.js` uses native `fetch`. If the API key
starts with `eyJ` it is sent as a `Bearer` token, otherwise as `?api_key=`.
Every request uses `language=es-ES`. Titles can be identified by a
`themoviedb.org` URL, a `tmdb:<id>` reference, or an IMDB id (resolved via
`/3/find`).

## Adding or fixing an entry

See [`GUIA.md`](GUIA.md) (Spanish) for the end-user flow through GitHub
Issues.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
