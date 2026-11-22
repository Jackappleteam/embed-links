# Unfurl

A static, GitHub Pages–ready clone of message.style's **Embed Links** tool: a builder, a JSON editor, a live Discord preview, and link creation, including **Components V2** layouts.

No build step. Push the folder to a repo and enable Pages (Settings → Pages → deploy from branch, `/ (root)`).

## How links work on GitHub Pages

Discord only reads the HTML a server sends, and GitHub Pages is static, so every link is its own tiny page. **Create Link** commits `e/<id>/index.html` (plus `oembed.json` when you set an author or provider URL) to your repo through the GitHub API. Pages serves it a minute later and the app shows **Live** once it is up.

Setup (gear icon in the sidebar → Link settings):

1. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new limited to this repo, with **Contents: Read and write**.
2. Owner, repo and site URL are auto-detected on `*.github.io`. Set them yourself for a custom domain.
3. The token stays in this browser's localStorage only.

### Other modes

- **Worker**: instant links, no commits. Deploy `worker/worker.js` (`npx wrangler deploy worker/worker.js --name embed-links --compatibility-date 2024-11-01`) and paste the URL. The embed is compressed into the link (`?d=…`), so it must stay under ~2,000 characters.
- **Manual**: no token. You get `index.html` to upload to `e/<id>/` yourself.

## Components V2 limits (enforced by the builder)

Single top-level Container, up to 40 components, 3,000-byte payload, 10 gallery images, link buttons only. Supported: Text Display, Separator, Section (thumbnail or link button), Media Gallery, Action Row. Open Graph tags are always emitted as a fallback. Test links with Discord's Embed Debugger (https://discord.com/developers/embeds). Discord caches previews about 30 minutes; add `?v=2` to refresh.

## Files

- `index.html`, `css/styles.css`: UI
- `js/app.js`: builder, JSON/HTML tabs, preview, link creation
- `js/render.js`: payload cleaning and page generation (shared with the Worker)
- `js/markdown.js`: Discord-style markdown for the preview
