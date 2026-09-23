# Cositeca Telegram bot

Cloudflare Worker that lets anyone with the passphrase add a Cositeca entry from
Telegram, without touching GitHub. It walks through a short conversation (Telegram
link, TMDB match confirmation, quality, languages, tags, poster) and then opens the
same kind of issue the `Añadir cosita` form would, so the existing
`.github/workflows/add-entry.yml` pipeline handles validation, the PR, the merge and
the deploy exactly as it already does today. The bot never touches `scripts/`,
workflows or issue templates directly.

TMDB search goes through the existing `cositeca-tmdb-proxy` worker
(`site/rules.js#TMDB_PROXY_URL`), so this worker doesn't need its own TMDB key.
`groups.yaml`, `qualities.yaml` and `languages.yaml` are fetched from the `main`
branch on GitHub and cached in KV for an hour, so adding a new Telegram group there
doesn't require redeploying this worker.

## One-time setup

1. **Create the Telegram bot**: talk to [@BotFather](https://t.me/BotFather),
   `/newbot`, note the token.
2. **Create the KV namespace**:
   ```sh
   cd tools/telegram-bot
   XDG_CONFIG_HOME=~/scratch/xdg wrangler kv namespace create BOT_KV
   ```
   Copy the returned `id` into `wrangler.toml` (`REPLACE_ME`).
3. **Create the dedicated GitHub account** that will open the issues (e.g.
   `cositeca-telegram-bot`). Wait at least 24h before the first real use: the
   existing anti-spam check in `scripts/lib.js` (`checkAntiSpam`) blocks issue
   authors whose account is less than a day old.
4. **Generate a fine-grained PAT** on that account, scoped only to
   `christt105/cositeca`, permission `Issues: Read and write`.
5. **Set the secrets** (from `tools/telegram-bot/`):
   ```sh
   XDG_CONFIG_HOME=~/scratch/xdg wrangler secret put TELEGRAM_BOT_TOKEN
   XDG_CONFIG_HOME=~/scratch/xdg wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any random string
   XDG_CONFIG_HOME=~/scratch/xdg wrangler secret put BOT_PASSPHRASE
   XDG_CONFIG_HOME=~/scratch/xdg wrangler secret put GITHUB_TOKEN
   XDG_CONFIG_HOME=~/scratch/xdg wrangler secret put GITHUB_WEBHOOK_SECRET       # any random string
   ```
6. **Deploy**:
   ```sh
   XDG_CONFIG_HOME=~/scratch/xdg wrangler deploy
   ```
7. **Register the Telegram webhook** (replace `<token>` and both secrets):
   ```sh
   curl "https://api.telegram.org/bot<token>/setWebhook" \
     -d "url=https://cositeca-telegram-bot.<account>.workers.dev/telegram-webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
8. **Register the GitHub webhook**: repo Settings → Webhooks → Add webhook.
   - Payload URL: `https://cositeca-telegram-bot.<account>.workers.dev/github-webhook`
   - Content type: `application/json`
   - Secret: `<GITHUB_WEBHOOK_SECRET>`
   - Events: only `Issue comments`

## Local dev

`wrangler dev` needs a `.dev.vars` (copy `.dev.vars.example`, fill in real values,
it's gitignored). Telegram/GitHub webhooks can't reach `localhost` directly; test the
logic by `curl`-ing `/telegram-webhook` and `/github-webhook` with crafted payloads
and the right secret headers instead of relying on live webhooks.

Pure parsing/formatting logic (link validation, TMDB candidate formatting, issue body
building, language keyboards) lives in `lib.js` and is covered by
`test/telegram-bot.test.js` (`npm test`). The conversation orchestration in
`worker.js` is integration-level and is exercised manually against `wrangler dev`.
