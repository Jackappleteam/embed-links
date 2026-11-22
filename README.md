# Unfurl: Discord Embed Link Generator

A static site (GitHub Pages) with a builder, a JSON editor, a live Discord preview and link creation, including **Components V2** layouts. Visitors need no account, token or setup.

## How it works

Discord only reads server-rendered HTML, so each link points at a small Cloudflare Worker (`worker/`) that stores the embed in KV and serves the page Discord reads:

- Create Link sends the embed to `POST <worker>/api/create` and gets back a short link like `<worker>/e/ab12cd3`.
- If the Worker or its KV storage is unreachable, the site falls back to a self-contained link (`<worker>/?d=…`) that works without storage as long as it stays under ~2,000 characters.

The Worker URL lives in `js/config.js` (`WORKER_URL`). Change it there if you redeploy under another name.

## Deploying the Worker

```powershell
cd worker
npx wrangler login
npx wrangler kv namespace create EMBEDS   # paste the printed id into wrangler.toml
npx wrangler deploy
```

## Components V2 limits (enforced by the builder)

Single top-level Container, up to 40 components, 3,000-byte payload, 10 gallery images, link buttons only. Supported: Text Display, Separator, Section (thumbnail or link button), Media Gallery, Action Row. Open Graph tags are always emitted as a fallback. Test links with Discord's Embed Debugger (https://discord.com/developers/embeds). Discord caches previews about 30 minutes; add `?v=2` to refresh.

## Files

- `index.html`, `css/styles.css`: UI
- `js/app.js`: builder, JSON/HTML tabs, preview, link creation
- `js/render.js`: payload cleaning and page generation (shared with the Worker)
- `js/markdown.js`: Discord-style markdown for the preview
- `js/config.js`: Worker URL
- `worker/`: Cloudflare Worker (KV short links)
