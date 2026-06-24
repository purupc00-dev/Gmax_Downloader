import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Readable } from "stream";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

// Stealth Scraper Imports
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

// Dynamic Stream Servers Config
const STREAM_SERVERS = {
  movie: [
    { name: "Server VidKing", getUrl: (p: any) => `https://vidking.net/embed/movie/${p.tmdbId}?color=e50914&autoPlay=true` },
    { name: "Server Xps", getUrl: (p: any) => `https://www.2embed.cc/embed/${p.tmdbId}` },
    { name: "Server Veasy", getUrl: (p: any) => `https://player.videasy.to/movie/${p.tmdbId}` },
    { name: "Server Vapi", getUrl: (p: any) => `https://vidapi.xyz/embed/movie/${p.tmdbId}` },
    { name: "Server VSrc", getUrl: (p: any) => `https://vidsrc-embed.ru/embed/movie/${p.tmdbId}` },
    { name: "Server Vidplus", getUrl: (p: any) => `https://player2.vidplus.pro/embed/movie/${p.tmdbId}` },
    { name: "Server Bluey", getUrl: (p: any) => `https://streamsrcs.2embed.cc/vpls?tmdb=${p.tmdbId}` },
    { name: "Server 111M", getUrl: (p: any) => `https://111movies.net/movie/${p.tmdbId}` }
  ],
  tv: [
    { name: "Server VidKing", getUrl: (p: any) => `https://vidking.net/embed/tv/${p.tmdbId}/${p.season || 1}/${p.episode || 1}?color=e50914&autoPlay=true` },
    { name: "Server Xps", getUrl: (p: any) => `https://www.2embed.cc/embedtv/${p.tmdbId}&s=${p.season || 1}&e=${p.episode || 1}` },
    { name: "Server Veasy", getUrl: (p: any) => `https://player.videasy.to/tv/${p.tmdbId}/${p.season || 1}/${p.episode || 1}` },
    { name: "Server Vapi", getUrl: (p: any) => `https://vidapi.xyz/embed/tv/${p.tmdbId}/${p.season || 1}/${p.episode || 1}` },
    { name: "Server VSrc", getUrl: (p: any) => `https://vidsrc-embed.ru/embed/tv/${p.tmdbId}/${p.season || 1}-${p.episode || 1}` },
    { name: "Server Vidplus", getUrl: (p: any) => `https://player2.vidplus.pro/embed/tv/${p.tmdbId}/${p.season || 1}/${p.episode || 1}` },
    { name: "Server Bluey", getUrl: (p: any) => `https://streamsrcs.2embed.cc/vpls-tv?tmdb=${p.tmdbId}&s=${p.season || 1}&e=${p.episode || 1}` },
    { name: "Server 111M", getUrl: (p: any) => `https://111movies.net/tv/${p.tmdbId}/${p.season || 1}/${p.episode || 1}` }
  ]
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range, Authorization");
    next();
  });

  // API endpoint: CORS Proxy for M3U8 and TS segments
  app.get("/api/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).json({ error: "Missing 'url' query parameter" });
      return;
    }

    try {
      const parsedUrl = new URL(targetUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        res.status(400).json({ error: "Invalid protocol. Only HTTP and HTTPS are supported." });
        return;
      }
    } catch (e) {
      res.status(400).json({ error: "Malformed URL provided." });
      return;
    }

    try {
      // Aggressive Header Spoofing to bypass 403 Forbidden errors
      let spoofedReferer = req.query.referer as string || req.headers.referer as string;
      let spoofedOrigin = req.query.origin as string;
      const customHeadersStr = req.query.headers as string;

      if (!spoofedReferer) {
        if (targetUrl.includes("vidking")) {
          spoofedReferer = "https://vidking.net/";
          spoofedOrigin = "https://vidking.net";
        } else if (targetUrl.includes("vidsrc") || targetUrl.includes("2embed")) {
          spoofedReferer = new URL(targetUrl).origin + "/";
          spoofedOrigin = new URL(targetUrl).origin;
        } else {
          spoofedReferer = new URL(targetUrl).origin + "/";
          spoofedOrigin = new URL(targetUrl).origin;
        }
      }

      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": spoofedOrigin,
        "Referer": spoofedReferer
      };

      if (customHeadersStr) {
        try {
          const parsedCustom = JSON.parse(customHeadersStr);
          if (parsedCustom && typeof parsedCustom === "object") {
            Object.assign(headers, parsedCustom);
          }
        } catch (err) {
          console.warn("Failed to parse custom headers JSON:", err);
        }
      }

      const response = await fetch(targetUrl, {
        headers,
        method: "GET",
      });

      if (!response.ok) {
        res.status(response.status).json({
          error: `Target server responded with status ${response.status}`,
          statusText: response.statusText,
        });
        return;
      }

      const contentType = response.headers.get("content-type");
      const contentLength = response.headers.get("content-length");
      const acceptRanges = response.headers.get("accept-ranges");
      const contentRange = response.headers.get("content-range");

      if (contentType) res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
      if (contentRange) res.setHeader("Content-Range", contentRange);

      if (response.body) {
        const readable = Readable.fromWeb(response.body as any);
        readable.pipe(res);
      } else {
        res.status(200).end();
      }
    } catch (error: any) {
      console.error("Proxy error for URL:", targetUrl, error);
      res.status(500).json({
        error: "Proxy failed to fetch the resource",
        details: error.message || String(error),
      });
    }
  });

  // API endpoint: Metadata & Stream Extractor Scraper for GmaxHub
  app.get("/api/extract", async (req, res) => {
    const tmdbId = req.query.tmdbId as string;
    const mediaType = (req.query.type as string || req.query.mediaType as string || "movie").toLowerCase();
    const providerParam = (req.query.provider as string || "Server VidKing").toLowerCase();
    const season = req.query.season ? parseInt(req.query.season as string, 10) : 1;
    const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : 1;

    if (!tmdbId) {
      res.status(400).json({ error: "Missing 'tmdbId' query parameter." });
      return;
    }

    console.log(`Extracting stream for TMDB ID: ${tmdbId}, Type: ${mediaType}, Provider: ${providerParam}, S: ${season}, E: ${episode}`);

    try {
      // 1. Fetch metadata
      let title = mediaType === "movie" ? `Movie (TMDB: ${tmdbId})` : `TV Show S${season}E${episode} (ID: ${tmdbId})`;
      let overview = "Connecting to high-bitrate streaming nodes for file preparation...";
      let poster = "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80";
      let backdrop = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1080&q=80";

      const api_key = process.env.TMDB_API_KEY;
      if (api_key && api_key !== "YOUR_TMDB_API_KEY") {
        try {
          const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${api_key}&language=en-US`;
          const tmdbRes = await fetch(tmdbUrl);
          if (tmdbRes.ok) {
            const data = await tmdbRes.json();
            title = data.title || data.name || title;
            overview = data.overview || overview;
            if (data.poster_path) poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            if (data.backdrop_path) backdrop = `https://image.tmdb.org/t/p/original${data.backdrop_path}`;
          }
        } catch (tmdbErr) {
          console.warn("Failed to fetch from TMDB:", tmdbErr);
        }
      } else {
        try {
          const geminiKey = process.env.GEMINI_API_KEY;
          if (geminiKey && geminiKey !== "MY_GEMINI_API_KEY") {
            const ai = new GoogleGenAI({
              apiKey: geminiKey,
              httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
            });
            const prompt = `You are a movie catalog service. Identify title, overview, poster/backdrop for TMDB ID: "${tmdbId}" (Type: "${mediaType}"). Return raw JSON: { "title": "...", "overview": "...", "poster_path": "...", "backdrop_path": "..." }`;
            const response = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
            if (response.text) {
              const parsed = JSON.parse(response.text.replace(/```json|```/gi, "").trim());
              title = parsed.title || title;
              overview = parsed.overview || overview;
              if (parsed.poster_path) poster = parsed.poster_path.startsWith("http") ? parsed.poster_path : `https://image.tmdb.org/t/p/w500${parsed.poster_path}`;
              if (parsed.backdrop_path) backdrop = parsed.backdrop_path.startsWith("http") ? parsed.backdrop_path : `https://image.tmdb.org/t/p/original${parsed.backdrop_path}`;
            }
          }
        } catch (geminiErr) {
          console.warn("Dynamic Gemini metadata lookup failed:", geminiErr);
        }
      }

      // 2. Select Server from Config
      const availableServers = mediaType === "movie" ? STREAM_SERVERS.movie : STREAM_SERVERS.tv;
      let selectedServerObj = availableServers.find(s => s.name.toLowerCase() === providerParam.toLowerCase());
      if (!selectedServerObj) selectedServerObj = availableServers[0];

      const targetEmbedUrl = selectedServerObj.getUrl({ tmdbId, season, episode });
      let streamUrl = "";

      // 3. Launch Puppeteer to scrape the real .m3u8 file
      console.log(`[SCRAPER] Launching stealth browser to target: ${targetEmbedUrl}`);
      try {
        const browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-web-security'
          ]
        });

        const page = await browser.newPage();
        await page.setRequestInterception(true);

        page.on('request', (request) => {
          const url = request.url();
          if (url.includes('.m3u8') && !url.includes('adserver') && !streamUrl) {
            console.log(`[SCRAPER] Caught stream link: ${url}`);
            streamUrl = url; 
          }
          if (['image', 'stylesheet', 'font'].includes(request.resourceType()) || url.includes('google-analytics')) {
            request.abort();
          } else {
            request.continue();
          }
        });

        await page.goto(targetEmbedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Simulate click to trigger video load if not caught immediately
        if (!streamUrl) {
          console.log("[SCRAPER] Simulating click...");
          await page.mouse.click(500, 500);
          await new Promise(r => setTimeout(r, 4000));
        }

        await browser.close();
      } catch (scrapeErr) {
        console.error("Puppeteer Scraping Error:", scrapeErr);
      }

      if (!streamUrl) {
        throw new Error(`Failed to extract the raw .m3u8 video file from ${selectedServerObj.name}. Anti-bot protections may be active.`);
      }

      // Return exactly what the UI needs. (Notice qualities & languages are removed, App.tsx handles them natively now)
      res.status(200).json({
        success: true,
        tmdbId,
        mediaType,
        provider: selectedServerObj.name,
        title,
        overview,
        poster,
        backdrop,
        url: streamUrl,
        filename: `${title.replace(/[^a-zA-Z0-9]/g, "_")}_${mediaType === "tv" ? `S${season}E${episode}` : "Movie"}`,
        servers: availableServers.map(s => s.name)
      });
      
    } catch (e: any) {
      console.error("Extraction routing failure:", e);
      res.status(500).json({
        success: false,
        error: "Scraper extract failed to analyze target stream hosts.",
        details: e.message || String(e)
      });
    }
  });

  // API endpoint: Server-Side Segment Aggregator & Decryptor Downloader
  app.get("/api/download", async (req, res) => {
    const targetUrl = req.query.url as string;
    const filename = (req.query.filename as string || "decoded_video").replace(/[^a-zA-Z0-9_\s-]/g, "_") + ".mp4";
    const customReferer = req.query.referer as string || "";
    const customOrigin = req.query.origin as string || "";
    const customHeadersStr = req.query.headers as string || "";

    if (!targetUrl) {
      res.status(400).json({ error: "Missing 'url' query parameter." });
      return;
    }

    try {
      let spoofedReferer = customReferer;
      let spoofedOrigin = customOrigin;

      if (!spoofedReferer) {
        if (targetUrl.includes("vidking")) {
          spoofedReferer = "https://vidking.net/";
          spoofedOrigin = "https://vidking.net";
        } else {
          spoofedReferer = new URL(targetUrl).origin + "/";
          spoofedOrigin = new URL(targetUrl).origin;
        }
      }

      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": spoofedOrigin,
        "Referer": spoofedReferer
      };
      if (customHeadersStr) {
        try {
          const parsed = JSON.parse(customHeadersStr);
          Object.assign(headers, parsed);
        } catch (e) { /* ignored */ }
      }

      const m3u8Res = await fetch(targetUrl, { headers });
      if (!m3u8Res.ok) {
        res.status(400).json({ error: `HLS endpoint returned error response code ${m3u8Res.status}` });
        return;
      }

      const text = await m3u8Res.text();
      if (!text.includes("#EXTM3U")) {
        res.status(400).json({ error: "Failed to locate HLS playlist declaration tag inside document." });
        return;
      }

      const lines = text.split(/\r?\n/);
      const segments: { uri: string; keyInfo?: { method: string; uri: string; iv?: Buffer } }[] = [];
      let currentKey: { method: string; uri: string; iv?: Buffer } | undefined;
      let segmentIndex = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("#")) {
          if (trimmed.startsWith("#EXT-X-KEY:")) {
            const parts = trimmed.substring("#EXT-X-KEY:".length);
            const methodMatch = parts.match(/METHOD=([^,\s]+)/i);
            const uriMatch = parts.match(/URI="([^"]+)"/i);
            const ivMatch = parts.match(/IV=(0[xX][0-9a-fA-F]+|[0-9a-fA-F]+)/i);

            if (methodMatch && methodMatch[1].toUpperCase() === "AES-128" && uriMatch) {
              const keyAbsoluteUrl = new URL(uriMatch[1], targetUrl).href;
              let iv: Buffer | undefined;
              if (ivMatch) {
                const hex = ivMatch[1].replace(/^0[xX]/, "");
                iv = Buffer.from(hex, "hex");
              }
              currentKey = { method: "AES-128", uri: keyAbsoluteUrl, iv };
            } else {
              currentKey = undefined;
            }
          }
          continue;
        }

        const segmentAbsoluteUrl = new URL(trimmed, targetUrl).href;
        let segmentKey = currentKey ? { ...currentKey } : undefined;

        if (segmentKey && !segmentKey.iv) {
          const defaultIv = Buffer.alloc(16);
          defaultIv.writeUInt32BE(segmentIndex, 12);
          segmentKey.iv = defaultIv;
        }

        segments.push({ uri: segmentAbsoluteUrl, keyInfo: segmentKey });
        segmentIndex++;
      }

      if (segments.length === 0) {
        res.status(404).json({ error: "No physical video stream chunks could be parsed." });
        return;
      }

      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "video/mp4");

      const keyCacheMap = new Map<string, Buffer>();

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        try {
          const segRes = await fetch(seg.uri, { headers });
          if (!segRes.ok) continue;

          const rawArrayBuffer = await segRes.arrayBuffer();
          let payload = Buffer.from(rawArrayBuffer);

          if (seg.keyInfo) {
            let keyBytes = keyCacheMap.get(seg.keyInfo.uri);
            if (!keyBytes) {
              const keyRes = await fetch(seg.keyInfo.uri, { headers });
              if (keyRes.ok) {
                keyBytes = Buffer.from(await keyRes.arrayBuffer());
                keyCacheMap.set(seg.keyInfo.uri, keyBytes);
              }
            }

            if (keyBytes && keyBytes.length === 16 && seg.keyInfo.iv) {
              const decipher = crypto.createDecipheriv("aes-128-cbc", keyBytes, seg.keyInfo.iv);
              decipher.setAutoPadding(false);
              payload = Buffer.concat([decipher.update(payload), decipher.final()]);
            }
          }

          const canWrite = res.write(payload);
          if (!canWrite) {
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        } catch (segmentErr) {
          console.error(`Error processing segment ${i}:`, segmentErr);
        }
      }

      res.end();
    } catch (e: any) {
      console.error("Streaming aggregator crash:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: "Server-side HLS packer exception.", details: e.message || String(e) });
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
