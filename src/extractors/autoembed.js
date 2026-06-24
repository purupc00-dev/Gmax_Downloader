// autoembed.cc — exposes a JSON endpoint that returns direct stream links.
// If the JSON path changes, update SERVER paths below.
import { httpGet, detectType } from './_util.js';

export async function extractAutoembed({ tmdbId, type, season, episode }) {
  const path =
    type === 'movie'
      ? `https://tom.autoembed.cc/api/getVideoSource?type=movie&id=${tmdbId}`
      : `https://tom.autoembed.cc/api/getVideoSource?type=tv&id=${tmdbId}/${season}/${episode}`;

  const { text, status } = await httpGet(path, { referer: 'https://autoembed.cc/' });
  if (status >= 400) return { sources: [] };

  let j;
  try { j = JSON.parse(text); } catch { return { sources: [] }; }

  const sources = [];
  const list = j.videoSource ? [{ file: j.videoSource, label: j.quality || 'auto' }] : (j.sources || []);
  for (const s of list) {
    const url = s.file || s.url;
    if (!url) continue;
    sources.push({
      quality: String(s.label || s.quality || 'auto'),
      url,
      type: detectType(url),
      server: 'autoembed',
      subtitles: j.subtitles || j.tracks || [],
    });
  }
  return { sources };
}
