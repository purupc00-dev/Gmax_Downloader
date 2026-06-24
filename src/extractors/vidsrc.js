// vidsrc.xyz / vidsrc.to family.
// Walks the embed → /prorcp/ → rcp → final source chain.
// NOTE: providers break this regularly. Update selectors/paths when it stops working.
import * as cheerio from 'cheerio';
import { httpGet, detectType } from './_util.js';

const BASES = ['https://streamsrcs.2embed.cc/vpls?tmdb=${p.tmdbId}', 'https://vidsrc.net', 'https://vidsrc-embed.ru/embed'];

export async function extractVidsrc({ tmdbId, type, season, episode }) {
  const sources = [];

  for (const base of BASES) {
    try {
      const embedUrl =
        type === 'movie'
          ? `${base}/embed/movie?tmdb=${tmdbId}`
          : `${base}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;

      const { text: embedHtml, status } = await httpGet(embedUrl, { referer: base + '/' });
      if (status >= 400) continue;

      const $ = cheerio.load(embedHtml);
      // Each server appears as an iframe src under #player_iframe or .serversList a[data-hash]
      const iframeSrc = $('#player_iframe').attr('src') || $('iframe').first().attr('src');
      if (!iframeSrc) continue;
      const iframeUrl = iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc;

      const { text: iframeHtml } = await httpGet(iframeUrl, { referer: embedUrl });
      const $$ = cheerio.load(iframeHtml);

      // Look for /prorcp/ID or /rcp/ID links
      const rcpHash = $$('a[data-hash]').first().attr('data-hash') ||
        (iframeHtml.match(/src:\s*['"]\/prorcp\/([^'"]+)/) || [])[1];

      if (rcpHash) {
        const rcpUrl = new URL(`/prorcp/${rcpHash}`, iframeUrl).toString();
        const { text: rcp } = await httpGet(rcpUrl, { referer: iframeUrl });
        const m = rcp.match(/file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
        if (m) {
          sources.push({
            quality: 'auto',
            url: m[1],
            type: detectType(m[1]),
            server: 'vidsrc',
            headers: { Referer: new URL(iframeUrl).origin + '/' },
          });
          break;
        }
      }
    } catch (e) {
      // try next base
    }
  }

  return { sources };
}
