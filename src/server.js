import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSources } from './resolver.js';
import { fetchMeta } from './tmdb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '1800', 10);
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '32kb' }));
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), cacheKeys: cache.keys().length });
});

/**
 * GET /api/meta?tmdbId=...&type=movie|tv
 * Optional convenience endpoint — proxies TMDB for title/poster.
 * Only works if TMDB_API_KEY is set.
 */
app.get('/api/meta', async (req, res) => {
  try {
    const { tmdbId, type } = req.query;
    if (!tmdbId || !['movie', 'tv'].includes(type)) {
      return res.status(400).json({ error: 'tmdbId and type=movie|tv required' });
    }
    const meta = await fetchMeta(String(tmdbId), type);
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/resolve
 * Body: { tmdbId, type: 'movie'|'tv', season?, episode? }
 * Returns: { sources: [{ quality, url, type, server, headers?, subtitles? }], cached }
 *
 * No file is downloaded server-side. The client uses the returned URL directly
 * (e.g. <a download href=...> or window.location = url).
 */
app.post('/api/resolve', async (req, res) => {
  try {
    const { tmdbId, type, season, episode } = req.body || {};
    if (!tmdbId || !['movie', 'tv'].includes(type)) {
      return res.status(400).json({ error: 'tmdbId and type=movie|tv required' });
    }
    if (type === 'tv' && (!season || !episode)) {
      return res.status(400).json({ error: 'season and episode required for tv' });
    }

    const key = `${type}:${tmdbId}:${season || 0}:${episode || 0}`;
    const hit = cache.get(key);
    if (hit) return res.json({ ...hit, cached: true });

    const sources = await resolveSources({ tmdbId: String(tmdbId), type, season, episode });

    if (!sources.length) {
      return res.status(404).json({
        error: 'No sources resolved. All extractors failed — providers likely changed.',
        sources: [],
      });
    }

    const payload = { sources, cached: false, resolvedAt: Date.now() };
    cache.set(key, payload);
    res.json(payload);
  } catch (e) {
    console.error('[resolve]', e);
    res.status(500).json({ error: e.message || 'resolve failed' });
  }
});

// Static UI
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`gmax-downloader listening on :${PORT}`);
});
