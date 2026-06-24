# Gmax Downloader

Standalone Node.js companion for **GmaxHub**. Resolves a TMDB ID into direct stream/download URLs by scraping public embed players, then hands the URL straight to the user's browser.

- **No file storage.** Server never writes the video to disk. The resolved URL goes back to the client; the browser downloads from the source CDN directly.
- **No headless browser.** Pure HTTP + cheerio, fits Render Free (512 MB).
- **API + UI** in one app. GmaxHub hits the API; humans can also use the standalone page.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness + cache size. |
| `GET` | `/api/meta?tmdbId=&type=movie\|tv` | TMDB title/poster (needs `TMDB_API_KEY`). |
| `POST` | `/api/resolve` | Body `{ tmdbId, type, season?, episode? }`. Returns `{ sources: [...], cached }`. |

Each `source` looks like:
```json
{ "quality": "720", "url": "https://cdn…/file.m3u8", "type": "m3u8", "server": "vidsrc", "headers": { "Referer": "…" } }
```

`.mp4` URLs download directly in the browser. `.m3u8` is an HLS playlist — playable in VLC or convertible via ffmpeg/ffmpeg.wasm on the client.

## Deploy to Render (Free)

1. Push this folder to its own GitHub repo (`gmax-downloader`).
2. On Render → **New → Web Service** → connect the repo.
3. Render auto-detects `render.yaml`. Confirm:
   - Runtime: **Node**
   - Build: `npm install`
   - Start: `npm start`
   - Plan: **Free**
4. Set env vars (Dashboard → Environment):
   - `TMDB_API_KEY` — optional, only for `/api/meta`.
   - `ALLOWED_ORIGINS` — comma-separated. Set to your GmaxHub origin in prod (e.g. `https://gmaxhub.vercel.app`).
   - `CACHE_TTL_SECONDS` — default `1800`.

Render Free spins down after ~15 min of inactivity; first request after wake takes ~30 s.

## Wire it into GmaxHub

In your `TheatricalPlayer.tsx`, the existing `Download` icon can call this service. Add to `playerConfig.ts`:

```ts
export const DOWNLOADER_BASE = 'https://gmax-downloader.onrender.com';
```

Then in `TheatricalPlayer.tsx`, replace your download handler with:

```tsx
async function handleDownload() {
  const res = await fetch(`${DOWNLOADER_BASE}/api/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tmdbId,
      type: mediaType,
      season: mediaType === 'tv' ? season : undefined,
      episode: mediaType === 'tv' ? episode : undefined,
    }),
  });
  const data = await res.json();
  if (!data.sources?.length) {
    alert('No download sources available right now.');
    return;
  }
  // Prefer first mp4, fall back to first source.
  const best = data.sources.find((s: any) => s.type === 'mp4') ?? data.sources[0];
  // Direct browser download (works for mp4; m3u8 will open in player).
  window.open(best.url, '_blank');
}
```

Or just link the user to the standalone page with prefilled params:
```
https://gmax-downloader.onrender.com/?tmdbId=550&type=movie
https://gmax-downloader.onrender.com/?tmdbId=1399&type=tv&season=1&episode=1
```

## Adding / fixing extractors

Each file in `src/extractors/*.js` exports `extract<Name>({ tmdbId, type, season, episode })` and returns `{ sources: [...] }`. Add a new one and register it in `src/resolver.js`. Run all in parallel — the resolver merges, dedupes, and sorts (mp4 first, then quality).

Embed providers change paths often. If everything 404s, open the embed URL in a browser, follow the iframe chain in DevTools → Network, and update the regex/selectors in the matching extractor file.

## Local dev

```bash
cd gmax-downloader
cp .env.example .env
npm install
npm run dev   # node --watch
# open http://localhost:3000
```

## Legal note

This proxies metadata from third-party embed providers. You're responsible for complying with copyright law in your jurisdiction and with each provider's ToS. Don't deploy this to serve content you don't have rights to.
