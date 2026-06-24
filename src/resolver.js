import { extractVidsrc } from './extractors/vidsrc.js';
import { extractAutoembed } from './extractors/autoembed.js';
import { extractMoviesapi } from './extractors/moviesapi.js';

/**
 * Run all extractors in parallel and merge successful results.
 * Each extractor returns: { sources: [{ quality, url, type, server, headers?, subtitles? }] } or throws.
 *
 * Sources are returned with download-friendly metadata so the client can
 * either redirect the browser to a direct .mp4 (instant download) or hand
 * an .m3u8 to a JS HLS-to-MP4 muxer like ffmpeg.wasm.
 */
export async function resolveSources(params) {
  const extractors = [
    { name: 'vidsrc', fn: extractVidsrc },
    { name: 'autoembed', fn: extractAutoembed },
    { name: 'moviesapi', fn: extractMoviesapi },
  ];

  const settled = await Promise.allSettled(
    extractors.map(async ({ name, fn }) => {
      const out = await withTimeout(fn(params), 12_000, name);
      return { name, sources: out?.sources || [] };
    })
  );

  const all = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const s of r.value.sources) {
        all.push({ ...s, server: s.server || r.value.name });
      }
    } else {
      console.warn('[extractor failed]', r.reason?.message || r.reason);
    }
  }

  // De-dupe by URL, prefer mp4 over m3u8, prefer higher quality.
  const seen = new Map();
  for (const s of all) {
    const k = s.url;
    if (!seen.has(k)) seen.set(k, s);
  }

  const sorted = [...seen.values()].sort((a, b) => {
    const ta = a.type === 'mp4' ? 0 : 1;
    const tb = b.type === 'mp4' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0);
  });

  return sorted;
}

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms)),
  ]);
}
