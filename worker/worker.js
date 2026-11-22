// Optional Cloudflare Worker: serves the Discord-readable page for links of the form
//   https://<your-worker>/?d=<compressed embed>
// Deploy: `npx wrangler deploy worker/worker.js --name embed-links --compatibility-date 2024-11-01`
import { decodeData, renderPage, renderOembed } from "../js/render.js";

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const d = url.searchParams.get("d");
    if (!d) return html("<!DOCTYPE html><title>Embed links</title><p>Create links with the Embed Links builder.</p>");
    let data;
    try {
      data = await decodeData(d);
    } catch {
      return html("<!DOCTYPE html><title>Invalid link</title><p>This embed link is invalid.</p>", 400);
    }
    if (url.pathname.endsWith("/oembed.json"))
      return new Response(JSON.stringify(renderOembed(data)), {
        headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
      });
    const oembedHref = `${url.origin}/oembed.json?d=${d}`;
    return html(renderPage(data, { oembedHref }));
  },
};
