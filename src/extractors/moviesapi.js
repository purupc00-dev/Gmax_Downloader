// moviesapi.club — scrapes the embed page for the packed JWPlayer config.
import { httpGet, detectType } from './_util.js';

export async function extractMoviesapi({ tmdbId, type, season, episode }) {
  const embedUrl =
    type === 'movie'
      ? `https://moviesapi.club/movie/${tmdbId}`
      : `https://moviesapi.club/tv/${tmdbId}-${season}-${episode}`;

  const { text: html, status } = await httpGet(embedUrl);
  if (status >= 400) return { sources: [] };

  // Find iframe → fetch → look for sources: [{file:...}]
  const iframe = (html.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [])[1];
  if (!iframe) return { sources: [] };

  const iframeUrl = iframe.startsWith('//') ? 'https:' + iframe : iframe;
  const { text: iframeHtml } = await httpGet(iframeUrl, { referer: embedUrl });

  const sources = [];
  const fileMatches = [...iframeHtml.matchAll(/file:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["'](?:[^}]*label:\s*["']([^"']+)["'])?/gi)];
  for (const m of fileMatches) {
    sources.push({
      quality: m[2] || 'auto',
      url: m[1],
      type: detectType(m[1]),
      server: 'moviesapi',
      headers: { Referer: new URL(iframeUrl).origin + '/' },
    });
  }
  return { sources };
}
